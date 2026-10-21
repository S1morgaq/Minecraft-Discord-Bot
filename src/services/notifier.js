const guildConfig = require('./guildConfig');
const { logger, safeError } = require('../utils/logger');

// Bildirim türü -> hedef kanal anahtarı
const CHANNEL_FOR = {
  serverOnline: 'serverEvents', serverOffline: 'serverEvents', maintenance: 'serverEvents',
  giveawayNew: 'giveaway', giveawayEnd: 'giveaway',
  playerJoin: 'chat', playerQuit: 'chat',
  modAction: 'modlog',
  botStart: 'errors', botError: 'errors',
};

const recent = new Map(); // dedupeKey -> zaman
const DEDUPE_MS = 60_000;

/**
 * Yapılandırılmış kanala bildirim gönderir. Tür kapalıysa veya kanal yoksa sessizce atlar.
 * `dedupeKey` aynıysa 60 sn içinde tekrar gönderilmez.
 */
async function notify(client, guildId, type, payload, dedupeKey = null) {
  try {
    const cfg = await guildConfig.get(guildId);
    if (cfg.notifications?.[type] === false) return false;
    const channelId = cfg.channels?.[CHANNEL_FOR[type]] || (type.startsWith('bot') ? cfg.channels?.log : null);
    if (!channelId) return false;

    if (dedupeKey) {
      const now = Date.now();
      if (now - (recent.get(dedupeKey) || 0) < DEDUPE_MS) return false;
      recent.set(dedupeKey, now);
      if (recent.size > 500) for (const [k, t] of recent) if (now - t > DEDUPE_MS) recent.delete(k);
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return false;
    await channel.send({ ...payload, allowedMentions: payload.allowedMentions ?? { parse: [] } });
    return true;
  } catch (err) {
    logger.warn({ err: safeError(err), type }, 'Bildirim gönderilemedi');
    return false;
  }
}

module.exports = { notify, CHANNEL_FOR };
