const { GuildConfig } = require('../database/models');

const cache = new Map(); // guildId -> { at, doc }
const TTL = 10_000;

async function get(guildId) {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < TTL) return hit.doc;
  const doc = await GuildConfig.findOneAndUpdate(
    { guildId },
    { $setOnInsert: { guildId } },
    { upsert: true, new: true, setDefaultsOnInsert: true, lean: true },
  );
  cache.set(guildId, { at: Date.now(), doc });
  return doc;
}

/** `$set`/`$inc` gibi bir Mongo güncellemesi uygular, önbelleği yeniler. */
async function update(guildId, change) {
  const doc = await GuildConfig.findOneAndUpdate({ guildId }, change, {
    upsert: true, new: true, setDefaultsOnInsert: true, lean: true,
  });
  cache.set(guildId, { at: Date.now(), doc });
  return doc;
}

const set = (guildId, fields) => update(guildId, { $set: fields });

module.exports = { get, update, set };
