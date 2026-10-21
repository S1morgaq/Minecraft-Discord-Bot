const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Giveaway, GiveawayEntry, GiveawayHistory } = require('../../database/models');
const theme = require('../../config/theme');
const ids = require('../../utils/ids');
const { ts } = require('../../utils/duration');
const { logger, safeError } = require('../../utils/logger');
const { UserError } = require('../../utils/errors');
const { audit } = require('../audit');
const { notify } = require('../notifier');
const { pickWinners, checkEligibility } = require('./logic');

const CHECK_INTERVAL_MS = 5000;
const EDIT_DEBOUNCE_MS = 5000;
let timer = null;
const editTimers = new Map();
const ending = new Set(); // aynı süreçte eşzamanlı sonuçlandırmaya karşı ek koruma

// ---------- Görünüm ----------
function buildEmbed(g) {
  const e = theme.embed(`${theme.EMOJI.giveaway} ${g.prize}`, null, theme.COLORS.purple);
  const lines = [];
  if (g.description) lines.push(g.description, '');
  if (g.status === 'active' || g.status === 'ending') {
    lines.push(`**Bitiş:** ${ts(g.endsAt, 'R')} (${ts(g.endsAt, 'f')})`);
  } else if (g.status === 'cancelled') {
    e.setColor(theme.COLORS.error);
    lines.push('**Bu çekiliş iptal edildi.**');
  } else {
    e.setColor(theme.COLORS.cyan);
    lines.push(`**Sona erdi:** ${ts(g.endedAt || g.endsAt, 'f')}`);
    lines.push(g.winners.length ? `**Kazananlar:** ${g.winners.map((w) => `<@${w}>`).join(', ')}` : '**Kazanan:** Geçerli katılımcı yok.');
  }
  lines.push(`**Düzenleyen:** <@${g.hostId}>`);
  e.setDescription(lines.join('\n'));
  e.addFields(
    { name: 'Kazanan sayısı', value: String(g.winnerCount), inline: true },
    { name: 'Katılımcı', value: String(g.entryCount), inline: true },
  );
  const rules = [];
  if (g.requiredRoleId) rules.push(`Gerekli rol: <@&${g.requiredRoleId}>`);
  if (g.excludedRoleIds?.length) rules.push(`Hariç roller: ${g.excludedRoleIds.map((r) => `<@&${r}>`).join(', ')}`);
  if (g.minAccountAgeDays) rules.push(`Min. hesap yaşı: ${g.minAccountAgeDays} gün`);
  if (g.minMemberDays) rules.push(`Min. üyelik: ${g.minMemberDays} gün`);
  if (rules.length) e.addFields({ name: 'Koşullar', value: rules.join('\n') });
  if (g.imageUrl) e.setImage(g.imageUrl);
  return e;
}

function buildComponents(g) {
  const open = g.status === 'active';
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(ids.id('gw', 'join', String(g._id))).setLabel(g.buttonLabel || 'Katıl')
      .setEmoji('🎉').setStyle(ButtonStyle.Primary).setDisabled(!open),
  );
  if (open && g.allowLeave) {
    row.addComponents(new ButtonBuilder().setCustomId(ids.id('gw', 'leave', String(g._id))).setLabel('Ayrıl').setStyle(ButtonStyle.Secondary));
  }
  return [row];
}

const render = (g) => ({ embeds: [buildEmbed(g)], components: buildComponents(g), allowedMentions: { parse: [] } });

async function fetchMessage(client, g) {
  if (!g.messageId) return null;
  const ch = await client.channels.fetch(g.channelId).catch(() => null);
  return ch?.isTextBased() ? ch.messages.fetch(g.messageId).catch(() => null) : null;
}

async function refreshMessage(client, id) {
  const g = await Giveaway.findById(id).lean();
  if (!g) return;
  const msg = await fetchMessage(client, g);
  await msg?.edit(render(g)).catch((err) => logger.warn({ err: safeError(err) }, 'Çekiliş mesajı güncellenemedi'));
}

/** Katılımcı sayısı güncellemelerini art arda düzenleme yapmamak için birleştirir. */
function scheduleRefresh(client, id) {
  const key = String(id);
  if (editTimers.has(key)) return;
  editTimers.set(key, setTimeout(() => {
    editTimers.delete(key);
    refreshMessage(client, key);
  }, EDIT_DEBOUNCE_MS).unref());
}

// ---------- Oluşturma ----------
async function create(client, channel, fields) {
  const g = await Giveaway.create({ ...fields, guildId: channel.guildId, channelId: channel.id });
  try {
    const msg = await channel.send(render(g.toObject()));
    g.messageId = msg.id;
    await g.save();
  } catch (err) {
    await Giveaway.deleteOne({ _id: g._id });
    throw err;
  }
  await audit(g.guildId, g.hostId, 'giveaway.create', String(g._id), { prize: g.prize });
  await notify(client, g.guildId, 'giveawayNew', {
    embeds: [theme.embed(`${theme.EMOJI.giveaway} Yeni çekiliş!`, `**${g.prize}** için çekiliş başladı: https://discord.com/channels/${g.guildId}/${g.channelId}/${g.messageId}`)],
  });
  return g;
}

// ---------- Katılım ----------
async function join(interaction, giveawayId) {
  const g = await Giveaway.findById(giveawayId).lean();
  if (!g || g.status !== 'active' || g.endsAt <= new Date()) throw new UserError('Bu çekiliş artık aktif değil.');

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const why = checkEligibility(
    g,
    { roleIds: member.roles.cache.keys(), joinedAt: member.joinedTimestamp },
    { createdAt: interaction.user.createdTimestamp },
  );
  if (why) throw new UserError(why);

  try {
    await GiveawayEntry.create({ giveawayId: g._id, guildId: g.guildId, userId: interaction.user.id });
  } catch (err) {
    if (err.code === 11000) throw new UserError('Bu çekilişe zaten katıldın.');
    throw err;
  }
  const upd = await Giveaway.findByIdAndUpdate(g._id, { $inc: { entryCount: 1 } }, { new: true, lean: true });
  scheduleRefresh(interaction.client, g._id);
  return upd.entryCount;
}

async function leave(interaction, giveawayId) {
  const g = await Giveaway.findById(giveawayId).lean();
  if (!g || g.status !== 'active') throw new UserError('Bu çekiliş artık aktif değil.');
  if (!g.allowLeave) throw new UserError('Bu çekilişten ayrılma kapalı.');
  const res = await GiveawayEntry.deleteOne({ giveawayId: g._id, userId: interaction.user.id });
  if (!res.deletedCount) throw new UserError('Bu çekilişe katılmamışsın.');
  await Giveaway.updateOne({ _id: g._id }, { $inc: { entryCount: -1 } });
  scheduleRefresh(interaction.client, g._id);
}

// ---------- Kazanan seçimi ----------
async function eligibleEntrants(guild, g, excludeIds = []) {
  const entries = await GiveawayEntry.find({ giveawayId: g._id }).select('userId').lean();
  const userIds = entries.map((e) => e.userId).filter((u) => !excludeIds.includes(u));
  const valid = [];
  for (let i = 0; i < userIds.length; i += 100) {
    const chunk = userIds.slice(i, i + 100);
    const members = await guild.members.fetch({ user: chunk }).catch(() => null);
    if (!members) continue;
    for (const m of members.values()) {
      const roles = new Set(m.roles.cache.keys());
      if (g.requiredRoleId && !roles.has(g.requiredRoleId)) continue;
      if (g.excludedRoleIds.some((r) => roles.has(r))) continue;
      valid.push(m.id);
    }
  }
  return valid;
}

async function announceWinners(client, g, winners, { reroll = false } = {}) {
  const ch = await client.channels.fetch(g.channelId).catch(() => null);
  if (!ch?.isTextBased()) return;
  const link = g.messageId ? `https://discord.com/channels/${g.guildId}/${g.channelId}/${g.messageId}` : '';
  const text = winners.length
    ? `${theme.EMOJI.giveaway} ${reroll ? 'Yeni kazanan(lar)' : 'Tebrikler'} ${winners.map((w) => `<@${w}>`).join(', ')}! **${g.prize}** kazandın. ${link}`
    : `${theme.EMOJI.giveaway} **${g.prize}** çekilişi için geçerli katılımcı bulunamadı. ${link}`;
  await ch.send({ content: text, allowedMentions: { users: winners } }).catch((err) => logger.warn({ err: safeError(err) }, 'Kazanan duyurusu gönderilemedi'));

  for (const id of winners) {
    const user = await client.users.fetch(id).catch(() => null);
    // DM kapalıysa çekiliş etkilenmez.
    await user?.send({ embeds: [theme.success(`**${g.prize}** çekilişini kazandın! ${link}`, '🎉 Tebrikler!')] }).catch(() => {});
  }
}

// ---------- Sonuçlandırma (tek seferlik) ----------
async function end(client, id, { by = null } = {}) {
  const key = String(id);
  if (ending.has(key)) return null;
  ending.add(key);
  try {
    // Atomik talep: yalnızca bir çağrı 'active' -> 'ending' geçişini yapabilir.
    const claimed = await Giveaway.findOneAndUpdate(
      { _id: id, status: 'active' },
      { $set: { status: 'ending', endingStartedAt: new Date() } },
      { new: true },
    );
    if (!claimed) return null;

    let winners;
    try {
      const guild = await client.guilds.fetch(claimed.guildId);
      const pool = await eligibleEntrants(guild, claimed);
      winners = pickWinners(pool, claimed.winnerCount);
    } catch (err) {
      await Giveaway.updateOne({ _id: id, status: 'ending' }, { $set: { status: 'active' } }); // yeniden denenebilsin
      throw err;
    }

    const done = await Giveaway.findOneAndUpdate(
      { _id: id, status: 'ending' },
      { $set: { status: 'ended', winners, endedAt: new Date() } },
      { new: true, lean: true },
    );
    await GiveawayHistory.create({ giveawayId: id, guildId: done.guildId, kind: 'end', winners, actorId: by });
    await audit(done.guildId, by, 'giveaway.end', key, { winners });

    const msg = await fetchMessage(client, done);
    await msg?.edit(render(done)).catch(() => {});
    await announceWinners(client, done, winners);
    await notify(client, done.guildId, 'giveawayEnd', {
      embeds: [theme.embed(`${theme.EMOJI.giveaway} Çekiliş sonuçlandı`, `**${done.prize}** — ${winners.length ? winners.map((w) => `<@${w}>`).join(', ') : 'kazanan yok'}`)],
    });
    return done;
  } finally {
    ending.delete(key);
  }
}

async function reroll(client, id, { by, count } = {}) {
  const g = await Giveaway.findById(id).lean();
  if (!g) throw new UserError('Çekiliş bulunamadı.');
  if (g.status !== 'ended') throw new UserError('Yalnızca sona ermiş çekilişler yeniden çekilebilir.');
  const past = await GiveawayHistory.find({ giveawayId: g._id }).lean();
  const exclude = [...new Set([...g.winners, ...past.flatMap((h) => h.winners)])];
  const guild = await client.guilds.fetch(g.guildId);
  const pool = await eligibleEntrants(guild, g, exclude);
  const winners = pickWinners(pool, count || g.winnerCount);
  await GiveawayHistory.create({ giveawayId: g._id, guildId: g.guildId, kind: 'reroll', winners, actorId: by });
  await audit(g.guildId, by, 'giveaway.reroll', String(g._id), { winners });
  await announceWinners(client, g, winners, { reroll: true });
  return winners;
}

async function cancel(client, id, by) {
  const g = await Giveaway.findOneAndUpdate(
    { _id: id, status: 'active' }, { $set: { status: 'cancelled', endedAt: new Date() } }, { new: true, lean: true },
  );
  if (!g) throw new UserError('Yalnızca aktif çekilişler iptal edilebilir.');
  await GiveawayHistory.create({ giveawayId: g._id, guildId: g.guildId, kind: 'cancel', actorId: by });
  await audit(g.guildId, by, 'giveaway.cancel', String(g._id));
  const msg = await fetchMessage(client, g);
  await msg?.edit(render(g)).catch(() => {});
  return g;
}

async function extend(client, id, addMs, by) {
  const g = await Giveaway.findOneAndUpdate(
    { _id: id, status: 'active' }, [{ $set: { endsAt: { $add: ['$endsAt', addMs] } } }], { new: true, lean: true },
  );
  if (!g) throw new UserError('Yalnızca aktif çekilişler uzatılabilir.');
  await GiveawayHistory.create({ giveawayId: g._id, guildId: g.guildId, kind: 'extend', actorId: by, note: `+${addMs}ms` });
  await audit(g.guildId, by, 'giveaway.extend', String(g._id), { addMs });
  const msg = await fetchMessage(client, g);
  await msg?.edit(render(g)).catch(() => {});
  return g;
}

// ---------- Zamanlayıcı ----------
async function tick(client) {
  const due = await Giveaway.find({ status: 'active', endsAt: { $lte: new Date() } }).select('_id').limit(20).lean();
  for (const { _id } of due) {
    await end(client, _id).catch((err) => logger.error({ err: safeError(err), id: String(_id) }, 'Çekiliş sonuçlandırılamadı'));
  }
}

/** Yeniden başlatmada yarıda kalmış 'ending' çekilişleri geri alır ve zamanlayıcıyı başlatır. */
async function start(client) {
  const stale = await Giveaway.updateMany(
    { status: 'ending', endingStartedAt: { $lt: new Date(Date.now() - 60_000) } },
    { $set: { status: 'active' } },
  );
  if (stale.modifiedCount) logger.warn({ count: stale.modifiedCount }, 'Yarım kalan çekilişler kurtarıldı');
  tick(client).catch(() => {});
  timer = setInterval(() => tick(client).catch((err) => logger.error({ err: safeError(err) }, 'Çekiliş zamanlayıcı hatası')), CHECK_INTERVAL_MS);
  timer.unref();
}

const stop = () => clearInterval(timer);

module.exports = { create, join, leave, end, reroll, cancel, extend, start, stop, tick, buildEmbed, render, refreshMessage };
