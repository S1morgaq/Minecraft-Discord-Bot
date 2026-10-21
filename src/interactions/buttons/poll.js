const { Poll } = require('../../database/models');
const { buildPoll } = require('../../services/community/poll');
const { UserError } = require('../../utils/errors');

module.exports = {
  module: 'poll',
  async execute(interaction, [action, pollId, idx]) {
    if (action !== 'vote' || !/^[a-f\d]{24}$/i.test(pollId || '')) return;
    const index = Number(idx);
    // Kullanıcı başına tek oy: aynı anahtarın üzerine yazılır (oy değiştirilebilir).
    const poll = await Poll.findOneAndUpdate(
      { _id: pollId, guildId: interaction.guildId, [`options.${index}`]: { $exists: true } },
      { $set: { [`votes.${interaction.user.id}`]: index } },
      { new: true },
    );
    if (!poll) throw new UserError('Bu anket artık geçerli değil.');
    await interaction.update(buildPoll(poll));
  },
};
