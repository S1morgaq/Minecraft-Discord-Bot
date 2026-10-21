const { MessageFlags } = require('discord.js');
const service = require('../../services/tickets/service');
const theme = require('../../config/theme');

module.exports = {
  module: 'ticket',
  async execute(interaction, [action]) {
    if (action !== 'open') return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = await service.open(interaction, interaction.values[0]);
    await interaction.editReply({ embeds: [theme.success(`Biletin oluşturuldu: ${channel}`)] });
    // Panel mesajındaki seçimi sıfırlamak için bileşeni yeniden yaz
    await interaction.message.edit({ components: interaction.message.components }).catch(() => {});
  },
};
