const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const panel = require('../../panels/admin');
const { ensure } = require('../../utils/permissions');
const { audit } = require('../../services/audit');

module.exports = {
  data: new SlashCommandBuilder().setName('admin-panel').setDescription('Etkileşimli yönetim panelini açar')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).setContexts(0),
  async execute(interaction) {
    if (!(await ensure(interaction, 'admin'))) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply(await panel.render('overview', interaction.client));
    await audit(interaction.guildId, interaction.user.id, 'admin_panel.open');
  },
};
