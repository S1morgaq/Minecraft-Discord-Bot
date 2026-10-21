const { AuditLog } = require('../database/models');
const { logger, safeError } = require('../utils/logger');

/** Denetim kaydı yazar; kayıt hatası asıl işlemi bozmaz. */
async function audit(guildId, actorId, action, target = null, details = {}) {
  try {
    await AuditLog.create({ guildId, actorId, action, target, details });
  } catch (err) {
    logger.error({ err: safeError(err), action }, 'Denetim kaydı yazılamadı');
  }
}

module.exports = { audit };
