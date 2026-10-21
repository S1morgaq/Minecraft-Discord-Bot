const { SlashCommandBuilder, PermissionFlagsBits: P, MessageFlags } = require('discord.js');
const { Warning, ModerationLog } = require('../../database/models');
const mod = require('../../services/moderation/service');
const theme = require('../../config/theme');
const { ensure } = require('../../utils/permissions');
const { UserError } = require('../../utils/errors');
const { parseDuration, ts, formatDuration } = require('../../utils/duration');
const { clean, truncate } = require('../../utils/text');

const MAX_TIMEOUT = 28 * 86_400_000;
const base = (name, desc, perm) => new SlashCommandBuilder().setName(name).setDescription(desc).setDefaultMemberPermissions(perm).setContexts(0);
const userOpt = (o, desc = 'Hedef kullanıcı') => o.setName('kullanıcı').setDescription(desc).setRequired(true);
const reasonOpt = (o) => o.setName('sebep').setDescription('Sebep').setMaxLength(400);
const reasonOf = (i) => clean(i.options.getString('sebep') || 'Belirtilmedi', 400);
const E = MessageFlags.Ephemeral;

async function targetMember(interaction, user) {
  const m = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!m) throw new UserError('Bu kullanıcı sunucuda bulunmuyor.');
  return m;
}

const guard = (fn) => async (interaction, client) => {
  if (!(await ensure(interaction, 'mod'))) return;
  await interaction.deferReply({ flags: E });
  return fn(interaction, client);
};
const done = (i, text) => i.editReply({ embeds: [theme.success(text)] });

const commands = [
  {
    data: base('uyar', 'Kullanıcıyı uyarır', P.ModerateMembers)
      .addUserOption(userOpt).addStringOption((o) => reasonOpt(o).setRequired(true)),
    execute: guard(async (i, client) => {
      const user = i.options.getUser('kullanıcı');
      const member = await targetMember(i, user);
      mod.assertCanTarget(i, member);
      const reason = reasonOf(i);
      const w = await Warning.create({ guildId: i.guildId, userId: user.id, moderatorId: i.user.id, reason });
      const count = await Warning.countDocuments({ guildId: i.guildId, userId: user.id });
      await mod.record(client, i.guildId, { action: 'warn', targetId: user.id, moderatorId: i.user.id, reason, meta: { 'Uyarı sayısı': count } });
      const dmOk = await mod.dm(user, `⚠️ ${i.guild.name} — Uyarı`, `**Sebep:** ${reason}\nToplam uyarın: ${count}`);
      await done(i, `${user} uyarıldı. (Toplam: ${count}, ID: \`${w._id}\`)${dmOk ? '' : '\nDM gönderilemedi.'}`);
    }),
  },
  {
    data: base('uyarılar', 'Kullanıcının uyarılarını gösterir', P.ModerateMembers).addUserOption(userOpt),
    execute: guard(async (i) => {
      const user = i.options.getUser('kullanıcı');
      const list = await Warning.find({ guildId: i.guildId, userId: user.id }).sort({ createdAt: -1 }).limit(15).lean();
      const body = list.length
        ? list.map((w) => `\`${w._id}\` — ${ts(w.createdAt, 'd')} — <@${w.moderatorId}>\n> ${truncate(w.reason, 150)}`).join('\n')
        : 'Uyarı yok.';
      await i.editReply({ embeds: [theme.info(`${user.username} — Uyarılar`, truncate(body, 4000))] });
    }),
  },
  {
    data: base('uyarı-sil', 'Bir uyarıyı siler', P.ModerateMembers)
      .addStringOption((o) => o.setName('id').setDescription('Uyarı kimliği (/uyarılar)').setRequired(true)),
    execute: guard(async (i, client) => {
      const id = i.options.getString('id').trim();
      if (!/^[a-f\d]{24}$/i.test(id)) throw new UserError('Geçersiz uyarı kimliği.');
      const w = await Warning.findOneAndDelete({ _id: id, guildId: i.guildId });
      if (!w) throw new UserError('Uyarı bulunamadı.');
      await mod.record(client, i.guildId, { action: 'unwarn', targetId: w.userId, moderatorId: i.user.id, reason: `Silinen uyarı: ${w.reason}` });
      await done(i, 'Uyarı silindi.');
    }),
  },
  {
    data: base('timeout', 'Kullanıcıya timeout uygular', P.ModerateMembers)
      .addUserOption(userOpt)
      .addStringOption((o) => o.setName('süre').setDescription('Örn: 10m, 2h, 1d').setRequired(true))
      .addStringOption(reasonOpt),
    execute: guard(async (i, client) => {
      const user = i.options.getUser('kullanıcı');
      const ms = parseDuration(i.options.getString('süre'));
      if (!ms || ms > MAX_TIMEOUT) throw new UserError('Süre geçersiz. En fazla 28 gün; örn: `10m`, `2h`, `1d`.');
      const member = await targetMember(i, user);
      mod.assertCanTarget(i, member, { needBotPerm: P.ModerateMembers, label: 'Timeout' });
      const reason = reasonOf(i);
      await member.timeout(ms, `${i.user.tag}: ${reason}`);
      await mod.record(client, i.guildId, { action: 'timeout', targetId: user.id, moderatorId: i.user.id, reason, meta: { Süre: formatDuration(ms) } });
      await mod.dm(user, `🔇 ${i.guild.name} — Timeout`, `Süre: ${formatDuration(ms)}\n**Sebep:** ${reason}`);
      await done(i, `${user} için **${formatDuration(ms)}** timeout uygulandı.`);
    }),
  },
  {
    data: base('timeout-kaldır', 'Timeout kaldırır', P.ModerateMembers).addUserOption(userOpt).addStringOption(reasonOpt),
    execute: guard(async (i, client) => {
      const user = i.options.getUser('kullanıcı');
      const member = await targetMember(i, user);
      mod.assertBotPerm(i, P.ModerateMembers, 'Timeout kaldırmak için iznim yok.');
      await member.timeout(null, reasonOf(i));
      await mod.record(client, i.guildId, { action: 'untimeout', targetId: user.id, moderatorId: i.user.id, reason: reasonOf(i) });
      await done(i, `${user} için timeout kaldırıldı.`);
    }),
  },
  {
    data: base('at', 'Kullanıcıyı sunucudan atar', P.KickMembers).addUserOption(userOpt).addStringOption(reasonOpt),
    execute: guard(async (i, client) => {
      const user = i.options.getUser('kullanıcı');
      const member = await targetMember(i, user);
      mod.assertCanTarget(i, member, { needBotPerm: P.KickMembers, label: 'Atma işlemi' });
      const reason = reasonOf(i);
      await mod.dm(user, `👢 ${i.guild.name} — Atıldın`, `**Sebep:** ${reason}`);
      await member.kick(`${i.user.tag}: ${reason}`);
      await mod.record(client, i.guildId, { action: 'kick', targetId: user.id, moderatorId: i.user.id, reason });
      await done(i, `${user} sunucudan atıldı.`);
    }),
  },
  {
    data: base('yasakla', 'Kullanıcıyı yasaklar', P.BanMembers).addUserOption(userOpt).addStringOption(reasonOpt)
      .addIntegerOption((o) => o.setName('mesaj-günü').setDescription('Silinecek mesaj günü (0-7)').setMinValue(0).setMaxValue(7)),
    execute: guard(async (i, client) => {
      const user = i.options.getUser('kullanıcı');
      mod.assertBotPerm(i, P.BanMembers, 'Yasaklamak için iznim yok.');
      const member = await i.guild.members.fetch(user.id).catch(() => null);
      if (member) mod.assertCanTarget(i, member);
      else if (user.id === i.user.id) throw new UserError('Kendini yasaklayamazsın.');
      const reason = reasonOf(i);
      if (member) await mod.dm(user, `🔨 ${i.guild.name} — Yasaklandın`, `**Sebep:** ${reason}`);
      await i.guild.members.ban(user.id, { reason: `${i.user.tag}: ${reason}`, deleteMessageSeconds: (i.options.getInteger('mesaj-günü') || 0) * 86400 });
      await mod.record(client, i.guildId, { action: 'ban', targetId: user.id, moderatorId: i.user.id, reason });
      await done(i, `${user} yasaklandı.`);
    }),
  },
  {
    data: base('yasak-kaldır', 'Yasağı kaldırır', P.BanMembers)
      .addStringOption((o) => o.setName('kullanıcı-id').setDescription('Kullanıcı kimliği').setRequired(true)).addStringOption(reasonOpt),
    execute: guard(async (i, client) => {
      const uid = i.options.getString('kullanıcı-id').trim();
      if (!/^\d{17,20}$/.test(uid)) throw new UserError('Geçersiz kullanıcı kimliği.');
      mod.assertBotPerm(i, P.BanMembers, 'Yasak kaldırmak için iznim yok.');
      const ban = await i.guild.bans.fetch(uid).catch(() => null);
      if (!ban) throw new UserError('Bu kullanıcı yasaklı değil.');
      await i.guild.members.unban(uid, reasonOf(i));
      await mod.record(client, i.guildId, { action: 'unban', targetId: uid, moderatorId: i.user.id, reason: reasonOf(i) });
      await done(i, `\`${uid}\` kullanıcısının yasağı kaldırıldı.`);
    }),
  },
  {
    data: base('mesaj-sil', 'Kanalda toplu mesaj siler', P.ManageMessages)
      .addIntegerOption((o) => o.setName('adet').setDescription('1-100').setMinValue(1).setMaxValue(100).setRequired(true))
      .addUserOption((o) => o.setName('kullanıcı').setDescription('Yalnızca bu kullanıcının mesajları')),
    execute: guard(async (i, client) => {
      mod.assertBotPerm(i, P.ManageMessages, 'Mesaj silmek için iznim yok.');
      const n = i.options.getInteger('adet');
      const user = i.options.getUser('kullanıcı');
      let deleted;
      if (user) {
        const fetched = await i.channel.messages.fetch({ limit: 100 });
        deleted = await i.channel.bulkDelete([...fetched.filter((m) => m.author.id === user.id).values()].slice(0, n), true);
      } else {
        deleted = await i.channel.bulkDelete(n, true); // 14 günden eski mesajlar atlanır
      }
      await mod.record(client, i.guildId, { action: 'purge', targetId: user?.id, moderatorId: i.user.id, reason: `#${i.channel.name}`, meta: { Silinen: deleted.size } });
      await done(i, `**${deleted.size}** mesaj silindi. (14 günden eski mesajlar silinemez)`);
    }),
  },
  {
    data: base('yavaş-mod', 'Kanal yavaş modunu ayarlar', P.ManageChannels)
      .addIntegerOption((o) => o.setName('saniye').setDescription('0 = kapat, en fazla 21600').setMinValue(0).setMaxValue(21600).setRequired(true)),
    execute: guard(async (i, client) => {
      mod.assertBotPerm(i, P.ManageChannels, 'Kanalı düzenlemek için iznim yok.');
      const s = i.options.getInteger('saniye');
      await i.channel.setRateLimitPerUser(s, `${i.user.tag}`);
      await mod.record(client, i.guildId, { action: 'slowmode', moderatorId: i.user.id, reason: `#${i.channel.name}`, meta: { Saniye: s } });
      await done(i, s ? `Yavaş mod **${s} sn** olarak ayarlandı.` : 'Yavaş mod kapatıldı.');
    }),
  },
  ...[['kilitle', false, 'lock'], ['kilit-aç', null, 'unlock']].map(([name, value, action]) => ({
    data: base(name, action === 'lock' ? 'Kanalı herkese yazmaya kapatır' : 'Kanal kilidini açar', P.ManageChannels).addStringOption(reasonOpt),
    execute: guard(async (i, client) => {
      mod.assertBotPerm(i, P.ManageChannels, 'Kanal izinlerini düzenlemek için iznim yok.');
      await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: value }, { reason: `${i.user.tag}: ${reasonOf(i)}` });
      await mod.record(client, i.guildId, { action, moderatorId: i.user.id, reason: reasonOf(i), meta: { Kanal: `#${i.channel.name}` } });
      await done(i, action === 'lock' ? '🔒 Kanal kilitlendi.' : '🔓 Kanal kilidi açıldı.');
    }),
  })),
  {
    data: base('nick', 'Kullanıcının takma adını değiştirir', P.ManageNicknames).addUserOption(userOpt)
      .addStringOption((o) => o.setName('yeni').setDescription('Yeni takma ad (boş = sıfırla)').setMaxLength(32)),
    execute: guard(async (i, client) => {
      const user = i.options.getUser('kullanıcı');
      const member = await targetMember(i, user);
      if (user.id !== i.user.id) mod.assertCanTarget(i, member, { needBotPerm: P.ManageNicknames, label: 'Takma ad değiştirme' });
      const nick = clean(i.options.getString('yeni') || '', 32) || null;
      await member.setNickname(nick, i.user.tag);
      await mod.record(client, i.guildId, { action: 'nick', targetId: user.id, moderatorId: i.user.id, reason: nick || 'Sıfırlandı' });
      await done(i, nick ? `Takma ad **${nick}** yapıldı.` : 'Takma ad sıfırlandı.');
    }),
  },
  {
    data: base('modlog', 'Moderasyon kayıtlarını gösterir', P.ModerateMembers)
      .addUserOption((o) => o.setName('kullanıcı').setDescription('Belirli bir kullanıcı')),
    execute: guard(async (i) => {
      const user = i.options.getUser('kullanıcı');
      const logs = await ModerationLog.find({ guildId: i.guildId, ...(user ? { targetId: user.id } : {}) }).sort({ createdAt: -1 }).limit(10).lean();
      const body = logs.length
        ? logs.map((l) => `${ts(l.createdAt, 'd')} **${mod.ACTION_LABEL[l.action] || l.action}**${l.targetId ? ` <@${l.targetId}>` : ''} — <@${l.moderatorId}>\n> ${truncate(l.reason, 120)}`).join('\n')
        : 'Kayıt yok.';
      await i.editReply({ embeds: [theme.info(user ? `${user.username} — Modlog` : 'Son moderasyon işlemleri', truncate(body, 4000))] });
    }),
  },
];

module.exports = commands;
