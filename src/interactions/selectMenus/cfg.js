const panel = require('../../panels/admin');
const guildConfig = require('../../services/guildConfig');
const { audit } = require('../../services/audit');

module.exports = {
  module: 'cfg',
  permission: 'admin',
  async execute(interaction, [action, key, section]) {
    const id = interaction.values[0];
    if (action === 'setch' && panel.CHANNEL_LABELS[key]) {
      const ch = interaction.guild.channels.cache.get(id);
      const me = interaction.guild.members.me;
      // Metin kanalıysa botun gönderebildiğini doğrula (kategori hariç)
      if (ch?.isTextBased() && !ch.permissionsFor(me)?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
        return interaction.reply({ content: `⚠️ ${ch} kanalında mesaj/embed gönderme iznim yok. İzin verip tekrar dene.`, flags: 64 });
      }
      await guildConfig.set(interaction.guildId, { [`channels.${key}`]: id });
      await audit(interaction.guildId, interaction.user.id, 'config.channel', key, { channelId: id });
    } else if (action === 'setrole' && panel.ROLE_LABELS[key]) {
      await guildConfig.set(interaction.guildId, { [`roles.${key}`]: id });
      await audit(interaction.guildId, interaction.user.id, 'config.role', key, { roleId: id });
    } else return;
    await interaction.update(await panel.render(section, interaction.client));
  },
};
