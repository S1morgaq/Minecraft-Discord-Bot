const { env } = require('../../config/env');
const { logger, safeError } = require('../../utils/logger');
const guildConfig = require('../guildConfig');
const bridge = require('./bridge');

/** Eklenti her bağlandığında kalıcı bakım durumunu oyuna iletir (kaynak: MongoDB). */
function register() {
  bridge.on('connected', async () => {
    try {
      const cfg = await guildConfig.get(env.guildId);
      bridge.send('maintenance', { enabled: Boolean(cfg.maintenance?.enabled), sync: true });
    } catch (err) {
      logger.warn({ err: safeError(err) }, 'Bakım durumu eklentiye senkronlanamadı');
    }
  });
}

module.exports = { register };
