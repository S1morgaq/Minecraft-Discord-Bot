const { SlashCommandBuilder, PermissionFlagsBits: P, MessageFlags } = require('discord.js');
const service = require('../../services/tickets/service');
const guildConfig = require('../../services/guildConfig');
const theme = require('../../config/theme');
const { ensure } = require('../../utils/permissions');
const { UserError } = require('../../utils/errors');

module.exports = [
  {
    data: new SlashCommandBuilder().setName('destek-panel').setDescription('Bu kanala destek paneli gönderir')
      .setDefaultMemberPermissions(P.ManageGuild).setContexts(0),
    async execute(i) {
      if (!(await ensure(i, 'admin'))) return;
      const cfg = await guildConfig.get(i.guildId);
      await i.channel.send(service.panelPayload(cfg));
      await i.reply({ embeds: [theme.success('Destek paneli gönderildi.')], flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder().setName('bilet').setDescription('Bilet yönetimi')
      .setDefaultMemberPermissions(P.ManageMessages).setContexts(0)
      .addSubcommand((s) => s.setName('ekle').setDescription('Bilete kullanıcı ekler')
        .addUserOption((o) => o.setName('kullanıcı').setDescription('Eklenecek kullanıcı').setRequired(true)))
      .addSubcommand((s) => s.setName('çıkar').setDescription('Biletten kullanıcı çıkarır')
        .addUserOption((o) => o.setName('kullanıcı').setDescription('Çıkarılacak kullanıcı').setRequired(true)))
      .addSubcommand((s) => s.setName('limit').setDescription('Kullanıcı başına açık bilet sınırı (yönetici)')
        .addIntegerOption((o) => o.setName('adet').setDescription('1-10').setMinValue(1).setMaxValue(10).setRequired(true))),
    async execute(i) {
      const sub = i.options.getSubcommand();
      if (!(await ensure(i, sub === 'limit' ? 'admin' : 'support'))) return;
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      if (sub === 'limit') {
        const n = i.options.getInteger('adet');
        await guildConfig.set(i.guildId, { 'tickets.limitPerUser': n });
        return i.editReply({ embeds: [theme.success(`Kullanıcı başına açık bilet sınırı **${n}** yapıldı.`)] });
      }
      const user = i.options.getUser('kullanıcı');
      if (user.bot) throw new UserError('Botlar bilete eklenemez.');
      await service.setUserAccess(i, user, sub === 'ekle');
      await i.editReply({ embeds: [theme.success(`${user} ${sub === 'ekle' ? 'bilete eklendi' : 'biletten çıkarıldı'}.`)] });
    },
  },
];
