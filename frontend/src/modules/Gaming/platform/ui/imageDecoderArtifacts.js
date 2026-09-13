export const DEFAULT_ARTIFACT_COUNT = 180;

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value || 'image-decoder')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = hashSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateDecoderArtifacts(seed, count = DEFAULT_ARTIFACT_COUNT) {
  const random = seededRandom(seed);
  return Array.from({ length: Math.max(0, count) }, (_, index) => {
    const radius = 2.8 + random() * 7.8;
    return {
      id: `${index}:${Math.round(random() * 1e9)}`,
      cx: -4 + random() * 108,
      cy: -4 + random() * 108,
      rx: radius,
      ry: radius * (0.72 + random() * 0.56),
      rotation: random() * 180,
      kind: index % 5 === 0 ? 'bubble' : 'ring',
      opacity: 0.72 + random() * 0.26,
    };
  });
}

// Warm pigments vary green/blue strongly while preserving red. A physical red
// filter removes the pattern; multiplying it over the signal preserves detail.
export function generateDecoderTexture(seed) {
  const random = seededRandom(`${seed}:texture`);
  return {
    tiles: Array.from({length:625}, (_, index) => ({
      id:index, x:index % 25 * 4, y:Math.floor(index / 25) * 4,
      tone:Math.floor(random() * 6), opacity:0.6 + random() * 0.4,
    })),
    streaks: Array.from({length:40}, (_, index) => ({
      id:index, x1:random() * 100, y1:random() * 100,
      x2:random() * 100, y2:random() * 100,
      tone:index % 6, width:0.5 + random() * 1.2,
    })),
  };
}

export function generateDecoderMotion(seed, count = 8) {
  const random = seededRandom(`${seed}:motion`);
  const startAtFarEdge = random() >= 0.5;
  return Array.from({ length: Math.max(2, count) }, (_, index) => {
    // The composite is 60% of its viewport. Alternating between 4% and 36%
    // moves it 53% of its own width on every frame, enough to break visual
    // tracking while keeping the complete clue inside the decoder viewport.
    const farEdge = Boolean(index % 2) !== startAtFarEdge;
    return {
      id: index,
      x: farEdge ? 36 : 4,
      y: random() >= 0.5 ? 36 : 4,
      scale: 0.94 + random() * 0.06,
    };
  });
}
