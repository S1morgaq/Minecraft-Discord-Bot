const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const service = require('../../services/tickets/service');
const { Ticket } = require('../../database/models');
const theme = require('../../config/theme');
const ids = require('../../utils/ids');
const { ensure } = require('../../utils/permissions');
const { UserError } = require('../../utils/errors');

module.exports = {
  module: 'ticket',
  async execute(interaction, [action]) {
    const ticket = await Ticket.findOne({ channelId: interaction.channelId, status: 'open' }).lean();
    if (!ticket) throw new UserError('Bu bilet artık açık değil.');

    if (action === 'claim') {
      if (!(await ensure(interaction, 'support'))) return;
      await service.claim(interaction);
      await interaction.update({ components: service.ticketButtons(true) });
      return interaction.followUp({ embeds: [theme.info('🙋 Bilet devralındı', `${interaction.user} bu bilete bakıyor.`)] });
    }

    if (action === 'close') {
      // Bilet sahibi veya destek yetkilisi kapatabilir
      if (interaction.user.id !== ticket.userId && !(await ensure(interaction, 'support'))) return;
      const modal = new ModalBuilder().setCustomId(ids.id('ticket', 'close')).setTitle('Bileti kapat').addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('reason').setLabel('Kapatma sebebi').setStyle(TextInputStyle.Paragraph)
            .setRequired(false).setMaxLength(300),
        ),
      );
      return interaction.showModal(modal);
    }
  },
};
