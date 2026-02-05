// tests/_fixtures/combobox/SlotMachine.mjs
/**
 * Slot machine for generating stochastic test fixtures.
 * Spins reels populated from APIs to create reproducible query permutations.
 */

import { createSeededRNG } from './seededRNG.mjs';
import { SlotMachineLoader } from './SlotMachineLoader.mjs';
import { RansomLetterGenerator } from './RansomLetterGenerator.mjs';

export class SlotMachine {
  #seed;
  #rng;
  #reels = null;
  #corpus = null;
  #ransomGenerator = null;
  #spinCount = 0;

  constructor(seed = Date.now()) {
    this.#seed = seed;
    this.#rng = createSeededRNG(seed);
  }

  /**
   * Initialize reels from live APIs
   */
  async initialize(baseUrl) {
    const loader = new SlotMachineLoader(baseUrl);
    const { reels, corpus } = await loader.load();

    this.#reels = reels;
    this.#corpus = corpus;
    this.#ransomGenerator = new RansomLetterGenerator(corpus, this.#rng);

    console.log(`SlotMachine initialized (seed: ${this.#seed})`);
    console.log(`   Sources: ${reels.sources.join(', ') || 'none'}`);
    console.log(`   Aliases: ${[...reels.aliases.builtIn, ...reels.aliases.userDefined].join(', ') || 'none'}`);
    console.log(`   Corpus: ${corpus.titles.length} titles, ${corpus.words.length} words`);

    return this;
  }

  /**
   * Spin all reels -> generate one test fixture
   */
  spin() {
    if (!this.#reels) {
      throw new Error('SlotMachine not initialized. Call initialize() first.');
    }

    this.#spinCount++;

    // Reel 1: Prefix type
    const prefixType = this.#rng.weightedChoice([
      { weight: 20, value: 'none' },
      { weight: 30, value: 'source' },
      { weight: 35, value: 'alias' },
      { weight: 15, value: 'category' },
    ]);

    // Reel 2: Specific prefix value
    const prefix = this.#spinPrefix(prefixType);

    // Reel 3: Keyword from corpus
    const keyword = this.#ransomGenerator.generate();
    const keywordStrategy = this.#ransomGenerator.lastStrategy;

    // Reel 4: Stress factor
    const stress = this.#rng.weightedChoice([
      { weight: 50, value: 'normal' },
      { weight: 20, value: 'rapid-fire' },
      { weight: 20, value: 'mid-stream-change' },
      { weight: 10, value: 'backspace-retype' },
    ]);

    // Build query
    const query = prefix ? `${prefix}:${keyword}` : keyword;

    // Derive expectations
    const expectations = this.#deriveExpectations(prefixType, prefix, keywordStrategy);

    return {
      seed: this.#seed,
      spinNumber: this.#spinCount,
      prefixType,
      prefix,
      keyword,
      keywordStrategy,
      stress,
      query,
      expectations,
    };
  }

  #spinPrefix(type) {
    switch (type) {
      case 'none':
        return null;
      case 'source':
        return this.#rng.pick(this.#reels.sources);
      case 'alias':
        const allAliases = [
          ...this.#reels.aliases.builtIn,
          ...this.#reels.aliases.userDefined,
        ];
        return this.#rng.pick(allAliases) || null;
      case 'category':
        return this.#rng.pick(this.#reels.aliases.categories) || null;
      default:
        return null;
    }
  }

  #deriveExpectations(prefixType, prefix, keywordStrategy) {
    const expectations = {
      noBackendErrors: true,
      sourceBadge: null,
      gatekeeper: null,
      resultRange: { min: 0, max: 250 },
    };

    // Source prefix: results should have matching badge
    if (prefixType === 'source' && prefix) {
      expectations.sourceBadge = prefix;
    }

    // Alias prefix: apply gatekeeper rules
    if (prefixType === 'alias' && prefix) {
      expectations.gatekeeper = this.#getGatekeeperRules(prefix);
    }

    // Adjust result range by keyword strategy
    if (keywordStrategy === 'mashup') {
      expectations.resultRange = { min: 0, max: 10 };
    } else if (keywordStrategy === 'typo') {
      expectations.resultRange = { min: 0, max: 50 };
    }

    return expectations;
  }

  #getGatekeeperRules(alias) {
    const rules = {
      music: { exclude: ['audiobook', 'podcast'] },
      photos: { mapToCategory: 'gallery' },
      video: { preferMediaType: 'video' },
      audiobooks: { include: ['audiobook'] },
    };
    return rules[alias] || null;
  }

  /**
   * Generate N fixtures
   */
  *generate(count) {
    for (let i = 0; i < count; i++) {
      yield this.spin();
    }
  }

  /**
   * Get seed for reproduction
   */
  getSeed() {
    return this.#seed;
  }
}

export default SlotMachine;
