// tests/_fixtures/combobox/RansomLetterGenerator.mjs
/**
 * Generates "ransom letter" style keywords from harvested corpus.
 * Produces varied result counts: full matches, partials, mashups, typos.
 */

export class RansomLetterGenerator {
  #corpus;
  #rng;
  #lastStrategy = null;

  constructor(corpus, rng) {
    this.#corpus = corpus;
    this.#rng = rng;
  }

  /**
   * Generate a keyword using weighted random strategy
   * @returns {string} Generated keyword
   */
  generate() {
    const strategies = [
      { weight: 25, type: 'full-title' },      // Exact title → high results
      { weight: 30, type: 'single-word' },     // One word → medium results
      { weight: 20, type: 'fragment' },        // Partial → varied results
      { weight: 10, type: 'mashup' },          // Combined → low/zero
      { weight: 10, type: 'artist-year' },     // Specific filter
      { weight: 5,  type: 'typo' },            // Fuzzy test
    ];

    const strategy = this.#rng.weightedChoice(strategies);
    this.#lastStrategy = strategy.type;

    switch (strategy.type) {
      case 'full-title':
        return this.#rng.pick(this.#corpus.titles) || 'test';

      case 'single-word':
        return this.#rng.pick(this.#corpus.words) || 'the';

      case 'fragment':
        return this.#rng.pick(this.#corpus.fragments) || 'est';

      case 'mashup':
        const word1 = this.#rng.pick(this.#corpus.words) || 'foo';
        const word2 = this.#rng.pick(this.#corpus.words) || 'bar';
        return `${word1} ${word2}`;

      case 'artist-year':
        const artist = this.#rng.pick(this.#corpus.artists);
        const year = this.#rng.pick(this.#corpus.years);
        if (artist && year) return `${artist} ${year}`;
        if (artist) return artist;
        if (year) return year;
        return '2024';

      case 'typo':
        const word = this.#rng.pick(this.#corpus.words) || 'test';
        return this.#injectTypo(word);

      default:
        return 'test';
    }
  }

  #injectTypo(word) {
    if (word.length < 3) return word;
    const pos = 1 + this.#rng.int(word.length - 2);
    const mutations = ['', word[pos], word[pos] + word[pos], 'x'];
    const mutation = this.#rng.pick(mutations);
    return word.slice(0, pos) + mutation + word.slice(pos + 1);
  }

  /**
   * Get the strategy used for last generation (for logging/expectations)
   */
  get lastStrategy() {
    return this.#lastStrategy;
  }
}

export default RansomLetterGenerator;
