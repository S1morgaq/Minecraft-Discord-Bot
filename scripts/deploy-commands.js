const { REST, Routes } = require('discord.js');
const { env, validate } = require('../src/config/env');
const { loadCommands } = require('../src/utils/loader');

(async () => {
  const problems = validate().filter((p) => /DISCORD_TOKEN|CLIENT_ID|GUILD_ID/.test(p));
  if (problems.length) {
    console.error('Yapılandırma hatası:\n - ' + problems.join('\n - '));
    process.exit(1);
  }
  const commands = [...loadCommands().values()].map((c) => c.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(env.token);
  const res = await rest.put(Routes.applicationGuildCommands(env.clientId, env.guildId), { body: commands });
  console.log(`${res.length} slash komutu sunucuya kaydedildi:`);
  console.log(res.map((c) => `  /${c.name}`).join('\n'));
})().catch((err) => {
  console.error('Komutlar kaydedilemedi:', String(err.message).replace(env.token || '\u0000', '[gizli]'));
  process.exit(1);
});
