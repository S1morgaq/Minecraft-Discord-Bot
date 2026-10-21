const { Schema, model } = require('mongoose');

const ModerationLogSchema = new Schema(
  {
    guildId: { type: String, required: true },
    action: {
      type: String,
      required: true,
      enum: ['warn', 'unwarn', 'timeout', 'untimeout', 'kick', 'ban', 'unban', 'purge', 'slowmode', 'lock', 'unlock', 'nick'],
    },
    targetId: { type: String, default: null },
    moderatorId: { type: String, required: true },
    reason: { type: String, default: 'Belirtilmedi', maxlength: 512 },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
ModerationLogSchema.index({ guildId: 1, createdAt: -1 });
ModerationLogSchema.index({ guildId: 1, targetId: 1, createdAt: -1 });

const WarningSchema = new Schema(
  {
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    moderatorId: { type: String, required: true },
    reason: { type: String, required: true, maxlength: 512 },
  },
  { timestamps: true },
);
WarningSchema.index({ guildId: 1, userId: 1, createdAt: -1 });

module.exports = {
  ModerationLog: model('ModerationLog', ModerationLogSchema),
  Warning: model('Warning', WarningSchema),
};
