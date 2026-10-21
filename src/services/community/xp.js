const { UserXP, UserProfile } = require('../../database/models');
const guildConfig = require('../guildConfig');
const theme = require('../../config/theme');
const { logger, safeError } = require('../../utils/logger');

const lastContent = new Map(); // userId -> son mesaj (aynı mesajla XP farmını engeller)

/** Seviye n'den n+1'e geçmek için gereken XP. */
const xpForLevel = (n) => 5 * n * n + 50 * n + 100;

function levelFromXp(xp) {
  let level = 0;
  let rest = xp;
  while (rest >= xpForLevel(level)) {
    rest -= xpForLevel(level);
    level++;
  }
  return { level, current: rest, needed: xpForLevel(level) };
}

/** Mesajdan XP kazandırır. Bekleme süresi veritabanında atomik uygulanır. */
async function handleMessage(message) {
  if (message.author.bot || !message.guild || message.webhookId) return;
  const cfg = await guildConfig.get(message.guildId);
  const x = cfg.xp;
  if (!x.enabled) return;
  const text = message.content.trim();
  if (text.length < x.minMessageLength) return;
  if (lastContent.get(message.author.id) === text) return;
  lastContent.set(message.author.id, text);
  if (lastContent.size > 5000) lastContent.clear();

  const min = Math.min(x.min, x.max);
  const gain = min + Math.floor(Math.random() * (Math.max(x.min, x.max) - min + 1));
  const now = new Date();
  const cutoff = new Date(now.getTime() - x.cooldownSec * 1000);

  let doc;
  try {
    doc = await UserXP.findOneAndUpdate(
      { guildId: message.guildId, userId: message.author.id, $or: [{ lastXpAt: null }, { lastXpAt: { $lte: cutoff } }] },
      { $inc: { xp: gain, messages: 1 }, $set: { lastXpAt: now } },
      { upsert: true, new: true },
    );
  } catch (err) {
    if (err.code === 11000) return; // bekleme süresinde
    throw err;
  }
  const { level } = levelFromXp(doc.xp);
  if (level > doc.level) {
    await UserXP.updateOne({ _id: doc._id }, { $set: { level } });
    const channelId = cfg.channels.levelUp || message.channelId;
    const ch = await message.client.channels.fetch(channelId).catch(() => null);
    await ch?.send({
      content: `${message.author}`,
      embeds: [theme.embed('⬆️ Seviye atladın!', `${message.author} artık **seviye ${level}**!`, theme.COLORS.cyan)],
      allowedMentions: { users: [message.author.id] },
    }).catch((err) => logger.debug({ err: safeError(err) }, 'Seviye mesajı gönderilemedi'));
  }
}

/** Günlük ödül: bekleme süresi atomik; seri hesabı önceki kayda göre. */
async function claimDaily(guildId, userId) {
  const cfg = await guildConfig.get(guildId);
  const now = new Date();
  const cooldownMs = cfg.xp.dailyCooldownHours * 3_600_000;
  const prev = await UserProfile.findOne({ guildId, userId }).lean();
  const streak = prev?.lastDailyAt && now - prev.lastDailyAt < cooldownMs + 24 * 3_600_000 ? (prev.dailyStreak || 0) + 1 : 1;
  const reward = cfg.xp.dailyReward + Math.min(streak - 1, 7) * 10;
  try {
    const doc = await UserProfile.findOneAndUpdate(
      { guildId, userId, $or: [{ lastDailyAt: null }, { lastDailyAt: { $lte: new Date(now - cooldownMs) } }] },
      { $inc: { coins: reward }, $set: { lastDailyAt: now, dailyStreak: streak } },
      { upsert: true, new: true },
    );
    return { ok: true, reward, streak, coins: doc.coins };
  } catch (err) {
    if (err.code !== 11000) throw err;
    const cur = await UserProfile.findOne({ guildId, userId }).lean();
    return { ok: false, nextAt: new Date(cur.lastDailyAt.getTime() + cooldownMs) };
  }
}

module.exports = { handleMessage, claimDaily, levelFromXp, xpForLevel };
