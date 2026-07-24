/**
 * Deterministic distractor sampling for generated geography banks. No
 * Math.random: a fixed seed yields identical output every process, so the
 * generator is testable and a deck's wrong-answer set is stable. Choice
 * PRESENTATION order is shuffled client-side (not here) so a stable generated
 * order doesn't teach position.
 */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(a) {
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleDistractors({ pool, exclude, count, seed }) {
  const candidates = pool.filter((v) => v !== exclude);
  const rand = mulberry32(hashSeed(seed));
  // Fisher-Yates with the seeded PRNG, then take the first `count`.
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, Math.min(count, candidates.length));
}
