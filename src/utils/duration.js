const UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** "1h30m", "2d", "45s" gibi ifadeleri milisaniyeye çevirir. Geçersizse null. */
function parseDuration(input) {
  if (!input) return null;
  const text = String(input).trim().toLowerCase().replace(/\s+/g, '');
  if (!/^(\d+[smhdw])+$/.test(text)) return null;
  let total = 0;
  for (const [, n, u] of text.matchAll(/(\d+)([smhdw])/g)) total += Number(n) * UNITS[u];
  return total > 0 && Number.isSafeInteger(total) ? total : null;
}

function formatDuration(ms) {
  if (ms < 1000) return '0 sn';
  const parts = [];
  const table = [['g', 86_400_000], ['sa', 3_600_000], ['dk', 60_000], ['sn', 1000]];
  let rest = ms;
  for (const [label, size] of table) {
    const n = Math.floor(rest / size);
    if (n) parts.push(`${n} ${label}`);
    rest %= size;
  }
  return parts.slice(0, 3).join(' ');
}

/** "2026-12-31 20:30" biçimini (Türkiye saati) Date'e çevirir. */
function parseDateTime(input, offset = '+03:00') {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec(String(input ?? '').trim());
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:00${offset}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const ts = (dateOrMs, style = 'R') => `<t:${Math.floor(new Date(dateOrMs).getTime() / 1000)}:${style}>`;

module.exports = { parseDuration, formatDuration, parseDateTime, ts };
