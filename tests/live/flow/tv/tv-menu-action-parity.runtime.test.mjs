/**
 * TV Menu Action Parity Test
 *
 * Validates dev API returns same action structure as production.
 * Tests that action field from YAML determines output property.
 */
import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;

// Test cases: label, expected action property, expected keys in action object
const TEST_CASES = [
  // Queue actions (action: Queue in YAML)
  { label: 'Sunday', expectedAction: 'queue', expectedKeys: ['plex', 'shuffle'] },
  { label: 'Music', expectedAction: 'queue', expectedKeys: ['queue', 'shuffle'] },
  { label: 'Holy Moly', expectedAction: 'queue', expectedKeys: ['plex', 'shuffle', 'continuous'] },

  // List actions (action: List in YAML)
  { label: 'Chosen', expectedAction: 'list', expectedKeys: ['plex'] },
  { label: 'FHE', expectedAction: 'list', expectedKeys: ['list'] },
  { label: 'Science', expectedAction: 'list', expectedKeys: ['plex'] },

  // Play actions (action: Play or no action in YAML)
  { label: 'General Conference', expectedAction: 'play', expectedKeys: ['talk'] },
  { label: 'Scripture', expectedAction: 'play', expectedKeys: ['scripture'] },
  { label: 'Primary', expectedAction: 'play', expectedKeys: ['primary'] },
];

test.describe('TV Menu Action Parity', () => {

  test('API returns correct action types for all test cases', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/v1/info/watchlist/TVApp`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    const items = data.items || [];

    const results = [];

    for (const testCase of TEST_CASES) {
      const item = items.find(i => i.label === testCase.label);

      if (!item) {
        console.log(`[SKIP] ${testCase.label} not found in menu`);
        continue;
      }

      const actionValue = item[testCase.expectedAction];
      const hasCorrectAction = !!actionValue;

      // Check all expected keys exist
      const missingKeys = testCase.expectedKeys.filter(k => !actionValue?.[k]);
      const hasAllKeys = missingKeys.length === 0;

      // Check action is NOT incorrectly on play (for non-play items)
      const wronglyOnPlay = testCase.expectedAction !== 'play' &&
        !!item.play && Object.keys(item.play).some(k => testCase.expectedKeys.includes(k));

      results.push({
        label: testCase.label,
        expected: testCase.expectedAction,
        hasCorrectAction,
        hasAllKeys,
        wronglyOnPlay,
        actual: actionValue,
        playValue: item.play
      });

      console.log(`[${hasCorrectAction && hasAllKeys && !wronglyOnPlay ? 'PASS' : 'FAIL'}] ${testCase.label}:`);
      console.log(`  Expected: ${testCase.expectedAction}: { ${testCase.expectedKeys.join(', ')} }`);
      console.log(`  Actual ${testCase.expectedAction}:`, JSON.stringify(actionValue));
      if (wronglyOnPlay) {
        console.log(`  WARNING: Found on play instead:`, JSON.stringify(item.play));
      }
    }

    // Assert all passed
    for (const result of results) {
      expect(result.hasCorrectAction,
        `${result.label} should have ${result.expected} action`).toBe(true);
      expect(result.hasAllKeys,
        `${result.label} ${result.expected} should have all expected keys`).toBe(true);
      expect(result.wronglyOnPlay,
        `${result.label} should NOT have action on play property`).toBe(false);
    }
  });

  test('Queue items include shuffle option when specified', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/v1/info/watchlist/TVApp`);
    const data = await response.json();

    // Sunday has shuffle: true in YAML
    const sunday = data.items?.find(i => i.label === 'Sunday');
    if (sunday) {
      expect(sunday.queue).toBeTruthy();
      expect(sunday.queue.shuffle).toBe(true);
      console.log('[PASS] Sunday queue includes shuffle option');
    }

    // Music has shuffle: true in YAML
    const music = data.items?.find(i => i.label === 'Music');
    if (music) {
      expect(music.queue).toBeTruthy();
      expect(music.queue.shuffle).toBe(true);
      console.log('[PASS] Music queue includes shuffle option');
    }
  });

  test('Queue items include continuous option when specified', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/v1/info/watchlist/TVApp`);
    const data = await response.json();

    // Holy Moly has continuous: true in YAML
    const holyMoly = data.items?.find(i => i.label === 'Holy Moly');
    if (holyMoly) {
      expect(holyMoly.queue).toBeTruthy();
      expect(holyMoly.queue.continuous).toBe(true);
      console.log('[PASS] Holy Moly queue includes continuous option');
    }
  });

  test('List items use list key not watchlist key', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/v1/info/watchlist/TVApp`);
    const data = await response.json();

    // FHE should be list: { list: "FHE" } not list: { watchlist: "FHE" }
    const fhe = data.items?.find(i => i.label === 'FHE');
    if (fhe) {
      expect(fhe.list).toBeTruthy();
      expect(fhe.list.list).toBe('FHE');
      expect(fhe.list.watchlist).toBeUndefined();
      console.log('[PASS] FHE uses list: { list: "FHE" }');
    }
  });

});
