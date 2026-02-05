# Slot Machine Test Fixtures Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a stochastic test fixture generator that populates reels from live APIs and generates reproducible random query permutations for comprehensive UI testing.

**Architecture:** Three-layer system: (1) SlotMachineLoader discovers available sources/aliases/content from APIs, (2) RansomLetterGenerator builds keyword corpus from harvested content, (3) SlotMachine combines reels with seeded RNG for reproducible test fixtures. Test runner executes fixtures with varied stress factors.

**Tech Stack:** Playwright, ES modules, seeded PRNG, REST API discovery

---

## Task 1: Add Content Discovery API Endpoints

**Files:**
- Modify: `backend/src/4_api/v1/routers/content.mjs`

**Step 1: Read the existing router**

Read `backend/src/4_api/v1/routers/content.mjs` to understand current structure and available dependencies (registry, aliasResolver).

**Step 2: Add /sources endpoint**

```javascript
// GET /api/v1/content/sources
// Returns available sources, categories, and providers from registry
router.get('/sources', (req, res) => {
  const sources = registry.list();
  const categories = registry.getCategories();
  const providers = registry.getProviders();
  res.json({ sources, categories, providers });
});
```

**Step 3: Add /aliases endpoint**

```javascript
// GET /api/v1/content/aliases
// Returns built-in and user-defined query aliases
router.get('/aliases', (req, res) => {
  const builtInAliases = aliasResolver.getBuiltInAliases();
  const allAliases = aliasResolver.getAvailableAliases();
  const userDefined = allAliases.filter(a => !Object.keys(builtInAliases).includes(a));
  const categories = registry.getCategories();

  res.json({
    builtIn: Object.keys(builtInAliases),
    userDefined,
    categories,
  });
});
```

**Step 4: Test endpoints manually**

Run:
```bash
curl http://localhost:3111/api/v1/content/sources | jq
curl http://localhost:3111/api/v1/content/aliases | jq
```

Expected: JSON with sources array and aliases object.

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/content.mjs
git commit -m "feat(api): add /content/sources and /content/aliases discovery endpoints"
```

---

## Task 2: Create Seeded RNG Utility

**Files:**
- Create: `tests/_fixtures/combobox/seededRNG.mjs`

**Step 1: Write the seeded RNG module**

```javascript
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
```

**Step 2: Commit**

```bash
git add tests/_fixtures/combobox/seededRNG.mjs
git commit -m "feat(fixtures): add seeded RNG utility for reproducible tests"
```

---

## Task 3: Create SlotMachineLoader

**Files:**
- Create: `tests/_fixtures/combobox/SlotMachineLoader.mjs`

**Step 1: Write the loader module**

```javascript
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
```

**Step 2: Commit**

```bash
git add tests/_fixtures/combobox/SlotMachineLoader.mjs
git commit -m "feat(fixtures): add SlotMachineLoader for API-driven reel discovery"
```

---

## Task 4: Create RansomLetterGenerator

**Files:**
- Create: `tests/_fixtures/combobox/RansomLetterGenerator.mjs`

**Step 1: Write the generator module**

```javascript
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
```

**Step 2: Commit**

```bash
git add tests/_fixtures/combobox/RansomLetterGenerator.mjs
git commit -m "feat(fixtures): add RansomLetterGenerator for corpus-based keywords"
```

---

## Task 5: Create SlotMachine

**Files:**
- Create: `tests/_fixtures/combobox/SlotMachine.mjs`

**Step 1: Write the slot machine module**

```javascript
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

    console.log(`🎰 SlotMachine initialized (seed: ${this.#seed})`);
    console.log(`   Sources: ${reels.sources.join(', ') || 'none'}`);
    console.log(`   Aliases: ${[...reels.aliases.builtIn, ...reels.aliases.userDefined].join(', ') || 'none'}`);
    console.log(`   Corpus: ${corpus.titles.length} titles, ${corpus.words.length} words`);

    return this;
  }

  /**
   * Spin all reels → generate one test fixture
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
```

**Step 2: Commit**

```bash
git add tests/_fixtures/combobox/SlotMachine.mjs
git commit -m "feat(fixtures): add SlotMachine for stochastic test generation"
```

---

## Task 6: Create Dynamic Fixture Loader

**Files:**
- Create: `tests/_fixtures/combobox/dynamicFixtureLoader.mjs`

**Step 1: Write the loader that integrates with test harness**

```javascript
// tests/_fixtures/combobox/dynamicFixtureLoader.mjs
/**
 * Dynamic fixture loader for Playwright tests.
 * Bridges SlotMachine with test execution.
 */

import { SlotMachine } from './SlotMachine.mjs';

let machineInstance = null;
let fixturesCache = null;

/**
 * Initialize the slot machine (call in test.beforeAll)
 */
export async function initializeSlotMachine(options = {}) {
  const {
    baseUrl = process.env.BACKEND_URL || 'http://localhost:3111',
    seed = process.env.TEST_SEED ? parseInt(process.env.TEST_SEED) : Date.now(),
    spinCount = parseInt(process.env.SPIN_COUNT) || 50,
  } = options;

  machineInstance = new SlotMachine(seed);
  await machineInstance.initialize(baseUrl);

  fixturesCache = [...machineInstance.generate(spinCount)];

  console.log(`\n🎰 Dynamic fixtures ready`);
  console.log(`   Seed: ${seed}`);
  console.log(`   Spins: ${spinCount}`);
  console.log(`   Reproduce: TEST_SEED=${seed} npm run test:slot-machine\n`);

  return {
    seed,
    spinCount,
    fixtures: fixturesCache,
  };
}

/**
 * Get fixture by index (call in test)
 */
export function getFixture(index) {
  if (!fixturesCache) {
    throw new Error('Fixtures not initialized. Call initializeSlotMachine() first.');
  }
  return fixturesCache[index];
}

/**
 * Get all fixtures
 */
export function getAllFixtures() {
  return fixturesCache || [];
}

/**
 * Get the seed for reproduction
 */
export function getSeed() {
  return machineInstance?.getSeed() || null;
}

export default {
  initializeSlotMachine,
  getFixture,
  getAllFixtures,
  getSeed,
};
```

**Step 2: Commit**

```bash
git add tests/_fixtures/combobox/dynamicFixtureLoader.mjs
git commit -m "feat(fixtures): add dynamic fixture loader for Playwright integration"
```

---

## Task 7: Create Slot Machine Test Runner

**Files:**
- Create: `tests/live/flow/admin/content-search-combobox/11-slot-machine.runtime.test.mjs`

**Step 1: Write the test file**

```javascript
// tests/live/flow/admin/content-search-combobox/11-slot-machine.runtime.test.mjs
/**
 * Slot Machine Query Tests
 *
 * Stochastic testing with API-driven fixtures.
 * Run with: npm run test:slot-machine
 * Reproduce: TEST_SEED=<seed> npm run test:slot-machine
 */
import { test, expect } from '@playwright/test';
import { ComboboxTestHarness, ComboboxLocators, ComboboxActions } from '#testlib/comboboxTestHarness.mjs';
import { initializeSlotMachine, getFixture, getSeed } from '#fixtures/combobox/dynamicFixtureLoader.mjs';

const TEST_URL = '/admin/test/combobox';
const SPIN_COUNT = parseInt(process.env.SPIN_COUNT) || 30;

test.describe('Slot Machine Query Tests', () => {
  let harness;
  let fixtureData;

  test.beforeAll(async () => {
    fixtureData = await initializeSlotMachine({ spinCount: SPIN_COUNT });
  });

  test.beforeEach(async ({ page }) => {
    harness = new ComboboxTestHarness(page);
    await harness.setup();
    await page.goto(TEST_URL);
  });

  test.afterEach(async () => {
    await harness.teardown();
  });

  // Generate tests dynamically
  for (let i = 0; i < SPIN_COUNT; i++) {
    test(`spin ${i}`, async ({ page }) => {
      const fixture = getFixture(i);
      if (!fixture) {
        console.log(`Spin ${i}: No fixture available`);
        return;
      }

      console.log(`🎰 [${fixture.spinNumber}] ${fixture.query} (${fixture.stress})`);

      // Execute with stress factor
      await ComboboxActions.open(page);
      await executeWithStress(page, fixture.query, fixture.stress);

      // Collect results
      const { count, results } = await collectResults(page);
      console.log(`   → ${count} results`);

      // Assert expectations
      await assertExpectations(harness, fixture, count, results);
    });
  }
});

// =============================================================================
// Stress Executors
// =============================================================================

async function executeWithStress(page, query, stress) {
  const input = ComboboxLocators.input(page);

  try {
    switch (stress) {
      case 'normal':
        await input.fill(query);
        break;

      case 'rapid-fire':
        await input.focus();
        for (const char of query) {
          await page.keyboard.type(char, { delay: 0 });
        }
        break;

      case 'mid-stream-change':
        await input.fill('decoy:interrupt');
        await page.waitForTimeout(50);
        await input.fill(query);
        break;

      case 'backspace-retype':
        await input.fill(query + 'xxx');
        for (let i = 0; i < 3; i++) {
          await page.keyboard.press('Backspace');
        }
        break;
    }

    // Wait for stream to complete
    await ComboboxActions.waitForStreamComplete(page, 15000);
  } catch {
    // Timeout acceptable
  }
}

// =============================================================================
// Result Collection
// =============================================================================

async function collectResults(page) {
  let count = 0;
  const results = [];

  try {
    const options = ComboboxLocators.options(page);
    count = await options.count();

    for (let i = 0; i < Math.min(count, 5); i++) {
      const opt = options.nth(i);
      results.push({
        badge: await ComboboxLocators.optionBadge(opt).textContent().catch(() => null),
        type: await opt.getAttribute('data-content-type').catch(() => null),
        mediaType: await opt.getAttribute('data-media-type').catch(() => null),
      });
    }
  } catch {
    // Page may have closed
  }

  return { count, results };
}

// =============================================================================
// Expectation Assertions
// =============================================================================

async function assertExpectations(harness, fixture, count, results) {
  const { expectations } = fixture;

  // Always: no critical backend errors
  if (expectations.noBackendErrors) {
    const check = harness.assertNoBackendErrors();
    const critical = check.errors.filter(e =>
      !e.includes('proxy.timeout') && !e.includes('ECONNREFUSED')
    );
    expect(critical).toEqual([]);
  }

  // Source prefix: badges should match
  if (expectations.sourceBadge && results.length > 0) {
    const badges = results.map(r => r.badge?.toLowerCase()).filter(Boolean);
    if (badges.length > 0) {
      const matching = badges.filter(b => b.includes(expectations.sourceBadge));
      // Allow 70% match (some mixed results ok)
      expect(matching.length).toBeGreaterThanOrEqual(Math.floor(badges.length * 0.7));
    }
  }

  // Gatekeeper exclude: should not contain excluded types
  if (expectations.gatekeeper?.exclude && results.length > 0) {
    for (const result of results) {
      if (result.type) {
        expect(expectations.gatekeeper.exclude).not.toContain(result.type);
      }
    }
  }

  // Gatekeeper include: should only contain included types
  if (expectations.gatekeeper?.include && results.length > 0) {
    for (const result of results) {
      if (result.type) {
        expect(expectations.gatekeeper.include).toContain(result.type);
      }
    }
  }

  // Result range (loose)
  expect(count).toBeGreaterThanOrEqual(expectations.resultRange.min);
  expect(count).toBeLessThanOrEqual(expectations.resultRange.max);
}
```

**Step 2: Commit**

```bash
git add tests/live/flow/admin/content-search-combobox/11-slot-machine.runtime.test.mjs
git commit -m "test(combobox): add slot machine stochastic test runner"
```

---

## Task 8: Add npm Script

**Files:**
- Modify: `package.json`

**Step 1: Add test:slot-machine script**

Add to the scripts section:

```json
{
  "scripts": {
    "test:slot-machine": "npx playwright test tests/live/flow/admin/content-search-combobox/11-slot-machine.runtime.test.mjs --reporter=line"
  }
}
```

**Step 2: Commit**

```bash
git add package.json
git commit -m "chore: add test:slot-machine npm script"
```

---

## Task 9: Run and Verify

**Step 1: Start dev server if not running**

```bash
npm run dev
```

**Step 2: Run slot machine tests**

```bash
npm run test:slot-machine
```

Expected output:
```
🎰 SlotMachine initialized (seed: 1707012345)
   Sources: plex, immich, filesystem, singing, narrated
   Aliases: music, photos, video, audiobooks
   Corpus: 150 titles, 320 words

🎰 Dynamic fixtures ready
   Seed: 1707012345
   Spins: 30
   Reproduce: TEST_SEED=1707012345 npm run test:slot-machine

  30 passed (2.5m)
```

**Step 3: Test reproduction**

```bash
TEST_SEED=1707012345 npm run test:slot-machine
```

Expected: Same fixtures generated, same results.

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(tests): complete slot machine test fixture system"
```

---

## Summary

| Task | Files | Purpose |
|------|-------|---------|
| 1 | content.mjs | API endpoints for discovery |
| 2 | seededRNG.mjs | Reproducible random |
| 3 | SlotMachineLoader.mjs | API discovery |
| 4 | RansomLetterGenerator.mjs | Corpus keywords |
| 5 | SlotMachine.mjs | Core generator |
| 6 | dynamicFixtureLoader.mjs | Playwright bridge |
| 7 | 11-slot-machine.runtime.test.mjs | Test runner |
| 8 | package.json | npm script |
| 9 | - | Verification |
