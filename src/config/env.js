require('dotenv').config({ quiet: true });

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== '' ? n : d;
};

const env = {
  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.CLIENT_ID || '',
  guildId: process.env.GUILD_ID || '',
  mongoUri: process.env.MONGODB_URI || '',
  mc: {
    host: process.env.MC_HOST || 'mc.zentarnetwork.com',
    port: num(process.env.MC_PORT, 25565),
    intervalSec: Math.max(15, num(process.env.MC_STATUS_INTERVAL_SEC, 30)),
  },
  bridge: {
    host: process.env.MC_BRIDGE_HOST || '127.0.0.1',
    port: num(process.env.MC_BRIDGE_PORT, 8765),
    secret: process.env.MC_BRIDGE_SECRET || '',
  },
  logLevel: process.env.LOG_LEVEL || 'info',
  bannerUrl: process.env.BRAND_BANNER_URL || '',
  iconUrl: process.env.BRAND_ICON_URL || '',
  timezoneOffset: '+03:00',
};

/** Eksik/hatalı ayarların listesini döndürür (boşsa yapılandırma geçerlidir). */
function validate() {
  const problems = [];
  if (!env.token) problems.push('DISCORD_TOKEN eksik');
  if (!/^\d{17,20}$/.test(env.clientId)) problems.push('CLIENT_ID eksik veya geçersiz');
  if (!/^\d{17,20}$/.test(env.guildId)) problems.push('GUILD_ID eksik veya geçersiz');
  if (!/^mongodb(\+srv)?:\/\//.test(env.mongoUri)) problems.push('MONGODB_URI eksik veya geçersiz');
  if (env.bridge.secret.length < 32) problems.push('MC_BRIDGE_SECRET en az 32 karakter olmalı');
  return problems;
}

module.exports = { env, validate };
