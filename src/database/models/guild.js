const { Schema, model } = require('mongoose');

const str = { type: String, default: null };

const GuildConfigSchema = new Schema(
  {
    guildId: { type: String, required: true, unique: true },
    channels: {
      status: str, chat: str, log: str, modlog: str, welcome: str, leave: str,
      serverEvents: str, announce: str, giveaway: str, ticketLog: str,
      ticketCategory: str, errors: str, levelUp: str,
    },
    roles: { admin: str, mod: str, support: str, verified: str, autoRole: str },
    notifications: {
      serverOnline: { type: Boolean, default: true },
      serverOffline: { type: Boolean, default: true },
      maintenance: { type: Boolean, default: true },
      giveawayNew: { type: Boolean, default: true },
      giveawayEnd: { type: Boolean, default: true },
      playerJoin: { type: Boolean, default: false },
      playerQuit: { type: Boolean, default: false },
      modAction: { type: Boolean, default: true },
      botStart: { type: Boolean, default: true },
      botError: { type: Boolean, default: true },
    },
    chatBridge: {
      enabled: { type: Boolean, default: false },
      toDiscord: { type: Boolean, default: true },
      toMinecraft: { type: Boolean, default: true },
    },
    maintenance: { enabled: { type: Boolean, default: false }, since: Date, by: str },
    statusMessage: { channelId: str, messageId: str },
    mcState: { online: { type: Boolean, default: null }, since: Date },
    welcomeMessage: { type: String, default: 'Hoş geldin {user}! **{server}** sunucusuna katıldın. Şu an {count} üyeyiz.' },
    leaveMessage: { type: String, default: '**{username}** sunucudan ayrıldı.' },
    xp: {
      enabled: { type: Boolean, default: true },
      min: { type: Number, default: 15 },
      max: { type: Number, default: 25 },
      cooldownSec: { type: Number, default: 60 },
      minMessageLength: { type: Number, default: 5 },
      dailyReward: { type: Number, default: 200 },
      dailyCooldownHours: { type: Number, default: 20 },
    },
    tickets: {
      counter: { type: Number, default: 0 },
      limitPerUser: { type: Number, default: 2 },
      categories: { type: [String], default: ['Genel Destek', 'Oyun İçi Sorun', 'Satın Alma', 'Şikayet'] },
    },
  },
  { timestamps: true },
);

module.exports = { GuildConfig: model('GuildConfig', GuildConfigSchema) };
