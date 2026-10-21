const { randomBytes } = require('node:crypto');
const { MessageFlags } = require('discord.js');
const { logger, safeError } = require('./logger');
const { env } = require('../config/env');
const theme = require('../config/theme');

/** Kullanıcıya gösterilmesi güvenli, beklenen hata. */
class UserError extends Error {}

// 10062: etkileşim süresi doldu, 40060: zaten yanıtlandı, 10008: mesaj yok
const IGNORABLE = new Set([10062, 40060, 10008]);
const lastNotified = { at: 0 };

async function handleInteractionError(interaction, err, client) {
  if (err instanceof UserError) {
    return respond(interaction, theme.warn(err.message));
  }
  if (IGNORABLE.has(err?.code)) {
    logger.debug({ code: err.code }, 'Süresi dolmuş/çift yanıtlanmış etkileşim yok sayıldı');
    return;
  }
  const ref = randomBytes(3).toString('hex');
  logger.error({ err: safeError(err), ref, customId: interaction.customId, command: interaction.commandName }, 'Etkileşim hatası');
  await respond(interaction, theme.error(`Beklenmeyen bir hata oluştu. Hata kodu: \`${ref}\``));
  await reportToChannel(client || interaction.client, ref, err);
}

async function respond(interaction, embed) {
  try {
    const body = { embeds: [embed], components: [], flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.followUp(body);
    else await interaction.reply(body);
  } catch (e) {
    logger.debug({ err: safeError(e) }, 'Hata yanıtı gönderilemedi');
  }
}

/** Hata kanalına (en fazla dakikada bir) özet gönderir. */
async function reportToChannel(client, ref, err) {
  try {
    if (!client || Date.now() - lastNotified.at < 60_000) return;
    lastNotified.at = Date.now();
    const { notify } = require('../services/notifier');
    const { scrub } = require('./logger');
    await notify(client, env.guildId, 'botError', {
      embeds: [theme.error(`Hata kodu: \`${ref}\`\n\`\`\`${scrub(err?.message).slice(0, 800)}\`\`\``, '🚨 Beklenmeyen hata')],
    });
  } catch { /* kanal raporu başarısızsa log yeterli */ }
}

module.exports = { UserError, handleInteractionError, reportToChannel };
