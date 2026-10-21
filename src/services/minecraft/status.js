const { status: pingServer } = require('minecraft-server-util');
const { env } = require('../../config/env');
const { logger, safeError } = require('../../utils/logger');
const theme = require('../../config/theme');
const guildConfig = require('../guildConfig');
const { notify } = require('../notifier');
const bridge = require('./bridge');
const { ts } = require('../../utils/duration');

/** Gerçek sunucu durumu (SLP sorgusu). Veri yoksa uydurulmaz. */
const state = {
  online: null, // null: henüz bilinmiyor
  checkedAt: null,
  lastOnlineAt: null,
  latency: null,
  version: null,
  players: { online: 0, max: 0, sample: [] },
  failures: 0,
};

const OFFLINE_AFTER_FAILURES = 2;
let timer = null;
let busy = false;

async function check() {
  try {
    const res = await pingServer(env.mc.host, env.mc.port, { timeout: 5000 });
    state.online = true;
    state.failures = 0;
    state.checkedAt = state.lastOnlineAt = Date.now();
    state.latency = res.roundTripLatency ?? null;
    state.version = res.version?.name ?? null;
    state.players = {
      online: res.players?.online ?? 0,
      max: res.players?.max ?? 0,
      sample: (res.players?.sample || []).map((p) => p.name),
    };
  } catch (err) {
    state.failures += 1;
    state.checkedAt = Date.now();
    logger.debug({ err: safeError(err), failures: state.failures }, 'Minecraft durum sorgusu başarısız');
    if (state.failures >= OFFLINE_AFTER_FAILURES) {
      state.online = false;
      state.latency = null;
      state.players = { online: 0, max: 0, sample: [] };
    }
  }
  return state;
}

/** Eklenti bağlı ve veri tazeyse eklentiden gelen gerçek oyuncu listesi, yoksa SLP örneği. */
function playerNames() {
  const fresh = bridge.freshStatus();
  if (fresh?.players) return { names: fresh.players.map((p) => p.name), complete: true };
  return { names: state.players.sample, complete: state.players.sample.length >= state.players.online };
}

async function handleTransition(client) {
  if (state.online === null) return;
  const cfg = await guildConfig.get(env.guildId);
  const prev = cfg.mcState?.online;
  if (prev === state.online) return;
  await guildConfig.set(env.guildId, { 'mcState.online': state.online, 'mcState.since': new Date() });
  if (prev === null || prev === undefined) return; // ilk ölçüm: bildirim yok
  const up = state.online;
  await notify(
    client, env.guildId, up ? 'serverOnline' : 'serverOffline',
    { embeds: [theme.embed(up ? `${theme.EMOJI.online} Sunucu açıldı` : `${theme.EMOJI.offline} Sunucu kapandı`,
      `**${env.mc.host}** ${up ? 'tekrar çevrimiçi!' : 'şu anda ulaşılamıyor.'}`, up ? theme.COLORS.success : theme.COLORS.error)] },
    `mc-${up ? 'up' : 'down'}-${Math.floor(Date.now() / 60_000)}`,
  );
}

function buildEmbed(cfg) {
  const maintenance = Boolean(cfg.maintenance?.enabled);
  const e = theme.embed(
    `${state.online ? theme.EMOJI.online : state.online === false ? theme.EMOJI.offline : theme.EMOJI.pending} ZentarNetwork • GenPvP`,
    `\`${env.mc.host}\``,
    state.online ? theme.COLORS.purple : theme.COLORS.error,
  );
  if (env.bannerUrl) e.setImage(env.bannerUrl);

  e.addFields({ name: 'Durum', value: state.online === null ? 'Bilinmiyor' : state.online ? 'Çevrimiçi' : 'Çevrimdışı', inline: true });
  e.addFields({ name: 'Bakım modu', value: maintenance ? `${theme.EMOJI.maintenance} Açık` : 'Kapalı', inline: true });

  if (state.online) {
    const { online, max } = state.players;
    e.addFields(
      { name: 'Oyuncular', value: `${online}/${max}\n${theme.progressBar(online, max)}`, inline: true },
      { name: 'Sürüm', value: state.version || 'Bilinmiyor', inline: true },
      { name: 'Gecikme', value: state.latency != null ? `${state.latency} ms` : '—', inline: true },
    );
    const { names, complete } = playerNames();
    if (names.length) {
      e.addFields({
        name: 'Çevrimiçi oyuncular', value: names.slice(0, 40).map((n) => `\`${n}\``).join(', ') + (complete ? '' : ' …'),
      });
    }
  } else if (state.online === false && state.lastOnlineAt) {
    e.addFields({ name: 'Son başarılı kontrol', value: ts(state.lastOnlineAt, 'R') });
  }
  e.addFields({ name: 'Son güncelleme', value: state.checkedAt ? ts(state.checkedAt, 'R') : '—' });
  return e;
}

/** Durum kanalındaki tek mesajı düzenler; yoksa yeniden oluşturur. */
async function updateStatusMessage(client) {
  const cfg = await guildConfig.get(env.guildId);
  const channelId = cfg.channels?.status;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const payload = { embeds: [buildEmbed(cfg)], allowedMentions: { parse: [] } };

  const sameChannel = cfg.statusMessage?.channelId === channelId;
  if (sameChannel && cfg.statusMessage?.messageId) {
    const msg = await channel.messages.fetch(cfg.statusMessage.messageId).catch(() => null);
    if (msg) return void (await msg.edit(payload));
  }
  const sent = await channel.send(payload);
  await guildConfig.set(env.guildId, { statusMessage: { channelId, messageId: sent.id } });
}

async function tick(client) {
  if (busy) return;
  busy = true;
  try {
    await check();
    await handleTransition(client);
    await updateStatusMessage(client);
  } catch (err) {
    logger.error({ err: safeError(err) }, 'Durum güncelleme hatası');
  } finally {
    busy = false;
  }
}

function start(client) {
  tick(client);
  timer = setInterval(() => tick(client), env.mc.intervalSec * 1000);
  timer.unref();
  bridge.on('connected', () => tick(client));
}

const stop = () => clearInterval(timer);

module.exports = { state, check, tick, start, stop, buildEmbed, playerNames };
