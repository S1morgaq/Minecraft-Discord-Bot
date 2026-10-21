process.env.MC_BRIDGE_SECRET = 'k'.repeat(48);
process.env.MC_BRIDGE_HOST = '127.0.0.1';
process.env.MC_BRIDGE_PORT = '38765';
process.env.LOG_LEVEL = 'silent';
process.env.LOG_PRETTY = 'false';

const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const bridge = require('../src/services/minecraft/bridge');
const { encode, decode, ReplayCache } = require('../src/services/minecraft/protocol');

const SECRET = process.env.MC_BRIDGE_SECRET;
const URL = 'ws://127.0.0.1:38765';
const once = (emitter, ev) => new Promise((r) => emitter.once(ev, r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Sahte eklenti: imzalı hello gönderir ve botun mesajlarını toplar. */
async function pluginClient({ secret = SECRET, hello = true } = {}) {
  const ws = new WebSocket(URL);
  const replay = new ReplayCache();
  const inbox = [];
  const closed = new Promise((r) => ws.on('close', (code) => r(code)));
  ws.on('message', (raw) => {
    const res = decode(SECRET, raw, 'bot', replay);
    if (res.ok) inbox.push(res.msg);
  });
  await once(ws, 'open');
  const send = (type, data, re) => ws.send(encode(secret, 'plugin', type, data, re).text);
  let helloId;
  if (hello) {
    const enc = encode(secret, 'plugin', 'hello', { serverName: 'GenPvP', pluginVersion: 'test' });
    helloId = enc.id;
    ws.send(enc.text);
  }
  return { ws, send, inbox, closed, helloId };
}

test.before(async () => {
  bridge.start();
  await once(bridge.wss, 'listening');
});
test.after(() => bridge.stop());

test('doğru anahtarla bağlanır, hello_ack alır', async () => {
  const connected = once(bridge, 'connected');
  const p = await pluginClient();
  await connected;
  await sleep(50);
  assert.ok(bridge.isConnected());
  assert.ok(p.inbox.some((m) => m.type === 'hello_ack' && m.re === p.helloId));
  p.ws.close();
  await once(bridge, 'disconnected');
  assert.equal(bridge.isConnected(), false);
});

test('yanlış anahtarla bağlantı reddedilir', async () => {
  const p = await pluginClient({ secret: 'z'.repeat(48) });
  assert.equal(await p.closed, 4401);
  assert.equal(bridge.isConnected(), false);
});

test('hello göndermeden gelen mesaj bağlantıyı kapatır', async () => {
  const p = await pluginClient({ hello: false });
  p.send('chat', { player: 'x', message: 'merhaba' });
  assert.equal(await p.closed, 4401);
});

test('imzasız/ham mesaj reddedilir', async () => {
  const p = await pluginClient({ hello: false });
  p.ws.send('{"type":"chat"}');
  assert.equal(await p.closed, 4401);
});

test('chat/join/quit olayları iletilir; tekrarlanan mesaj kimliği yok sayılır', async () => {
  const p = await pluginClient();
  await once(bridge, 'connected');
  const got = [];
  bridge.on('chat', (d) => got.push(d));
  const enc = encode(SECRET, 'plugin', 'chat', { player: 'Ali', message: 'selam' });
  p.ws.send(enc.text);
  p.ws.send(enc.text); // birebir aynı mesaj (replay)
  await sleep(150);
  assert.equal(got.length, 1);
  assert.equal(got[0].player, 'Ali');
  bridge.removeAllListeners('chat');
  p.ws.close();
  await once(bridge, 'disconnected');
});

test('istek/yanıt ve ping gecikmesi', async () => {
  const p = await pluginClient();
  await once(bridge, 'connected');
  p.ws.on('message', (raw) => {
    const res = decode(SECRET, raw, 'bot', new ReplayCache());
    if (res.ok && res.msg.type === 'ping') p.send('pong', res.msg.data, res.msg.id);
    if (res.ok && res.msg.type === 'announce') p.send('announce_result', { ok: true, recipients: 3 }, res.msg.id);
  });
  const reply = await bridge.request('announce', { message: 'hi' });
  assert.deepEqual(reply, { ok: true, recipients: 3 });
  const ms = await bridge.ping();
  assert.ok(ms >= 0 && ms < 2000);
  p.ws.close();
  await once(bridge, 'disconnected');
});

test('bağlantı yokken istek hata verir; kopma bekleyen istekleri reddeder', async () => {
  await assert.rejects(bridge.request('announce', {}), /bağlı değil/);
  const p = await pluginClient();
  await once(bridge, 'connected');
  const pending = bridge.request('announce', {}, 3000);
  await sleep(50);
  p.ws.close();
  await assert.rejects(pending, /koptu/);
});

test('kopma sonrası yeniden bağlanma kabul edilir', async () => {
  const a = await pluginClient();
  await once(bridge, 'connected');
  a.ws.close();
  await once(bridge, 'disconnected');
  const reconnect = once(bridge, 'connected');
  const b = await pluginClient();
  await reconnect;
  assert.ok(bridge.isConnected());
  b.ws.close();
  await once(bridge, 'disconnected');
});
