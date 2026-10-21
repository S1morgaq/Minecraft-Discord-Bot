const guildConfig = require('../guildConfig');
const { audit } = require('../audit');
const { notify } = require('../notifier');
const theme = require('../../config/theme');
const bridge = require('./bridge');
const mcStatus = require('./status');

/**
 * Bakım modunu kalıcı olarak değiştirir ve oyuna iletmeyi dener.
 * @returns {Promise<{applied:boolean}>} applied=false: eklenti onaylamadı (bağlandığında senkronlanır)
 */
async function setMaintenance(client, guildId, enabled, actorId) {
  await guildConfig.set(guildId, { 'maintenance.enabled': enabled, 'maintenance.since': new Date(), 'maintenance.by': actorId });
  await audit(guildId, actorId, enabled ? 'maintenance.on' : 'maintenance.off');
  let applied = false;
  if (bridge.isConnected()) applied = Boolean(await bridge.request('maintenance', { enabled }).then((r) => r?.ok).catch(() => false));
  await notify(client, guildId, 'maintenance', {
    embeds: [theme.embed(`${theme.EMOJI.maintenance} Bakım ${enabled ? 'başladı' : 'bitti'}`,
      enabled ? 'Sunucu bakım modunda; yetkililer dışındaki oyuncular giriş yapamaz.' : 'Bakım tamamlandı, iyi oyunlar!',
      enabled ? theme.COLORS.warning : theme.COLORS.success)],
  }, `maint-${enabled}`);
  await mcStatus.tick(client);
  return { applied };
}

module.exports = { setMaintenance };
