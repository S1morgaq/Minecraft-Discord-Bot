const mongoose = require('mongoose');
const { env } = require('../config/env');
const { logger, safeError } = require('../utils/logger');

let wired = false;

/** İlk bağlantıyı kurar; kopmalarda mongoose sürücüsü kendi yeniden bağlanma politikasını uygular. */
async function connectDatabase() {
  if (!wired) {
    wired = true;
    mongoose.connection.on('disconnected', () => logger.warn('MongoDB bağlantısı koptu, sürücü yeniden bağlanmayı deniyor.'));
    mongoose.connection.on('reconnected', () => logger.info('MongoDB bağlantısı yeniden kuruldu.'));
    mongoose.connection.on('error', (err) => logger.error({ err: safeError(err) }, 'MongoDB hatası'));
  }
  mongoose.set('strictQuery', true);

  for (let attempt = 1; ; attempt++) {
    try {
      await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 10 });
      break;
    } catch (err) {
      if (attempt >= 5) throw err;
      const wait = Math.min(30_000, 2000 * 2 ** attempt);
      logger.error({ err: safeError(err), attempt }, `MongoDB'ye bağlanılamadı, ${wait / 1000} sn sonra tekrar denenecek`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  const models = require('./models');
  await Promise.all(Object.values(models).map((m) => m.init())); // indeksleri oluştur
  logger.info('MongoDB bağlantısı hazır, indeksler oluşturuldu.');
}

const isConnected = () => mongoose.connection.readyState === 1;

module.exports = { connectDatabase, isConnected, mongoose };
