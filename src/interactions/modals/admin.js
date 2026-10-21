const { MessageFlags } = require('discord.js');
const guildConfig = require('../../services/guildConfig');
const giveaways = require('../../services/giveaways/service');
const bridge = require('../../services/minecraft/bridge');
const { playerEmbed } = require('../../services/minecraft/player');
const { audit } = require('../../services/audit');
const theme = require('../../config/theme');
const { UserError } = require('../../utils/errors');
const { parseDuration, ts } = require('../../utils/duration');
const { clean, sanitizeForMinecraft } = require('../../utils/text');

const E = MessageFlags.Ephemeral;
const intField = (i, id, min, max, label) => {
  const n = Number(i.fields.getTextInputValue(id));
  if (!Number.isInteger(n) || n < min || n > max) throw new UserError(`${label} ${min}-${max} arasında bir tam sayı olmalı.`);
  return n;
};

module.exports = {
  module: 'admin',
  permission: 'admin',
  async execute(interaction, [action]) {
    const gid = interaction.guildId;
    const text = (id) => interaction.fields.getTextInputValue(id);

    switch (action) {
      case 'player_search': {
        await interaction.deferReply({ flags: E });
        return interaction.editReply({ embeds: [await playerEmbed(gid, text('name'))] });
      }
      case 'announce_mc': {
        if (!bridge.isConnected()) throw new UserError('Minecraft eklentisi bağlı değil; duyuru iletilemedi.');
        const message = sanitizeForMinecraft(text('message'));
        await interaction.deferReply({ flags: E });
        const res = await bridge.request('announce', { message, from: sanitizeForMinecraft(interaction.member.displayName, 32) }).catch(() => null);
        if (!res?.ok) throw new UserError('Eklenti mesajı onaylamadı; iletilmiş sayılmaz.');
        await audit(gid, interaction.user.id, 'mc.announce', null, { message });
        return interaction.editReply({ embeds: [theme.success(`Duyuru ${res.recipients ?? '?'} oyuncuya iletildi.`)] });
      }
      case 'announce_dc': {
        const cfg = await guildConfig.get(gid);
        const ch = await interaction.client.channels.fetch(cfg.channels.announce || interaction.channelId).catch(() => null);
        if (!ch?.isTextBased()) throw new UserError('Duyuru kanalı bulunamadı.');
        await ch.send({ embeds: [theme.embed(clean(text('title'), 100), clean(text('body'), 2000))], allowedMentions: { parse: [] } });
        await audit(gid, interaction.user.id, 'announce.discord', ch.id);
        return interaction.reply({ embeds: [theme.success(`Duyuru ${ch} kanalına gönderildi.`)], flags: E });
      }
      case 'gw_new': {
        await interaction.deferReply({ flags: E });
        const winners = intField(interaction, 'winners', 1, 20, 'Kazanan sayısı');
        const ms = parseDuration(text('duration'));
        if (!ms || ms < 10_000 || ms > 90 * 86_400_000) throw new UserError('Süre geçersiz (10 sn - 90 gün). Örn: `1h`, `2d`');
        const g = await giveaways.create(interaction.client, interaction.channel, {
          hostId: interaction.user.id, prize: clean(text('prize'), 200), winnerCount: winners,
          endsAt: new Date(Date.now() + ms), description: clean(text('description'), 500),
        });
        return interaction.editReply({ embeds: [theme.success(`Çekiliş başlatıldı. Bitiş: ${ts(g.endsAt, 'f')}`)] });
      }
      case 'xp': {
        const min = intField(interaction, 'min', 0, 1000, 'Min XP');
        const max = intField(interaction, 'max', min, 1000, 'Maks XP');
        const fields = {
          'xp.min': min, 'xp.max': max, 'xp.cooldownSec': intField(interaction, 'cooldown', 5, 86400, 'Bekleme süresi'),
          'xp.minMessageLength': intField(interaction, 'minlen', 0, 200, 'Min. uzunluk'),
          'xp.dailyReward': intField(interaction, 'daily', 0, 100000, 'Günlük ödül'),
        };
        await guildConfig.set(gid, fields);
        await audit(gid, interaction.user.id, 'config.xp', null, fields);
        return interaction.reply({ embeds: [theme.success('XP ayarları güncellendi. Paneli yenile.')], flags: E });
      }
      case 'welcome': {
        const fields = { welcomeMessage: clean(text('welcome'), 500), leaveMessage: clean(text('leave'), 500) };
        await guildConfig.set(gid, fields);
        await audit(gid, interaction.user.id, 'config.welcome');
        return interaction.reply({ embeds: [theme.success('Metinler güncellendi.')], flags: E });
      }
      default:
    }
  },
};
