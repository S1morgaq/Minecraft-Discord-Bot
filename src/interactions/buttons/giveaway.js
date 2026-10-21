const { MessageFlags } = require('discord.js');
const service = require('../../services/giveaways/service');
const theme = require('../../config/theme');

module.exports = {
  module: 'gw',
  async execute(interaction, [action, giveawayId]) {
    if (!/^[a-f\d]{24}$/i.test(giveawayId || '')) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (action === 'join') {
      const count = await service.join(interaction, giveawayId);
      return interaction.editReply({ embeds: [theme.success(`Çekilişe katıldın! Şu an **${count}** katılımcı var.`)] });
    }
    if (action === 'leave') {
      await service.leave(interaction, giveawayId);
      return interaction.editReply({ embeds: [theme.success('Çekilişten ayrıldın.')] });
    }
  },
};
