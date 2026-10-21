const { MessageFlags } = require('discord.js');
const theme = require('../../config/theme');
const { ensure } = require('../../utils/permissions');
const { clean } = require('../../utils/text');

module.exports = {
  module: 'rules',
  async execute(interaction) {
    if (!(await ensure(interaction, 'admin'))) return;
    const title = clean(interaction.fields.getTextInputValue('title'), 100);
    const body = clean(interaction.fields.getTextInputValue('body'), 4000);
    await interaction.channel.send({ embeds: [theme.embed(title, body, theme.COLORS.purple)], allowedMentions: { parse: [] } });
    await interaction.reply({ embeds: [theme.success('Kurallar gönderildi.')], flags: MessageFlags.Ephemeral });
  },
};
