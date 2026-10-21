const { SlashCommandBuilder, PermissionFlagsBits: P, MessageFlags } = require('discord.js');
const service = require('../../services/verification/service');
const theme = require('../../config/theme');
const { ensure } = require('../../utils/permissions');
const { UserError } = require('../../utils/errors');
const { ts } = require('../../utils/duration');
const { env } = require('../../config/env');

module.exports = [
  {
    data: new SlashCommandBuilder().setName('doğrula').setDescription('Minecraft hesabını Discord hesabınla ilişkilendirir').setContexts(0),
    async execute(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const res = await service.issueCode(i.guild, i.user.id);
      if (res.retriedRole) {
        return i.editReply({ embeds: [theme.success(`**${res.name}** hesabın zaten bağlıydı; eksik olan rol şimdi verildi.`)] });
      }
      await i.editReply({ embeds: [theme.embed('🔐 Doğrulama kodun', `Minecraft'ta **${env.mc.host}** sunucusuna girip şu komutu yaz:\n\n\`/dogrula ${res.code}\`\n\nKod tek kullanımlıktır ve ${ts(res.expiresAt)} süresi dolar. **Kimseyle paylaşma.**`, theme.COLORS.cyan)] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('doğrulama-kaldır').setDescription('Bir kullanıcının hesap bağlantısını kaldırır')
      .setDefaultMemberPermissions(P.ManageGuild).setContexts(0)
      .addUserOption((o) => o.setName('kullanıcı').setDescription('Kullanıcı').setRequired(true)),
    async execute(i) {
      if (!(await ensure(i, 'admin'))) return;
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const user = i.options.getUser('kullanıcı');
      const link = await service.unlink(i.guild, user.id, i.user.id);
      if (!link) throw new UserError('Bu kullanıcının bağlı hesabı yok.');
      await i.editReply({ embeds: [theme.success(`${user} kullanıcısının **${link.minecraftName}** bağlantısı kaldırıldı.`)] });
    },
  },
];
