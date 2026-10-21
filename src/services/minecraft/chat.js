const { env } = require('../../config/env');
const theme = require('../../config/theme');
const { logger, safeError } = require('../../utils/logger');
const { RateLimiter } = require('../../utils/rateLimiter');
const { sanitizeForDiscord, sanitizeForMinecraft } = require('../../utils/text');
const guildConfig = require('../guildConfig');
const { notify } = require('../notifier');
const bridge = require('./bridge');

const SERVER_TAG = 'GenPvP';
const perUser = new RateLimiter(5, 10_000); // Discord kullanıcısı başına 10 sn'de 5 mesaj
const lastMsg = new Map(); // userId -> { text, at } (aynı mesaj tekrarını engeller)
const perPlayer = new RateLimiter(10, 10_000); // Minecraft oyuncusu başına

async function bridgeChannel(client, cfg) {
  if (!cfg.chatBridge?.enabled || !cfg.channels?.chat) return null;
  const ch = await client.channels.fetch(cfg.channels.chat).catch(() => null);
  return ch?.isTextBased() ? ch : null;
}

/** Minecraft → Discord olay dinleyicilerini bağlar. */
function register(client) {
  const handle = (fn) => async (data) => {
    try {
      const cfg = await guildConfig.get(env.guildId);
      await fn(cfg, data);
    } catch (err) {
      logger.warn({ err: safeError(err) }, 'Köprü olayı işlenemedi');
    }
  };

  bridge.on('chat', handle(async (cfg, d) => {
    if (!cfg.chatBridge?.toDiscord) return;
    const name = sanitizeForDiscord(d.player, 32);
    if (!name || !perPlayer.take(d.uuid || name)) return;
    const ch = await bridgeChannel(client, cfg);
    if (!ch) return;
    const rank = d.rank ? `[${sanitizeForDiscord(d.rank, 24)}] ` : '';
    await ch.send({
      content: `**[${SERVER_TAG}]** ${rank}**${name}**: ${sanitizeForDiscord(d.message, 300)}`,
      allowedMentions: { parse: [] },
    });
  }));

  const lifecycle = (type, notifKey, color, emoji, text) => handle(async (cfg, d) => {
    const name = sanitizeForDiscord(d.player, 32);
    const body = text(name, d);
    const embed = theme.embed(null, `${emoji} ${body}`, color).setFooter({ text: theme.BRAND });
    if (cfg.chatBridge?.enabled && cfg.chatBridge.toDiscord) {
      const ch = await bridgeChannel(client, cfg);
      if (ch) return void (await ch.send({ embeds: [embed], allowedMentions: { parse: [] } }));
    }
    if (notifKey) await notify(client, env.guildId, notifKey, { embeds: [embed] });
  });

  bridge.on('join', lifecycle('join', 'playerJoin', theme.COLORS.success, '➕', (n) => `**${n}** sunucuya katıldı.`));
  bridge.on('quit', lifecycle('quit', 'playerQuit', theme.COLORS.primary, '➖', (n) => `**${n}** sunucudan ayrıldı.`));
  bridge.on('death', lifecycle('death', null, theme.COLORS.error, '💀', (n, d) => sanitizeForDiscord(d.message || `${n} öldü.`, 200)));
}

/** Discord → Minecraft. Komut çalıştırmaz; yalnızca sohbet satırı gönderir. */
async function forwardDiscordMessage(message) {
  if (message.author.bot || message.webhookId || message.system || !message.guild) return;
  if (message.guildId !== env.guildId) return;
  const cfg = await guildConfig.get(message.guildId);
  if (!cfg.chatBridge?.enabled || !cfg.chatBridge.toMinecraft || message.channelId !== cfg.channels?.chat) return;
  if (!bridge.isConnected()) return;

  const content = sanitizeForMinecraft(message.cleanContent + (message.attachments.size ? ' [ek]' : ''));
  if (!content) return;
  if (!perUser.take(message.author.id)) return;
  const prev = lastMsg.get(message.author.id);
  if (prev && prev.text === content && Date.now() - prev.at < 30_000) return;
  lastMsg.set(message.author.id, { text: content, at: Date.now() });
  if (lastMsg.size > 1000) lastMsg.clear();

  const name = sanitizeForMinecraft(message.member?.displayName || message.author.username, 32);
  bridge.send('discord_chat', { user: name, message: content });
}

module.exports = { register, forwardDiscordMessage };
