const { logger, safeError } = require('../utils/logger');
const { forwardDiscordMessage } = require('../services/minecraft/chat');
const xp = require('../services/community/xp');

module.exports = {
  name: 'messageCreate',
  async execute(client, message) {
    if (message.author.bot) return; // bot mesajları (köprünün kendi mesajları dahil) asla geri yansıtılmaz
    await Promise.allSettled([forwardDiscordMessage(message), xp.handleMessage(message)]).then((results) => {
      for (const r of results) if (r.status === 'rejected') logger.warn({ err: safeError(r.reason) }, 'Mesaj işleyici hatası');
    });
  },
};
