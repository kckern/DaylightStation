// Color choice for the decoder's once-a-second shuffle (the tick itself lives in
// SegmentedSecretText with the position jump, so both land on the same frame).

// Always a different color from the same palette and, wherever one is free,
// none of `avoid` — the colors touching segments hold. A one-color palette
// stays put.
export function nextColorIndex(current, paletteLength, random = Math.random, avoid = []) {
  if (paletteLength < 2) return current;
  const others = Array.from({ length: paletteLength }, (_, index) => index).filter(index => index !== current);
  const free = others.filter(index => !avoid.includes(index));
  const pool = free.length ? free : others;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}
