// Scheduling for the decoder's color flicker. Segments are shuffled into three
// groups and one group changes per tick, so every segment changes about once a
// second without the whole display jumping at the same moment.
export const FLICKER_TICK_MS = 333;
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

// Always a different color from the same palette; a one-color palette stays put.
export function nextColorIndex(current, paletteLength, random = Math.random) {
  if (paletteLength < 2) return current;
  const step = 1 + Math.floor(random() * (paletteLength - 1));
  return (current + step) % paletteLength;
}
