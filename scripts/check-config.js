// Yapılandırma ve bağlantı kontrolü: node scripts/check-config.js
const { env, validate } = require('../src/config/env');

(async () => {
  let failed = false;
  const ok = (m) => console.log(`  [OK]    ${m}`);
  const bad = (m) => { failed = true; console.log(`  [HATA]  ${m}`); };

  console.log('Yapılandırma:');
  const problems = validate();
  if (problems.length) problems.forEach(bad); else ok('.env değerleri geçerli görünüyor');

  try {
    require('../src/utils/loader').loadCommands();
    require('../src/utils/loader').loadHandlers();
    ok('Komut ve etkileşim modülleri yüklendi');
  } catch (e) { bad(`Modül yükleme: ${e.message}`); }

  if (/^mongodb/.test(env.mongoUri)) {
    const mongoose = require('mongoose');
    try {
      await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 5000 });
      ok('MongoDB bağlantısı başarılı');
      await mongoose.disconnect();
    } catch (e) { bad(`MongoDB bağlanamadı: ${String(e.message).split(env.mongoUri).join('[gizli]')}`); }
  }

  if (env.token) {
    try {
      const res = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bot ${env.token}` } });
      if (res.ok) ok(`Discord token geçerli (${(await res.json()).username})`); else bad(`Discord token reddedildi (HTTP ${res.status})`);
    } catch (e) { bad(`Discord API'ye ulaşılamadı: ${e.message}`); }
  }

  console.log(failed ? '\nKontrol başarısız.' : '\nKontrol başarılı.');
  process.exit(failed ? 1 : 0);
})();
