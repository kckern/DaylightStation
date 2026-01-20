#!/usr/bin/env node
// tests/integration/api/_utils/captureBaselines.mjs
/**
 * Baseline capture script.
 *
 * Captures responses from legacy API endpoints and saves to _baselines/.
 * Run before retiring legacy endpoints to create golden baseline data.
 *
 * Usage:
 *   npm run test:capture-baselines              # Capture from legacy endpoints
 *   npm run test:capture-baselines -- --verify  # Verify new endpoints match
 *   npm run test:capture-baselines -- --new     # Capture from new endpoints only
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CAPTURE_MANIFEST, getAllManifestEntries, getCategories } from './CAPTURE_MANIFEST.mjs';
import { checkPlexHealth } from './plexHealthCheck.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINES_DIR = path.resolve(__dirname, '../_baselines');

// Parse command line args
const args = process.argv.slice(2);
const VERIFY_MODE = args.includes('--verify');
const NEW_ONLY = args.includes('--new');
const OVERWRITE = args.includes('--overwrite');
const CATEGORY_FILTER = args.find(a => a.startsWith('--category='))?.split('=')[1];

// Dev server URL (assumes running)
const DEV_SERVER = process.env.DEV_SERVER_URL || 'http://localhost:3112';

/**
 * Fetch JSON from endpoint with timeout.
 */
async function fetchEndpoint(urlPath, options = {}) {
  const { timeout = 10000 } = options;
  const url = `${DEV_SERVER}${urlPath}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        error: `HTTP ${response.status}`
      };
    }

    const data = await response.json();
    return { success: true, data, status: response.status };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return { success: false, error: 'Timeout' };
    }
    return { success: false, error: err.message };
  }
}

/**
 * Save baseline to file.
 */
async function saveBaseline(category, name, data, source) {
  const dir = path.join(BASELINES_DIR, category);
  await fs.promises.mkdir(dir, { recursive: true });

  const filePath = path.join(dir, `${name}.json`);

  const baseline = {
    ...data,
    _meta: {
      captured: new Date().toISOString(),
      source: source,
      category: category
    }
  };

  await fs.promises.writeFile(filePath, JSON.stringify(baseline, null, 2));
  return filePath;
}

/**
 * Load existing baseline.
 */
async function loadBaseline(category, name) {
  const filePath = path.join(BASELINES_DIR, category, `${name}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = await fs.promises.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Compare two objects for equivalence (ignoring _meta fields).
 */
function compareResponses(baseline, current) {
  // Remove meta fields for comparison
  const cleanBaseline = { ...baseline };
  const cleanCurrent = { ...current };
  delete cleanBaseline._meta;
  delete cleanBaseline._captured;
  delete cleanBaseline._source;
  delete cleanCurrent._meta;
  delete cleanCurrent._captured;
  delete cleanCurrent._source;

  // Simple deep comparison
  const baselineStr = JSON.stringify(cleanBaseline, Object.keys(cleanBaseline).sort());
  const currentStr = JSON.stringify(cleanCurrent, Object.keys(cleanCurrent).sort());

  return baselineStr === currentStr;
}

/**
 * Main capture function.
 */
async function captureBaselines() {
  console.log('\n========================================');
  console.log('  BASELINE CAPTURE');
  console.log('========================================\n');

  console.log(`Mode: ${VERIFY_MODE ? 'VERIFY' : NEW_ONLY ? 'NEW ENDPOINTS' : 'LEGACY CAPTURE'}`);
  console.log(`Server: ${DEV_SERVER}`);
  console.log(`Output: ${BASELINES_DIR}`);
  if (CATEGORY_FILTER) {
    console.log(`Category: ${CATEGORY_FILTER}`);
  }
  console.log('');

  // Check dev server is running
  console.log('Checking dev server...');
  const healthCheck = await fetchEndpoint('/api/ping');
  if (!healthCheck.success) {
    console.error('\nERROR: Dev server not running!');
    console.error(`Expected server at: ${DEV_SERVER}`);
    console.error('Start with: npm run dev\n');
    process.exit(1);
  }
  console.log('  Dev server OK\n');

  // Check Plex if we need it
  const categories = CATEGORY_FILTER ? [CATEGORY_FILTER] : getCategories();
  const needsPlex = categories.includes('plex');

  if (needsPlex) {
    console.log('Checking Plex connectivity...');
    const plexHealth = await checkPlexHealth();
    if (!plexHealth.online) {
      console.warn(`  WARNING: Plex offline - skipping plex category`);
      console.warn(`  Error: ${plexHealth.error}\n`);
      const plexIndex = categories.indexOf('plex');
      if (plexIndex > -1) {
        categories.splice(plexIndex, 1);
      }
    } else {
      console.log('  Plex OK\n');
    }
  }

  // Ensure baselines directory exists
  await fs.promises.mkdir(BASELINES_DIR, { recursive: true });

  // Process each category
  const results = {
    captured: 0,
    skipped: 0,
    failed: 0,
    verified: 0,
    mismatched: 0
  };

  for (const category of categories) {
    const entries = CAPTURE_MANIFEST[category] || [];
    console.log(`\n--- ${category.toUpperCase()} (${entries.length} endpoints) ---\n`);

    for (const entry of entries) {
      const endpoint = NEW_ONLY || VERIFY_MODE ? entry.new : entry.legacy;
      const label = `${entry.name}`;

      // Check if baseline exists
      const existingBaseline = await loadBaseline(category, entry.name);

      if (VERIFY_MODE) {
        // Verify mode: compare new endpoint against existing baseline
        if (!existingBaseline) {
          console.log(`  SKIP ${label} - no baseline to verify against`);
          results.skipped++;
          continue;
        }

        const result = await fetchEndpoint(entry.new);
        if (!result.success) {
          console.log(`  FAIL ${label} - ${result.error}`);
          results.failed++;
          continue;
        }

        const matches = compareResponses(existingBaseline, result.data);
        if (matches) {
          console.log(`  OK   ${label} - matches baseline`);
          results.verified++;
        } else {
          console.log(`  DIFF ${label} - response differs from baseline`);
          results.mismatched++;
        }
      } else {
        // Capture mode
        if (existingBaseline && !OVERWRITE) {
          console.log(`  SKIP ${label} - baseline exists (use --overwrite)`);
          results.skipped++;
          continue;
        }

        const result = await fetchEndpoint(endpoint);
        if (!result.success) {
          console.log(`  FAIL ${label} - ${result.error}`);
          results.failed++;
          continue;
        }

        const source = NEW_ONLY ? entry.new : entry.legacy;
        const filePath = await saveBaseline(category, entry.name, result.data, source);
        console.log(`  OK   ${label}`);
        results.captured++;
      }
    }
  }

  // Summary
  console.log('\n========================================');
  console.log('  SUMMARY');
  console.log('========================================\n');

  if (VERIFY_MODE) {
    console.log(`Verified: ${results.verified}`);
    console.log(`Mismatched: ${results.mismatched}`);
    console.log(`Skipped: ${results.skipped}`);
    console.log(`Failed: ${results.failed}`);

    if (results.mismatched > 0) {
      console.log('\nWARNING: Some responses differ from baselines!');
      console.log('Run with --overwrite to update baselines if changes are expected.\n');
      process.exit(1);
    }
  } else {
    console.log(`Captured: ${results.captured}`);
    console.log(`Skipped: ${results.skipped}`);
    console.log(`Failed: ${results.failed}`);
  }

  console.log(`\nBaselines saved to: ${BASELINES_DIR}\n`);

  if (results.failed > 0) {
    process.exit(1);
  }
}

// Run
captureBaselines().catch(err => {
  console.error('\nFATAL ERROR:', err.message);
  process.exit(1);
});
