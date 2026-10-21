const { Schema, model } = require('mongoose');

const GiveawaySchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, default: null },
    hostId: { type: String, required: true },
    prize: { type: String, required: true, maxlength: 256, trim: true },
    description: { type: String, maxlength: 1000, default: '' },
    winnerCount: { type: Number, required: true, min: 1, max: 20, default: 1 },
    endsAt: { type: Date, required: true },
    status: { type: String, enum: ['active', 'ending', 'ended', 'cancelled'], default: 'active' },
    requiredRoleId: { type: String, default: null },
    excludedRoleIds: { type: [String], default: [] },
    minAccountAgeDays: { type: Number, default: 0, min: 0 },
    minMemberDays: { type: Number, default: 0, min: 0 },
    buttonLabel: { type: String, default: 'Katıl', maxlength: 80 },
    imageUrl: { type: String, default: null },
    allowLeave: { type: Boolean, default: true },
    winners: { type: [String], default: [] },
    entryCount: { type: Number, default: 0, min: 0 },
    endedAt: Date,
    endingStartedAt: Date,
  },
  { timestamps: true },
);
GiveawaySchema.index({ status: 1, endsAt: 1 });

const GiveawayEntrySchema = new Schema(
  {
    giveawayId: { type: Schema.Types.ObjectId, ref: 'Giveaway', required: true },
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
  },
  { timestamps: true },
);
// Mükerrer katılımı veritabanı düzeyinde engeller.
GiveawayEntrySchema.index({ giveawayId: 1, userId: 1 }, { unique: true });

const GiveawayHistorySchema = new Schema(
  {
    giveawayId: { type: Schema.Types.ObjectId, ref: 'Giveaway', required: true, index: true },
    guildId: { type: String, required: true },
    kind: { type: String, enum: ['end', 'reroll', 'cancel', 'extend'], required: true },
    winners: { type: [String], default: [] },
    actorId: { type: String, default: null },
    note: { type: String, default: '' },
  },
  { timestamps: true },
);

module.exports = {
  Giveaway: model('Giveaway', GiveawaySchema),
  GiveawayEntry: model('GiveawayEntry', GiveawayEntrySchema),
  GiveawayHistory: model('GiveawayHistory', GiveawayHistorySchema),
};
