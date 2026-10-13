export function coerceRepeats(repeats) {
  const n = Math.floor(Number(repeats));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** First compiled block index of an arrangement entry. */
export function entryStartBlock(arrangement, entryIdx) {
  let sum = 0;
  for (let i = 0; i < entryIdx; i += 1) sum += coerceRepeats(arrangement[i]?.repeats);
  return sum;
}

/** Arrangement entry containing a compiled block index, or -1. */
export function entryIndexOfBlock(arrangement, blockIndex) {
  if (!Number.isInteger(blockIndex) || blockIndex < 0) return -1;
  let sum = 0;
  for (let i = 0; i < arrangement.length; i += 1) {
    sum += coerceRepeats(arrangement[i]?.repeats);
    if (blockIndex < sum) return i;
  }
  return -1;
}
