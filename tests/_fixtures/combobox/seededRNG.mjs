// tests/_fixtures/combobox/seededRNG.mjs
/**
 * Seeded pseudo-random number generator for reproducible tests.
 * Uses mulberry32 algorithm.
 */

export function createSeededRNG(seed) {
  let state = seed;

  function next() {
    // mulberry32 PRNG algorithm - simple, fast, 32-bit generator with good distribution
    state |= 0; // Ensure 32-bit integer
    state = (state + 0x6d2b79f5) | 0; // 0x6d2b79f5: golden ratio-derived increment for uniform distribution
    let t = Math.imul(state ^ (state >>> 15), 1 | state); // XOR-shift and multiply for bit mixing
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; // 61: prime multiplier for additional mixing
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // 4294967296 = 2^32, normalizes to [0, 1)
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
      // Validate input: return null for empty or invalid arrays
      if (!options || options.length === 0) return null;

      const totalWeight = options.reduce((sum, opt) => sum + (opt.weight || 0), 0);

      // Handle edge case where all weights are 0 - fall back to uniform random selection
      if (totalWeight === 0) {
        return this.pick(options.map((opt) => (opt.value !== undefined ? opt.value : opt)));
      }

      let random = next() * totalWeight;

      for (const option of options) {
        random -= option.weight || 0;
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
