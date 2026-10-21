const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const panel = require('../../panels/admin');
const { pickerView } = require('../selectMenus/admin');
const guildConfig = require('../../services/guildConfig');
const mcStatus = require('../../services/minecraft/status');
const { setMaintenance } = require('../../services/minecraft/maintenance');
const tickets = require('../../services/tickets/service');
const { audit } = require('../../services/audit');
const theme = require('../../config/theme');
const ids = require('../../utils/ids');

const input = (id, label, style, opts = {}) => {
  const field = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style)
    .setRequired(opts.required ?? true).setMaxLength(opts.max ?? 100);
  if (opts.value) field.setValue(opts.value);
  return new ActionRowBuilder().addComponents(field);
};
const modal = (id, title, ...rows) => new ModalBuilder().setCustomId(ids.id('admin', id)).setTitle(title).addComponents(...rows);
const S = TextInputStyle.Short;
const P = TextInputStyle.Paragraph;

module.exports = {
  module: 'admin',
  permission: 'admin',
  async execute(interaction, [action, ...args]) {
    const client = interaction.client;
    const gid = interaction.guildId;
    switch (action) {
      case 'refresh':
        return interaction.update(await panel.render(args[0], client));
      case 'mc_refresh':
        await interaction.deferUpdate();
        await mcStatus.tick(client);
        return interaction.editReply(await panel.render('server', client));
      case 'maint': {
        await interaction.deferUpdate();
        const { applied } = await setMaintenance(client, gid, args[0] === 'on', interaction.user.id);
        await interaction.editReply(await panel.render('server', client));
        if (!applied) await interaction.followUp({ embeds: [theme.warn('Bakım ayarı kaydedildi ancak eklenti onaylamadı (bağlı değil olabilir). Eklenti bağlandığında oyuna uygulanacak.')], flags: MessageFlags.Ephemeral });
        return;
      }
      case 'bridge': {
        const field = args[0];
        if (!['enabled', 'toDiscord', 'toMinecraft'].includes(field)) return;
        const cfg = await guildConfig.get(gid);
        await guildConfig.set(gid, { [`chatBridge.${field}`]: !cfg.chatBridge[field] });
        await audit(gid, interaction.user.id, 'config.bridge', field, { value: !cfg.chatBridge[field] });
        return interaction.update(await panel.render('bridge', client));
      }
      case 'xp_toggle': {
        const cfg = await guildConfig.get(gid);
        await guildConfig.set(gid, { 'xp.enabled': !cfg.xp.enabled });
        await audit(gid, interaction.user.id, 'config.xp_toggle', null, { value: !cfg.xp.enabled });
        return interaction.update(await panel.render('config', client));
      }
      case 'pickch':
        return interaction.update(pickerView('ch', args[0], args[1] || 'logs'));
      case 'clear': {
        const [kind, key, section] = args;
        if (kind === 'ch' && panel.CHANNEL_LABELS[key]) await guildConfig.set(gid, { [`channels.${key}`]: null });
        else if (kind === 'role' && panel.ROLE_LABELS[key]) await guildConfig.set(gid, { [`roles.${key}`]: null });
        else return;
        await audit(gid, interaction.user.id, 'config.clear', key);
        return interaction.update(await panel.render(section, client));
      }
      case 'ticket_panel': {
        const cfg = await guildConfig.get(gid);
        await interaction.channel.send(tickets.panelPayload(cfg));
        return interaction.reply({ embeds: [theme.success('Destek paneli bu kanala gönderildi.')], flags: MessageFlags.Ephemeral });
      }
      case 'player_search':
        return interaction.showModal(modal('player_search', 'Oyuncu ara', input('name', 'Minecraft oyuncu adı', S, { max: 16 })));
      case 'announce_mc':
        return interaction.showModal(modal('announce_mc', 'Oyuna duyuru', input('message', 'Mesaj', P, { max: 256 })));
      case 'announce_dc':
        return interaction.showModal(modal('announce_dc', 'Discord duyurusu',
          input('title', 'Başlık', S, { max: 100, value: '📢 Duyuru' }), input('body', 'İçerik', P, { max: 2000 })));
      case 'gw_new':
        return interaction.showModal(modal('gw_new', 'Hızlı çekiliş (bu kanalda)',
          input('prize', 'Ödül', S, { max: 200 }), input('winners', 'Kazanan sayısı', S, { max: 2, value: '1' }),
          input('duration', 'Süre (örn: 1h, 2d)', S, { max: 20, value: '1d' }),
          input('description', 'Açıklama (isteğe bağlı)', P, { required: false, max: 500 })));
      case 'xp_modal': {
        const x = (await guildConfig.get(gid)).xp;
        return interaction.showModal(modal('xp', 'XP ayarları',
          input('min', 'Mesaj başına min XP', S, { max: 4, value: String(x.min) }),
          input('max', 'Mesaj başına maks XP', S, { max: 4, value: String(x.max) }),
          input('cooldown', 'Bekleme süresi (sn)', S, { max: 5, value: String(x.cooldownSec) }),
          input('minlen', 'Min. mesaj uzunluğu', S, { max: 3, value: String(x.minMessageLength) }),
          input('daily', 'Günlük ödül (coin)', S, { max: 6, value: String(x.dailyReward) })));
      }
      case 'welcome_modal': {
        const cfg = await guildConfig.get(gid);
        return interaction.showModal(modal('welcome', 'Karşılama / Ayrılma metni',
          input('welcome', 'Karşılama ({user} {server} {count})', P, { max: 500, value: cfg.welcomeMessage }),
          input('leave', 'Ayrılma ({username} {server} {count})', P, { max: 500, value: cfg.leaveMessage })));
      }
      default:
    }
  },
};
