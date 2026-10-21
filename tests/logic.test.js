const test = require('node:test');
const assert = require('node:assert/strict');
const { pickWinners, checkEligibility } = require('../src/services/giveaways/logic');
const { parseDuration, parseDateTime, formatDuration } = require('../src/utils/duration');
const { sanitizeForDiscord, sanitizeForMinecraft } = require('../src/utils/text');
const { RateLimiter } = require('../src/utils/rateLimiter');
const { levelFromXp } = require('../src/services/community/xp');
const ids = require('../src/utils/ids');

test('kazanan sayısı katılımcıyı aşarsa hata vermez, tekrar yok', () => {
  const w = pickWinners(['a', 'b', 'c', 'a'], 10);
  assert.equal(w.length, 3);
  assert.equal(new Set(w).size, 3);
  assert.deepEqual(pickWinners([], 3), []);
});

test('hariç tutulanlar seçilmez', () => {
  for (let i = 0; i < 50; i++) assert.ok(!pickWinners(['a', 'b', 'c'], 2, ['a']).includes('a'));
  assert.deepEqual(pickWinners(['a'], 1, ['a']), []);
});

test('seçim dağılımı rastgele (her aday bir noktada seçilir)', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(pickWinners(['a', 'b', 'c', 'd'], 1)[0]);
  assert.equal(seen.size, 4);
});

test('katılım koşulları', () => {
  const day = 86_400_000;
  const g = { requiredRoleId: 'R', excludedRoleIds: ['X'], minAccountAgeDays: 10, minMemberDays: 5 };
  const now = Date.now();
  const ok = { roleIds: ['R'], joinedAt: now - 6 * day };
  const user = { createdAt: now - 11 * day };
  assert.equal(checkEligibility(g, ok, user, now), null);
  assert.match(checkEligibility(g, { ...ok, roleIds: [] }, user, now), /rol/);
  assert.match(checkEligibility(g, { ...ok, roleIds: ['R', 'X'] }, user, now), /izin/);
  assert.match(checkEligibility(g, ok, { createdAt: now - 2 * day }, now), /Hesabın/);
  assert.match(checkEligibility(g, { ...ok, joinedAt: now - day }, user, now), /Sunucuda/);
});

test('süre ve tarih ayrıştırma', () => {
  assert.equal(parseDuration('1h30m'), 5_400_000);
  assert.equal(parseDuration('2d'), 172_800_000);
  assert.equal(parseDuration('abc'), null);
  assert.equal(parseDuration('0m'), null);
  assert.equal(parseDateTime('2026-12-31 20:30').toISOString(), '2026-12-31T17:30:00.000Z');
  assert.equal(parseDateTime('31.12.2026'), null);
  assert.match(formatDuration(5_400_000), /1 sa 30 dk/);
});

test('Minecraft → Discord temizliği mention ve markdown etkisizleştirir', () => {
  const out = sanitizeForDiscord('§cHi @everyone <@123> **kalın** @here');
  assert.ok(!out.includes('§'));
  assert.ok(!/@everyone/.test(out) && !/@here/.test(out));
  assert.ok(!/<@123>/.test(out));
  assert.ok(sanitizeForDiscord('a'.repeat(1000)).length <= 300);
});

test('Discord → Minecraft temizliği', () => {
  assert.equal(sanitizeForMinecraft('§aselam\n\nnasılsın'), 'aselam nasılsın');
  assert.ok(sanitizeForMinecraft('x'.repeat(999)).length <= 256);
});

test('hız sınırlayıcı', () => {
  const r = new RateLimiter(2, 1000);
  assert.ok(r.take('u', 0) && r.take('u', 1));
  assert.equal(r.take('u', 2), false);
  assert.ok(r.take('u', 1500));
});

test('seviye hesabı', () => {
  assert.equal(levelFromXp(0).level, 0);
  assert.equal(levelFromXp(99).level, 0);
  assert.equal(levelFromXp(100).level, 1);
  assert.ok(levelFromXp(10_000).level > 5);
});

test('bileşen kimlikleri', () => {
  assert.deepEqual(ids.parse(ids.id('gw', 'join', 'abc')), { module: 'gw', args: ['join', 'abc'] });
  assert.equal(ids.parse('baska:x'), null);
  assert.throws(() => ids.id('x'.repeat(120)));
});
