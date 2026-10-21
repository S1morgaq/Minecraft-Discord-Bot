const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { Giveaway, GiveawayEntry, GiveawayHistory } = require('../../database/models');
const service = require('../../services/giveaways/service');
const theme = require('../../config/theme');
const { ensure } = require('../../utils/permissions');
const { UserError } = require('../../utils/errors');
const { parseDuration, parseDateTime, ts, formatDuration } = require('../../utils/duration');
const { clean, truncate } = require('../../utils/text');
const { env } = require('../../config/env');

const idOpt = (o) => o.setName('id').setDescription('Çekiliş').setRequired(true).setAutocomplete(true);
const MIN_MS = 10_000;
const MAX_MS = 90 * 86_400_000;

const data = new SlashCommandBuilder()
  .setName('çekiliş')
  .setDescription('Çekiliş yönetimi')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(0)
  .addSubcommand((s) => s.setName('oluştur').setDescription('Yeni çekiliş başlatır')
    .addStringOption((o) => o.setName('ödül').setDescription('Ödül').setMaxLength(256).setRequired(true))
    .addIntegerOption((o) => o.setName('kazanan').setDescription('Kazanan sayısı (1-20)').setMinValue(1).setMaxValue(20).setRequired(true))
    .addStringOption((o) => o.setName('süre').setDescription('Örn: 1h30m, 2d, 45m'))
    .addStringOption((o) => o.setName('bitiş').setDescription('Tarih-saat (Türkiye saati): 2026-12-31 20:30'))
    .addChannelOption((o) => o.setName('kanal').setDescription('Çekiliş kanalı').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addRoleOption((o) => o.setName('gerekli-rol').setDescription('Katılım için gerekli rol'))
    .addRoleOption((o) => o.setName('hariç-rol').setDescription('Katılamayacak rol'))
    .addRoleOption((o) => o.setName('hariç-rol-2').setDescription('Katılamayacak ikinci rol'))
    .addIntegerOption((o) => o.setName('min-hesap-yaşı').setDescription('Minimum hesap yaşı (gün)').setMinValue(0).setMaxValue(3650))
    .addIntegerOption((o) => o.setName('min-üyelik').setDescription('Sunucuda minimum bulunma süresi (gün)').setMinValue(0).setMaxValue(3650))
    .addStringOption((o) => o.setName('açıklama').setDescription('Açıklama').setMaxLength(1000))
    .addStringOption((o) => o.setName('buton-metni').setDescription('Katılım butonu metni').setMaxLength(40))
    .addAttachmentOption((o) => o.setName('görsel').setDescription('Çekiliş görseli'))
    .addBooleanOption((o) => o.setName('ayrılma').setDescription('Katılımcılar ayrılabilsin mi? (varsayılan: evet)')))
  .addSubcommand((s) => s.setName('bitir').setDescription('Çekilişi hemen bitirir').addStringOption(idOpt))
  .addSubcommand((s) => s.setName('yeniden-çek').setDescription('Yeni kazanan seçer (eskiler hariç)').addStringOption(idOpt)
    .addIntegerOption((o) => o.setName('adet').setDescription('Kaç kazanan').setMinValue(1).setMaxValue(20)))
  .addSubcommand((s) => s.setName('iptal').setDescription('Aktif çekilişi iptal eder').addStringOption(idOpt))
  .addSubcommand((s) => s.setName('katılımcılar').setDescription('Katılımcıları listeler').addStringOption(idOpt))
  .addSubcommand((s) => s.setName('bilgi').setDescription('Çekiliş bilgisi').addStringOption(idOpt))
  .addSubcommand((s) => s.setName('liste').setDescription('Aktif çekilişleri listeler'))
  .addSubcommand((s) => s.setName('uzat').setDescription('Aktif çekilişi uzatır').addStringOption(idOpt)
    .addStringOption((o) => o.setName('süre').setDescription('Eklenecek süre, örn: 1h').setRequired(true)));

async function load(id) {
  if (!/^[a-f\d]{24}$/i.test(id)) throw new UserError('Geçersiz çekiliş kimliği; listeden seç.');
  const g = await Giveaway.findById(id).lean();
  if (!g || g.guildId !== env.guildId) throw new UserError('Çekiliş bulunamadı.');
  return g;
}

async function execute(interaction, client) {
  if (!(await ensure(interaction, 'admin'))) return;
  const sub = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const reply = (embed) => interaction.editReply({ embeds: [embed] });

  if (sub === 'oluştur') {
    const o = interaction.options;
    let endsAt;
    if (o.getString('bitiş')) {
      endsAt = parseDateTime(o.getString('bitiş'), env.timezoneOffset);
      if (!endsAt) throw new UserError('Bitiş biçimi geçersiz. Örnek: `2026-12-31 20:30`');
    } else if (o.getString('süre')) {
      const ms = parseDuration(o.getString('süre'));
      if (!ms) throw new UserError('Süre biçimi geçersiz. Örnek: `1h30m`, `2d`');
      endsAt = new Date(Date.now() + ms);
    } else throw new UserError('`süre` veya `bitiş` seçeneklerinden birini gir.');
    const delta = endsAt - Date.now();
    if (delta < MIN_MS || delta > MAX_MS) throw new UserError('Çekiliş süresi 10 saniye ile 90 gün arasında olmalı.');

    const channel = o.getChannel('kanal') || interaction.channel;
    const me = interaction.guild.members.me;
    const perms = channel.permissionsFor(me);
    if (!perms?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) throw new UserError(`${channel} kanalında mesaj/embed gönderme iznim yok.`);

    const image = o.getAttachment('görsel');
    if (image && !image.contentType?.startsWith('image/')) throw new UserError('Görsel alanı yalnızca resim kabul eder.');

    const g = await service.create(client, channel, {
      hostId: interaction.user.id,
      prize: clean(o.getString('ödül'), 256),
      winnerCount: o.getInteger('kazanan'),
      endsAt,
      description: clean(o.getString('açıklama') || '', 1000),
      requiredRoleId: o.getRole('gerekli-rol')?.id ?? null,
      excludedRoleIds: [o.getRole('hariç-rol')?.id, o.getRole('hariç-rol-2')?.id].filter(Boolean),
      minAccountAgeDays: o.getInteger('min-hesap-yaşı') ?? 0,
      minMemberDays: o.getInteger('min-üyelik') ?? 0,
      buttonLabel: clean(o.getString('buton-metni') || 'Katıl', 40),
      imageUrl: image?.url ?? null,
      allowLeave: o.getBoolean('ayrılma') ?? true,
    });
    return reply(theme.success(`Çekiliş ${channel} kanalında başlatıldı.\nBitiş: ${ts(g.endsAt, 'f')}\nKimlik: \`${g._id}\``));
  }

  if (sub === 'liste') {
    const list = await Giveaway.find({ guildId: interaction.guildId, status: 'active' }).sort({ endsAt: 1 }).limit(20).lean();
    return reply(theme.info('Aktif çekilişler', list.length
      ? list.map((g) => `• **${truncate(g.prize, 60)}** — ${ts(g.endsAt)} — ${g.entryCount} katılımcı — <#${g.channelId}>`).join('\n')
      : 'Aktif çekiliş yok.'));
  }

  const g = await load(interaction.options.getString('id'));

  switch (sub) {
    case 'bitir': {
      const done = await service.end(client, g._id, { by: interaction.user.id });
      if (!done) throw new UserError('Bu çekiliş zaten sonuçlanmış, iptal edilmiş veya işleniyor.');
      return reply(theme.success(`Çekiliş sonuçlandırıldı. Kazanan sayısı: **${done.winners.length}**`));
    }
    case 'yeniden-çek': {
      const winners = await service.reroll(client, g._id, { by: interaction.user.id, count: interaction.options.getInteger('adet') });
      return reply(winners.length
        ? theme.success(`Yeni kazananlar: ${winners.map((w) => `<@${w}>`).join(', ')}`)
        : theme.warn('Yeni kazanan seçilebilecek uygun katılımcı kalmadı.'));
    }
    case 'iptal':
      await service.cancel(client, g._id, interaction.user.id);
      return reply(theme.success('Çekiliş iptal edildi.'));
    case 'uzat': {
      const ms = parseDuration(interaction.options.getString('süre'));
      if (!ms || ms > MAX_MS) throw new UserError('Süre biçimi geçersiz. Örnek: `1h`, `2d`');
      const upd = await service.extend(client, g._id, ms, interaction.user.id);
      return reply(theme.success(`Çekiliş **${formatDuration(ms)}** uzatıldı. Yeni bitiş: ${ts(upd.endsAt, 'f')}`));
    }
    case 'katılımcılar': {
      const entries = await GiveawayEntry.find({ giveawayId: g._id }).limit(100).select('userId').lean();
      return reply(theme.info(`Katılımcılar (${g.entryCount})`, entries.length
        ? truncate(entries.map((e) => `<@${e.userId}>`).join(' '), 4000) + (g.entryCount > 100 ? '\n… (ilk 100 gösterildi)' : '')
        : 'Katılımcı yok.'));
    }
    case 'bilgi': {
      const hist = await GiveawayHistory.find({ giveawayId: g._id }).sort({ createdAt: 1 }).lean();
      const e = service.buildEmbed(g);
      e.addFields(
        { name: 'Durum', value: g.status, inline: true },
        { name: 'Kimlik', value: `\`${g._id}\``, inline: true },
      );
      if (hist.length) {
        e.addFields({ name: 'Geçmiş', value: truncate(hist.map((h) => `${ts(h.createdAt, 'f')} — ${h.kind}${h.winners.length ? `: ${h.winners.map((w) => `<@${w}>`).join(', ')}` : ''}`).join('\n'), 1024) });
      }
      return interaction.editReply({ embeds: [e] });
    }
    default:
  }
}

async function autocomplete(interaction) {
  const cfg = await require('../../services/guildConfig').get(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member || !require('../../utils/permissions').isAdmin(member, cfg)) return interaction.respond([]);
  const focus = interaction.options.getFocused().toLowerCase();
  const list = await Giveaway.find({ guildId: interaction.guildId }).sort({ createdAt: -1 }).limit(50).select('prize status').lean();
  await interaction.respond(
    list.filter((g) => g.prize.toLowerCase().includes(focus)).slice(0, 25)
      .map((g) => ({ name: truncate(`${g.prize} [${g.status}]`, 100), value: String(g._id) })),
  );
}

module.exports = { data, execute, autocomplete };
