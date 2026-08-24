import { nextRandom, shuffle } from './random.mjs';

export function selectSeeded(items, seed = 1) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('Selection requires at least one candidate');
  const next = nextRandom(seed);
  const index = Math.floor(next.value * items.length);
  return { selected: structuredClone(items[index]), index, rng_state: next.state };
}

export function orderSeeded(items, seed = 1) {
  const result = shuffle(items, seed);
  return { ordered: result.items, rng_state: result.rngState };
}
