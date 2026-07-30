/**
 * Polish tempo-tier math (wave-3 H).
 * Pure, DOM-free.
 */

export const TIERS = ['slow', 'medium', 'full', 'overclocked'];

/**
 * Tier bucket for a run, decided by tempoMult AT RUN START.
 * @param {number} tempoMult
 * @returns {'slow'|'medium'|'full'|'overclocked'}
 */
export function tierOf(tempoMult) {
  const t = Number(tempoMult);
  if (!Number.isFinite(t)) return 'full';
  if (Math.abs(t - 1) <= 1e-6) return 'full';
  if (t < 0.8) return 'slow';
  if (t < 1) return 'medium';
  return 'overclocked';
}

/**
 * round(100 × mean(combined)) over measures that expected notes; null if none.
 * @param {Object.<string, {combined: number, rest: boolean}>} grades
 * @returns {number|null}
 */
export function runScore(grades) {
  const vals = Object.values(grades || {}).filter((g) => g && !g.rest && Number.isFinite(g.combined));
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, g) => a + g.combined, 0) / vals.length) * 100);
}

/**
 * Overclocked extra credit: stored/displayed = round(base × 1.25); can exceed 100.
 * @param {number} base - 0-100 run score
 * @param {'slow'|'medium'|'full'|'overclocked'} tier
 * @returns {number|null}
 */
export function displayScore(base, tier) {
  if (base == null) return null;
  return tier === 'overclocked' ? Math.round(base * 1.25) : base;
}

export default { TIERS, tierOf, runScore, displayScore };
