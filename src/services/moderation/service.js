const { PermissionFlagsBits } = require('discord.js');
const { ModerationLog } = require('../../database/models');
const theme = require('../../config/theme');
const { UserError } = require('../../utils/errors');
const { audit } = require('../audit');
const { notify } = require('../notifier');
const { truncate } = require('../../utils/text');

const ACTION_LABEL = {
  warn: 'Uyarı', unwarn: 'Uyarı silindi', timeout: 'Timeout', untimeout: 'Timeout kaldırıldı', kick: 'Atma',
  ban: 'Yasaklama', unban: 'Yasak kaldırıldı', purge: 'Mesaj silme', slowmode: 'Yavaş mod', lock: 'Kanal kilitlendi',
  unlock: 'Kanal kilidi açıldı', nick: 'Takma ad',
};

/**
 * Hedef üyeye işlem yapılabilir mi? Kendine, sunucu sahibine, bota ve
 * yetkili/botun rolünden yüksek veya eşit rollere sahip üyelere karşı engeller.
 */
function assertCanTarget(interaction, target, { needBotPerm, label = 'bu işlemi' } = {}) {
  const guild = interaction.guild;
  const me = guild.members.me;
  const actor = interaction.member;
  if (target.id === interaction.user.id) throw new UserError('Kendine karşı bu işlemi yapamazsın.');
  if (target.id === interaction.client.user.id) throw new UserError('Bana karşı bu işlemi yapamazsın.');
  if (target.id === guild.ownerId) throw new UserError('Sunucu sahibine karşı bu işlemi yapamazsın.');
  if (actor.id !== guild.ownerId && target.roles.highest.position >= actor.roles.highest.position) {
    throw new UserError('Senden yüksek veya eşit roldeki bir üyeye karşı bu işlemi yapamazsın.');
  }
  if (target.roles.highest.position >= me.roles.highest.position) {
    throw new UserError('Bu üyenin rolü benim rolümden yüksek veya eşit; işlemi yapamam.');
  }
  if (needBotPerm && !me.permissions.has(needBotPerm)) {
    throw new UserError(`${label} yapmak için gerekli iznim yok.`);
  }
}

function assertBotPerm(interaction, perm, text) {
  if (!interaction.guild.members.me.permissions.has(perm)) throw new UserError(text);
}

/** Kaydı yazar, modlog kanalına gönderir, denetim kaydı ekler. */
async function record(client, guildId, { action, targetId = null, moderatorId, reason = 'Belirtilmedi', meta = {} }) {
  const doc = await ModerationLog.create({ guildId, action, targetId, moderatorId, reason: truncate(reason, 512), meta });
  await audit(guildId, moderatorId, `mod.${action}`, targetId, { reason, ...meta });
  const embed = theme.embed(`${theme.EMOJI.shield} ${ACTION_LABEL[action] || action}`, null, theme.COLORS.warning)
    .addFields(
      ...(targetId ? [{ name: 'Hedef', value: `<@${targetId}> (\`${targetId}\`)`, inline: true }] : []),
      { name: 'Yetkili', value: `<@${moderatorId}>`, inline: true },
      { name: 'Sebep', value: truncate(reason, 1000) },
    );
  for (const [k, v] of Object.entries(meta)) embed.addFields({ name: k, value: truncate(String(v), 200), inline: true });
  await notify(client, guildId, 'modAction', { embeds: [embed] });
  return doc;
}

/** Kullanıcıya DM atmayı dener; kapalıysa sessizce false döner. */
async function dm(user, title, description) {
  try {
    await user.send({ embeds: [theme.warn(description, title)] });
    return true;
  } catch {
    return false;
  }
}

module.exports = { assertCanTarget, assertBotPerm, record, dm, ACTION_LABEL, P: PermissionFlagsBits };
