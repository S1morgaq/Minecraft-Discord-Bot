const { env } = require('../../config/env');
const theme = require('../../config/theme');
const { logger, safeError } = require('../../utils/logger');
const { sanitizeForDiscord } = require('../../utils/text');
const bridge = require('../minecraft/bridge');
const guildConfig = require('../guildConfig');
const { consumeCode } = require('./service');

/** Eklentiden gelen `verify` isteklerini işler ve sonucu eklentiye geri bildirir. */
function register(client) {
  bridge.on('verify', async (data, reply) => {
    let result;
    try {
      result = await consumeCode(client, data);
    } catch (err) {
      logger.error({ err: safeError(err) }, 'Doğrulama işlenemedi');
      result = { ok: false, message: 'Sunucu hatası, daha sonra tekrar dene.' };
    }
    reply({ uuid: data.uuid, ok: result.ok, message: result.message });

    if (result.ok) {
      const cfg = await guildConfig.get(env.guildId);
      const chId = cfg.channels?.chat;
      const ch = chId && (await client.channels.fetch(chId).catch(() => null));
      if (ch?.isTextBased() && cfg.chatBridge?.enabled) {
        const embed = theme.success(`**${sanitizeForDiscord(data.name, 16)}** Minecraft hesabını doğruladı.`, '🔗 Hesap doğrulandı');
        ch.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
      }
    }
  });
}

module.exports = { register };
