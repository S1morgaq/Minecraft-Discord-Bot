const pino = require('pino');
const { env } = require('../config/env');

const options = {
  level: env.logLevel,
  base: undefined,
  redact: {
    paths: ['token', '*.token', 'secret', '*.secret', 'password', '*.password', 'authorization', '*.authorization'],
    censor: '[gizli]',
  },
};

const pretty = process.stdout.isTTY && process.env.LOG_PRETTY !== 'false';
const logger = pretty
  ? pino({ ...options, transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } } })
  : pino({ ...options, timestamp: pino.stdTimeFunctions.isoTime });

/** Hata metinlerinden token/gizli anahtar sızıntısını temizler. */
function scrub(text) {
  let out = String(text ?? '');
  for (const s of [env.token, env.bridge.secret, env.mongoUri]) {
    if (s && s.length > 8) out = out.split(s).join('[gizli]');
  }
  return out.replace(/mongodb(\+srv)?:\/\/[^@\s]+@/g, 'mongodb$1://[gizli]@');
}

function safeError(err) {
  return { name: err?.name, code: err?.code, message: scrub(err?.message), stack: scrub(err?.stack) };
}

module.exports = { logger, scrub, safeError };
