const { ActionRowBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const panel = require('../../panels/admin');
const guildConfig = require('../../services/guildConfig');
const { audit } = require('../../services/audit');
const theme = require('../../config/theme');
const ids = require('../../utils/ids');

/** "Kanal seç" / "Rol seç" ikinci adım görünümü (anahtar customId içinde taşınır). */
function pickerView(kind, key, section) {
  const label = (kind === 'ch' ? panel.CHANNEL_LABELS : panel.ROLE_LABELS)[key];
  const select = kind === 'ch'
    ? new ChannelSelectMenuBuilder().setCustomId(ids.id('cfg', 'setch', key, section))
      .setChannelTypes(key === 'ticketCategory' ? [ChannelType.GuildCategory] : [ChannelType.GuildText, ChannelType.GuildAnnouncement])
    : new RoleSelectMenuBuilder().setCustomId(ids.id('cfg', 'setrole', key, section));
  select.setPlaceholder(`${label} için seç…`).setMinValues(1).setMaxValues(1);
  return {
    embeds: [theme.embed('⚙️ Ayar seç', `**${label}** için yeni değeri seç.`)],
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ids.id('admin', 'clear', kind, key, section)).setLabel('Temizle').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(ids.id('admin', 'refresh', section)).setLabel('Geri').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

module.exports = {
  module: 'admin',
  permission: 'admin',
  pickerView,
  async execute(interaction, [action]) {
    const value = interaction.values[0];
    switch (action) {
      case 'nav':
        return interaction.update(await panel.render(value, interaction.client));
      case 'pickch':
        if (!panel.CHANNEL_LABELS[value]) return;
        return interaction.update(pickerView('ch', value, 'logs'));
      case 'pickrole':
        if (!panel.ROLE_LABELS[value]) return;
        return interaction.update(pickerView('role', value, 'verification'));
      case 'notif': {
        const on = new Set(interaction.values);
        const fields = Object.fromEntries(Object.keys(panel.NOTIF_LABELS).map((k) => [`notifications.${k}`, on.has(k)]));
        await guildConfig.set(interaction.guildId, fields);
        await audit(interaction.guildId, interaction.user.id, 'config.notifications', null, { enabled: [...on] });
        return interaction.update(await panel.render('config', interaction.client));
      }
      default:
    }
  },
};
