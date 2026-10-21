const guildConfig = require('../services/guildConfig');
const theme = require('../config/theme');
const { env } = require('../config/env');
const { logger, safeError } = require('../utils/logger');
const { clean } = require('../utils/text');

const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);

async function post(client, channelId, embed, content) {
  if (!channelId) return;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  await ch?.send({ content, embeds: [embed], allowedMentions: { users: content ? [content.replace(/\D/g, '')] : [] } }).catch(() => {});
}

module.exports = [
  {
    name: 'guildMemberAdd',
    async execute(client, member) {
      if (member.guild.id !== env.guildId || member.user.bot) return;
      const cfg = await guildConfig.get(member.guild.id);
      if (cfg.roles.autoRole) {
        await member.roles.add(cfg.roles.autoRole, 'Otomatik rol').catch((err) => logger.warn({ err: safeError(err) }, 'Otomatik rol verilemedi'));
      }
      const text = fill(cfg.welcomeMessage, { user: `${member}`, username: clean(member.user.username, 32), server: member.guild.name, count: member.guild.memberCount });
      await post(client, cfg.channels.welcome, theme.embed('👋 Hoş geldin!', text, theme.COLORS.cyan).setThumbnail(member.user.displayAvatarURL()));
    },
  },
  {
    name: 'guildMemberRemove',
    async execute(client, member) {
      if (member.guild.id !== env.guildId || member.user?.bot) return;
      const cfg = await guildConfig.get(member.guild.id);
      const text = fill(cfg.leaveMessage, { user: clean(member.user.username, 32), username: clean(member.user.username, 32), server: member.guild.name, count: member.guild.memberCount });
      await post(client, cfg.channels.leave, theme.embed('👋 Güle güle', text, theme.COLORS.primary));
    },
  },
];
