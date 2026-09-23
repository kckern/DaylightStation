/**
 * Deterministic seeding helpers shared by the card ladder (choice order, the
 * printed quiz's item order). Pure: the same seed always gives the same order,
 * so a reload or a reprint shows the same thing.
 */

/** FNV-1a, 32 bit. */
export function hashString(value) {
  let hash = 0x811c9dc5;
  for (const ch of String(value)) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle(items, seed) {
  const out = [...items];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
