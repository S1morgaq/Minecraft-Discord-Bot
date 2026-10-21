const { MessageFlags } = require('discord.js');
const { env } = require('../config/env');
const theme = require('../config/theme');
const ids = require('../utils/ids');
const { RateLimiter } = require('../utils/rateLimiter');
const { ensure } = require('../utils/permissions');
const { handleInteractionError } = require('../utils/errors');

const limiter = new RateLimiter(8, 10_000); // kullanıcı başına 10 sn'de 8 etkileşim

const deny = (interaction, text) => {
  const body = { embeds: [theme.warn(text)], flags: MessageFlags.Ephemeral };
  return (interaction.replied || interaction.deferred ? interaction.followUp(body) : interaction.reply(body)).catch(() => {});
};

module.exports = {
  name: 'interactionCreate',
  async execute(client, interaction) {
    try {
      if (!interaction.inGuild() || interaction.guildId !== env.guildId) {
        if (interaction.isRepliable()) await deny(interaction, 'Bu bot yalnızca ZentarNetwork sunucusunda çalışır.');
        return;
      }
      if (interaction.isAutocomplete()) {
        const cmd = client.commands.get(interaction.commandName);
        return void (await cmd?.autocomplete?.(interaction, client));
      }
      if (!limiter.take(interaction.user.id)) return void (await deny(interaction, 'Çok hızlı işlem yapıyorsun, birkaç saniye bekle.'));

      if (interaction.isChatInputCommand()) {
        const cmd = client.commands.get(interaction.commandName);
        if (!cmd) return void (await deny(interaction, 'Bu komut tanınmıyor.'));
        return void (await cmd.execute(interaction, client));
      }

      const kind = interaction.isButton() ? 'button' : interaction.isModalSubmit() ? 'modal' : interaction.isAnySelectMenu() ? 'select' : null;
      if (!kind) return;
      const parsed = ids.parse(interaction.customId);
      const handler = parsed && client.handlers[kind].get(parsed.module);
      if (!handler) return void (await deny(interaction, 'Bu bileşen artık geçerli değil.'));
      // Panel gibi yetkili modüller her etkileşimde yeniden doğrulanır (yeniden başlatma sonrası da).
      if (handler.permission && !(await ensure(interaction, handler.permission))) return;
      await handler.execute(interaction, parsed.args, client);
    } catch (err) {
      await handleInteractionError(interaction, err, client);
    }
  },
};
