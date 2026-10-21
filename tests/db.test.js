const GUILD = '111111111111111111';
Object.assign(process.env, {
  DISCORD_TOKEN: 'test-token-not-real', CLIENT_ID: '222222222222222222', GUILD_ID: GUILD,
  MC_BRIDGE_SECRET: 's'.repeat(48), LOG_LEVEL: 'silent', LOG_PRETTY: 'false', MONGODB_URI: 'mongodb://placeholder/x',
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongod;
let M; // modeller
let guildConfig;

const sent = [];
const member = (id, roles = []) => ({
  id, roles: { cache: new Map(roles.map((r) => [r, {}])), add: async () => {}, remove: async () => {} },
});
const channelStub = (id = 'chan1') => ({
  id, guildId: GUILD, isTextBased: () => true,
  send: async (p) => { sent.push(p); return { id: `msg${sent.length}` }; },
  messages: { fetch: async () => ({ edit: async () => {} }) },
});

function makeClient(members = new Map()) {
  const guild = {
    id: GUILD,
    members: {
      fetch: async (arg) => {
        if (arg && typeof arg === 'object') return new Map(arg.user.filter((u) => members.has(u)).map((u) => [u, members.get(u)]));
        if (!members.has(arg)) throw new Error('Bilinmeyen üye');
        return members.get(arg);
      },
    },
  };
  return {
    guild,
    guilds: { fetch: async () => guild },
    channels: { fetch: async () => channelStub() },
    users: { fetch: async () => ({ send: async () => { throw new Error('DM kapalı'); } }) },
  };
}

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  const { connectDatabase } = require('../src/database/connect');
  await connectDatabase();
  M = require('../src/database/models');
  guildConfig = require('../src/services/guildConfig');
});
test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// ---------------- Çekiliş ----------------
test('çekiliş: mükerrer katılım engellenir, sayaç doğru kalır', async () => {
  const svc = require('../src/services/giveaways/service');
  const client = makeClient();
  const g = await svc.create(client, channelStub(), { hostId: 'h', prize: 'VIP', winnerCount: 1, endsAt: new Date(Date.now() + 60_000) });
  const interaction = (id) => ({
    client, user: { id, createdTimestamp: 0 }, guild: { members: { fetch: async () => member(id) } },
  });
  assert.equal(await svc.join(interaction('u1'), g._id), 1);
  await assert.rejects(svc.join(interaction('u1'), g._id), /zaten katıldın/);
  // eşzamanlı çifte tıklama
  const results = await Promise.allSettled([svc.join(interaction('u2'), g._id), svc.join(interaction('u2'), g._id)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await M.Giveaway.findById(g._id)).entryCount, 2);
  assert.equal(await M.GiveawayEntry.countDocuments({ giveawayId: g._id }), 2);
  await svc.leave(interaction('u2'), g._id);
  assert.equal((await M.Giveaway.findById(g._id)).entryCount, 1);
});

test('çekiliş: koşullar (gerekli rol) katılımı engeller', async () => {
  const svc = require('../src/services/giveaways/service');
  const client = makeClient();
  const g = await svc.create(client, channelStub(), { hostId: 'h', prize: 'Rollü', winnerCount: 1, endsAt: new Date(Date.now() + 60_000), requiredRoleId: 'ROLE' });
  const it = (id, roles) => ({ client, user: { id, createdTimestamp: 0 }, guild: { members: { fetch: async () => member(id, roles) } } });
  await assert.rejects(svc.join(it('a', []), g._id), /rolüne sahip/);
  assert.equal(await svc.join(it('b', ['ROLE']), g._id), 1);
});

test('çekiliş: eşzamanlı bitirme yalnızca bir kez sonuçlanır; kazanan > katılımcı hata vermez; DM hatası bozmaz', async () => {
  const svc = require('../src/services/giveaways/service');
  const members = new Map(['a', 'b', 'c'].map((id) => [id, member(id)]));
  const client = makeClient(members);
  const g = await svc.create(client, channelStub(), { hostId: 'h', prize: 'Tek sefer', winnerCount: 5, endsAt: new Date(Date.now() + 60_000) });
  await M.GiveawayEntry.insertMany(['a', 'b', 'c'].map((u) => ({ giveawayId: g._id, guildId: GUILD, userId: u })));
  const res = await Promise.all([svc.end(client, g._id), svc.end(client, g._id), svc.end(client, g._id)]);
  assert.equal(res.filter(Boolean).length, 1);
  const done = await M.Giveaway.findById(g._id);
  assert.equal(done.status, 'ended');
  assert.equal(done.winners.length, 3);
  assert.equal(await M.GiveawayHistory.countDocuments({ giveawayId: g._id, kind: 'end' }), 1);
  assert.equal(await svc.end(client, g._id), null); // sonuçlanmış çekiliş tekrar işlenmez
});

test('çekiliş: yeniden çekilişte önceki kazananlar hariç tutulur ve geçmiş korunur', async () => {
  const svc = require('../src/services/giveaways/service');
  const members = new Map(['a', 'b', 'c', 'd'].map((id) => [id, member(id)]));
  const client = makeClient(members);
  const g = await svc.create(client, channelStub(), { hostId: 'h', prize: 'Reroll', winnerCount: 1, endsAt: new Date(Date.now() + 60_000) });
  await M.GiveawayEntry.insertMany(['a', 'b', 'c', 'd'].map((u) => ({ giveawayId: g._id, guildId: GUILD, userId: u })));
  const done = await svc.end(client, g._id);
  const first = done.winners[0];
  const again = await svc.reroll(client, g._id, { by: 'mod', count: 10 });
  assert.equal(again.length, 3);
  assert.ok(!again.includes(first));
  const none = await svc.reroll(client, g._id, { by: 'mod', count: 10 });
  assert.deepEqual(none, []); // herkes kazandı, uygun aday kalmadı
  assert.equal(await M.GiveawayHistory.countDocuments({ giveawayId: g._id }), 3);
  assert.deepEqual((await M.Giveaway.findById(g._id)).winners, [first]); // asıl sonuç silinmedi
});

test('çekiliş: bot yeniden başlatıldığında süresi dolan çekiliş sonuçlanır, yarım kalan kurtarılır', async () => {
  const svc = require('../src/services/giveaways/service');
  const client = makeClient(new Map([['a', member('a')]]));
  // "Bot kapalıyken" süresi dolmuş aktif çekiliş
  const due = await M.Giveaway.create({ guildId: GUILD, channelId: 'c', messageId: 'm', hostId: 'h', prize: 'Kaçırılan', winnerCount: 1, endsAt: new Date(Date.now() - 1000) });
  await M.GiveawayEntry.create({ giveawayId: due._id, guildId: GUILD, userId: 'a' });
  // Çökme anında yarım kalmış çekiliş
  const stuck = await M.Giveaway.create({ guildId: GUILD, channelId: 'c', messageId: 'm', hostId: 'h', prize: 'Yarım', winnerCount: 1, endsAt: new Date(Date.now() + 60_000), status: 'ending', endingStartedAt: new Date(Date.now() - 120_000) });
  await svc.start(client);
  await new Promise((r) => setTimeout(r, 400));
  svc.stop();
  assert.equal((await M.Giveaway.findById(due._id)).status, 'ended');
  assert.deepEqual((await M.Giveaway.findById(due._id)).winners, ['a']);
  assert.equal((await M.Giveaway.findById(stuck._id)).status, 'active');
});

test('çekiliş: iptal edilen çekiliş sonuçlanmaz, uzatma bitiş zamanını ilerletir', async () => {
  const svc = require('../src/services/giveaways/service');
  const client = makeClient();
  const g = await svc.create(client, channelStub(), { hostId: 'h', prize: 'İptal', winnerCount: 1, endsAt: new Date(Date.now() + 60_000) });
  const ext = await svc.extend(client, g._id, 60_000, 'mod');
  assert.ok(ext.endsAt - g.endsAt === 60_000);
  await svc.cancel(client, g._id, 'mod');
  assert.equal(await svc.end(client, g._id), null);
  await assert.rejects(svc.cancel(client, g._id, 'mod'));
});

// ---------------- Doğrulama ----------------
test('doğrulama: kod tek kullanımlık, hesap bağlanır, rol verilir', async () => {
  const v = require('../src/services/verification/service');
  await guildConfig.set(GUILD, { 'roles.verified': '999' });
  const client = makeClient(new Map([['d1', member('d1')]]));
  const { code } = await v.issueCode(client.guild, 'd1');
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
  const uuid = '11111111-2222-3333-4444-555555555555';
  const ok = await v.consumeCode(client, { code, uuid, name: 'Steve' });
  assert.equal(ok.ok, true);
  assert.equal(ok.roleGranted, true);
  assert.equal(ok.discordId, 'd1');
  const again = await v.consumeCode(client, { code, uuid, name: 'Steve' });
  assert.equal(again.ok, false); // aynı kod ikinci kez kullanılamaz
  assert.equal(await M.LinkedAccount.countDocuments({ guildId: GUILD, discordId: 'd1' }), 1);
  await assert.rejects(v.issueCode(client.guild, 'd1'), /zaten/);
});

test('doğrulama: yanlış kod, süresi dolmuş kod ve başkasının Minecraft hesabı reddedilir', async () => {
  const v = require('../src/services/verification/service');
  const client = makeClient(new Map([['d2', member('d2')], ['d3', member('d3')]]));
  assert.equal((await v.consumeCode(client, { code: 'AAAAAAAA', uuid: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'X' })).ok, false);
  assert.equal((await v.consumeCode(client, { code: 'kısa', uuid: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'X' })).ok, false);

  const { code } = await v.issueCode(client.guild, 'd2');
  await M.VerificationCode.updateOne({ discordId: 'd2' }, { expiresAt: new Date(Date.now() - 1000) });
  assert.equal((await v.consumeCode(client, { code, uuid: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'Alex' })).ok, false);

  // d3, d1'e bağlı olan Minecraft hesabını kullanmaya çalışır
  const c3 = (await v.issueCode(client.guild, 'd3')).code;
  const stolen = await v.consumeCode(client, { code: c3, uuid: '11111111-2222-3333-4444-555555555555', name: 'Steve' });
  assert.equal(stolen.ok, false);
  assert.equal(await M.LinkedAccount.countDocuments({ guildId: GUILD, discordId: 'd3' }), 0);
});

test('doğrulama: rol verilemezse bağlantı kaydedilir, durum doğru raporlanır ve yeniden denenebilir', async () => {
  const v = require('../src/services/verification/service');
  const m = member('d4');
  let fail = true;
  m.roles.add = async () => { if (fail) throw new Error('Missing Permissions'); };
  const client = makeClient(new Map([['d4', m]]));
  const { code } = await v.issueCode(client.guild, 'd4');
  const res = await v.consumeCode(client, { code, uuid: 'bbbbbbbb-0000-0000-0000-000000000001', name: 'Notch' });
  assert.equal(res.ok, true);
  assert.equal(res.roleGranted, false);
  assert.equal((await M.LinkedAccount.findOne({ discordId: 'd4' })).roleGranted, false);
  fail = false;
  const retry = await v.issueCode(client.guild, 'd4');
  assert.equal(retry.retriedRole, true);
  assert.equal((await M.LinkedAccount.findOne({ discordId: 'd4' })).roleGranted, true);
});

test('doğrulama: aynı oyuncunun brute-force denemeleri sınırlanır', async () => {
  const v = require('../src/services/verification/service');
  const client = makeClient();
  let last;
  for (let i = 0; i < 7; i++) last = await v.consumeCode(client, { code: 'ZZZZZZZZ', uuid: 'cccccccc-0000-0000-0000-000000000001', name: 'Brute' });
  assert.match(last.message, /Çok fazla deneme/);
});

// ---------------- Biletler ----------------
function ticketInteraction(userId, store) {
  const guild = {
    id: GUILD, roles: { everyone: { id: GUILD } },
    members: { me: { id: 'bot', permissions: { has: () => true } } },
    channels: {
      create: async (opts) => {
        const ch = { id: `tc${store.n++}`, ...opts, send: async () => ({}), delete: async () => {} };
        return ch;
      },
    },
  };
  return { guild, user: { id: userId, tag: `${userId}#0` } };
}

test('bilet: kullanıcı başına açık bilet sınırı uygulanır, numaralar benzersizdir', async () => {
  const svc = require('../src/services/tickets/service');
  const store = { n: 1 };
  const cat = (await guildConfig.get(GUILD)).tickets.categories[0];
  const limit = (await guildConfig.get(GUILD)).tickets.limitPerUser;
  for (let i = 0; i < limit; i++) await svc.open(ticketInteraction('tu1', store), cat);
  await assert.rejects(svc.open(ticketInteraction('tu1', store), cat), /açık biletin olabilir/);
  const nums = (await M.Ticket.find({ userId: 'tu1' })).map((t) => t.number);
  assert.equal(new Set(nums).size, limit);
  // aynı anda iki istek: yalnızca biri geçer
  const r = await Promise.allSettled([svc.open(ticketInteraction('tu2', store), cat), svc.open(ticketInteraction('tu2', store), cat)]);
  assert.ok(r.filter((x) => x.status === 'fulfilled').length >= 1);
  assert.ok(await M.Ticket.countDocuments({ userId: 'tu2', status: 'open' }) <= limit);
  await assert.rejects(svc.open(ticketInteraction('tu3', store), 'Olmayan kategori'), /Geçersiz kategori/);
});

test('bilet: kapatma bir kez çalışır, transcript saklanır', async () => {
  const svc = require('../src/services/tickets/service');
  const store = { n: 100 };
  const ch = await svc.open(ticketInteraction('tu9', store), (await guildConfig.get(GUILD)).tickets.categories[0]);
  const msgs = { size: 1, values: () => [{ createdAt: new Date(), author: { tag: 'tu9#0' }, cleanContent: 'merhaba', attachments: { size: 0 } }], last: () => ({ id: 'x' }) };
  const interaction = {
    channelId: ch.id, user: { id: 'staff' },
    channel: { ...ch, messages: { fetch: async () => msgs }, delete: async () => {} },
    client: { channels: { fetch: async () => null }, users: { fetch: async () => ({ send: async () => {} }) } },
  };
  const t = await svc.close(interaction, 'Çözüldü');
  assert.equal(t.status, 'closed');
  await assert.rejects(svc.close(interaction, 'tekrar'), /açık bir bilet değil/);
  const tr = await M.TicketTranscript.findOne({ ticketId: t._id });
  assert.match(tr.text, /merhaba/);
});

// ---------------- Sohbet köprüsü ----------------
test('köprü: bot mesajları, yanlış kanal ve tekrar eden mesajlar Minecraft\'a gönderilmez; içerik temizlenir', async () => {
  const bridge = require('../src/services/minecraft/bridge');
  const { forwardDiscordMessage } = require('../src/services/minecraft/chat');
  await guildConfig.set(GUILD, { 'chatBridge.enabled': true, 'chatBridge.toMinecraft': true, 'channels.chat': 'bridgeCh' });
  const out = [];
  bridge.isConnected = () => true;
  bridge.send = (type, data) => out.push({ type, data });
  const msg = (over = {}) => ({
    author: { bot: false, id: 'du1', username: 'ali' }, guild: {}, guildId: GUILD, channelId: 'bridgeCh', webhookId: null, system: false,
    cleanContent: 'merhaba §cdünya', attachments: { size: 0 }, member: { displayName: 'Ali' }, ...over,
  });
  await forwardDiscordMessage(msg({ author: { bot: true, id: 'bot1' } }));
  await forwardDiscordMessage(msg({ webhookId: 'wh' }));
  await forwardDiscordMessage(msg({ channelId: 'baska' }));
  assert.equal(out.length, 0);

  await forwardDiscordMessage(msg());
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'discord_chat');
  assert.ok(!out[0].data.message.includes('§'));
  await forwardDiscordMessage(msg()); // aynı kullanıcı, aynı metin
  assert.equal(out.length, 1);

  for (let i = 0; i < 10; i++) await forwardDiscordMessage(msg({ cleanContent: `spam ${i}` })); // hız sınırı: 5/10 sn
  assert.ok(out.length <= 5);

  await guildConfig.set(GUILD, { 'chatBridge.toMinecraft': false });
  const before = out.length;
  await forwardDiscordMessage(msg({ author: { bot: false, id: 'du2', username: 'x' }, cleanContent: 'yeni' }));
  assert.equal(out.length, before);
});

// ---------------- Topluluk ----------------
test('XP: bekleme süresi atomik uygulanır; günlük ödül bir kez alınır', async () => {
  const xp = require('../src/services/community/xp');
  await guildConfig.set(GUILD, { 'xp.cooldownSec': 60 });
  const base = (content) => ({
    author: { bot: false, id: 'xu1' }, guild: {}, guildId: GUILD, channelId: 'c', webhookId: null, content,
    client: { channels: { fetch: async () => channelStub() } },
  });
  await Promise.all(['merhaba dünya', 'ikinci mesaj', 'üçüncü mesaj'].map((c) => xp.handleMessage(base(c))));
  const doc = await M.UserXP.findOne({ userId: 'xu1' });
  assert.equal(doc.messages, 1);
  await xp.handleMessage(base('çok kısa'.slice(0, 2)));
  assert.equal((await M.UserXP.findOne({ userId: 'xu1' })).messages, 1);

  const d1 = await xp.claimDaily(GUILD, 'xu1');
  const d2 = await xp.claimDaily(GUILD, 'xu1');
  assert.equal(d1.ok, true);
  assert.equal(d2.ok, false);
});

test('periyodik duyuru: çift tetiklemede yalnızca bir kez gönderilir', async () => {
  const announcer = require('../src/services/community/announcer');
  sent.length = 0;
  await M.Announcement.create({ guildId: GUILD, channelId: 'c', content: 'Merhaba', intervalMs: 3_600_000, nextRunAt: new Date(Date.now() - 1000), createdBy: 'a' });
  const client = makeClient();
  await Promise.all([announcer.tick(client), announcer.tick(client)]);
  assert.equal(sent.length, 1);
});

// ---------------- Yetki ----------------
test('yetki: yetkisiz kullanıcı reddedilir, yönetici/rol sahibi geçer', async () => {
  const { ensure } = require('../src/utils/permissions');
  await guildConfig.set(GUILD, { 'roles.admin': 'ADMINROLE' });
  const replies = [];
  const mk = (perm, roles) => ({
    guildId: GUILD, user: { id: 'p1' }, replied: false, deferred: false,
    guild: { members: { fetch: async () => ({ permissions: { has: (p) => perm.includes(p) }, roles: { cache: new Map(roles.map((r) => [r, {}])) } }) } },
    reply: async (b) => replies.push(b),
  });
  assert.equal(await ensure(mk([], []), 'admin'), false);
  assert.equal(replies.length, 1);
  assert.equal(await ensure(mk([], ['ADMINROLE']), 'admin'), true);
  assert.equal(await ensure(mk([], []), 'mod'), false);
  assert.equal(await ensure(mk([8n], []), 'admin'), true); // Administrator
});

test('modeller: benzersiz indeksler oluşturuldu', async () => {
  const idx = await M.GiveawayEntry.collection.indexes();
  assert.ok(idx.some((i) => i.unique && i.key.giveawayId === 1 && i.key.userId === 1));
  const lidx = await M.LinkedAccount.collection.indexes();
  assert.ok(lidx.some((i) => i.unique && i.key.minecraftUuid === 1));
  const vidx = await M.VerificationCode.collection.indexes();
  assert.ok(vidx.some((i) => i.expireAfterSeconds === 0));
});
