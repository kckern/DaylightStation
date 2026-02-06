// tests/_fixtures/combobox/dynamicFixtureLoader.mjs
/**
 * Dynamic test fixture loader for ContentSearchCombobox
 *
 * Queries the ContentQueryService API to get real, varied test data
 * each run instead of hardcoding the same fixtures.
 *
 * Uses backend/src/3_applications/content/ContentQueryService.mjs
 * via /api/v1/content/query/search and /api/v1/item endpoints.
 */

import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';
import { SlotMachine } from './SlotMachine.mjs';

const API_BASE = BACKEND_URL;
if (!API_BASE) {
  throw new Error('BACKEND_URL not configured. Check tests/_fixtures/runtime/urls.mjs and system.yml');
}

/**
 * Fetch search results from the API
 * @param {string} text - Search text
 * @param {Object} [options] - Query options
 * @returns {Promise<{items: Array, total: number}>}
 */
async function searchContent(text, options = {}) {
  const params = new URLSearchParams({
    text,
    take: options.take || 20,
    ...(options.source && { source: options.source }),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 10000);

  try {
    const response = await fetch(`${API_BASE}/api/v1/content/query/search?${params}`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch list contents from the API
 * @param {string} source - Source name
 * @param {string} [path] - Path within source
 * @returns {Promise<{items: Array}>}
 */
async function listContent(source, path = '', timeout = 10000) {
  const url = path
    ? `${API_BASE}/api/v1/item/${source}/${encodeURIComponent(path)}`
    : `${API_BASE}/api/v1/item/${source}/`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`List failed: ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Pick N random items from an array
 * @param {Array} array
 * @param {number} n
 * @returns {Array}
 */
function pickRandom(array, n) {
  const copy = [...array];
  // Fisher-Yates partial shuffle (only need first n)
  for (let i = 0; i < n && i < copy.length; i++) {
    const j = i + Math.floor(Math.random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

/**
 * Generate random search terms from available content
 * Uses real content titles to create meaningful search terms
 * @returns {Promise<string[]>}
 */
async function generateSearchTerms() {
  const terms = new Set();

  // Get samples from different sources
  const sources = ['plex', 'files', 'immich'];

  for (const source of sources) {
    try {
      // Search with common words to get a variety
      const result = await searchContent('the', { source, take: 50 });

      for (const item of pickRandom(result.items || [], 5)) {
        // Extract meaningful words from titles
        const words = (item.title || '')
          .split(/\s+/)
          .filter(w => w.length >= 3 && !/^(the|and|for|with)$/i.test(w));

        if (words.length > 0) {
          terms.add(words[0]);
        }
      }
    } catch (e) {
      console.warn(`[dynamicFixtureLoader] Could not fetch from ${source}: ${e.message}`);
    }
  }

  return Array.from(terms);
}

/**
 * Get containers for drilling down
 * @returns {Promise<Array<{id: string, title: string, source: string, type: string}>>}
 */
async function getContainers() {
  const containers = [];

  // Try to get shows from Plex
  try {
    const result = await searchContent('', { source: 'plex', take: 20 });
    const plexContainers = (result.items || [])
      .filter(i => i.itemType === 'container' || ['show', 'album', 'artist'].includes(i.type))
      .slice(0, 5);
    containers.push(...plexContainers);
  } catch (e) {
    console.warn('[dynamicFixtureLoader] Could not fetch Plex containers');
  }

  // Try to get folders from files
  try {
    const result = await listContent('files');
    const mediaContainers = (result.items || [])
      .filter(i => i.itemType === 'container' || i.type === 'folder')
      .slice(0, 3);
    containers.push(...mediaContainers);
  } catch (e) {
    console.warn('[dynamicFixtureLoader] Could not fetch media containers');
  }

  return containers;
}

/**
 * Get leaf items for selection tests
 * @returns {Promise<Array<{id: string, title: string, source: string, type: string}>>}
 */
async function getLeaves() {
  const leaves = [];

  try {
    // Search for episodes/tracks (typically leaves)
    const result = await searchContent('episode', { take: 10 });
    const leafItems = (result.items || [])
      .filter(i => i.itemType === 'leaf' || ['episode', 'track', 'movie', 'photo'].includes(i.type))
      .slice(0, 5);
    leaves.push(...leafItems);
  } catch (e) {
    console.warn('[dynamicFixtureLoader] Could not fetch leaf items');
  }

  return leaves;
}

/**
 * Load dynamic test fixtures from real API data
 * Call this in test setup to get varied data each run
 *
 * @returns {Promise<Object>} Test fixtures
 */
export async function loadDynamicFixtures() {
  console.log('Loading dynamic test fixtures from API...');

  const [searchTerms, containers, leaves] = await Promise.all([
    generateSearchTerms(),
    getContainers(),
    getLeaves(),
  ]);

  // Build source-specific fixtures from discovered data
  const sourceFixtures = {};

  // Group items by source
  const bySource = {};
  for (const item of [...containers, ...leaves]) {
    const source = item.source || (typeof item.id === 'string' && item.id.includes(':') && item.id.split(':')[0]) || 'unknown';
    bySource[source] = bySource[source] || { containers: [], leaves: [] };

    if (item.itemType === 'container' || ['show', 'album', 'artist', 'folder', 'playlist'].includes(item.type)) {
      bySource[source].containers.push(item);
    } else {
      bySource[source].leaves.push(item);
    }
  }

  // Build fixtures for each discovered source
  for (const [source, data] of Object.entries(bySource)) {
    sourceFixtures[source] = {
      name: source.charAt(0).toUpperCase() + source.slice(1),
      searchTerms: pickRandom(searchTerms, 3),
      containers: data.containers.map(c => ({ type: c.type, id: c.id, title: c.title })),
      leaves: data.leaves.map(l => ({ type: l.type, id: l.id, title: l.title })),
    };
  }

  return {
    searchTerms,
    containers,
    leaves,
    sourceFixtures,

    // Mode scenarios using real data
    modeScenarios: {
      directInput: leaves.slice(0, 3).map(l => ({
        value: l.id,
        description: `${l.type}: ${l.title}`,
      })),

      search: searchTerms.slice(0, 3).map(term => ({
        term,
        description: `Search for "${term}"`,
      })),

      browse: containers.slice(0, 3).map(c => ({
        startValue: c.id,
        title: c.title,
        action: 'drillDown',
        description: `Drill into ${c.type}: ${c.title}`,
      })),
    },
  };
}

/**
 * Static edge case scenarios (these don't need dynamic data)
 */
export const EDGE_CASES = [
  { name: 'special-chars', searchTerm: 'test & < > "quoted"', description: 'Special HTML chars' },
  { name: 'unicode', searchTerm: '日本語テスト', description: 'Unicode characters' },
  { name: 'emoji', searchTerm: '🎬 movie', description: 'Emoji in search' },
  { name: 'long-title', searchTerm: 'a'.repeat(100), description: 'Very long search term' },
  { name: 'empty-results', searchTerm: 'xyznonexistent123', description: 'No matching results' },
  { name: 'single-char', searchTerm: 'a', description: 'Single char (below min)' },
  { name: 'whitespace', searchTerm: '   ', description: 'Only whitespace' },
  { name: 'rapid-typing', searchTerms: ['a', 'ab', 'abc', 'abcd'], description: 'Rapid sequential typing' },
];

/**
 * Get all container types from fixtures
 */
export function getAllContainerTypes(fixtures) {
  const types = new Set();
  for (const source of Object.values(fixtures.sourceFixtures || {})) {
    for (const container of source.containers || []) {
      types.add(container.type);
    }
  }
  return Array.from(types);
}

/**
 * Get all leaf types from fixtures
 */
export function getAllLeafTypes(fixtures) {
  const types = new Set();
  for (const source of Object.values(fixtures.sourceFixtures || {})) {
    for (const leaf of source.leaves || []) {
      types.add(leaf.type);
    }
  }
  return Array.from(types);
}

// === Slot Machine Integration ===

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

  try {
    machineInstance = new SlotMachine(seed);
    await machineInstance.initialize(baseUrl);
    fixturesCache = [...machineInstance.generate(spinCount)];
  } catch (e) {
    machineInstance = null;
    fixturesCache = null;
    throw new Error(`SlotMachine initialization failed: ${e.message}`);
  }

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
  if (index < 0 || index >= fixturesCache.length) {
    throw new Error(`Fixture index ${index} out of bounds (0-${fixturesCache.length - 1})`);
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
export function getSlotMachineSeed() {
  return machineInstance?.getSeed() || null;
}
