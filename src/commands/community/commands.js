const {
  SlashCommandBuilder, PermissionFlagsBits: P, MessageFlags, ActionRowBuilder,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType,
} = require('discord.js');
const { UserXP, UserProfile, LinkedAccount, Poll, Announcement } = require('../../database/models');
const { claimDaily, levelFromXp } = require('../../services/community/xp');
const { buildPoll } = require('../../services/community/poll');
const theme = require('../../config/theme');
const ids = require('../../utils/ids');
const { ensure } = require('../../utils/permissions');
const { UserError } = require('../../utils/errors');
const { parseDuration, parseDateTime, ts, formatDuration } = require('../../utils/duration');
const { clean, truncate } = require('../../utils/text');
const { env } = require('../../config/env');
const { audit } = require('../../services/audit');

const E = MessageFlags.Ephemeral;
const adminBase = (n, d) => new SlashCommandBuilder().setName(n).setDescription(d).setDefaultMemberPermissions(P.ManageGuild).setContexts(0);
const DANGEROUS = P.Administrator | P.ManageGuild | P.ManageRoles | P.ManageChannels | P.KickMembers | P.BanMembers
  | P.ModerateMembers | P.ManageMessages | P.MentionEveryone | P.ManageWebhooks | P.ManageNicknames;

/** Rol menüsünde verilebilecek güvenli roller. */
function roleProblem(guild, role) {
  if (role.id === guild.id || role.managed) return 'yönetilen/everyone rolleri kullanılamaz';
  if (role.position >= guild.members.me.roles.highest.position) return 'botun rolünden yüksek veya eşit';
  if (role.permissions.bitfield & DANGEROUS) return 'yönetici/moderasyon izni içeren roller menüye eklenemez';
  return null;
}

const bar = (v, max) => theme.progressBar(v, max, 12);

module.exports = [
  {
    data: new SlashCommandBuilder().setName('profil').setDescription('Profil kartını gösterir').setContexts(0)
      .addUserOption((o) => o.setName('kullanıcı').setDescription('Başka bir kullanıcı')),
    async execute(i) {
      await i.deferReply();
      const user = i.options.getUser('kullanıcı') || i.user;
      const [xp, prof, link, rank] = await Promise.all([
        UserXP.findOne({ guildId: i.guildId, userId: user.id }).lean(),
        UserProfile.findOne({ guildId: i.guildId, userId: user.id }).lean(),
        LinkedAccount.findOne({ guildId: i.guildId, discordId: user.id }).lean(),
        UserXP.countDocuments({ guildId: i.guildId, xp: { $gt: (await UserXP.findOne({ guildId: i.guildId, userId: user.id }).lean())?.xp ?? Infinity } }),
      ]);
      const lv = levelFromXp(xp?.xp ?? 0);
      const e = theme.embed(`👤 ${user.username}`, null, theme.COLORS.cyan).setThumbnail(user.displayAvatarURL({ size: 256 })).addFields(
        { name: 'Seviye', value: `${lv.level}`, inline: true },
        { name: 'Sıralama', value: xp ? `#${rank + 1}` : '—', inline: true },
        { name: 'Coin', value: `${prof?.coins ?? 0}`, inline: true },
        { name: 'XP', value: `${bar(lv.current, lv.needed)} ${lv.current}/${lv.needed}` },
        { name: 'Mesaj', value: `${xp?.messages ?? 0}`, inline: true },
        { name: 'Günlük seri', value: `${prof?.dailyStreak ?? 0}`, inline: true },
        { name: 'Minecraft', value: link ? `\`${link.minecraftName}\`` : 'Bağlı değil (/doğrula)', inline: true },
      );
      await i.editReply({ embeds: [e] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('liderlik').setDescription('XP liderlik tablosu').setContexts(0),
    async execute(i) {
      await i.deferReply();
      const top = await UserXP.find({ guildId: i.guildId }).sort({ xp: -1 }).limit(10).lean();
      const medals = ['🥇', '🥈', '🥉'];
      const body = top.length
        ? top.map((u, n) => `${medals[n] || `**${n + 1}.**`} <@${u.userId}> — seviye **${levelFromXp(u.xp).level}** (${u.xp} XP)`).join('\n')
        : 'Henüz kimse XP kazanmadı.';
      await i.editReply({ embeds: [theme.embed('🏆 Liderlik Tablosu', body)], allowedMentions: { parse: [] } });
    },
  },
  {
    data: new SlashCommandBuilder().setName('günlük').setDescription('Günlük ödülünü al').setContexts(0),
    async execute(i) {
      await i.deferReply({ flags: E });
      const r = await claimDaily(i.guildId, i.user.id);
      if (!r.ok) return i.editReply({ embeds: [theme.warn(`Günlük ödülünü zaten aldın. Tekrar: ${ts(r.nextAt, 'R')}`)] });
      await i.editReply({ embeds: [theme.success(`**+${r.reward}** coin kazandın! Seri: **${r.streak}** gün • Toplam: **${r.coins}** coin`, '🎁 Günlük ödül')] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('anket').setDescription('Anket oluşturur').setContexts(0)
      .setDefaultMemberPermissions(P.ManageMessages)
      .addStringOption((o) => o.setName('soru').setDescription('Anket sorusu').setMaxLength(200).setRequired(true))
      .addStringOption((o) => o.setName('seçenek1').setDescription('Seçenek 1').setMaxLength(60).setRequired(true))
      .addStringOption((o) => o.setName('seçenek2').setDescription('Seçenek 2').setMaxLength(60).setRequired(true))
      .addStringOption((o) => o.setName('seçenek3').setDescription('Seçenek 3').setMaxLength(60))
      .addStringOption((o) => o.setName('seçenek4').setDescription('Seçenek 4').setMaxLength(60))
      .addStringOption((o) => o.setName('seçenek5').setDescription('Seçenek 5').setMaxLength(60)),
    async execute(i) {
      if (!(await ensure(i, 'mod'))) return;
      await i.deferReply({ flags: E });
      const options = [1, 2, 3, 4, 5].map((n) => i.options.getString(`seçenek${n}`)).filter(Boolean).map((s) => clean(s, 60));
      const poll = await Poll.create({
        guildId: i.guildId, channelId: i.channelId, question: clean(i.options.getString('soru'), 200), options, createdBy: i.user.id,
      });
      const msg = await i.channel.send(buildPoll(poll));
      await Poll.updateOne({ _id: poll._id }, { messageId: msg.id });
      await i.editReply({ embeds: [theme.success('Anket yayınlandı.')] });
    },
  },
  {
    data: adminBase('rolmenü', 'Rol seçim menüsü gönderir')
      .addStringOption((o) => o.setName('başlık').setDescription('Menü başlığı').setMaxLength(100).setRequired(true))
      .addRoleOption((o) => o.setName('rol1').setDescription('Rol 1').setRequired(true))
      .addRoleOption((o) => o.setName('rol2').setDescription('Rol 2'))
      .addRoleOption((o) => o.setName('rol3').setDescription('Rol 3'))
      .addRoleOption((o) => o.setName('rol4').setDescription('Rol 4'))
      .addRoleOption((o) => o.setName('rol5').setDescription('Rol 5')),
    async execute(i) {
      if (!(await ensure(i, 'admin'))) return;
      await i.deferReply({ flags: E });
      const roles = [...new Map([1, 2, 3, 4, 5].map((n) => i.options.getRole(`rol${n}`)).filter(Boolean).map((r) => [r.id, r])).values()];
      for (const r of roles) {
        const problem = roleProblem(i.guild, r);
        if (problem) throw new UserError(`**${r.name}** eklenemedi: ${problem}.`);
      }
      const menu = new StringSelectMenuBuilder().setCustomId(ids.id('rolemenu', 'pick')).setPlaceholder('Rollerini seç…')
        .setMinValues(0).setMaxValues(roles.length)
        .addOptions(roles.map((r) => ({ label: truncate(r.name, 100), value: r.id })));
      await i.channel.send({
        embeds: [theme.embed(`🎭 ${clean(i.options.getString('başlık'), 100)}`, 'Menüden istediğin rolleri seç; seçimini kaldırırsan rol geri alınır.')],
        components: [new ActionRowBuilder().addComponents(menu)],
      });
      await audit(i.guildId, i.user.id, 'rolemenu.create', null, { roles: roles.map((r) => r.id) });
      await i.editReply({ embeds: [theme.success('Rol menüsü gönderildi.')] });
    },
  },
  {
    data: adminBase('kurallar', 'Sunucu kuralları mesajı gönderir (form açılır)'),
    async execute(i) {
      if (!(await ensure(i, 'admin'))) return;
      await i.showModal(new ModalBuilder().setCustomId(ids.id('rules', 'post')).setTitle('Sunucu kuralları').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Başlık').setStyle(TextInputStyle.Short).setValue('📜 Sunucu Kuralları').setMaxLength(100)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('body').setLabel('Kurallar').setStyle(TextInputStyle.Paragraph).setMaxLength(4000)),
      ));
    },
  },
  {
    data: adminBase('etkinlik', 'Etkinlik duyurusu yayınlar')
      .addStringOption((o) => o.setName('başlık').setDescription('Etkinlik adı').setMaxLength(100).setRequired(true))
      .addStringOption((o) => o.setName('zaman').setDescription('Tarih-saat (Türkiye saati): 2026-12-31 20:30').setRequired(true))
      .addStringOption((o) => o.setName('açıklama').setDescription('Açıklama').setMaxLength(1500))
      .addChannelOption((o) => o.setName('kanal').setDescription('Duyuru kanalı').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addRoleOption((o) => o.setName('etiket').setDescription('Etiketlenecek rol')),
    async execute(i) {
      if (!(await ensure(i, 'admin'))) return;
      await i.deferReply({ flags: E });
      const when = parseDateTime(i.options.getString('zaman'), env.timezoneOffset);
      if (!when || when < new Date()) throw new UserError('Zaman geçersiz veya geçmişte. Örnek: `2026-12-31 20:30`');
      const ch = i.options.getChannel('kanal') || i.channel;
      const role = i.options.getRole('etiket');
      const e = theme.embed(`📅 ${clean(i.options.getString('başlık'), 100)}`, clean(i.options.getString('açıklama') || '', 1500), theme.COLORS.cyan)
        .addFields({ name: 'Zaman', value: `${ts(when, 'F')} (${ts(when, 'R')})` });
      await ch.send({ content: role ? `${role}` : undefined, embeds: [e], allowedMentions: { roles: role ? [role.id] : [] } });
      await i.editReply({ embeds: [theme.success(`Etkinlik ${ch} kanalında duyuruldu.`)] });
    },
  },
  {
    data: adminBase('otoduyuru', 'Periyodik topluluk duyuruları')
      .addSubcommand((s) => s.setName('ekle').setDescription('Periyodik duyuru ekler')
        .addStringOption((o) => o.setName('başlık').setDescription('Başlık').setMaxLength(100).setRequired(true))
        .addStringOption((o) => o.setName('içerik').setDescription('Duyuru metni').setMaxLength(1500).setRequired(true))
        .addStringOption((o) => o.setName('aralık').setDescription('En az 10m. Örn: 6h, 1d').setRequired(true))
        .addChannelOption((o) => o.setName('kanal').setDescription('Kanal').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
      .addSubcommand((s) => s.setName('liste').setDescription('Duyuruları listeler'))
      .addSubcommand((s) => s.setName('sil').setDescription('Duyuru siler')
        .addStringOption((o) => o.setName('id').setDescription('Duyuru kimliği').setRequired(true))),
    async execute(i) {
      if (!(await ensure(i, 'admin'))) return;
      await i.deferReply({ flags: E });
      const sub = i.options.getSubcommand();
      if (sub === 'ekle') {
        const ms = parseDuration(i.options.getString('aralık'));
        if (!ms || ms < 600_000) throw new UserError('Aralık en az 10 dakika olmalı. Örn: `6h`');
        const a = await Announcement.create({
          guildId: i.guildId, channelId: (i.options.getChannel('kanal') || i.channel).id, createdBy: i.user.id,
          title: `📢 ${clean(i.options.getString('başlık'), 100)}`, content: clean(i.options.getString('içerik'), 1500),
          intervalMs: ms, nextRunAt: new Date(Date.now() + ms),
        });
        return i.editReply({ embeds: [theme.success(`Duyuru eklendi (her ${formatDuration(ms)}). İlk gönderim: ${ts(a.nextRunAt)}\nID: \`${a._id}\``)] });
      }
      if (sub === 'liste') {
        const list = await Announcement.find({ guildId: i.guildId }).lean();
        return i.editReply({ embeds: [theme.info('Periyodik duyurular', list.length ? list.map((a) => `\`${a._id}\` <#${a.channelId}> her ${formatDuration(a.intervalMs)} — ${truncate(a.title, 50)}`).join('\n') : 'Yok.')] });
      }
      const id = i.options.getString('id').trim();
      if (!/^[a-f\d]{24}$/i.test(id)) throw new UserError('Geçersiz kimlik.');
      const res = await Announcement.deleteOne({ _id: id, guildId: i.guildId });
      if (!res.deletedCount) throw new UserError('Duyuru bulunamadı.');
      await i.editReply({ embeds: [theme.success('Duyuru silindi.')] });
    },
  },
];

