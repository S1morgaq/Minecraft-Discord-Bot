const crypto = require('node:crypto');
const { env } = require('../../config/env');
const { LinkedAccount, VerificationCode } = require('../../database/models');
const { RateLimiter } = require('../../utils/rateLimiter');
const { logger, safeError } = require('../../utils/logger');
const { UserError } = require('../../utils/errors');
const { audit } = require('../audit');
const guildConfig = require('../guildConfig');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // karışan karakterler (0/O, 1/I/L) yok
const CODE_LENGTH = 8;
const CODE_TTL_MS = 10 * 60_000;
const attempts = new RateLimiter(5, 60_000); // oyuncu başına dakikada 5 deneme

const hashCode = (code) => crypto.createHmac('sha256', env.bridge.secret).update(code.toUpperCase()).digest('hex');

function generateCode() {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

function normalizeUuid(uuid) {
  const hex = String(uuid || '').replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function grantRole(guild, discordId) {
  const cfg = await guildConfig.get(guild.id);
  if (!cfg.roles?.verified) return { ok: false, reason: 'Doğrulanmış rolü yapılandırılmamış.' };
  try {
    const member = await guild.members.fetch(discordId);
    await member.roles.add(cfg.roles.verified, 'Minecraft hesabı doğrulandı');
    return { ok: true };
  } catch (err) {
    logger.warn({ err: safeError(err), discordId }, 'Doğrulanmış rolü verilemedi');
    return { ok: false, reason: 'Rol verilemedi (bot yetkisi/rol sırası?).' };
  }
}

/** /doğrula: kod üretir. Zaten bağlıysa ve rol eksikse rolü yeniden dener. */
async function issueCode(guild, discordId) {
  const linked = await LinkedAccount.findOne({ guildId: guild.id, discordId });
  if (linked) {
    if (linked.roleGranted) throw new UserError(`Hesabın zaten **${linked.minecraftName}** ile ilişkilendirilmiş.`);
    const res = await grantRole(guild, discordId);
    if (res.ok) {
      await LinkedAccount.updateOne({ _id: linked._id }, { roleGranted: true });
      return { retriedRole: true, name: linked.minecraftName };
    }
    throw new UserError(`Hesabın bağlı ancak rol verilemedi: ${res.reason} Bir yetkiliye ulaş.`);
  }

  for (let i = 0; i < 5; i++) {
    const code = generateCode();
    try {
      await VerificationCode.findOneAndUpdate(
        { guildId: guild.id, discordId },
        { codeHash: hashCode(code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
        { upsert: true, new: true },
      );
      await audit(guild.id, discordId, 'verification.code_issued', discordId);
      return { code, expiresAt: Date.now() + CODE_TTL_MS };
    } catch (err) {
      if (err.code !== 11000) throw err; // kod çakışması: yeni kod dene
    }
  }
  throw new Error('Doğrulama kodu üretilemedi');
}

/** Minecraft tarafından gelen doğrulama isteği. { ok, message, discordId? } döner. */
async function consumeCode(client, { code, uuid, name }) {
  const mcUuid = normalizeUuid(uuid);
  const cleanName = String(name || '').slice(0, 16);
  if (!mcUuid || !/^\w{1,16}$/.test(cleanName)) return { ok: false, message: 'Geçersiz oyuncu bilgisi.' };
  if (!attempts.take(mcUuid)) return { ok: false, message: 'Çok fazla deneme yaptın, bir dakika bekle.' };
  if (!/^[A-Za-z0-9]{8}$/.test(String(code || ''))) return { ok: false, message: 'Kod geçersiz.' };

  const guildId = env.guildId;
  // Atomik tüketim: kod yalnızca bir kez ve süresi dolmadan kullanılabilir.
  const doc = await VerificationCode.findOneAndDelete({
    guildId, codeHash: hashCode(code), expiresAt: { $gt: new Date() },
  });
  if (!doc) return { ok: false, message: 'Kod geçersiz veya süresi dolmuş. Discord\'da /doğrula ile yeni kod al.' };

  if (await LinkedAccount.exists({ guildId, minecraftUuid: mcUuid })) {
    return { ok: false, message: 'Bu Minecraft hesabı zaten başka bir Discord hesabına bağlı.' };
  }
  let link;
  try {
    link = await LinkedAccount.create({ guildId, discordId: doc.discordId, minecraftUuid: mcUuid, minecraftName: cleanName });
  } catch (err) {
    if (err.code === 11000) return { ok: false, message: 'Hesap zaten ilişkilendirilmiş.' };
    throw err;
  }

  const guild = await client.guilds.fetch(guildId);
  const role = await grantRole(guild, doc.discordId);
  if (role.ok) await LinkedAccount.updateOne({ _id: link._id }, { roleGranted: true });
  await audit(guildId, doc.discordId, 'verification.linked', mcUuid, { name: cleanName, roleGranted: role.ok });

  return {
    ok: true,
    discordId: doc.discordId,
    roleGranted: role.ok,
    message: role.ok
      ? 'Hesabın başarıyla doğrulandı!'
      : `Hesabın bağlandı ancak rol verilemedi (${role.reason}) Discord'da /doğrula komutunu tekrar dene veya yetkiliye ulaş.`,
  };
}

async function unlink(guild, discordId, actorId) {
  const link = await LinkedAccount.findOneAndDelete({ guildId: guild.id, discordId });
  if (!link) return null;
  const cfg = await guildConfig.get(guild.id);
  if (cfg.roles?.verified) {
    const member = await guild.members.fetch(discordId).catch(() => null);
    await member?.roles.remove(cfg.roles.verified, 'Doğrulama kaldırıldı').catch(() => {});
  }
  await audit(guild.id, actorId, 'verification.unlinked', discordId, { uuid: link.minecraftUuid });
  return link;
}

module.exports = { issueCode, consumeCode, unlink, generateCode, hashCode, normalizeUuid, CODE_TTL_MS };
