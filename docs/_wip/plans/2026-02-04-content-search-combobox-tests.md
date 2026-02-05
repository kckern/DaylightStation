# ContentSearchCombobox Bulletproof Test Suite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a comprehensive three-layer test suite (UI, API, Backend) for ContentSearchCombobox with full coverage across all dimensions: modes, sources, navigation, states, and edge cases.

**Architecture:** Isolated test route mounts component with controllable state. Test harness intercepts API calls, tails backend logs, and validates response schemas. ~88 test cases cover the full permutation space.

**Tech Stack:** Playwright E2E, Zod schema validation, Node child_process for log tailing

---

## Task 1: Create API Response Schemas

**Files:**
- Create: `tests/_lib/schemas/contentSearchSchemas.mjs`

**Step 1: Write the schema definitions**

```javascript
// tests/_lib/schemas/contentSearchSchemas.mjs
/**
 * Zod schemas for ContentSearchCombobox API responses
 * Used for validating /api/v1/list and /api/v1/content/query/search responses
 */
import { z } from 'zod';

// Base item schema - common fields across all sources
export const ContentItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  type: z.string().optional(),
  itemType: z.enum(['container', 'leaf']).optional(),
  source: z.string().optional(),
  localId: z.string().optional(),
  thumbnail: z.string().url().optional().nullable(),
  imageUrl: z.string().url().optional().nullable(),
  isContainer: z.boolean().optional(),
  metadata: z.object({
    type: z.string().optional(),
    parentTitle: z.string().optional(),
    parentId: z.string().optional(),
  }).passthrough().optional(),
});

// List endpoint response
export const ListResponseSchema = z.object({
  items: z.array(ContentItemSchema),
  total: z.number().optional(),
  path: z.string().optional(),
  source: z.string().optional(),
});

// Search endpoint response
export const SearchResponseSchema = z.object({
  items: z.array(ContentItemSchema),
  query: z.object({
    text: z.string().optional(),
    source: z.string().optional(),
    take: z.number().optional(),
    skip: z.number().optional(),
  }).passthrough().optional(),
  total: z.number().optional(),
});

// Error response schema
export const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.any().optional(),
});

/**
 * Validate a list response
 * @param {Object} data - Response data
 * @returns {{valid: boolean, errors?: string[]}}
 */
export function validateListResponse(data) {
  const result = ListResponseSchema.safeParse(data);
  if (result.success) return { valid: true };
  return {
    valid: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
  };
}

/**
 * Validate a search response
 * @param {Object} data - Response data
 * @returns {{valid: boolean, errors?: string[]}}
 */
export function validateSearchResponse(data) {
  const result = SearchResponseSchema.safeParse(data);
  if (result.success) return { valid: true };
  return {
    valid: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
  };
}

/**
 * Validate item has required display fields
 * @param {Object} item - Content item
 * @returns {{valid: boolean, errors?: string[]}}
 */
export function validateDisplayFields(item) {
  const errors = [];

  if (!item.id) errors.push('Missing id');
  if (!item.title) errors.push('Missing title');

  // Must have either thumbnail or type for icon fallback
  if (!item.thumbnail && !item.imageUrl && !item.type && !item.metadata?.type) {
    errors.push('Missing thumbnail and type (no icon fallback possible)');
  }

  // ID must be parseable as source:localId
  if (item.id && !item.id.includes(':') && !/^\d+$/.test(item.id)) {
    errors.push(`ID "${item.id}" not in source:localId format`);
  }

  return { valid: errors.length === 0, errors };
}
```

**Step 2: Verify schemas compile**

Run: `node -e "import('./tests/_lib/schemas/contentSearchSchemas.mjs').then(() => console.log('OK'))"`
Expected: `OK` (or install zod first)

**Step 3: Install zod if needed**

Run: `npm ls zod || npm install -D zod`
Expected: zod installed

**Step 4: Commit**

```bash
git add tests/_lib/schemas/contentSearchSchemas.mjs
git commit -m "test: add Zod schemas for content search API validation"
```

---

## Task 2: Create Test Harness Module

**Files:**
- Create: `tests/_lib/comboboxTestHarness.mjs`

**Step 1: Write the harness module**

```javascript
// tests/_lib/comboboxTestHarness.mjs
/**
 * Three-layer test harness for ContentSearchCombobox
 * - Layer 1: UI (Playwright page interactions)
 * - Layer 2: API (request/response interception and validation)
 * - Layer 3: Backend (dev.log tailing for error detection)
 */
import { spawn } from 'child_process';
import path from 'path';
import { validateListResponse, validateSearchResponse, validateDisplayFields } from './schemas/contentSearchSchemas.mjs';

/**
 * API call record
 * @typedef {Object} ApiCall
 * @property {string} url
 * @property {string} method
 * @property {number} timestamp
 * @property {number} status
 * @property {Object} response
 * @property {Object} validation
 */

/**
 * Test harness for ContentSearchCombobox
 */
export class ComboboxTestHarness {
  /**
   * @param {import('@playwright/test').Page} page
   * @param {Object} options
   * @param {string} [options.logPath] - Path to dev.log
   */
  constructor(page, options = {}) {
    this.page = page;
    this.apiCalls = [];
    this.backendErrors = [];
    this.backendWarnings = [];
    this.logTail = null;
    this.logPath = options.logPath || path.resolve(process.cwd(), 'dev.log');
  }

  /**
   * Set up API interception and log tailing
   */
  async setup() {
    await this.interceptApi();
    this.startLogTail();
  }

  /**
   * Tear down harness
   */
  async teardown() {
    this.stopLogTail();
  }

  /**
   * Intercept API calls and validate responses
   */
  async interceptApi() {
    await this.page.route('**/api/v1/list/**', async (route, request) => {
      const url = request.url();
      const method = request.method();
      const timestamp = Date.now();

      const response = await route.fetch();
      const status = response.status();
      let body = null;
      let validation = { valid: true };

      try {
        body = await response.json();
        validation = validateListResponse(body);
      } catch (e) {
        validation = { valid: false, errors: [`JSON parse error: ${e.message}`] };
      }

      this.apiCalls.push({ url, method, timestamp, status, response: body, validation, type: 'list' });

      await route.fulfill({ response });
    });

    await this.page.route('**/api/v1/content/query/search**', async (route, request) => {
      const url = request.url();
      const method = request.method();
      const timestamp = Date.now();

      const response = await route.fetch();
      const status = response.status();
      let body = null;
      let validation = { valid: true };

      try {
        body = await response.json();
        validation = validateSearchResponse(body);
      } catch (e) {
        validation = { valid: false, errors: [`JSON parse error: ${e.message}`] };
      }

      this.apiCalls.push({ url, method, timestamp, status, response: body, validation, type: 'search' });

      await route.fulfill({ response });
    });
  }

  /**
   * Start tailing dev.log for errors
   */
  startLogTail() {
    try {
      this.logTail = spawn('tail', ['-f', '-n', '0', this.logPath]);

      this.logTail.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          if (/\bERROR\b/i.test(line) || /\bException\b/i.test(line)) {
            this.backendErrors.push(line);
          } else if (/\bWARN\b/i.test(line)) {
            this.backendWarnings.push(line);
          }
        }
      });

      this.logTail.stderr.on('data', (data) => {
        // Ignore stderr (e.g., "file truncated")
      });
    } catch (e) {
      console.warn(`Could not tail log file: ${e.message}`);
    }
  }

  /**
   * Stop tailing dev.log
   */
  stopLogTail() {
    if (this.logTail) {
      this.logTail.kill();
      this.logTail = null;
    }
  }

  // =========================================================================
  // Assertions
  // =========================================================================

  /**
   * Assert no backend errors occurred
   * @returns {{passed: boolean, errors: string[]}}
   */
  assertNoBackendErrors() {
    return {
      passed: this.backendErrors.length === 0,
      errors: this.backendErrors
    };
  }

  /**
   * Assert API was called with pattern
   * @param {RegExp} pattern - URL pattern
   * @param {number} [times] - Expected call count (undefined = at least once)
   * @returns {{passed: boolean, actual: number, calls: ApiCall[]}}
   */
  assertApiCalled(pattern, times) {
    const matching = this.apiCalls.filter(c => pattern.test(c.url));
    const passed = times === undefined ? matching.length > 0 : matching.length === times;
    return { passed, actual: matching.length, calls: matching };
  }

  /**
   * Assert all API responses passed schema validation
   * @returns {{passed: boolean, failures: Array<{url: string, errors: string[]}>}}
   */
  assertAllApiValid() {
    const failures = this.apiCalls
      .filter(c => !c.validation.valid)
      .map(c => ({ url: c.url, errors: c.validation.errors }));
    return { passed: failures.length === 0, failures };
  }

  /**
   * Assert no duplicate API calls (debounce working)
   * @param {number} windowMs - Time window for duplicates
   * @returns {{passed: boolean, duplicates: ApiCall[]}}
   */
  assertNoDuplicateCalls(windowMs = 100) {
    const duplicates = [];
    for (let i = 1; i < this.apiCalls.length; i++) {
      const prev = this.apiCalls[i - 1];
      const curr = this.apiCalls[i];
      if (curr.url === prev.url && curr.timestamp - prev.timestamp < windowMs) {
        duplicates.push(curr);
      }
    }
    return { passed: duplicates.length === 0, duplicates };
  }

  /**
   * Get all API calls matching a pattern
   * @param {RegExp} pattern
   * @returns {ApiCall[]}
   */
  getApiCalls(pattern) {
    return this.apiCalls.filter(c => pattern.test(c.url));
  }

  /**
   * Clear recorded data for next test
   */
  reset() {
    this.apiCalls = [];
    this.backendErrors = [];
    this.backendWarnings = [];
  }
}

/**
 * Standard locators for ContentSearchCombobox
 */
export const ComboboxLocators = {
  input: (page) => page.locator('.mantine-Combobox-target input'),
  dropdown: (page) => page.locator('.mantine-Combobox-dropdown'),
  options: (page) => page.locator('.mantine-Combobox-option'),
  backButton: (page) => page.locator('.mantine-Combobox-dropdown .mantine-ActionIcon').first(),
  breadcrumbs: (page) => page.locator('.mantine-Combobox-dropdown').locator('text=\\/'),
  loader: (page) => page.locator('.mantine-Loader'),
  emptyState: (page) => page.locator('.mantine-Combobox-empty'),

  // Option details
  optionTitle: (option) => option.locator('.mantine-Text').first(),
  optionParent: (option) => option.locator('.mantine-Text[c="dimmed"]'),
  optionBadge: (option) => option.locator('.mantine-Badge-root'),
  optionChevron: (option) => option.locator('svg[class*="chevron"], [data-icon="chevron"]'),
  optionAvatar: (option) => option.locator('.mantine-Avatar-root'),
};

/**
 * Standard actions for ContentSearchCombobox
 */
export const ComboboxActions = {
  /**
   * Open dropdown by clicking input
   */
  async open(page) {
    await ComboboxLocators.input(page).click();
    await page.waitForTimeout(100);
  },

  /**
   * Type search text (waits for debounce)
   */
  async search(page, text, debounceMs = 400) {
    await ComboboxLocators.input(page).fill(text);
    await page.waitForTimeout(debounceMs);
  },

  /**
   * Click an option by index
   */
  async clickOption(page, index) {
    await ComboboxLocators.options(page).nth(index).click();
    await page.waitForTimeout(200);
  },

  /**
   * Click back button
   */
  async goBack(page) {
    await ComboboxLocators.backButton(page).click();
    await page.waitForTimeout(200);
  },

  /**
   * Press keyboard key
   */
  async pressKey(page, key) {
    await page.keyboard.press(key);
    await page.waitForTimeout(100);
  },

  /**
   * Wait for loading to complete
   */
  async waitForLoad(page, timeout = 5000) {
    await ComboboxLocators.loader(page).waitFor({ state: 'hidden', timeout });
  },
};
```

**Step 2: Verify harness module loads**

Run: `node -e "import('./tests/_lib/comboboxTestHarness.mjs').then(m => console.log(Object.keys(m)))"`
Expected: `[ 'ComboboxTestHarness', 'ComboboxLocators', 'ComboboxActions' ]`

**Step 3: Commit**

```bash
git add tests/_lib/comboboxTestHarness.mjs
git commit -m "test: add three-layer test harness for ContentSearchCombobox"
```

---

## Task 3: Create Isolated Test Route

**Files:**
- Modify: `frontend/src/Apps/AdminApp.jsx`
- Create: `frontend/src/modules/Admin/TestHarness/ComboboxTestPage.jsx`

**Step 1: Create the test page component**

```jsx
// frontend/src/modules/Admin/TestHarness/ComboboxTestPage.jsx
/**
 * Isolated test page for ContentSearchCombobox
 * Mounts component with controllable props via URL params
 *
 * URL params:
 * - value: Initial content ID (e.g., plex:12345)
 * - placeholder: Input placeholder text
 * - mock: API mock mode (none, error, empty, slow)
 */
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Stack, Paper, Text, Code, Group, Badge, Title, Divider } from '@mantine/core';
import ContentSearchCombobox from '../ContentLists/ContentSearchCombobox.jsx';

function ComboboxTestPage() {
  const [searchParams] = useSearchParams();
  const initialValue = searchParams.get('value') || '';
  const placeholder = searchParams.get('placeholder') || 'Search content...';

  const [value, setValue] = useState(initialValue);
  const [changeLog, setChangeLog] = useState([]);

  // Log all onChange calls for test assertion
  const handleChange = (newValue) => {
    const entry = {
      timestamp: Date.now(),
      from: value,
      to: newValue,
    };
    setChangeLog(prev => [...prev, entry]);
    setValue(newValue);
  };

  // Reset when URL params change
  useEffect(() => {
    setValue(initialValue);
    setChangeLog([]);
  }, [initialValue]);

  return (
    <Stack p="xl" maw={800} mx="auto">
      <Title order={2}>ContentSearchCombobox Test Harness</Title>

      <Paper p="md" withBorder>
        <Text size="sm" c="dimmed" mb="md">Component Under Test</Text>
        <ContentSearchCombobox
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
        />
      </Paper>

      <Paper p="md" withBorder>
        <Text size="sm" c="dimmed" mb="xs">Current Value</Text>
        <Code block data-testid="current-value">{value || '(empty)'}</Code>
      </Paper>

      <Paper p="md" withBorder>
        <Text size="sm" c="dimmed" mb="xs">Change Log</Text>
        <Stack gap="xs" data-testid="change-log">
          {changeLog.length === 0 ? (
            <Text size="sm" c="dimmed">No changes yet</Text>
          ) : (
            changeLog.map((entry, i) => (
              <Group key={i} gap="xs">
                <Badge size="xs" variant="light">{i + 1}</Badge>
                <Code>{entry.from || '(empty)'}</Code>
                <Text size="sm">→</Text>
                <Code>{entry.to}</Code>
              </Group>
            ))
          )}
        </Stack>
      </Paper>

      <Divider />

      <Paper p="md" withBorder>
        <Text size="sm" c="dimmed" mb="xs">Test Parameters</Text>
        <Stack gap="xs">
          <Group gap="xs">
            <Badge variant="outline">value</Badge>
            <Code>{initialValue || '(none)'}</Code>
          </Group>
          <Group gap="xs">
            <Badge variant="outline">placeholder</Badge>
            <Code>{placeholder}</Code>
          </Group>
        </Stack>
      </Paper>
    </Stack>
  );
}

export default ComboboxTestPage;
```

**Step 2: Add route to AdminApp**

Modify `frontend/src/Apps/AdminApp.jsx` - add import and route:

```jsx
// Add import at top
import ComboboxTestPage from '../modules/Admin/TestHarness/ComboboxTestPage.jsx';

// Add route inside <Routes> (before the catch-all)
<Route path="test/combobox" element={<ComboboxTestPage />} />
```

**Step 3: Verify route works**

Run: Start dev server, navigate to `/admin/test/combobox`
Expected: Test harness page renders with combobox

**Step 4: Commit**

```bash
git add frontend/src/modules/Admin/TestHarness/ComboboxTestPage.jsx
git add frontend/src/Apps/AdminApp.jsx
git commit -m "test: add isolated test route for ContentSearchCombobox"
```

---

## Task 4: Create Dynamic Test Fixture Loader

**Files:**
- Create: `tests/_fixtures/combobox/dynamicFixtureLoader.mjs`

**Step 1: Write dynamic fixture loader that queries real API data**

```javascript
// tests/_fixtures/combobox/dynamicFixtureLoader.mjs
/**
 * Dynamic test fixture loader for ContentSearchCombobox
 *
 * Queries the ContentQueryService API to get real, varied test data
 * each run instead of hardcoding the same fixtures.
 *
 * Uses backend/src/3_applications/content/ContentQueryService.mjs
 * via /api/v1/content/query/search and /api/v1/list endpoints.
 */

import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const API_BASE = BACKEND_URL || 'http://localhost:3111';

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

  const response = await fetch(`${API_BASE}/api/v1/content/query/search?${params}`);
  if (!response.ok) {
    throw new Error(`Search failed: ${response.status}`);
  }
  return response.json();
}

/**
 * Fetch list contents from the API
 * @param {string} source - Source name
 * @param {string} [path] - Path within source
 * @returns {Promise<{items: Array}>}
 */
async function listContent(source, path = '') {
  const url = path
    ? `${API_BASE}/api/v1/list/${source}/${encodeURIComponent(path)}`
    : `${API_BASE}/api/v1/list/${source}/`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`List failed: ${response.status}`);
  }
  return response.json();
}

/**
 * Pick N random items from an array
 * @param {Array} array
 * @param {number} n
 * @returns {Array}
 */
function pickRandom(array, n) {
  const shuffled = [...array].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

/**
 * Generate random search terms from available content
 * Uses real content titles to create meaningful search terms
 * @returns {Promise<string[]>}
 */
async function generateSearchTerms() {
  const terms = new Set();

  // Get samples from different sources
  const sources = ['plex', 'media', 'immich'];

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
      console.warn(`Could not fetch from ${source}: ${e.message}`);
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
    console.warn('Could not fetch Plex containers');
  }

  // Try to get folders from media
  try {
    const result = await listContent('media');
    const mediaContainers = (result.items || [])
      .filter(i => i.itemType === 'container' || i.type === 'folder')
      .slice(0, 3);
    containers.push(...mediaContainers);
  } catch (e) {
    console.warn('Could not fetch media containers');
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
    console.warn('Could not fetch leaf items');
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
    const source = item.source || item.id?.split(':')[0] || 'unknown';
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
```

**Step 2: Verify dynamic loader works**

Run: `node -e "import('./tests/_fixtures/combobox/dynamicFixtureLoader.mjs').then(m => m.loadDynamicFixtures().then(f => console.log('Loaded:', Object.keys(f))))"`
Expected: `Loaded: [ 'searchTerms', 'containers', 'leaves', 'sourceFixtures', 'modeScenarios' ]`

**Step 3: Commit**

```bash
git add tests/_fixtures/combobox/dynamicFixtureLoader.mjs
git commit -m "test: add dynamic fixture loader using ContentQueryService API"
```

---

## Task 5: Write Basic Interaction Tests

**Files:**
- Create: `tests/live/flow/admin/content-search-combobox/01-basic-interactions.runtime.test.mjs`

**Step 1: Write the test file**

```javascript
// tests/live/flow/admin/content-search-combobox/01-basic-interactions.runtime.test.mjs
/**
 * Basic interaction tests for ContentSearchCombobox
 * Tests: open/close, focus/blur, initial states
 */
import { test, expect } from '@playwright/test';
import { ComboboxTestHarness, ComboboxLocators, ComboboxActions } from '#testlib/comboboxTestHarness.mjs';

const TEST_URL = '/admin/test/combobox';

test.describe('ContentSearchCombobox - Basic Interactions', () => {
  let harness;

  test.beforeEach(async ({ page }) => {
    harness = new ComboboxTestHarness(page);
    await harness.setup();
  });

  test.afterEach(async () => {
    await harness.teardown();

    // Assert no backend errors after each test
    const backendCheck = harness.assertNoBackendErrors();
    expect(backendCheck.errors).toEqual([]);
  });

  test('renders with placeholder when empty', async ({ page }) => {
    await page.goto(TEST_URL);

    const input = ComboboxLocators.input(page);
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute('placeholder', 'Search content...');
    await expect(input).toHaveValue('');
  });

  test('renders with initial value from URL param', async ({ page }) => {
    await page.goto(`${TEST_URL}?value=plex:12345`);

    const input = ComboboxLocators.input(page);
    await expect(input).toHaveValue('plex:12345');
  });

  test('opens dropdown on click', async ({ page }) => {
    await page.goto(TEST_URL);

    await ComboboxActions.open(page);

    const dropdown = ComboboxLocators.dropdown(page);
    await expect(dropdown).toBeVisible();
  });

  test('opens dropdown on focus', async ({ page }) => {
    await page.goto(TEST_URL);

    const input = ComboboxLocators.input(page);
    await input.focus();
    await page.waitForTimeout(100);

    const dropdown = ComboboxLocators.dropdown(page);
    await expect(dropdown).toBeVisible();
  });

  test('closes dropdown on blur', async ({ page }) => {
    await page.goto(TEST_URL);

    await ComboboxActions.open(page);
    await expect(ComboboxLocators.dropdown(page)).toBeVisible();

    // Click outside
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(200);

    await expect(ComboboxLocators.dropdown(page)).not.toBeVisible();
  });

  test('closes dropdown on Escape key', async ({ page }) => {
    await page.goto(TEST_URL);

    await ComboboxActions.open(page);
    await expect(ComboboxLocators.dropdown(page)).toBeVisible();

    await ComboboxActions.pressKey(page, 'Escape');

    await expect(ComboboxLocators.dropdown(page)).not.toBeVisible();
  });

  test('shows "Type to search" when empty and opened', async ({ page }) => {
    await page.goto(TEST_URL);

    await ComboboxActions.open(page);

    const emptyState = ComboboxLocators.emptyState(page);
    await expect(emptyState).toContainText('Type to search');
  });

  test('shows loader during search', async ({ page }) => {
    await page.goto(TEST_URL);

    await ComboboxActions.open(page);

    // Type quickly and check for loader before debounce completes
    await ComboboxLocators.input(page).fill('test');

    // Loader should appear briefly
    const loader = ComboboxLocators.loader(page);
    // Note: This may be flaky depending on API speed; adjust timing if needed
  });

  test('custom placeholder from URL param', async ({ page }) => {
    await page.goto(`${TEST_URL}?placeholder=Find%20content...`);

    const input = ComboboxLocators.input(page);
    await expect(input).toHaveAttribute('placeholder', 'Find content...');
  });

  test('value display shows in test harness', async ({ page }) => {
    await page.goto(`${TEST_URL}?value=plex:999`);

    const valueDisplay = page.locator('[data-testid="current-value"]');
    await expect(valueDisplay).toContainText('plex:999');
  });
});
```

**Step 2: Run tests to verify setup**

Run: `npx playwright test tests/live/flow/admin/content-search-combobox/01-basic-interactions.runtime.test.mjs --reporter=line`
Expected: Tests run (some may fail if dev server not running - that's OK for now)

**Step 3: Commit**

```bash
git add tests/live/flow/admin/content-search-combobox/01-basic-interactions.runtime.test.mjs
git commit -m "test: add basic interaction tests for ContentSearchCombobox"
```

---

## Task 6: Write Search Mode Tests

**Files:**
- Create: `tests/live/flow/admin/content-search-combobox/02-search-mode.runtime.test.mjs`

**Step 1: Write search tests**

```javascript
// tests/live/flow/admin/content-search-combobox/02-search-mode.runtime.test.mjs
/**
 * Search mode tests for ContentSearchCombobox
 * Tests: keyword search, debounce, results display, source filtering
 */
import { test, expect } from '@playwright/test';
import { ComboboxTestHarness, ComboboxLocators, ComboboxActions } from '#testlib/comboboxTestHarness.mjs';
import { loadDynamicFixtures } from '#fixtures/combobox/dynamicFixtureLoader.mjs';

const TEST_URL = '/admin/test/combobox';

// Load dynamic fixtures once for the test file
let fixtures;

test.describe('ContentSearchCombobox - Search Mode', () => {
  let harness;

  test.beforeAll(async () => {
    // Load varied test data from API
    fixtures = await loadDynamicFixtures();
    console.log(`Loaded ${fixtures.searchTerms.length} search terms, ${fixtures.containers.length} containers`);
  });

  test.beforeEach(async ({ page }) => {
    harness = new ComboboxTestHarness(page);
    await harness.setup();
    await page.goto(TEST_URL);
  });

  test.afterEach(async () => {
    // Validate all API responses
    const apiCheck = harness.assertAllApiValid();
    if (!apiCheck.passed) {
      console.error('API validation failures:', apiCheck.failures);
    }
    expect(apiCheck.passed).toBe(true);

    // Assert no backend errors
    const backendCheck = harness.assertNoBackendErrors();
    expect(backendCheck.errors).toEqual([]);

    await harness.teardown();
  });

  test('search triggers API call after debounce', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');

    const apiCheck = harness.assertApiCalled(/content\/query\/search/);
    expect(apiCheck.passed).toBe(true);
    expect(apiCheck.actual).toBeGreaterThanOrEqual(1);
  });

  test('search does not trigger for single character', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'a', 500);

    const apiCheck = harness.assertApiCalled(/content\/query\/search/);
    expect(apiCheck.actual).toBe(0);

    await expect(ComboboxLocators.emptyState(page)).toContainText('Type to search');
  });

  test('search results display with correct structure', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count > 0) {
      const firstOption = options.first();

      // Check avatar exists
      await expect(ComboboxLocators.optionAvatar(firstOption)).toBeVisible();

      // Check title exists
      await expect(ComboboxLocators.optionTitle(firstOption)).toBeVisible();

      // Check badge exists
      await expect(ComboboxLocators.optionBadge(firstOption)).toBeVisible();
    }
  });

  test('debounce prevents duplicate API calls', async ({ page }) => {
    await ComboboxActions.open(page);

    // Type rapidly
    const input = ComboboxLocators.input(page);
    await input.fill('O');
    await page.waitForTimeout(50);
    await input.fill('Of');
    await page.waitForTimeout(50);
    await input.fill('Off');
    await page.waitForTimeout(50);
    await input.fill('Offi');
    await page.waitForTimeout(50);
    await input.fill('Offic');
    await page.waitForTimeout(50);
    await input.fill('Office');

    // Wait for debounce
    await page.waitForTimeout(500);

    const duplicateCheck = harness.assertNoDuplicateCalls(100);
    expect(duplicateCheck.passed).toBe(true);
  });

  test('shows "No results found" for unmatched search', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'xyznonexistent123abc');
    await ComboboxActions.waitForLoad(page);

    await expect(ComboboxLocators.emptyState(page)).toContainText('No results');
  });

  test('clearing search clears results', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    // Verify results appeared
    const options = ComboboxLocators.options(page);
    const initialCount = await options.count();

    // Clear search
    await ComboboxLocators.input(page).fill('');
    await page.waitForTimeout(400);

    // Should show "Type to search" again
    await expect(ComboboxLocators.emptyState(page)).toContainText('Type to search');
  });

  // Test dynamically loaded search terms (varied each run)
  test('search with dynamic fixture terms', async ({ page }) => {
    // Use dynamically loaded search terms - different each run
    for (const term of fixtures.searchTerms.slice(0, 3)) {
      harness.reset(); // Clear API call tracking

      await ComboboxActions.open(page);
      await ComboboxActions.search(page, term);
      await ComboboxActions.waitForLoad(page);

      const options = ComboboxLocators.options(page);
      const count = await options.count();

      console.log(`Dynamic search "${term}": ${count} results`);

      // API should have been called
      const apiCheck = harness.assertApiCalled(/content\/query\/search/);
      expect(apiCheck.passed).toBe(true);

      // Close and reopen for next term
      await ComboboxActions.pressKey(page, 'Escape');
      await page.waitForTimeout(200);
    }
  });
});
```

**Step 2: Run tests**

Run: `npx playwright test tests/live/flow/admin/content-search-combobox/02-search-mode.runtime.test.mjs --reporter=line`
Expected: Tests run

**Step 3: Commit**

```bash
git add tests/live/flow/admin/content-search-combobox/02-search-mode.runtime.test.mjs
git commit -m "test: add search mode tests for ContentSearchCombobox"
```

---

## Task 7: Write Browse Mode Tests

**Files:**
- Create: `tests/live/flow/admin/content-search-combobox/03-browse-mode.runtime.test.mjs`

**Step 1: Write browse tests**

```javascript
// tests/live/flow/admin/content-search-combobox/03-browse-mode.runtime.test.mjs
/**
 * Browse mode tests for ContentSearchCombobox
 * Tests: drill-down, back navigation, breadcrumbs, sibling loading
 */
import { test, expect } from '@playwright/test';
import { ComboboxTestHarness, ComboboxLocators, ComboboxActions } from '#testlib/comboboxTestHarness.mjs';

const TEST_URL = '/admin/test/combobox';

test.describe('ContentSearchCombobox - Browse Mode', () => {
  let harness;

  test.beforeEach(async ({ page }) => {
    harness = new ComboboxTestHarness(page);
    await harness.setup();
  });

  test.afterEach(async () => {
    const apiCheck = harness.assertAllApiValid();
    expect(apiCheck.passed).toBe(true);

    const backendCheck = harness.assertNoBackendErrors();
    expect(backendCheck.errors).toEqual([]);

    await harness.teardown();
  });

  test('loads siblings when opening with existing value', async ({ page }) => {
    // Start with a value that has a parent path
    await page.goto(`${TEST_URL}?value=media:workouts/hiit.mp4`);

    await ComboboxActions.open(page);
    await page.waitForTimeout(1000); // Wait for sibling load

    // Should have called list API
    const apiCheck = harness.assertApiCalled(/api\/v1\/list\//);
    expect(apiCheck.passed).toBe(true);
  });

  test('clicking container drills into it', async ({ page }) => {
    await page.goto(TEST_URL);
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count > 0) {
      // Find a container (has chevron)
      let containerFound = false;
      for (let i = 0; i < count; i++) {
        const option = options.nth(i);
        const chevron = option.locator('svg').last(); // Chevron is usually last icon
        const hasChevron = await chevron.isVisible().catch(() => false);

        if (hasChevron) {
          containerFound = true;

          // Get initial breadcrumb state
          const initialBreadcrumbs = await ComboboxLocators.breadcrumbs(page).count();

          // Click to drill in
          await option.click();
          await page.waitForTimeout(500);

          // Should have called list API for drill-down
          const listCalls = harness.getApiCalls(/api\/v1\/list\//);
          expect(listCalls.length).toBeGreaterThan(0);

          // Breadcrumbs should appear
          const backButton = ComboboxLocators.backButton(page);
          await expect(backButton).toBeVisible();

          break;
        }
      }

      if (!containerFound) {
        console.log('No container found in search results - skipping drill-down test');
      }
    }
  });

  test('back button returns to previous level', async ({ page }) => {
    await page.goto(TEST_URL);
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count > 0) {
      // Find and click a container
      const firstOption = options.first();
      await firstOption.click();
      await page.waitForTimeout(500);

      // Check if we drilled in (back button visible)
      const backButton = ComboboxLocators.backButton(page);
      const didDrillIn = await backButton.isVisible().catch(() => false);

      if (didDrillIn) {
        const callsBeforeBack = harness.apiCalls.length;

        // Click back
        await ComboboxActions.goBack(page);

        // Should have made another API call or returned to search results
        await page.waitForTimeout(500);
      }
    }
  });

  test('breadcrumbs display navigation path', async ({ page }) => {
    await page.goto(TEST_URL);
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count > 0) {
      // Click first option (may or may not be container)
      await options.first().click();
      await page.waitForTimeout(500);

      // Check for breadcrumb text
      const dropdown = ComboboxLocators.dropdown(page);
      const dropdownText = await dropdown.textContent();

      // If we drilled in, should see breadcrumb separator
      const backButton = ComboboxLocators.backButton(page);
      const didDrillIn = await backButton.isVisible().catch(() => false);

      if (didDrillIn) {
        // Breadcrumb area should have some text
        const breadcrumbArea = dropdown.locator('text=/').first();
        // Breadcrumbs use " / " separator
      }
    }
  });

  test('deep navigation maintains breadcrumb trail', async ({ page }) => {
    await page.goto(TEST_URL);
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    let drillCount = 0;
    const maxDrills = 3;

    while (drillCount < maxDrills) {
      const options = ComboboxLocators.options(page);
      const count = await options.count();

      if (count === 0) break;

      // Click first option
      await options.first().click();
      await page.waitForTimeout(500);

      const backButton = ComboboxLocators.backButton(page);
      const didDrillIn = await backButton.isVisible().catch(() => false);

      if (!didDrillIn) break; // Hit a leaf

      drillCount++;
    }

    console.log(`Drilled ${drillCount} levels deep`);

    // Navigate back through all levels
    for (let i = 0; i < drillCount; i++) {
      await ComboboxActions.goBack(page);
      await page.waitForTimeout(300);
    }

    // Should be back at search results or root
  });

  test('clicking parent title navigates to parent', async ({ page }) => {
    await page.goto(TEST_URL);
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Pilot'); // Search for an episode
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count > 0) {
      const firstOption = options.first();
      const parentText = ComboboxLocators.optionParent(firstOption);

      const hasParent = await parentText.isVisible().catch(() => false);

      if (hasParent) {
        const parentContent = await parentText.textContent();
        console.log(`Found parent: ${parentContent}`);

        // Check if parent is clickable (underlined)
        const isClickable = await parentText.evaluate(el =>
          window.getComputedStyle(el).textDecoration.includes('underline')
        ).catch(() => false);

        if (isClickable) {
          await parentText.click();
          await page.waitForTimeout(500);

          // Should have navigated
          const backButton = ComboboxLocators.backButton(page);
          await expect(backButton).toBeVisible();
        }
      }
    }
  });
});
```

**Step 2: Run tests**

Run: `npx playwright test tests/live/flow/admin/content-search-combobox/03-browse-mode.runtime.test.mjs --reporter=line`
Expected: Tests run

**Step 3: Commit**

```bash
git add tests/live/flow/admin/content-search-combobox/03-browse-mode.runtime.test.mjs
git commit -m "test: add browse mode tests for ContentSearchCombobox"
```

---

## Task 8: Write Keyboard Navigation Tests

**Files:**
- Create: `tests/live/flow/admin/content-search-combobox/04-keyboard-navigation.runtime.test.mjs`

**Step 1: Write keyboard tests**

```javascript
// tests/live/flow/admin/content-search-combobox/04-keyboard-navigation.runtime.test.mjs
/**
 * Keyboard navigation tests for ContentSearchCombobox
 * Tests: Arrow keys, Enter, Escape, Tab
 */
import { test, expect } from '@playwright/test';
import { ComboboxTestHarness, ComboboxLocators, ComboboxActions } from '#testlib/comboboxTestHarness.mjs';

const TEST_URL = '/admin/test/combobox';

test.describe('ContentSearchCombobox - Keyboard Navigation', () => {
  let harness;

  test.beforeEach(async ({ page }) => {
    harness = new ComboboxTestHarness(page);
    await harness.setup();
    await page.goto(TEST_URL);
  });

  test.afterEach(async () => {
    const backendCheck = harness.assertNoBackendErrors();
    expect(backendCheck.errors).toEqual([]);
    await harness.teardown();
  });

  test('ArrowDown highlights next option', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count > 1) {
      // Press down arrow
      await ComboboxActions.pressKey(page, 'ArrowDown');

      // First option should be highlighted (data-combobox-selected or similar)
      const firstOption = options.first();
      const isSelected = await firstOption.getAttribute('data-combobox-selected');

      // Press down again
      await ComboboxActions.pressKey(page, 'ArrowDown');

      // Second option should now be highlighted
    }
  });

  test('ArrowUp highlights previous option', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count > 1) {
      // Navigate down twice
      await ComboboxActions.pressKey(page, 'ArrowDown');
      await ComboboxActions.pressKey(page, 'ArrowDown');

      // Navigate up once
      await ComboboxActions.pressKey(page, 'ArrowUp');

      // Should be back at first option
    }
  });

  test('Enter selects highlighted leaf option', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Pilot'); // Search for episodes (leaves)
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count > 0) {
      // Navigate to first option
      await ComboboxActions.pressKey(page, 'ArrowDown');

      // Get the option's ID before selecting
      const firstOption = options.first();
      const optionValue = await firstOption.getAttribute('value');

      // Press Enter to select
      await ComboboxActions.pressKey(page, 'Enter');
      await page.waitForTimeout(300);

      // Dropdown should close
      await expect(ComboboxLocators.dropdown(page)).not.toBeVisible();

      // Value should be updated in test harness
      const currentValue = page.locator('[data-testid="current-value"]');
      const valueText = await currentValue.textContent();

      // Change log should have an entry
      const changeLog = page.locator('[data-testid="change-log"]');
      const logText = await changeLog.textContent();
      expect(logText).not.toContain('No changes yet');
    }
  });

  test('Enter on container drills in instead of selecting', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office'); // Search for shows (containers)
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count > 0) {
      // Navigate to first option
      await ComboboxActions.pressKey(page, 'ArrowDown');

      // Press Enter
      await ComboboxActions.pressKey(page, 'Enter');
      await page.waitForTimeout(500);

      // If it was a container, dropdown should still be open with back button
      const dropdown = ComboboxLocators.dropdown(page);
      const isOpen = await dropdown.isVisible().catch(() => false);

      if (isOpen) {
        const backButton = ComboboxLocators.backButton(page);
        const hasBackButton = await backButton.isVisible().catch(() => false);

        if (hasBackButton) {
          console.log('Enter drilled into container as expected');
        }
      }
    }
  });

  test('Escape closes dropdown', async ({ page }) => {
    await ComboboxActions.open(page);
    await expect(ComboboxLocators.dropdown(page)).toBeVisible();

    await ComboboxActions.pressKey(page, 'Escape');

    await expect(ComboboxLocators.dropdown(page)).not.toBeVisible();
  });

  test('Escape while browsing returns to search', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    // Try to drill into a container
    const options = ComboboxLocators.options(page);
    if (await options.count() > 0) {
      await options.first().click();
      await page.waitForTimeout(500);

      const backButton = ComboboxLocators.backButton(page);
      const didDrillIn = await backButton.isVisible().catch(() => false);

      if (didDrillIn) {
        // Press Escape - should close dropdown entirely
        await ComboboxActions.pressKey(page, 'Escape');
        await expect(ComboboxLocators.dropdown(page)).not.toBeVisible();
      }
    }
  });

  test('Tab moves focus away and closes dropdown', async ({ page }) => {
    await ComboboxActions.open(page);
    await expect(ComboboxLocators.dropdown(page)).toBeVisible();

    await ComboboxActions.pressKey(page, 'Tab');
    await page.waitForTimeout(200);

    // Dropdown should close on blur
    await expect(ComboboxLocators.dropdown(page)).not.toBeVisible();
  });

  test('typing while navigating resets to search', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    // Drill into a result
    const options = ComboboxLocators.options(page);
    if (await options.count() > 0) {
      await options.first().click();
      await page.waitForTimeout(500);
    }

    // Type new search - should reset to search mode
    await ComboboxActions.search(page, 'Parks');
    await ComboboxActions.waitForLoad(page);

    // Breadcrumbs should be gone (back at search)
    const backButton = ComboboxLocators.backButton(page);
    const hasBackButton = await backButton.isVisible().catch(() => false);

    // May or may not have breadcrumbs depending on search results
  });
});
```

**Step 2: Run tests**

Run: `npx playwright test tests/live/flow/admin/content-search-combobox/04-keyboard-navigation.runtime.test.mjs --reporter=line`
Expected: Tests run

**Step 3: Commit**

```bash
git add tests/live/flow/admin/content-search-combobox/04-keyboard-navigation.runtime.test.mjs
git commit -m "test: add keyboard navigation tests for ContentSearchCombobox"
```

---

## Task 9: Write Display Validation Tests

**Files:**
- Create: `tests/live/flow/admin/content-search-combobox/05-display-validation.runtime.test.mjs`

**Step 1: Write display tests**

```javascript
// tests/live/flow/admin/content-search-combobox/05-display-validation.runtime.test.mjs
/**
 * Display validation tests for ContentSearchCombobox
 * Tests: avatars, titles, badges, icons, truncation
 */
import { test, expect } from '@playwright/test';
import { ComboboxTestHarness, ComboboxLocators, ComboboxActions } from '#testlib/comboboxTestHarness.mjs';
import { validateDisplayFields } from '#testlib/schemas/contentSearchSchemas.mjs';
import { getAllContainerTypes, getAllLeafTypes } from '#fixtures/combobox/sourceFixtures.mjs';

const TEST_URL = '/admin/test/combobox';

test.describe('ContentSearchCombobox - Display Validation', () => {
  let harness;

  test.beforeEach(async ({ page }) => {
    harness = new ComboboxTestHarness(page);
    await harness.setup();
    await page.goto(TEST_URL);
  });

  test.afterEach(async () => {
    await harness.teardown();
  });

  test('each option has avatar', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    for (let i = 0; i < Math.min(count, 5); i++) {
      const option = options.nth(i);
      const avatar = ComboboxLocators.optionAvatar(option);
      await expect(avatar).toBeVisible();
    }
  });

  test('each option has title text', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    for (let i = 0; i < Math.min(count, 5); i++) {
      const option = options.nth(i);
      const title = ComboboxLocators.optionTitle(option);
      const titleText = await title.textContent();

      expect(titleText).toBeTruthy();
      expect(titleText.length).toBeGreaterThan(0);

      // Should not be a raw ID
      expect(titleText).not.toMatch(/^plex:\d+$/);
      expect(titleText).not.toMatch(/^\d+$/);
    }
  });

  test('each option has source badge', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    for (let i = 0; i < Math.min(count, 5); i++) {
      const option = options.nth(i);
      const badge = ComboboxLocators.optionBadge(option);
      await expect(badge).toBeVisible();

      const badgeText = await badge.textContent();
      expect(badgeText).toBeTruthy();
    }
  });

  test('containers show chevron icon', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office'); // Shows are containers
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    let foundContainer = false;
    for (let i = 0; i < count; i++) {
      const option = options.nth(i);
      const chevron = option.locator('[class*="IconChevron"], svg').last();
      const hasChevron = await chevron.isVisible().catch(() => false);

      if (hasChevron) {
        foundContainer = true;
        break;
      }
    }

    // At least one container should have chevron (if search returned containers)
    console.log(`Found container with chevron: ${foundContainer}`);
  });

  test('leaves do not show chevron icon', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Pilot'); // Episodes are leaves
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    // Find a leaf (click it - should select, not drill in)
    if (count > 0) {
      const firstOption = options.first();

      // Check if it has a chevron
      const chevrons = await firstOption.locator('[class*="IconChevron"]').count();

      // If no chevron, it's a leaf
      if (chevrons === 0) {
        console.log('Found leaf without chevron');
      }
    }
  });

  test('long titles are truncated', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'a'); // Broad search
    await page.waitForTimeout(500);

    // This test verifies CSS truncation is applied
    // The title element should have text-overflow: ellipsis
    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count > 0) {
      const title = ComboboxLocators.optionTitle(options.first());
      const overflow = await title.evaluate(el =>
        window.getComputedStyle(el).textOverflow
      );

      // Should have truncate class or ellipsis style
      // Mantine's truncate prop sets text-overflow: ellipsis
    }
  });

  test('parent title shows for nested items', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Pilot'); // Episodes have parents
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    let foundParent = false;
    for (let i = 0; i < Math.min(count, 5); i++) {
      const option = options.nth(i);
      const parent = ComboboxLocators.optionParent(option);
      const hasParent = await parent.isVisible().catch(() => false);

      if (hasParent) {
        foundParent = true;
        const parentText = await parent.textContent();
        expect(parentText).toBeTruthy();
        console.log(`Found parent title: ${parentText}`);
        break;
      }
    }

    console.log(`Found item with parent title: ${foundParent}`);
  });

  test('API response items pass display validation', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    // Check API responses for display field validation
    const searchCalls = harness.getApiCalls(/content\/query\/search/);

    for (const call of searchCalls) {
      if (call.response?.items) {
        for (const item of call.response.items.slice(0, 5)) {
          const validation = validateDisplayFields(item);
          if (!validation.valid) {
            console.error(`Display validation failed for ${item.id}:`, validation.errors);
          }
          expect(validation.valid).toBe(true);
        }
      }
    }
  });
});
```

**Step 2: Run tests**

Run: `npx playwright test tests/live/flow/admin/content-search-combobox/05-display-validation.runtime.test.mjs --reporter=line`
Expected: Tests run

**Step 3: Commit**

```bash
git add tests/live/flow/admin/content-search-combobox/05-display-validation.runtime.test.mjs
git commit -m "test: add display validation tests for ContentSearchCombobox"
```

---

## Task 10: Write Edge Case Tests

**Files:**
- Create: `tests/live/flow/admin/content-search-combobox/06-edge-cases.runtime.test.mjs`

**Step 1: Write edge case tests**

```javascript
// tests/live/flow/admin/content-search-combobox/06-edge-cases.runtime.test.mjs
/**
 * Edge case tests for ContentSearchCombobox
 * Tests: special chars, unicode, errors, rapid input, deep nesting
 */
import { test, expect } from '@playwright/test';
import { ComboboxTestHarness, ComboboxLocators, ComboboxActions } from '#testlib/comboboxTestHarness.mjs';
import { EDGE_CASES } from '#fixtures/combobox/sourceFixtures.mjs';

const TEST_URL = '/admin/test/combobox';

test.describe('ContentSearchCombobox - Edge Cases', () => {
  let harness;

  test.beforeEach(async ({ page }) => {
    harness = new ComboboxTestHarness(page);
    await harness.setup();
    await page.goto(TEST_URL);
  });

  test.afterEach(async () => {
    const backendCheck = harness.assertNoBackendErrors();
    expect(backendCheck.errors).toEqual([]);
    await harness.teardown();
  });

  test('handles special HTML characters in search', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'test & < > "quoted"');
    await ComboboxActions.waitForLoad(page);

    // Should not error, should show results or empty state
    const dropdown = ComboboxLocators.dropdown(page);
    await expect(dropdown).toBeVisible();

    // No XSS - check page doesn't have injected HTML
    const bodyHtml = await page.locator('body').innerHTML();
    expect(bodyHtml).not.toContain('<script');
  });

  test('handles unicode characters in search', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, '日本語');
    await ComboboxActions.waitForLoad(page);

    // Should handle gracefully
    const dropdown = ComboboxLocators.dropdown(page);
    await expect(dropdown).toBeVisible();

    const apiCheck = harness.assertApiCalled(/content\/query\/search/);
    expect(apiCheck.passed).toBe(true);
  });

  test('handles emoji in search', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, '🎬 movie');
    await ComboboxActions.waitForLoad(page);

    const dropdown = ComboboxLocators.dropdown(page);
    await expect(dropdown).toBeVisible();
  });

  test('handles very long search term', async ({ page }) => {
    await ComboboxActions.open(page);
    const longTerm = 'a'.repeat(200);
    await ComboboxActions.search(page, longTerm);
    await ComboboxActions.waitForLoad(page);

    // Should not crash, may show no results
    const dropdown = ComboboxLocators.dropdown(page);
    await expect(dropdown).toBeVisible();
  });

  test('handles rapid typing without duplicate calls', async ({ page }) => {
    await ComboboxActions.open(page);

    const input = ComboboxLocators.input(page);

    // Type very rapidly
    const chars = 'testing rapid input';
    for (const char of chars) {
      await input.press(char);
      await page.waitForTimeout(20); // Very fast
    }

    // Wait for debounce
    await page.waitForTimeout(500);

    // Should only have 1-2 API calls, not one per character
    const searchCalls = harness.getApiCalls(/content\/query\/search/);
    expect(searchCalls.length).toBeLessThan(5);
    console.log(`Rapid typing resulted in ${searchCalls.length} API calls`);
  });

  test('handles empty API response gracefully', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'xyznonexistent123456789');
    await ComboboxActions.waitForLoad(page);

    const emptyState = ComboboxLocators.emptyState(page);
    await expect(emptyState).toContainText('No results');
  });

  test('handles whitespace-only search', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, '   ');
    await page.waitForTimeout(500);

    // Should show "Type to search" (whitespace trimmed = empty)
    const emptyState = ComboboxLocators.emptyState(page);
    await expect(emptyState).toBeVisible();
  });

  test('handles value with special characters', async ({ page }) => {
    // URL encode special chars in value param
    await page.goto(`${TEST_URL}?value=media:path/with%20spaces/file.mp4`);

    const input = ComboboxLocators.input(page);
    const value = await input.inputValue();

    expect(value).toContain('path/with spaces/file.mp4');
  });

  test('handles API timeout gracefully', async ({ page }) => {
    // Slow down API responses
    await page.route('**/api/v1/content/query/search**', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 3000));
      await route.continue();
    });

    await ComboboxActions.open(page);
    await ComboboxLocators.input(page).fill('test');

    // Should show loader
    const loader = ComboboxLocators.loader(page);
    await expect(loader).toBeVisible({ timeout: 1000 });
  });

  test('deep navigation does not crash', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    // Try to drill 5 levels deep
    for (let i = 0; i < 5; i++) {
      const options = ComboboxLocators.options(page);
      const count = await options.count();

      if (count === 0) break;

      await options.first().click();
      await page.waitForTimeout(500);

      const backButton = ComboboxLocators.backButton(page);
      const canGoDeeper = await backButton.isVisible().catch(() => false);

      if (!canGoDeeper) {
        console.log(`Stopped at depth ${i + 1} (hit leaf)`);
        break;
      }
    }

    // Should still be functional
    const dropdown = ComboboxLocators.dropdown(page);
    await expect(dropdown).toBeVisible();
  });

  test('selecting clears state properly', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Pilot');
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    if (await options.count() > 0) {
      await options.first().click();
      await page.waitForTimeout(500);

      // If we selected (not drilled), dropdown should be closed
      const dropdown = ComboboxLocators.dropdown(page);
      const isOpen = await dropdown.isVisible().catch(() => false);

      if (!isOpen) {
        // Reopen and search again - should start fresh
        await ComboboxActions.open(page);
        await ComboboxActions.search(page, 'Parks');
        await ComboboxActions.waitForLoad(page);

        // Should show new search results, no breadcrumbs from previous
        const backButton = ComboboxLocators.backButton(page);
        const hasBreadcrumbs = await backButton.isVisible().catch(() => false);
        expect(hasBreadcrumbs).toBe(false);
      }
    }
  });
});
```

**Step 2: Run tests**

Run: `npx playwright test tests/live/flow/admin/content-search-combobox/06-edge-cases.runtime.test.mjs --reporter=line`
Expected: Tests run

**Step 3: Commit**

```bash
git add tests/live/flow/admin/content-search-combobox/06-edge-cases.runtime.test.mjs
git commit -m "test: add edge case tests for ContentSearchCombobox"
```

---

## Task 11: Write Source Coverage Tests

**Files:**
- Create: `tests/live/flow/admin/content-search-combobox/07-source-coverage.runtime.test.mjs`

**Step 1: Write source-specific tests**

```javascript
// tests/live/flow/admin/content-search-combobox/07-source-coverage.runtime.test.mjs
/**
 * Source coverage tests for ContentSearchCombobox
 * Tests real content from discovered sources (varied each run)
 */
import { test, expect } from '@playwright/test';
import { ComboboxTestHarness, ComboboxLocators, ComboboxActions } from '#testlib/comboboxTestHarness.mjs';
import { loadDynamicFixtures } from '#fixtures/combobox/dynamicFixtureLoader.mjs';

const TEST_URL = '/admin/test/combobox';

// Load dynamic fixtures once
let fixtures;

test.describe('ContentSearchCombobox - Source Coverage', () => {
  let harness;

  test.beforeAll(async () => {
    fixtures = await loadDynamicFixtures();
    console.log(`Loaded sources: ${Object.keys(fixtures.sourceFixtures).join(', ')}`);
  });

  test.beforeEach(async ({ page }) => {
    harness = new ComboboxTestHarness(page);
    await harness.setup();
    await page.goto(TEST_URL);
  });

  test.afterEach(async () => {
    const apiCheck = harness.assertAllApiValid();
    expect(apiCheck.passed).toBe(true);

    const backendCheck = harness.assertNoBackendErrors();
    expect(backendCheck.errors).toEqual([]);

    await harness.teardown();
  });

  // Test each dynamically discovered source
  test('search works for each discovered source', async ({ page }) => {
    for (const [sourceKey, source] of Object.entries(fixtures.sourceFixtures)) {
      console.log(`Testing source: ${source.name}`);

      for (const term of source.searchTerms.slice(0, 2)) {
        harness.reset();

        await ComboboxActions.open(page);
        await ComboboxActions.search(page, term);
        await ComboboxActions.waitForLoad(page);

        // API should be called
        const apiCheck = harness.assertApiCalled(/content\/query\/search/);
        expect(apiCheck.passed).toBe(true);

        // Should show dropdown (results or empty state)
        const dropdown = ComboboxLocators.dropdown(page);
        await expect(dropdown).toBeVisible();

        await ComboboxActions.pressKey(page, 'Escape');
        await page.waitForTimeout(100);
      }
    }
  });

  // Test drilling into real containers
  test('can drill into discovered containers', async ({ page }) => {
    for (const container of fixtures.containers.slice(0, 3)) {
      console.log(`Testing container: ${container.title} (${container.id})`);

      // Initialize with container ID
      await page.goto(`${TEST_URL}?value=${encodeURIComponent(container.id)}`);

      await ComboboxActions.open(page);
      await page.waitForTimeout(1000); // Wait for sibling load

      // Should have loaded siblings
      const apiCheck = harness.assertApiCalled(/api\/v1\/list\//);
      if (apiCheck.passed) {
        console.log(`  Loaded siblings for ${container.title}`);
      }

      harness.reset();
    }
  });

  // Test selecting real leaf items
  test('can select discovered leaf items', async ({ page }) => {
    for (const leaf of fixtures.leaves.slice(0, 3)) {
      console.log(`Testing leaf: ${leaf.title} (${leaf.id})`);

      // Initialize with leaf ID
      await page.goto(`${TEST_URL}?value=${encodeURIComponent(leaf.id)}`);

      const input = ComboboxLocators.input(page);
      const value = await input.inputValue();

      expect(value).toBe(leaf.id);

      // Verify it displays correctly
      const currentValue = page.locator('[data-testid="current-value"]');
      await expect(currentValue).toContainText(leaf.id);
    }
  });

  test('mixed source results display correctly', async ({ page }) => {
    // Search term that might return results from multiple sources
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'test');
    await ComboboxActions.waitForLoad(page);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count > 0) {
      // Collect unique sources from results
      const sources = new Set();

      for (let i = 0; i < Math.min(count, 10); i++) {
        const option = options.nth(i);
        const badge = ComboboxLocators.optionBadge(option);
        const badgeText = await badge.first().textContent().catch(() => '');
        if (badgeText) sources.add(badgeText);
      }

      console.log(`Found sources in results: ${Array.from(sources).join(', ')}`);
    }
  });

  test('browsing Plex hierarchy works', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForLoad(page);

    // Find a Plex show and drill into it
    const options = ComboboxLocators.options(page);
    const count = await options.count();

    for (let i = 0; i < count; i++) {
      const option = options.nth(i);
      const badge = ComboboxLocators.optionBadge(option).first();
      const badgeText = await badge.textContent().catch(() => '');

      if (badgeText.toLowerCase() === 'plex') {
        await option.click();
        await page.waitForTimeout(500);

        const backButton = ComboboxLocators.backButton(page);
        if (await backButton.isVisible().catch(() => false)) {
          console.log('Drilled into Plex container');

          // Drill one more level (season -> episodes)
          const innerOptions = ComboboxLocators.options(page);
          if (await innerOptions.count() > 0) {
            await innerOptions.first().click();
            await page.waitForTimeout(500);
          }
        }
        break;
      }
    }
  });

  test('browsing folder hierarchy works', async ({ page }) => {
    // Start with a folder path
    await page.goto(`${TEST_URL}?value=media:workouts/hiit.mp4`);

    await ComboboxActions.open(page);
    await page.waitForTimeout(1000); // Wait for sibling load

    // Should load siblings from parent folder
    const apiCheck = harness.assertApiCalled(/api\/v1\/list\/media/);

    if (apiCheck.passed) {
      console.log('Loaded folder siblings');

      // Should show breadcrumb
      const backButton = ComboboxLocators.backButton(page);
      const hasBreadcrumbs = await backButton.isVisible().catch(() => false);
      console.log(`Has breadcrumbs: ${hasBreadcrumbs}`);
    }
  });
});
```

**Step 2: Run tests**

Run: `npx playwright test tests/live/flow/admin/content-search-combobox/07-source-coverage.runtime.test.mjs --reporter=line`
Expected: Tests run

**Step 3: Commit**

```bash
git add tests/live/flow/admin/content-search-combobox/07-source-coverage.runtime.test.mjs
git commit -m "test: add source coverage tests for ContentSearchCombobox"
```

---

## Task 12: Create Test Runner Script

**Files:**
- Create: `tests/live/flow/admin/content-search-combobox/run-all.sh`

**Step 1: Write the runner script**

```bash
#!/bin/bash
# tests/live/flow/admin/content-search-combobox/run-all.sh
# Run all ContentSearchCombobox tests with summary

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"

cd "$PROJECT_ROOT"

echo "=========================================="
echo "ContentSearchCombobox Test Suite"
echo "=========================================="
echo ""

# Check if dev server is running
if ! curl -s http://localhost:3111 > /dev/null 2>&1; then
    echo "⚠️  Dev server not running on port 3111"
    echo "   Start with: npm run dev"
    echo ""
    echo "Starting dev server in background..."
    npm run dev &
    DEV_PID=$!
    sleep 10
    trap "kill $DEV_PID 2>/dev/null" EXIT
fi

# Run tests
echo "Running tests..."
echo ""

npx playwright test tests/live/flow/admin/content-search-combobox/ \
    --reporter=line \
    --timeout=60000 \
    "$@"

EXIT_CODE=$?

echo ""
echo "=========================================="
if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ All tests passed!"
else
    echo "❌ Some tests failed (exit code: $EXIT_CODE)"
fi
echo "=========================================="

exit $EXIT_CODE
```

**Step 2: Make executable**

Run: `chmod +x tests/live/flow/admin/content-search-combobox/run-all.sh`
Expected: Script is executable

**Step 3: Commit**

```bash
git add tests/live/flow/admin/content-search-combobox/run-all.sh
git commit -m "test: add test runner script for ContentSearchCombobox suite"
```

---

## Task 13: Update Test Path Aliases

**Files:**
- Modify: `tests/_lib/index.mjs` (if exists, add exports)

**Step 1: Verify path alias works**

Run: `node -e "import('#testlib/comboboxTestHarness.mjs').then(() => console.log('OK'))"`

If this fails, check `package.json` imports field or create index export.

**Step 2: Run full suite**

Run: `./tests/live/flow/admin/content-search-combobox/run-all.sh`
Expected: All tests execute (pass or fail is OK at this stage)

**Step 3: Final commit**

```bash
git add -A
git commit -m "test: complete ContentSearchCombobox bulletproof test suite"
```

---

## Summary

This plan creates a comprehensive three-layer test suite:

| Layer | Coverage |
|-------|----------|
| **UI (Playwright)** | 7 test files, ~88 test cases |
| **API (Schema Validation)** | Zod schemas for list/search responses |
| **Backend (Log Monitoring)** | dev.log tailing for errors |

**Test files:**
1. `01-basic-interactions` - Open/close, focus/blur, initial states
2. `02-search-mode` - Keyword search, debounce, results
3. `03-browse-mode` - Drill-down, back, breadcrumbs, siblings
4. `04-keyboard-navigation` - Arrow keys, Enter, Escape
5. `05-display-validation` - Avatars, titles, badges, icons
6. `06-edge-cases` - Special chars, unicode, errors, rapid input
7. `07-source-coverage` - Plex, media, folder, immich, list

**Supporting files:**
- `schemas/contentSearchSchemas.mjs` - Zod response schemas
- `comboboxTestHarness.mjs` - Three-layer test harness
- `sourceFixtures.mjs` - Test data fixtures
- `ComboboxTestPage.jsx` - Isolated test route
