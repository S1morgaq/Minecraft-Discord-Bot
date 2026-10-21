const { escapeMarkdown } = require('discord.js');

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;

function truncate(text, max) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Minecraft → Discord: renk kodları, kontrol karakterleri, mention ve Markdown temizliği. */
function sanitizeForDiscord(text, max = 300) {
  let s = String(text ?? '').replace(/[§&][0-9a-fk-or]/gi, '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  s = escapeMarkdown(s);
  s = s.replace(/@(everyone|here)/gi, '@​$1').replace(/<(@[!&]?|#)(\d+)>/g, '<​$1$2>');
  return truncate(s, max);
}

/** Discord → Minecraft: renk/biçim kodları ve kontrol karakterleri temizlenir. */
function sanitizeForMinecraft(text, max = 256) {
  const s = String(text ?? '').replace(/[§]/g, '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  return truncate(s, max);
}

const clean = (text, max = 1000) => truncate(String(text ?? '').replace(CONTROL, ' ').trim(), max);

module.exports = { truncate, sanitizeForDiscord, sanitizeForMinecraft, clean };
