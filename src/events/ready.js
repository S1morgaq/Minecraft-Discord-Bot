const { ActivityType } = require('discord.js');
const { env } = require('../config/env');
const theme = require('../config/theme');
const { logger } = require('../utils/logger');
const { notify } = require('../services/notifier');
const mcStatus = require('../services/minecraft/status');
const mcChat = require('../services/minecraft/chat');
const mcSync = require('../services/minecraft/sync');
const verifyListener = require('../services/verification/listener');
const giveaways = require('../services/giveaways/service');
const announcer = require('../services/community/announcer');

module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    logger.info(`Discord'a bağlandı: ${client.user.tag}`);
    client.user.setPresence({ activities: [{ name: env.mc.host, type: ActivityType.Playing }], status: 'online' });

    mcChat.register(client);
    mcSync.register();
    verifyListener.register(client);
    mcStatus.start(client);
    await giveaways.start(client);
    announcer.start(client);

    await notify(client, env.guildId, 'botStart', {
      embeds: [theme.success(`Bot başlatıldı. Köprü: \`ws://${env.bridge.host}:${env.bridge.port}\``, '🤖 Bot çevrimiçi')],
    }, 'bot-start');
  },
};
