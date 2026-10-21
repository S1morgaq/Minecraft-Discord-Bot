const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, PermissionFlagsBits: P, AttachmentBuilder,
} = require('discord.js');
const { Ticket, TicketTranscript } = require('../../database/models');
const theme = require('../../config/theme');
const ids = require('../../utils/ids');
const guildConfig = require('../guildConfig');
const { audit } = require('../audit');
const { UserError } = require('../../utils/errors');
const { logger, safeError } = require('../../utils/logger');
const { clean, truncate } = require('../../utils/text');

const MAX_TRANSCRIPT_MESSAGES = 2000;
const opening = new Set(); // aynı kullanıcının eşzamanlı açma isteklerini sıraya sokar

function panelPayload(cfg) {
  const embed = theme.embed(`${theme.EMOJI.ticket} Destek Merkezi`, 'Yardıma mı ihtiyacın var? Aşağıdan bir kategori seç, ekibimiz sana özel bir kanal açsın.', theme.COLORS.purple);
  const menu = new StringSelectMenuBuilder().setCustomId(ids.id('ticket', 'open')).setPlaceholder('Bir kategori seç…')
    .addOptions(cfg.tickets.categories.slice(0, 25).map((c) => ({ label: truncate(c, 100), value: truncate(c, 100) })));
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

const ticketButtons = (claimed = false, closed = false) => [new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(ids.id('ticket', 'close')).setLabel('Kapat').setEmoji('🔒').setStyle(ButtonStyle.Danger).setDisabled(closed),
  new ButtonBuilder().setCustomId(ids.id('ticket', 'claim')).setLabel(claimed ? 'Devralındı' : 'Devral').setEmoji('🙋').setStyle(ButtonStyle.Success).setDisabled(claimed || closed),
)];

async function open(interaction, category) {
  const { guild, user } = interaction;
  const cfg = await guildConfig.get(guild.id);
  if (!cfg.tickets.categories.includes(category)) throw new UserError('Geçersiz kategori.');
  const key = `${guild.id}:${user.id}`;
  if (opening.has(key)) throw new UserError('Biletin zaten oluşturuluyor, lütfen bekle.');
  opening.add(key);
  try {
    const openCount = await Ticket.countDocuments({ guildId: guild.id, userId: user.id, status: 'open' });
    if (openCount >= cfg.tickets.limitPerUser) {
      throw new UserError(`En fazla **${cfg.tickets.limitPerUser}** açık biletin olabilir. Önce mevcut biletlerini kapat.`);
    }
    const me = guild.members.me;
    if (!me.permissions.has([P.ManageChannels, P.ManageRoles])) throw new UserError('Bilet kanalı oluşturmak için iznim yok; bir yetkiliye haber ver.');

    const updated = await guildConfig.update(guild.id, { $inc: { 'tickets.counter': 1 } });
    const number = updated.tickets.counter;
    const staffRoles = [cfg.roles.admin, cfg.roles.mod, cfg.roles.support].filter(Boolean);
    const allow = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];

    const channel = await guild.channels.create({
      name: `bilet-${String(number).padStart(4, '0')}`,
      type: ChannelType.GuildText,
      parent: cfg.channels.ticketCategory || undefined,
      topic: `Bilet #${number} • ${user.id} • ${category}`,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
        { id: user.id, allow },
        { id: me.id, allow: [...allow, P.ManageChannels, P.ManageMessages] },
        ...staffRoles.map((id) => ({ id, allow })),
      ],
      reason: `Destek bileti: ${user.tag}`,
    });

    let ticket;
    try {
      ticket = await Ticket.create({ guildId: guild.id, number, channelId: channel.id, userId: user.id, category, actions: [{ actorId: user.id, action: 'open' }] });
    } catch (err) {
      await channel.delete().catch(() => {});
      throw err;
    }
    const embed = theme.embed(`${theme.EMOJI.ticket} Bilet #${number} — ${category}`, `Merhaba ${user}, ekibimiz en kısa sürede ilgilenecek.\nSorununu ayrıntılı şekilde yaz.`);
    await channel.send({
      content: `${user}${staffRoles.length ? ` ${staffRoles.map((r) => `<@&${r}>`).join(' ')}` : ''}`,
      embeds: [embed], components: ticketButtons(),
      allowedMentions: { users: [user.id], roles: staffRoles },
    });
    await audit(guild.id, user.id, 'ticket.open', String(ticket._id), { number, category });
    return channel;
  } finally {
    opening.delete(key);
  }
}

async function claim(interaction) {
  const t = await Ticket.findOneAndUpdate(
    { channelId: interaction.channelId, status: 'open', claimedBy: null },
    { $set: { claimedBy: interaction.user.id }, $push: { actions: { actorId: interaction.user.id, action: 'claim' } } },
    { new: true },
  );
  if (!t) throw new UserError('Bilet zaten devralınmış veya kapalı.');
  await audit(t.guildId, interaction.user.id, 'ticket.claim', String(t._id));
  return t;
}

async function buildTranscript(channel) {
  const lines = [];
  let before;
  while (lines.length < MAX_TRANSCRIPT_MESSAGES) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    for (const m of batch.values()) {
      const att = m.attachments.size ? ` [ekler: ${[...m.attachments.values()].map((a) => a.url).join(', ')}]` : '';
      lines.push(`[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.cleanContent}${att}`);
    }
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return lines.reverse();
}

/** Bileti atomik olarak kapatır, transcript'i saklar ve kanalı siler. */
async function close(interaction, reason) {
  const t = await Ticket.findOneAndUpdate(
    { channelId: interaction.channelId, status: 'open' },
    { $set: { status: 'closed', closedBy: interaction.user.id, closeReason: clean(reason || 'Belirtilmedi', 300), closedAt: new Date() },
      $push: { actions: { actorId: interaction.user.id, action: 'close' } } },
    { new: true },
  );
  if (!t) throw new UserError('Bu kanal açık bir bilet değil.');
  const channel = interaction.channel;
  const lines = await buildTranscript(channel).catch((err) => {
    logger.error({ err: safeError(err) }, 'Transcript oluşturulamadı');
    return ['(transcript oluşturulamadı)'];
  });
  const text = `Bilet #${t.number} — ${t.category}\nAçan: ${t.userId}\nKapatan: ${t.closedBy}\nSebep: ${t.closeReason}\n${'-'.repeat(40)}\n${lines.join('\n')}`;
  await TicketTranscript.create({ ticketId: t._id, guildId: t.guildId, messageCount: lines.length, text });
  await audit(t.guildId, interaction.user.id, 'ticket.close', String(t._id), { reason: t.closeReason });

  const cfg = await guildConfig.get(t.guildId);
  const file = () => new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `bilet-${t.number}.txt` });
  const summary = theme.embed(`${theme.EMOJI.ticket} Bilet #${t.number} kapatıldı`, null, theme.COLORS.primary).addFields(
    { name: 'Açan', value: `<@${t.userId}>`, inline: true },
    { name: 'Kapatan', value: `<@${t.closedBy}>`, inline: true },
    { name: 'Devralan', value: t.claimedBy ? `<@${t.claimedBy}>` : '—', inline: true },
    { name: 'Kategori', value: t.category, inline: true },
    { name: 'Sebep', value: t.closeReason },
  );
  const logCh = cfg.channels.ticketLog && (await interaction.client.channels.fetch(cfg.channels.ticketLog).catch(() => null));
  await logCh?.send({ embeds: [summary], files: [file()], allowedMentions: { parse: [] } }).catch(() => {});
  const opener = await interaction.client.users.fetch(t.userId).catch(() => null);
  await opener?.send({ embeds: [summary], files: [file()] }).catch(() => {});

  setTimeout(() => channel.delete(`Bilet #${t.number} kapatıldı`).catch(() => {}), 8000).unref();
  return t;
}

async function setUserAccess(interaction, user, allowed) {
  const t = await Ticket.findOne({ channelId: interaction.channelId, status: 'open' });
  if (!t) throw new UserError('Bu komut yalnızca açık bilet kanallarında kullanılabilir.');
  if (user.id === t.userId) throw new UserError('Bilet sahibinin erişimi değiştirilemez.');
  if (allowed) {
    await interaction.channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
  } else {
    await interaction.channel.permissionOverwrites.delete(user.id);
  }
  await Ticket.updateOne({ _id: t._id }, {
    ...(allowed ? { $addToSet: { addedUserIds: user.id } } : { $pull: { addedUserIds: user.id } }),
    $push: { actions: { actorId: interaction.user.id, action: allowed ? `add:${user.id}` : `remove:${user.id}` } },
  });
  await audit(t.guildId, interaction.user.id, allowed ? 'ticket.add_user' : 'ticket.remove_user', String(t._id), { user: user.id });
}

module.exports = { panelPayload, open, claim, close, setUserAccess, ticketButtons };
