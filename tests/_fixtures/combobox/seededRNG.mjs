// tests/_fixtures/combobox/seededRNG.mjs
/**
 * Seeded pseudo-random number generator for reproducible tests.
 * Uses mulberry32 algorithm.
 */

export function createSeededRNG(seed) {
  let state = seed;

  function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    /** Get next float between 0 and 1 */
    next,

    /** Get integer between 0 and max (exclusive) */
    int(max) {
      return Math.floor(next() * max);
    },

    /** Pick random element from array */
    pick(array) {
      if (!array || array.length === 0) return null;
      return array[Math.floor(next() * array.length)];
    },

    /** Weighted random choice from array of { weight, value } or { weight, ...rest } */
    weightedChoice(options) {
      const totalWeight = options.reduce((sum, opt) => sum + opt.weight, 0);
      let random = next() * totalWeight;

      for (const option of options) {
        random -= option.weight;
        if (random <= 0) {
          return option.value !== undefined ? option.value : option;
        }
      }
      return options[options.length - 1].value || options[options.length - 1];
    },

    /** Shuffle array in place */
    shuffle(array) {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
    },

    /** Get current seed for reproduction */
    getSeed() {
      return seed;
    },
  };
}

export default createSeededRNG;
