const test = require('node:test');
const assert = require('node:assert/strict');
const { encode, decode, ReplayCache, sign } = require('../src/services/minecraft/protocol');

const SECRET = 'x'.repeat(40);

test('geçerli mesaj çözülür', () => {
  const { text } = encode(SECRET, 'plugin', 'chat', { message: 'selam' });
  const res = decode(SECRET, text, 'plugin', new ReplayCache());
  assert.equal(res.ok, true);
  assert.equal(res.msg.data.message, 'selam');
});

test('yanlış anahtar ve kurcalanmış içerik reddedilir', () => {
  const { text } = encode(SECRET, 'plugin', 'chat', { message: 'selam' });
  assert.equal(decode('y'.repeat(40), text, 'plugin', new ReplayCache()).reason, 'bad-signature');
  const env = JSON.parse(text);
  env.p = env.p.replace('selam', 'hile!');
  assert.equal(decode(SECRET, JSON.stringify(env), 'plugin', new ReplayCache()).reason, 'bad-signature');
});

test('tekrar (replay) reddedilir', () => {
  const { text } = encode(SECRET, 'plugin', 'chat', {});
  const cache = new ReplayCache();
  assert.equal(decode(SECRET, text, 'plugin', cache).ok, true);
  assert.equal(decode(SECRET, text, 'plugin', cache).reason, 'replay');
});

test('zaman aşımı reddedilir', () => {
  const { text } = encode(SECRET, 'plugin', 'chat', {});
  const res = decode(SECRET, text, 'plugin', new ReplayCache(), Date.now() + 120_000);
  assert.equal(res.reason, 'expired');
});

test('yön bağlama: botun mesajı "plugin" mesajı olarak kabul edilmez', () => {
  const { text } = encode(SECRET, 'bot', 'announce', {});
  assert.equal(decode(SECRET, text, 'plugin', new ReplayCache()).reason, 'wrong-direction');
});

test('bozuk zarflar reddedilir', () => {
  const c = new ReplayCache();
  for (const raw of ['', 'abc', '{}', '{"p":1,"s":2}', JSON.stringify({ p: '{}', s: 'zz' })]) {
    assert.equal(decode(SECRET, raw, 'plugin', c).ok, false);
  }
  const p = JSON.stringify({ hello: 1 });
  assert.equal(decode(SECRET, JSON.stringify({ p, s: sign(SECRET, p) }), 'plugin', c).reason, 'malformed');
});
