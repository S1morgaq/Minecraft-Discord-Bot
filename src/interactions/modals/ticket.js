const service = require('../../services/tickets/service');
const theme = require('../../config/theme');
const { Ticket } = require('../../database/models');
const { ensure } = require('../../utils/permissions');
const { UserError } = require('../../utils/errors');

module.exports = {
  module: 'ticket',
  async execute(interaction, [action]) {
    if (action !== 'close') return;
    // Modal gönderiminde yetkiyi yeniden doğrula
    const t = await Ticket.findOne({ channelId: interaction.channelId, status: 'open' }).lean();
    if (!t) throw new UserError('Bu bilet artık açık değil.');
    if (interaction.user.id !== t.userId && !(await ensure(interaction, 'support'))) return;
    await interaction.reply({ embeds: [theme.pending('Bilet kapatılıyor, transcript hazırlanıyor…')] });
    await service.close(interaction, interaction.fields.getTextInputValue('reason'));
  },
};
