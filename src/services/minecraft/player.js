const { LinkedAccount } = require('../../database/models');
const bridge = require('./bridge');
const theme = require('../../config/theme');
const { UserError } = require('../../utils/errors');
const { ts, formatDuration } = require('../../utils/duration');

/** Oyuncu bilgi embed'i. Yalnızca eklentiden/veritabanından gelen gerçek veriyi gösterir. */
async function playerEmbed(guildId, rawName) {
  const name = String(rawName || '').trim();
  if (!/^\w{1,16}$/.test(name)) throw new UserError('Geçersiz oyuncu adı.');
  const link = await LinkedAccount.findOne({ guildId, minecraftName: new RegExp(`^${name}$`, 'i') }).lean();
  const info = bridge.isConnected() ? await bridge.request('player_info', { name }).catch(() => null) : null;
  if (!info?.found && !link) {
    return theme.warn(bridge.isConnected()
      ? `**${name}** sunucuda kayıtlı bir oyuncu olarak bulunamadı.`
      : 'Eklenti bağlı olmadığı için oyuncu bilgisi alınamıyor.');
  }
  const e = theme.embed(`👤 ${info?.name || link.minecraftName}`, null, theme.COLORS.cyan);
  const uuid = info?.uuid || link?.minecraftUuid;
  if (uuid) e.setThumbnail(`https://mc-heads.net/avatar/${uuid}/128`).addFields({ name: 'UUID', value: `\`${uuid}\`` });
  if (info?.found) {
    e.addFields(
      { name: 'Durum', value: info.online ? `${theme.EMOJI.online} Çevrimiçi` : `${theme.EMOJI.offline} Çevrimdışı`, inline: true },
      { name: 'İlk giriş', value: info.firstPlayed ? ts(info.firstPlayed, 'D') : '—', inline: true },
      { name: 'Son görülme', value: info.online ? 'Şu an' : info.lastPlayed ? ts(info.lastPlayed, 'R') : '—', inline: true },
      { name: 'Oyun süresi', value: info.playtimeMs != null ? formatDuration(info.playtimeMs) : '—', inline: true },
      { name: 'Öldürme / Ölüm', value: `${info.kills ?? '—'} / ${info.deaths ?? '—'}`, inline: true },
    );
  }
  e.addFields({ name: 'Discord', value: link ? `<@${link.discordId}> (doğrulanmış)` : 'Bağlı hesap yok', inline: true });
  return e;
}

module.exports = { playerEmbed };
