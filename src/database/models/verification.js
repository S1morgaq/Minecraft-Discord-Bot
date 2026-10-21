const { Schema, model } = require('mongoose');

const LinkedAccountSchema = new Schema(
  {
    guildId: { type: String, required: true },
    discordId: { type: String, required: true },
    minecraftUuid: { type: String, required: true },
    minecraftName: { type: String, required: true },
    roleGranted: { type: Boolean, default: false },
    linkedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
// Bir Discord hesabı tek, bir Minecraft hesabı da tek hesaba bağlanabilir.
LinkedAccountSchema.index({ guildId: 1, discordId: 1 }, { unique: true });
LinkedAccountSchema.index({ guildId: 1, minecraftUuid: 1 }, { unique: true });

const VerificationCodeSchema = new Schema(
  {
    guildId: { type: String, required: true },
    discordId: { type: String, required: true },
    codeHash: { type: String, required: true }, // SHA-256; düz kod saklanmaz
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
VerificationCodeSchema.index({ guildId: 1, discordId: 1 }, { unique: true });
VerificationCodeSchema.index({ codeHash: 1 }, { unique: true });
VerificationCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = {
  LinkedAccount: model('LinkedAccount', LinkedAccountSchema),
  VerificationCode: model('VerificationCode', VerificationCodeSchema),
};
