// tests/_fixtures/combobox/SlotMachineLoader.mjs
/**
 * Discovers available reels from live APIs.
 * Populates sources, aliases, categories, and content corpus.
 */

export class SlotMachineLoader {
  #baseUrl;

  constructor(baseUrl) {
    this.#baseUrl = baseUrl;
  }

  /**
   * Load all reels and corpus from APIs
   */
  async load() {
    const [sources, aliases, corpus] = await Promise.all([
      this.#discoverSources(),
      this.#discoverAliases(),
      this.#harvestCorpus(),
    ]);

    return {
      reels: {
        sources: sources.sources || [],
        providers: sources.providers || [],
        aliases: {
          builtIn: aliases.builtIn || [],
          userDefined: aliases.userDefined || [],
          categories: aliases.categories || [],
        },
      },
      corpus,
    };
  }

  async #discoverSources() {
    try {
      const resp = await fetch(`${this.#baseUrl}/api/v1/content/sources`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch (e) {
      console.warn('SlotMachineLoader: Could not discover sources:', e.message);
      return { sources: [], categories: [], providers: [] };
    }
  }

  async #discoverAliases() {
    try {
      const resp = await fetch(`${this.#baseUrl}/api/v1/content/aliases`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch (e) {
      console.warn('SlotMachineLoader: Could not discover aliases:', e.message);
      return { builtIn: [], userDefined: [], categories: [] };
    }
  }

  async #harvestCorpus() {
    const corpus = {
      titles: [],
      words: [],
      fragments: [],
      artists: [],
      years: [],
      bySource: {},
    };

    // Harvest with multiple seed queries to get variety
    const seedQueries = ['a', 'e', 'the', '1', 'love'];

    for (const query of seedQueries) {
      try {
        const resp = await fetch(
          `${this.#baseUrl}/api/v1/content/query/search/stream?text=${encodeURIComponent(query)}&take=30`
        );
        if (!resp.ok) continue;

        const text = await resp.text();
        const lines = text.split('\n').filter(l => l.startsWith('data:'));

        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(5));
            if (data.items) {
              for (const item of data.items) {
                if (item.title) {
                  corpus.titles.push(item.title);

                  // Track by source
                  const source = item.source || 'unknown';
                  if (!corpus.bySource[source]) corpus.bySource[source] = [];
                  corpus.bySource[source].push(item.title);
                }
                if (item.artist) corpus.artists.push(item.artist);
                if (item.year) corpus.years.push(String(item.year));
              }
            }
          } catch {
            // Skip unparseable lines
          }
        }
      } catch (e) {
        console.warn(`SlotMachineLoader: Harvest failed for "${query}":`, e.message);
      }
    }

    // Dedupe
    corpus.titles = [...new Set(corpus.titles)];
    corpus.artists = [...new Set(corpus.artists)];
    corpus.years = [...new Set(corpus.years)];

    // Build derived pools
    corpus.words = this.#extractWords(corpus.titles);
    corpus.fragments = this.#extractFragments(corpus.words);

    return corpus;
  }

  #extractWords(titles) {
    const words = new Set();
    for (const title of titles) {
      const parts = title.split(/[\s\-:,.']+/).filter(w => w.length > 2);
      parts.forEach(w => words.add(w.toLowerCase()));
    }
    return [...words];
  }

  #extractFragments(words) {
    const fragments = [];
    for (const word of words.slice(0, 200)) {
      if (word.length > 4) {
        const start = Math.floor(Math.random() * 2);
        const len = 3 + Math.floor(Math.random() * 3);
        fragments.push(word.substring(start, start + len));
      }
    }
    return [...new Set(fragments)];
  }
}

export default SlotMachineLoader;
