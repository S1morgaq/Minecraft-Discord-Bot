const { EventEmitter } = require('node:events');
const { WebSocketServer } = require('ws');
const { env } = require('../../config/env');
const { logger, safeError } = require('../../utils/logger');
const { RateLimiter } = require('../../utils/rateLimiter');
const { encode, decode, ReplayCache } = require('./protocol');

const AUTH_TIMEOUT_MS = 5000;
const PING_INTERVAL_MS = 15_000;
const STATUS_FRESH_MS = 40_000;

/**
 * Minecraft eklentisiyle imzalı WebSocket iletişimi.
 * Olaylar: connected, disconnected, status, chat, join, quit, death, verify
 */
class Bridge extends EventEmitter {
  constructor() {
    super();
    this.wss = null;
    this.socket = null; // kimliği doğrulanmış tek eklenti bağlantısı
    this.replay = new ReplayCache();
    this.pending = new Map(); // istek id -> { resolve, reject, timer }
    this.limiter = new RateLimiter(60, 10_000); // bağlantı başına 10 sn'de 60 mesaj
    this.latency = null;
    this.lastStatus = null;
    this.serverInfo = null;
    this.pingTimer = null;
  }

  start() {
    const { host, port, secret } = env.bridge;
    this.wss = new WebSocketServer({ host, port, maxPayload: 64 * 1024 });
    this.wss.on('listening', () => logger.info(`Minecraft köprüsü dinliyor: ws://${host}:${port}`));
    this.wss.on('error', (err) => logger.error({ err: safeError(err) }, 'Köprü sunucu hatası'));
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req, secret));
    this.pingTimer = setInterval(() => this.ping().catch(() => {}), PING_INTERVAL_MS);
    this.pingTimer.unref();
  }

  stop() {
    clearInterval(this.pingTimer);
    this.wss?.close();
  }

  onConnection(ws, req, secret) {
    const remote = req.socket.remoteAddress;
    ws.authed = false;
    const authTimer = setTimeout(() => {
      if (!ws.authed) ws.close(4401, 'auth-timeout');
    }, AUTH_TIMEOUT_MS);
    const key = Symbol('conn');

    ws.on('message', (raw) => {
      if (!this.limiter.take(key)) {
        logger.warn({ remote }, 'Köprü hız sınırı aşıldı, bağlantı kapatılıyor');
        return ws.close(4429, 'rate-limit');
      }
      const res = decode(secret, raw, 'plugin', this.replay);
      if (!res.ok) {
        logger.warn({ remote, reason: res.reason }, 'Geçersiz köprü mesajı reddedildi');
        if (!ws.authed || res.reason === 'bad-signature') ws.close(4401, 'unauthorized');
        return;
      }
      const msg = res.msg;
      if (!ws.authed) {
        if (msg.type !== 'hello') return ws.close(4401, 'unauthorized');
        return this.acceptHello(ws, msg, remote, secret, authTimer);
      }
      this.dispatch(msg);
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (this.socket === ws) {
        this.socket = null;
        this.latency = null;
        this.rejectAllPending(new Error('Bağlantı koptu'));
        logger.warn('Minecraft eklentisi bağlantısı koptu');
        this.emit('disconnected');
      }
    });
    ws.on('error', (err) => logger.warn({ err: safeError(err), remote }, 'Köprü soket hatası'));
  }

  acceptHello(ws, msg, remote, secret, authTimer) {
    clearTimeout(authTimer);
    if (this.socket && this.socket !== ws) this.socket.close(4000, 'replaced');
    ws.authed = true;
    this.socket = ws;
    this.serverInfo = { ...msg.data };
    ws.send(encode(secret, 'bot', 'hello_ack', { botTime: Date.now() }, msg.id).text);
    logger.info({ remote, plugin: msg.data.pluginVersion, server: msg.data.serverName }, 'Minecraft eklentisi bağlandı');
    this.emit('connected', msg.data);
    this.ping().catch(() => {});
  }

  dispatch(msg) {
    if (msg.re && this.pending.has(msg.re)) {
      const p = this.pending.get(msg.re);
      this.pending.delete(msg.re);
      clearTimeout(p.timer);
      return p.resolve(msg.data);
    }
    switch (msg.type) {
      case 'status':
        this.lastStatus = { ...msg.data, at: Date.now() };
        return this.emit('status', this.lastStatus);
      case 'chat': case 'join': case 'quit': case 'death':
        return this.emit(msg.type, msg.data);
      case 'verify':
        return this.emit('verify', msg.data, (reply) => this.send('verify_result', reply, msg.id));
      default:
        logger.debug({ type: msg.type }, 'Bilinmeyen köprü mesajı türü');
    }
  }

  isConnected() {
    return Boolean(this.socket && this.socket.readyState === 1);
  }

  /** Son durum yeterince tazeyse döner, değilse null (eski veri gösterilmez). */
  freshStatus() {
    if (!this.isConnected() || !this.lastStatus) return null;
    return Date.now() - this.lastStatus.at <= STATUS_FRESH_MS ? this.lastStatus : null;
  }

  send(type, data = {}, re = null) {
    if (!this.isConnected()) return null;
    const { id, text } = encode(env.bridge.secret, 'bot', type, data, re);
    this.socket.send(text);
    return id;
  }

  /** İstek gönderir, eklentinin `re` ile bağlı yanıtını bekler. */
  request(type, data = {}, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) return reject(new Error('Minecraft eklentisi bağlı değil'));
      const { id, text } = encode(env.bridge.secret, 'bot', type, data);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Minecraft eklentisi yanıt vermedi'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(text);
    });
  }

  async ping() {
    const t0 = Date.now();
    await this.request('ping', { t: t0 }, 5000);
    this.latency = Date.now() - t0;
    return this.latency;
  }

  rejectAllPending(err) {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }
}

module.exports = new Bridge();
