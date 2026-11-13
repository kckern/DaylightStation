/**
 * Synthetic "not practice" sittings for the practice scorer's calibration:
 * the shapes a child produces when mashing rather than playing. Deterministic
 * (mulberry32), 180 s each, notes as [ms, pitch, velocity] like
 * audit-sittings.json.
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DURATION_MS = 180000;

function cluster(rnd, root, size, t, vel) {
  const out = [];
  for (let i = 0; i < size; i++) out.push([t + Math.floor(rnd() * 12), root + i, vel]);
  return out;
}

const KINDS = {
  // 6–10 adjacent keys pressed at once every ~300 ms
  fist(rnd) {
    const notes = [];
    for (let t = 0; t < DURATION_MS; t += 260 + Math.floor(rnd() * 80)) {
      const size = 6 + Math.floor(rnd() * 5);
      const root = 40 + Math.floor(rnd() * 36);
      notes.push(...cluster(rnd, root, size, t, 70 + Math.floor(rnd() * 40)));
    }
    return notes;
  },
  // two 5-key palms at least two octaves apart
  'two-palms'(rnd) {
    const notes = [];
    for (let t = 0; t < DURATION_MS; t += 300 + Math.floor(rnd() * 150)) {
      const lo = 30 + Math.floor(rnd() * 20);
      const hi = lo + 24 + Math.floor(rnd() * 20);
      const vel = 70 + Math.floor(rnd() * 40);
      notes.push(...cluster(rnd, lo, 5, t, vel), ...cluster(rnd, hi, 5, t, vel));
    }
    return notes;
  },
  // three-octave sweeps at about 30 notes/s
  glissando(rnd) {
    const notes = [];
    let t = 0;
    while (t < DURATION_MS) {
      const start = 40 + Math.floor(rnd() * 10);
      const up = rnd() < 0.5;
      for (let i = 0; i < 36 && t < DURATION_MS; i++) {
        notes.push([t, up ? start + i : start + 36 - i, 60 + Math.floor(rnd() * 30)]);
        t += 30 + Math.floor(rnd() * 8);
      }
      t += 200 + Math.floor(rnd() * 400);
    }
    return notes;
  },
  // one key at 4–8 presses per second
  hammer(rnd) {
    const notes = [];
    const key = 55 + Math.floor(rnd() * 15);
    for (let t = 0; t < DURATION_MS; t += 125 + Math.floor(rnd() * 125)) {
      notes.push([t, key, 60 + Math.floor(rnd() * 50)]);
    }
    return notes;
  },
  // uniform keys across the whole keyboard at ~5/s
  scatter(rnd) {
    const notes = [];
    for (let t = 0; t < DURATION_MS; t += 150 + Math.floor(rnd() * 100)) {
      notes.push([t, 21 + Math.floor(rnd() * 88), 40 + Math.floor(rnd() * 70)]);
    }
    return notes;
  },
  // flat velocity-127 bangs at ~6/s
  bangs(rnd) {
    const notes = [];
    for (let t = 0; t < DURATION_MS; t += 140 + Math.floor(rnd() * 60)) {
      notes.push([t, 48 + Math.floor(rnd() * 24), 127]);
    }
    return notes;
  },
};

export const MASH_KINDS = Object.freeze(Object.keys(KINDS));

/** @returns {Array<{ id: string, kind: string, notes: number[][] }>} */
export function mashSittings(seed = 1) {
  return MASH_KINDS.map((kind, i) => {
    const rnd = mulberry32(seed * 1000 + i + 1);
    const notes = KINDS[kind](rnd).sort((a, b) => a[0] - b[0]);
    return { id: `mash-${kind}`, kind, durationSec: DURATION_MS / 1000, notes };
  });
}

export default mashSittings;
