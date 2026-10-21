const crypto = require('node:crypto');

/**
 * Köprü protokolü. Her mesaj { p: "<JSON metni>", s: "<hex HMAC-SHA256>" } zarfıdır.
 * İmza, ayrıştırılmadan önce `p` metni üzerinde doğrulanır (kanonik JSON sorunu yoktur).
 * Payload: { id, ts, from, type, re?, data }
 *  - ts: zaman aşımı penceresi (tekrar saldırısı)
 *  - id: tek kullanımlık (tekrar saldırısı)
 *  - from: yön bağlama ("bot" | "plugin"); karşı tarafın mesajı geri yansıtılamaz
 */
const MAX_SKEW_MS = 60_000;

const sign = (secret, text) => crypto.createHmac('sha256', secret).update(text, 'utf8').digest('hex');

function encode(secret, from, type, data = {}, re = null) {
  const id = crypto.randomUUID();
  const p = JSON.stringify({ id, ts: Date.now(), from, type, ...(re ? { re } : {}), data });
  return { id, text: JSON.stringify({ p, s: sign(secret, p) }) };
}

/** Kısa ömürlü "görülmüş kimlik" önbelleği. */
class ReplayCache {
  constructor(ttlMs = MAX_SKEW_MS * 2) {
    this.ttlMs = ttlMs;
    this.seen = new Map();
  }

  /** Daha önce görüldüyse true döner; görülmediyse kaydeder. */
  check(id, now = Date.now()) {
    if (this.seen.size > 2000) this.sweep(now);
    if (this.seen.has(id)) return true;
    this.seen.set(id, now + this.ttlMs);
    return false;
  }

  sweep(now = Date.now()) {
    for (const [k, exp] of this.seen) if (exp <= now) this.seen.delete(k);
  }
}

/** @returns {{ok:true,msg:object}|{ok:false,reason:string}} */
function decode(secret, raw, expectedFrom, replay, now = Date.now()) {
  let env;
  try {
    env = JSON.parse(String(raw));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!env || typeof env.p !== 'string' || typeof env.s !== 'string' || !/^[0-9a-f]{64}$/i.test(env.s)) {
    return { ok: false, reason: 'malformed' };
  }
  const expected = Buffer.from(sign(secret, env.p), 'hex');
  const given = Buffer.from(env.s, 'hex');
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'bad-signature' };
  }
  let msg;
  try {
    msg = JSON.parse(env.p);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!msg || typeof msg.id !== 'string' || typeof msg.type !== 'string' || typeof msg.ts !== 'number') {
    return { ok: false, reason: 'malformed' };
  }
  if (msg.from !== expectedFrom) return { ok: false, reason: 'wrong-direction' };
  if (Math.abs(now - msg.ts) > MAX_SKEW_MS) return { ok: false, reason: 'expired' };
  if (replay.check(msg.id, now)) return { ok: false, reason: 'replay' };
  return { ok: true, msg: { ...msg, data: msg.data && typeof msg.data === 'object' ? msg.data : {} } };
}

module.exports = { encode, decode, sign, ReplayCache, MAX_SKEW_MS };
