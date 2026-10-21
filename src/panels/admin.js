const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} = require('discord.js');
const models = require('../database/models');
const guildConfig = require('../services/guildConfig');
const bridge = require('../services/minecraft/bridge');
const mcStatus = require('../services/minecraft/status');
const { isConnected } = require('../database/connect');
const theme = require('../config/theme');
const ids = require('../utils/ids');
const { env } = require('../config/env');
const { ts, formatDuration } = require('../utils/duration');
const { truncate } = require('../utils/text');

const CHANNEL_LABELS = {
  status: 'Sunucu durum mesajı', chat: 'Minecraft sohbet köprüsü', log: 'Genel log', modlog: 'Moderasyon log',
  welcome: 'Karşılama', leave: 'Ayrılma', serverEvents: 'Sunucu açıldı/kapandı/bakım', announce: 'Duyurular',
  giveaway: 'Çekiliş bildirimleri', ticketLog: 'Bilet log', ticketCategory: 'Bilet kategorisi (kategori kanalı)',
  errors: 'Bot başlatma/hata bildirimi', levelUp: 'Seviye mesajları',
};
const ROLE_LABELS = {
  admin: 'Yönetici rolü', mod: 'Moderatör rolü', support: 'Destek rolü', verified: 'Doğrulanmış rolü', autoRole: 'Otomatik rol (yeni üye)',
};
const NOTIF_LABELS = {
  serverOnline: 'Sunucu açıldı', serverOffline: 'Sunucu kapandı', maintenance: 'Bakım başladı/bitti', giveawayNew: 'Yeni çekiliş',
  giveawayEnd: 'Çekiliş sonuçlandı', playerJoin: 'Oyuncu katıldı', playerQuit: 'Oyuncu ayrıldı', modAction: 'Moderasyon işlemleri',
  botStart: 'Bot başlatıldı', botError: 'Beklenmeyen hata',
};

const SECTIONS = [
  ['overview', '📋 Genel bakış'], ['server', '🖥️ Minecraft sunucu durumu'], ['players', '👥 Oyuncu bilgileri'],
  ['giveaways', '🎉 Çekiliş yönetimi'], ['moderation', '🛡️ Moderasyon'], ['tickets', '🎫 Destek biletleri'],
  ['announcements', '📢 Duyurular'], ['bridge', '💬 Minecraft–Discord sohbet köprüsü'],
  ['verification', '🔐 Doğrulama ve rol yönetimi'], ['stats', '📊 İstatistikler'], ['logs', '🗂️ Log kanalları'],
  ['config', '⚙️ Bot yapılandırması'],
];

const row = (...c) => new ActionRowBuilder().addComponents(...c);
const btn = (action, label, style = ButtonStyle.Secondary, ...args) =>
  new ButtonBuilder().setCustomId(ids.id('admin', action, ...args)).setLabel(label).setStyle(style);
const chan = (id) => (id ? `<#${id}>` : '*ayarlanmamış*');
const role = (id) => (id ? `<@&${id}>` : '*ayarlanmamış*');

function navRow(current) {
  return row(new StringSelectMenuBuilder().setCustomId(ids.id('admin', 'nav')).setPlaceholder('Bölüm seç…')
    .addOptions(SECTIONS.map(([value, label]) => ({ label, value, default: value === current }))));
}

function pickerRow(action, labels, placeholder) {
  return row(new StringSelectMenuBuilder().setCustomId(ids.id('admin', action)).setPlaceholder(placeholder)
    .addOptions(Object.entries(labels).map(([value, label]) => ({ label, value }))));
}

const refreshRow = (section) => btn('refresh', '🔄 Yenile', ButtonStyle.Secondary, section);

const sections = {
  async overview(cfg, client) {
    const [gw, tickets, links] = await Promise.all([
      models.Giveaway.countDocuments({ guildId: env.guildId, status: 'active' }),
      models.Ticket.countDocuments({ guildId: env.guildId, status: 'open' }),
      models.LinkedAccount.countDocuments({ guildId: env.guildId }),
    ]);
    const ok = (v) => (v ? theme.EMOJI.online : theme.EMOJI.offline);
    const e = theme.embed('📋 Genel bakış', 'ZentarNetwork yönetim paneli — tüm işlemler Discord üzerinden yürütülür.').addFields(
      { name: 'Bot', value: `${ok(true)} ${Math.round(client.ws.ping)} ms • ${formatDuration(process.uptime() * 1000)}`, inline: true },
      { name: 'MongoDB', value: `${ok(isConnected())} ${isConnected() ? 'Bağlı' : 'Kopuk'}`, inline: true },
      { name: 'Minecraft', value: `${ok(mcStatus.state.online)} ${mcStatus.state.online ? `${mcStatus.state.players.online}/${mcStatus.state.players.max}` : 'Çevrimdışı/bilinmiyor'}`, inline: true },
      { name: 'Eklenti köprüsü', value: `${ok(bridge.isConnected())} ${bridge.isConnected() ? 'Bağlı' : 'Bağlı değil'}`, inline: true },
      { name: 'Bakım modu', value: cfg.maintenance?.enabled ? '🛠️ Açık' : 'Kapalı', inline: true },
      { name: 'Aktif çekiliş', value: String(gw), inline: true },
      { name: 'Açık bilet', value: String(tickets), inline: true },
      { name: 'Doğrulanmış hesap', value: String(links), inline: true },
    );
    return { embeds: [e], extra: [row(refreshRow('overview'))] };
  },

  async server(cfg) {
    await mcStatus.check();
    const m = cfg.maintenance?.enabled;
    return {
      embeds: [mcStatus.buildEmbed(cfg)],
      extra: [row(
        btn('mc_refresh', '🔄 Durumu yenile'),
        btn('maint', m ? 'Bakımı kapat' : 'Bakımı aç', m ? ButtonStyle.Success : ButtonStyle.Danger, m ? 'off' : 'on'),
        btn('announce_mc', '📣 Oyuna duyuru', ButtonStyle.Primary),
      )],
    };
  },

  async players() {
    const { names, complete } = mcStatus.playerNames();
    const s = mcStatus.state;
    const e = theme.embed(`${theme.EMOJI.players} Oyuncu bilgileri`,
      !s.online ? 'Sunucuya ulaşılamıyor.' : `Çevrimiçi: **${s.players.online}/${s.players.max}**\n${names.map((n) => `\`${n}\``).join(', ') || '—'}${complete ? '' : '\n*Liste kısmi (eklenti bağlı değil).*'}`);
    return { embeds: [e], extra: [row(btn('player_search', '🔎 Oyuncu ara', ButtonStyle.Primary), refreshRow('players'))] };
  },

  async giveaways() {
    const list = await models.Giveaway.find({ guildId: env.guildId, status: 'active' }).sort({ endsAt: 1 }).limit(10).lean();
    const e = theme.embed(`${theme.EMOJI.giveaway} Çekiliş yönetimi`, list.length
      ? list.map((g) => `• **${truncate(g.prize, 50)}** — ${ts(g.endsAt)} — ${g.entryCount} katılımcı\n  \`${g._id}\``).join('\n')
      : 'Aktif çekiliş yok.').setFooter({ text: 'Gelişmiş seçenekler için /çekiliş komutlarını kullan • ' + theme.BRAND });
    return { embeds: [e], extra: [row(btn('gw_new', '➕ Hızlı çekiliş', ButtonStyle.Success), refreshRow('giveaways'))] };
  },

  async moderation() {
    const [warns, logs, recent] = await Promise.all([
      models.Warning.countDocuments({ guildId: env.guildId }),
      models.ModerationLog.countDocuments({ guildId: env.guildId }),
      models.ModerationLog.find({ guildId: env.guildId }).sort({ createdAt: -1 }).limit(8).lean(),
    ]);
    const e = theme.embed('🛡️ Moderasyon', `Toplam uyarı: **${warns}** • Toplam kayıt: **${logs}**\n\n${recent.map((l) => `${ts(l.createdAt, 'R')} **${l.action}** ${l.targetId ? `<@${l.targetId}>` : ''} — <@${l.moderatorId}>`).join('\n') || 'Kayıt yok.'}`);
    return { embeds: [e], extra: [row(refreshRow('moderation'))] };
  },

  async tickets(cfg) {
    const [open, closed] = await Promise.all([
      models.Ticket.countDocuments({ guildId: env.guildId, status: 'open' }),
      models.Ticket.countDocuments({ guildId: env.guildId, status: 'closed' }),
    ]);
    const recent = await models.Ticket.find({ guildId: env.guildId, status: 'open' }).sort({ createdAt: -1 }).limit(8).lean();
    const e = theme.embed(`${theme.EMOJI.ticket} Destek biletleri`, `Açık: **${open}** • Kapalı: **${closed}** • Kişi başı sınır: **${cfg.tickets.limitPerUser}**\nKategoriler: ${cfg.tickets.categories.join(', ')}\n\n${recent.map((t) => `<#${t.channelId}> — <@${t.userId}> — ${t.category}`).join('\n') || 'Açık bilet yok.'}`);
    return { embeds: [e], extra: [row(btn('ticket_panel', '📨 Bu kanala panel gönder', ButtonStyle.Primary), refreshRow('tickets'))] };
  },

  async announcements() {
    const list = await models.Announcement.find({ guildId: env.guildId }).limit(10).lean();
    const e = theme.embed('📢 Duyurular', `Periyodik duyuru: **${list.length}**\n${list.map((a) => `\`${a._id}\` <#${a.channelId}> her ${formatDuration(a.intervalMs)}`).join('\n') || '—'}\n\nPeriyodik duyuruları \`/otoduyuru\` ile yönet.`);
    return { embeds: [e], extra: [row(btn('announce_dc', '📢 Duyuru yayınla', ButtonStyle.Primary), btn('announce_mc', '📣 Oyuna duyuru'))] };
  },

  async bridge(cfg) {
    const b = cfg.chatBridge;
    const on = (v) => (v ? '✅ Açık' : '❌ Kapalı');
    const e = theme.embed('💬 Minecraft–Discord sohbet köprüsü').addFields(
      { name: 'Köprü', value: on(b.enabled), inline: true },
      { name: 'Minecraft → Discord', value: on(b.toDiscord), inline: true },
      { name: 'Discord → Minecraft', value: on(b.toMinecraft), inline: true },
      { name: 'Kanal', value: chan(cfg.channels.chat), inline: true },
      { name: 'Eklenti bağlantısı', value: bridge.isConnected() ? `Bağlı • ${bridge.latency ?? '?'} ms` : 'Bağlı değil', inline: true },
    );
    return {
      embeds: [e],
      extra: [
        row(btn('bridge', b.enabled ? 'Köprüyü kapat' : 'Köprüyü aç', b.enabled ? ButtonStyle.Danger : ButtonStyle.Success, 'enabled'),
          btn('bridge', 'MC → Discord', ButtonStyle.Secondary, 'toDiscord'), btn('bridge', 'Discord → MC', ButtonStyle.Secondary, 'toMinecraft')),
        row(btn('pickch', '📍 Köprü kanalını seç', ButtonStyle.Primary, 'chat', 'bridge')),
      ],
    };
  },

  async verification(cfg) {
    const [links, pendingCodes, noRole] = await Promise.all([
      models.LinkedAccount.countDocuments({ guildId: env.guildId }),
      models.VerificationCode.countDocuments({ guildId: env.guildId }),
      models.LinkedAccount.countDocuments({ guildId: env.guildId, roleGranted: false }),
    ]);
    const e = theme.embed('🔐 Doğrulama ve rol yönetimi').addFields(
      { name: 'Bağlı hesap', value: String(links), inline: true },
      { name: 'Bekleyen kod', value: String(pendingCodes), inline: true },
      { name: 'Rolü verilemeyen', value: String(noRole), inline: true },
      ...Object.entries(ROLE_LABELS).map(([k, label]) => ({ name: label, value: role(cfg.roles[k]), inline: true })),
    );
    return { embeds: [e], extra: [pickerRow('pickrole', ROLE_LABELS, 'Ayarlanacak rolü seç…')] };
  },

  async stats(cfg, client) {
    const g = env.guildId;
    const [xpUsers, msgs, warns, closed, gwEnded] = await Promise.all([
      models.UserXP.countDocuments({ guildId: g }),
      models.UserXP.aggregate([{ $match: { guildId: g } }, { $group: { _id: null, n: { $sum: '$messages' } } }]),
      models.Warning.countDocuments({ guildId: g }),
      models.Ticket.countDocuments({ guildId: g, status: 'closed' }),
      models.Giveaway.countDocuments({ guildId: g, status: 'ended' }),
    ]);
    const e = theme.embed('📊 İstatistikler').addFields(
      { name: 'Üye sayısı', value: String(client.guilds.cache.get(g)?.memberCount ?? '—'), inline: true },
      { name: 'XP kazanan üye', value: String(xpUsers), inline: true },
      { name: 'XP\'li mesaj', value: String(msgs[0]?.n ?? 0), inline: true },
      { name: 'Uyarılar', value: String(warns), inline: true },
      { name: 'Kapanan bilet', value: String(closed), inline: true },
      { name: 'Biten çekiliş', value: String(gwEnded), inline: true },
    );
    return { embeds: [e], extra: [row(refreshRow('stats'))] };
  },

  async logs(cfg) {
    const e = theme.embed('🗂️ Log kanalları', Object.entries(CHANNEL_LABELS).map(([k, l]) => `**${l}:** ${chan(cfg.channels[k])}`).join('\n'));
    return { embeds: [e], extra: [pickerRow('pickch', CHANNEL_LABELS, 'Ayarlanacak kanalı seç…')] };
  },

  async config(cfg) {
    const x = cfg.xp;
    const e = theme.embed('⚙️ Bot yapılandırması').addFields(
      { name: 'XP sistemi', value: `${x.enabled ? '✅' : '❌'} ${x.min}-${x.max} XP / ${x.cooldownSec} sn • min. ${x.minMessageLength} karakter\nGünlük: ${x.dailyReward} coin / ${x.dailyCooldownHours} sa` },
      { name: 'Karşılama', value: truncate(cfg.welcomeMessage, 300) },
      { name: 'Ayrılma', value: truncate(cfg.leaveMessage, 300) },
      { name: 'Bildirimler (aşağıdan aç/kapat)', value: Object.entries(NOTIF_LABELS).map(([k, l]) => `${cfg.notifications[k] ? '✅' : '❌'} ${l}`).join('\n') },
    );
    const notif = new StringSelectMenuBuilder().setCustomId(ids.id('admin', 'notif')).setPlaceholder('Açık bildirimleri seç…')
      .setMinValues(0).setMaxValues(Object.keys(NOTIF_LABELS).length)
      .addOptions(Object.entries(NOTIF_LABELS).map(([value, label]) => ({ label, value, default: Boolean(cfg.notifications[value]) })));
    return {
      embeds: [e],
      extra: [row(notif), row(btn('xp_modal', '✏️ XP ayarları', ButtonStyle.Primary), btn('xp_toggle', x.enabled ? 'XP kapat' : 'XP aç'), btn('welcome_modal', '✏️ Karşılama/Ayrılma metni', ButtonStyle.Primary))],
    };
  },
};

/** Bir bölümü render eder: { embeds, components }. */
async function render(section, client) {
  const key = sections[section] ? section : 'overview';
  const cfg = await guildConfig.get(env.guildId);
  const { embeds, extra } = await sections[key](cfg, client);
  return { embeds, components: [navRow(key), ...extra] };
}

module.exports = { render, SECTIONS, CHANNEL_LABELS, ROLE_LABELS, NOTIF_LABELS, row, btn };
