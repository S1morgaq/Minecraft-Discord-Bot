const { Schema, model } = require('mongoose');

const TicketSchema = new Schema(
  {
    guildId: { type: String, required: true },
    number: { type: Number, required: true },
    channelId: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    category: { type: String, required: true },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    claimedBy: { type: String, default: null },
    addedUserIds: { type: [String], default: [] },
    closedBy: { type: String, default: null },
    closeReason: { type: String, default: null },
    closedAt: Date,
    actions: {
      type: [{ actorId: String, action: String, at: { type: Date, default: Date.now }, _id: false }],
      default: [],
    },
  },
  { timestamps: true },
);
TicketSchema.index({ guildId: 1, number: 1 }, { unique: true });
TicketSchema.index({ guildId: 1, userId: 1, status: 1 });

const TicketTranscriptSchema = new Schema(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: 'Ticket', required: true, unique: true },
    guildId: { type: String, required: true },
    messageCount: { type: Number, default: 0 },
    text: { type: String, default: '' },
  },
  { timestamps: true },
);

module.exports = {
  Ticket: model('Ticket', TicketSchema),
  TicketTranscript: model('TicketTranscript', TicketTranscriptSchema),
};
