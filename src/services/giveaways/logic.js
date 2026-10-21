const { randomInt } = require('node:crypto');

/** Kriptografik rastgelelikle, tekrarsız kazanan seçimi. Katılımcıdan fazla istenirse hata vermez. */
function pickWinners(candidateIds, count, excludeIds = [], rng = randomInt) {
  const excluded = new Set(excludeIds);
  const pool = [...new Set(candidateIds)].filter((id) => !excluded.has(id));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(0, count));
}

/**
 * Katılım koşulları. member: { roleIds:Set|Array, joinedAt:ms }, user: { createdAt:ms }.
 * @returns {string|null} Reddedilme sebebi veya null (uygun)
 */
function checkEligibility(g, member, user, now = Date.now()) {
  const roles = new Set(member.roleIds);
  if (g.requiredRoleId && !roles.has(g.requiredRoleId)) return `Bu çekilişe katılmak için <@&${g.requiredRoleId}> rolüne sahip olmalısın.`;
  if ((g.excludedRoleIds || []).some((r) => roles.has(r))) return 'Rolün bu çekilişe katılmana izin vermiyor.';
  const day = 86_400_000;
  if (g.minAccountAgeDays && now - user.createdAt < g.minAccountAgeDays * day) {
    return `Hesabın en az **${g.minAccountAgeDays} gün** önce açılmış olmalı.`;
  }
  if (g.minMemberDays && member.joinedAt && now - member.joinedAt < g.minMemberDays * day) {
    return `Sunucuda en az **${g.minMemberDays} gündür** bulunmalısın.`;
  }
  return null;
}

module.exports = { pickWinners, checkEligibility };
