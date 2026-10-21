const { EmbedBuilder } = require('discord.js');
const { env } = require('./env');

const COLORS = {
  primary: 0x2b2d31, // koyu antrasit
  secondary: 0x0b0b0f, // siyah
  purple: 0xb026ff, // neon mor
  cyan: 0x00f0ff, // neon camgöbeği
  success: 0x2ecc71,
  warning: 0xff9f1a,
  error: 0xff3b3b,
};

const EMOJI = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  pending: '⏳',
  online: '🟢',
  offline: '🔴',
  maintenance: '🛠️',
  players: '👥',
  ping: '📡',
  giveaway: '🎉',
  ticket: '🎫',
  shield: '🛡️',
  star: '⭐',
};

const BRAND = 'ZentarNetwork • mc.zentarnetwork.com';

function base(color = COLORS.purple) {
  const e = new EmbedBuilder().setColor(color).setFooter({
    text: BRAND,
    ...(env.iconUrl ? { iconURL: env.iconUrl } : {}),
  }).setTimestamp();
  return e;
}

const embed = (title, description, color = COLORS.purple) => {
  const e = base(color);
  if (title) e.setTitle(title);
  if (description) e.setDescription(description);
  return e;
};

const info = (title, description) => embed(title, description, COLORS.cyan);
const success = (description, title = `${EMOJI.success} Başarılı`) => embed(title, description, COLORS.success);
const error = (description, title = `${EMOJI.error} Hata`) => embed(title, description, COLORS.error);
const warn = (description, title = `${EMOJI.warning} Uyarı`) => embed(title, description, COLORS.warning);
const pending = (description, title = `${EMOJI.pending} İşleniyor`) => embed(title, description, COLORS.primary);

/** 10 karakterlik ilerleme çubuğu. */
function progressBar(value, max, length = 10) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const filled = Math.round(ratio * length);
  return '▰'.repeat(filled) + '▱'.repeat(length - filled);
}

module.exports = { COLORS, EMOJI, BRAND, embed, info, success, error, warn, pending, progressBar };
