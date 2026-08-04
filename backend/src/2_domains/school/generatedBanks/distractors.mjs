/** Stable seeded sampling for any recipe-generated question bank. */
export function hashSeed(value) {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  return function next() {
    seed |= 0; // eslint-disable-line no-param-reassign
    seed = (seed + 0x6D2B79F5) | 0; // eslint-disable-line no-param-reassign
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleDistractors({ pool, exclude, count, seed }) {
  const candidates = [...new Set(pool)].filter((value) => value !== exclude);
  const random = mulberry32(hashSeed(seed));
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [candidates[index], candidates[swap]] = [candidates[swap], candidates[index]];
  }
  return candidates.slice(0, Math.min(count, candidates.length));
}
