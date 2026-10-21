const { SlashCommandBuilder, PermissionFlagsBits: P, MessageFlags } = require('discord.js');
const { LinkedAccount, Ticket, Giveaway, Warning, UserXP } = require('../../database/models');
const bridge = require('../../services/minecraft/bridge');
const mcStatus = require('../../services/minecraft/status');
const guildConfig = require('../../services/guildConfig');
const { notify } = require('../../services/notifier');
const { audit } = require('../../services/audit');
const { isConnected } = require('../../database/connect');
const theme = require('../../config/theme');
const { env } = require('../../config/env');
const { ensure } = require('../../utils/permissions');
const { setMaintenance } = require('../../services/minecraft/maintenance');
const { playerEmbed } = require('../../services/minecraft/player');
const { UserError } = require('../../utils/errors');
const { ts, formatDuration } = require('../../utils/duration');
const { sanitizeForMinecraft, truncate } = require('../../utils/text');

const E = MessageFlags.Ephemeral;
const adminCmd = (name, desc) => new SlashCommandBuilder().setName(name).setDescription(desc).setDefaultMemberPermissions(P.ManageGuild).setContexts(0);
const pubCmd = (name, desc) => new SlashCommandBuilder().setName(name).setDescription(desc).setContexts(0);

async function freshState() {
  if (!mcStatus.state.checkedAt || Date.now() - mcStatus.state.checkedAt > 15_000) await mcStatus.check();
  return mcStatus.state;
}

const requireBridge = () => {
  if (!bridge.isConnected()) throw new UserError('Minecraft eklentisi şu anda bağlı değil; bu işlem oyuna iletilemedi.');
};

const commands = [
  {
    data: pubCmd('sunucu', 'Minecraft sunucusunun durumunu gösterir'),
    async execute(i) {
      await i.deferReply();
      await freshState();
      await i.editReply({ embeds: [mcStatus.buildEmbed(await guildConfig.get(i.guildId))] });
    },
  },
  {
    data: pubCmd('durum', 'Bağlantı ve sunucu sağlık bilgilerini gösterir'),
    async execute(i) {
      await i.deferReply({ flags: E });
      const s = await freshState();
      const fresh = bridge.freshStatus();
      const row = (ok, text) => `${ok ? theme.EMOJI.online : theme.EMOJI.offline} ${text}`;
      const e = theme.info('📋 Sistem sağlığı').addFields(
        { name: 'Minecraft sunucusu', value: row(s.online, s.online ? `Çevrimiçi (${s.version || '?'})` : 'Ulaşılamıyor'), inline: true },
        { name: 'Eklenti köprüsü', value: row(bridge.isConnected(), bridge.isConnected() ? `Bağlı (${bridge.serverInfo?.pluginVersion || '?'})` : 'Bağlı değil'), inline: true },
        { name: 'MongoDB', value: row(isConnected(), isConnected() ? 'Bağlı' : 'Kopuk'), inline: true },
        { name: 'Son sorgu', value: s.checkedAt ? ts(s.checkedAt) : '—', inline: true },
        { name: 'Eklenti verisi', value: fresh ? ts(fresh.at) : 'Yok/eski', inline: true },
        { name: 'TPS', value: fresh?.tps != null ? String(fresh.tps) : 'Bilinmiyor', inline: true },
        { name: 'Bot çalışma süresi', value: formatDuration(process.uptime() * 1000), inline: true },
      );
      await i.editReply({ embeds: [e] });
    },
  },
  {
    data: pubCmd('ping', 'Bot ve Minecraft bağlantı gecikmelerini gösterir'),
    async execute(i, client) {
      await i.deferReply({ flags: E });
      const s = await freshState();
      let bridgeMs = null;
      if (bridge.isConnected()) bridgeMs = await bridge.ping().catch(() => null);
      const e = theme.info(`${theme.EMOJI.ping} Gecikmeler`).addFields(
        { name: 'Discord WS', value: `${Math.round(client.ws.ping)} ms`, inline: true },
        { name: 'Minecraft sunucusu', value: s.online && s.latency != null ? `${s.latency} ms` : 'Ulaşılamıyor', inline: true },
        { name: 'Eklenti köprüsü', value: bridgeMs != null ? `${bridgeMs} ms` : 'Bağlı değil', inline: true },
      );
      await i.editReply({ embeds: [e] });
    },
  },
  {
    data: pubCmd('oyuncular', 'Çevrimiçi oyuncuları listeler'),
    async execute(i) {
      await i.deferReply();
      const s = await freshState();
      if (!s.online) return i.editReply({ embeds: [theme.error('Sunucuya ulaşılamıyor, oyuncu listesi alınamadı.')] });
      const { names, complete } = mcStatus.playerNames();
      const e = theme.embed(`${theme.EMOJI.players} Çevrimiçi oyuncular (${s.players.online}/${s.players.max})`,
        names.length ? names.map((n) => `\`${n}\``).join(', ') + (complete ? '' : '\n*Liste kısmi; tam liste için eklenti bağlı olmalı.*') : s.players.online ? 'İsimler alınamadı (eklenti bağlı değil).' : 'Şu an oyuncu yok.');
      await i.editReply({ embeds: [e] });
    },
  },
  {
    data: pubCmd('oyuncu', 'Bir oyuncunun bilgilerini gösterir')
      .addStringOption((o) => o.setName('isim').setDescription('Minecraft oyuncu adı').setRequired(true).setMaxLength(16)),
    async execute(i) {
      await i.deferReply();
      await i.editReply({ embeds: [await playerEmbed(i.guildId, i.options.getString('isim'))] });
    },
  },
  {
    data: pubCmd('istatistik', 'Toplanan gerçek istatistikleri gösterir'),
    async execute(i) {
      await i.deferReply();
      const g = i.guildId;
      const [linked, openTickets, totalTickets, activeGw, totalGw, warns, xpUsers] = await Promise.all([
        LinkedAccount.countDocuments({ guildId: g }),
        Ticket.countDocuments({ guildId: g, status: 'open' }),
        Ticket.countDocuments({ guildId: g }),
        Giveaway.countDocuments({ guildId: g, status: 'active' }),
        Giveaway.countDocuments({ guildId: g }),
        Warning.countDocuments({ guildId: g }),
        UserXP.countDocuments({ guildId: g }),
      ]);
      const fresh = bridge.freshStatus();
      const e = theme.info('📊 İstatistikler').addFields(
        { name: 'Discord üyeleri', value: String(i.guild.memberCount), inline: true },
        { name: 'Doğrulanmış hesaplar', value: String(linked), inline: true },
        { name: 'Seviye takibindeki üyeler', value: String(xpUsers), inline: true },
        { name: 'Biletler', value: `${openTickets} açık / ${totalTickets} toplam`, inline: true },
        { name: 'Çekilişler', value: `${activeGw} aktif / ${totalGw} toplam`, inline: true },
        { name: 'Verilen uyarılar', value: String(warns), inline: true },
      );
      if (fresh?.uniquePlayers != null) e.addFields({ name: 'Sunucuya girmiş benzersiz oyuncu', value: String(fresh.uniquePlayers), inline: true });
      await i.editReply({ embeds: [e] });
    },
  },
  {
    data: adminCmd('sunucuyenile', 'Sunucu durum bilgisini hemen yeniler'),
    async execute(i, client) {
      if (!(await ensure(i, 'admin'))) return;
      await i.deferReply({ flags: E });
      await mcStatus.tick(client);
      await i.editReply({ embeds: [theme.success('Durum bilgisi yenilendi.')] });
    },
  },
  {
    data: adminCmd('bakim', 'Bakım modunu yönetir')
      .addSubcommand((s) => s.setName('aç').setDescription('Bakım modunu etkinleştirir'))
      .addSubcommand((s) => s.setName('kapat').setDescription('Bakım modunu devre dışı bırakır')),
    async execute(i, client) {
      if (!(await ensure(i, 'admin'))) return;
      await i.deferReply({ flags: E });
      const enabled = i.options.getSubcommand() === 'aç';
      const { applied } = await setMaintenance(client, i.guildId, enabled, i.user.id);
      const note = applied ? 'Oyunda uygulandı.' : '⚠️ Eklenti bağlı değil/yanıt vermedi: ayar kaydedildi, eklenti bağlandığında oyuna uygulanacak.';
      await i.editReply({ embeds: [(applied ? theme.success : theme.warn)(`Bakım modu **${enabled ? 'açıldı' : 'kapatıldı'}**. ${note}`)] });
    },
  },
  ...[['duyuru', 'announce', 'Minecraft sunucusuna duyuru gönderir'], ['sunucumesaj', 'staff_message', 'Oyun içine yetkili mesajı gönderir']].map(([name, type, desc]) => ({
    data: adminCmd(name, desc).addStringOption((o) => o.setName('mesaj').setDescription('Mesaj').setRequired(true).setMaxLength(256)),
    async execute(i) {
      if (!(await ensure(i, 'admin'))) return;
      requireBridge();
      await i.deferReply({ flags: E });
      const message = sanitizeForMinecraft(i.options.getString('mesaj'));
      if (!message) throw new UserError('Mesaj boş olamaz.');
      const res = await bridge.request(type, { message, from: sanitizeForMinecraft(i.member.displayName, 32) }).catch(() => null);
      if (!res?.ok) throw new UserError('Minecraft eklentisi mesajı onaylamadı; iletilmiş sayılmaz.');
      await audit(i.guildId, i.user.id, `mc.${type}`, null, { message });
      await i.editReply({ embeds: [theme.success(`Mesaj ${res.recipients ?? '?'} oyuncuya iletildi:\n> ${truncate(message, 200)}`)] });
    },
  })),
];

module.exports = commands;
