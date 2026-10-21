const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const theme = require('../../config/theme');
const ids = require('../../utils/ids');

/** Anket mesajını (embed + oy butonları) oluşturur. `poll.votes`: userId -> seçenek indeksi. */
function buildPoll(poll) {
  const votes = poll.votes instanceof Map ? [...poll.votes.values()] : Object.values(poll.votes || {});
  const total = votes.length;
  const lines = poll.options.map((opt, idx) => {
    const n = votes.filter((v) => v === idx).length;
    const pct = total ? Math.round((n / total) * 100) : 0;
    return `**${idx + 1}. ${opt}**\n${theme.progressBar(n, total || 1, 12)} ${n} oy (%${pct})`;
  });
  const embed = theme.embed(`📊 ${poll.question}`, `${lines.join('\n\n')}\n\nToplam oy: **${total}** • Oyunu değiştirmek için başka bir seçeneğe bas.`, theme.COLORS.cyan);
  const row = new ActionRowBuilder().addComponents(
    poll.options.map((opt, idx) => new ButtonBuilder().setCustomId(ids.id('poll', 'vote', String(poll._id), String(idx)))
      .setLabel(`${idx + 1}`).setStyle(ButtonStyle.Primary)),
  );
  return { embeds: [embed], components: [row] };
}

module.exports = { buildPoll };
