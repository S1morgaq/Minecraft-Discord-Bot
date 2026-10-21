const { MessageFlags, PermissionFlagsBits: P } = require('discord.js');
const theme = require('../../config/theme');
const { UserError } = require('../../utils/errors');

const DANGEROUS = P.Administrator | P.ManageGuild | P.ManageRoles | P.ManageChannels | P.KickMembers | P.BanMembers
  | P.ModerateMembers | P.ManageMessages | P.MentionEveryone | P.ManageWebhooks | P.ManageNicknames;

module.exports = {
  module: 'rolemenu',
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    // Menüdeki roller mesajın kendi seçeneklerinden okunur (kalıcı, durumsuz).
    const menuRoleIds = interaction.component.options.map((o) => o.value);
    const selected = new Set(interaction.values.filter((v) => menuRoleIds.includes(v)));
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const botTop = interaction.guild.members.me.roles.highest.position;

    const added = [];
    const removed = [];
    for (const id of menuRoleIds) {
      const role = interaction.guild.roles.cache.get(id);
      if (!role) continue;
      // Menü oluşturulduktan sonra role tehlikeli izin eklenmiş olabilir: yeniden doğrula.
      if (role.managed || role.position >= botTop || (role.permissions.bitfield & DANGEROUS)) continue;
      const has = member.roles.cache.has(id);
      if (selected.has(id) && !has) { await member.roles.add(id, 'Rol menüsü'); added.push(role); }
      if (!selected.has(id) && has) { await member.roles.remove(id, 'Rol menüsü'); removed.push(role); }
    }
    if (!added.length && !removed.length) throw new UserError('Rollerinde değişiklik olmadı.');
    const parts = [];
    if (added.length) parts.push(`➕ ${added.map((r) => `**${r.name}**`).join(', ')}`);
    if (removed.length) parts.push(`➖ ${removed.map((r) => `**${r.name}**`).join(', ')}`);
    await interaction.editReply({ embeds: [theme.success(parts.join('\n'))] });
    await interaction.message.edit({ components: interaction.message.components }).catch(() => {}); // seçimi sıfırla
  },
};
