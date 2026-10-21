const { Announcement } = require('../../database/models');
const theme = require('../../config/theme');
const { logger, safeError } = require('../../utils/logger');

let timer = null;

/** Süresi gelen periyodik duyuruları, atomik "talep" ile tek sefer gönderir. */
async function tick(client) {
  const due = await Announcement.find({ enabled: true, nextRunAt: { $lte: new Date() } }).limit(10).lean();
  for (const a of due) {
    const claimed = await Announcement.findOneAndUpdate(
      { _id: a._id, nextRunAt: a.nextRunAt },
      { $set: { nextRunAt: new Date(Date.now() + a.intervalMs) } },
      { new: true },
    );
    if (!claimed) continue;
    const ch = await client.channels.fetch(a.channelId).catch(() => null);
    if (!ch?.isTextBased()) continue;
    await ch.send({ embeds: [theme.embed(a.title, a.content)], allowedMentions: { parse: [] } })
      .catch((err) => logger.warn({ err: safeError(err), id: String(a._id) }, 'Periyodik duyuru gönderilemedi'));
  }
}

function start(client) {
  timer = setInterval(() => tick(client).catch((err) => logger.error({ err: safeError(err) }, 'Duyuru zamanlayıcı hatası')), 30_000);
  timer.unref();
}

const stop = () => clearInterval(timer);

module.exports = { start, stop, tick };
