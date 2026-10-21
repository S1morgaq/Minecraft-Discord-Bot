const { Schema, model } = require('mongoose');

const UserProfileSchema = new Schema(
  {
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    coins: { type: Number, default: 0, min: 0 },
    dailyStreak: { type: Number, default: 0 },
    lastDailyAt: Date,
  },
  { timestamps: true },
);
UserProfileSchema.index({ guildId: 1, userId: 1 }, { unique: true });

const UserXPSchema = new Schema(
  {
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    xp: { type: Number, default: 0, min: 0 },
    level: { type: Number, default: 0, min: 0 },
    messages: { type: Number, default: 0 },
    lastXpAt: Date,
  },
  { timestamps: true },
);
UserXPSchema.index({ guildId: 1, userId: 1 }, { unique: true });
UserXPSchema.index({ guildId: 1, xp: -1 });

const AnnouncementSchema = new Schema(
  {
    guildId: { type: String, required: true },
    channelId: { type: String, required: true },
    title: { type: String, default: '📢 Duyuru', maxlength: 256 },
    content: { type: String, required: true, maxlength: 2000 },
    intervalMs: { type: Number, required: true, min: 600_000 },
    nextRunAt: { type: Date, required: true },
    enabled: { type: Boolean, default: true },
    createdBy: { type: String, required: true },
  },
  { timestamps: true },
);
AnnouncementSchema.index({ enabled: 1, nextRunAt: 1 });

const PollSchema = new Schema(
  {
    guildId: { type: String, required: true },
    channelId: { type: String, required: true },
    messageId: { type: String, default: null },
    question: { type: String, required: true, maxlength: 256 },
    options: { type: [String], required: true },
    votes: { type: Map, of: Number, default: {} }, // userId -> seçenek indeksi
    createdBy: { type: String, required: true },
  },
  { timestamps: true },
);

const AuditLogSchema = new Schema(
  {
    guildId: { type: String, required: true },
    actorId: { type: String, default: null },
    action: { type: String, required: true },
    target: { type: String, default: null },
    details: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
AuditLogSchema.index({ guildId: 1, createdAt: -1 });
AuditLogSchema.index({ guildId: 1, action: 1 });

module.exports = {
  UserProfile: model('UserProfile', UserProfileSchema),
  UserXP: model('UserXP', UserXPSchema),
  Announcement: model('Announcement', AnnouncementSchema),
  Poll: model('Poll', PollSchema),
  AuditLog: model('AuditLog', AuditLogSchema),
};
