export const DEFAULT_ARTIFACT_COUNT = 72;

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
      kind: index % 5 === 0 ? 'ring' : 'bubble',
      opacity: 0.72 + random() * 0.26,
    };
  });
}
