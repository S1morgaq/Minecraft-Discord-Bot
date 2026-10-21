const { PermissionFlagsBits: P, MessageFlags } = require('discord.js');
const guildConfig = require('../services/guildConfig');
const theme = require('../config/theme');

const isAdmin = (member, cfg) =>
  member.permissions.has(P.Administrator) ||
  member.permissions.has(P.ManageGuild) ||
  Boolean(cfg.roles?.admin && member.roles.cache.has(cfg.roles.admin));

const isMod = (member, cfg) =>
  isAdmin(member, cfg) ||
  member.permissions.has(P.ModerateMembers) ||
  Boolean(cfg.roles?.mod && member.roles.cache.has(cfg.roles.mod));

const isSupport = (member, cfg) =>
  isMod(member, cfg) || Boolean(cfg.roles?.support && member.roles.cache.has(cfg.roles.support));

const CHECKS = { admin: isAdmin, mod: isMod, support: isSupport };

async function reply(interaction, payload) {
  const body = { ...payload, flags: MessageFlags.Ephemeral };
  if (interaction.deferred || interaction.replied) return interaction.followUp(body);
  return interaction.reply(body);
}

/**
 * Her etkileşimde yetkiyi taze üyelik bilgisiyle yeniden doğrular.
 * Yetkisizse ephemeral reddi gönderir ve false döner.
 */
async function ensure(interaction, level) {
  const cfg = await guildConfig.get(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (member && CHECKS[level](member, cfg)) return true;
  await reply(interaction, { embeds: [theme.error('Bu işlem için yetkin yok.', '⛔ Erişim reddedildi')] });
  return false;
}

module.exports = { isAdmin, isMod, isSupport, ensure, reply };
