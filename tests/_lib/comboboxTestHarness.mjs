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
