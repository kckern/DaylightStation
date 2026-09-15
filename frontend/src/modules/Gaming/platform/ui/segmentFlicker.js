// Scheduling for the decoder's color flicker. Segments are shuffled into three
// groups and one group changes per tick, so every segment changes once every
// three seconds without the whole display jumping at the same moment.
export const FLICKER_TICK_MS = 1000;
export const FLICKER_GROUP_COUNT = 3;

export function assignFlickerGroups(count, random = Math.random) {
  const order = Array.from({ length: count }, (_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  const groups = Array.from({ length: FLICKER_GROUP_COUNT }, () => []);
  order.forEach((segmentIndex, position) => groups[position % FLICKER_GROUP_COUNT].push(segmentIndex));
  return groups;
}

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
