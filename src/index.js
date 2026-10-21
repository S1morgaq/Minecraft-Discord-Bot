const { Client, GatewayIntentBits, Partials, Options } = require('discord.js');
const { env, validate } = require('./config/env');
const { logger, safeError } = require('./utils/logger');

const problems = validate();
if (problems.length) {
  console.error('Yapılandırma hatası:\n - ' + problems.join('\n - ') + '\n\n.env dosyasını kontrol edin (örnek: .env.example).');
  process.exit(1);
}

const { connectDatabase, mongoose } = require('./database/connect');
const { loadCommands, loadHandlers, loadEvents } = require('./utils/loader');
const bridge = require('./services/minecraft/bridge');
const mcStatus = require('./services/minecraft/status');
const giveaways = require('./services/giveaways/service');
const announcer = require('./services/community/announcer');
const { reportToChannel } = require('./utils/errors');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // ayrıcalıklı: karşılama, otomatik rol, çekiliş kontrolleri
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // ayrıcalıklı: sohbet köprüsü ve XP
  ],
  partials: [Partials.Channel],
  allowedMentions: { parse: [] },
  makeCache: Options.cacheWithLimits({ ...Options.DefaultMakeCacheSettings, MessageManager: 50 }),
});

client.commands = loadCommands();
client.handlers = loadHandlers();
for (const ev of loadEvents()) {
  const run = (...args) => Promise.resolve(ev.execute(client, ...args)).catch((err) => logger.error({ err: safeError(err), event: ev.name }, 'Olay işleyici hatası'));
  if (ev.once) client.once(ev.name, run);
  else client.on(ev.name, run);
}

client.on('error', (err) => logger.error({ err: safeError(err) }, 'Discord istemci hatası'));
client.on('warn', (msg) => logger.warn(msg));
client.on('shardDisconnect', (e, id) => logger.warn({ code: e.code, shard: id }, 'Discord bağlantısı koptu'));
client.on('shardReconnecting', (id) => logger.info({ shard: id }, 'Discord yeniden bağlanıyor'));

let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Kapatılıyor…');
  try {
    mcStatus.stop(); giveaways.stop(); announcer.stop(); bridge.stop();
    await client.destroy();
    await mongoose.disconnect();
  } catch (err) {
    logger.error({ err: safeError(err) }, 'Kapatma hatası');
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: safeError(reason instanceof Error ? reason : new Error(String(reason))) }, 'Yakalanmamış promise reddi');
  reportToChannel(client, 'unhandled', reason instanceof Error ? reason : new Error(String(reason)));
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err: safeError(err) }, 'Yakalanmamış istisna, bot kapatılıyor');
  shutdown(1);
});

(async () => {
  logger.info(`Komutlar yüklendi: ${client.commands.size}`);
  await connectDatabase();
  bridge.start();
  await client.login(env.token);
})().catch((err) => {
  logger.fatal({ err: safeError(err) }, 'Bot başlatılamadı');
  process.exit(1);
});
