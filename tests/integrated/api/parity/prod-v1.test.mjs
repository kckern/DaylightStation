// tests/integration/suite/api/_wip/prod-v1-parity.test.mjs
/**
 * Production vs Local v1 API Parity Tests
 *
 * Compares live production API responses against local v1/DDD endpoints
 * to identify missing fields, type mismatches, and structural differences.
 *
 * This is a WIP/exploratory test - it reports differences but doesn't fail.
 *
 * Usage:
 *   # Ensure local server is running on port 3111
 *   NODE_OPTIONS=--experimental-vm-modules npx jest tests/integration/suite/api/_wip/prod-v1-parity.test.mjs
 */

import fetch from 'node-fetch';

// =============================================================================
// CONFIGURATION
// =============================================================================

const PROD_URL = process.env.PROD_URL || 'https://daylightlocal.kckern.net';
const LOCAL_URL = process.env.LOCAL_URL || 'http://localhost:3111';

// Fields to ignore in comparisons (volatile/timing-related)
const IGNORE_FIELDS = new Set([
  '_debug',
  '_meta',
  '_cached',
  '_source',
  'timestamp',
  'fetchedAt',
  'lastUpdated',
  'generatedAt',
  'capturedAt'
]);

// Endpoint pairs to compare
const ENDPOINT_PAIRS = [
  {
    name: 'Fitness Config',
    prod: '/api/fitness',
    v1: '/api/v1/fitness',
    description: 'Main fitness configuration with users, zones, equipment'
  },
  {
    name: 'Plex List - Fitness Shows Collection',
    prod: '/media/plex/list/671468',
    v1: '/api/v1/item/plex/671468',
    description: 'Collection listing with show items and ratings'
  },
  {
    name: 'Plex List - Speed Train Playable',
    prod: '/media/plex/list/662027/playable',
    v1: '/api/v1/item/plex/662027/playable',
    description: 'Playable episodes with watch progress and seasons'
  }
];

// =============================================================================
// FETCH HELPERS
// =============================================================================

async function fetchJSON(baseUrl, path, timeout = 15000) {
  const url = `${baseUrl}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return { ok: false, status: res.status, error: 'Not JSON response' };
    }

    const body = await res.json();
    return { ok: true, status: res.status, body };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return { ok: false, error: 'Timeout' };
    }
    return { ok: false, error: err.message };
  }
}

/**
 * Validate image URL returns valid image content
 */
async function validateImageUrl(baseUrl, imagePath, timeout = 10000) {
  if (!imagePath) return { valid: false, error: 'No image path' };

  const url = `${baseUrl}${imagePath}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      method: 'HEAD'
    });
    clearTimeout(timeoutId);

    const contentType = res.headers.get('content-type') || '';
    const isImage = contentType.startsWith('image/');
    const isSvgPlaceholder = contentType.includes('svg');
    const isValidImage = isImage && !isSvgPlaceholder && res.status === 200;

    return {
      valid: isValidImage,
      contentType,
      status: res.status,
      error: !isValidImage ? `Invalid image: ${contentType} (${res.status})` : undefined
    };
  } catch (err) {
    clearTimeout(timeoutId);
    return { valid: false, error: err.message, status: 0, contentType: '' };
  }
}

// =============================================================================
// COMPARISON LOGIC
// =============================================================================

function getType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function shouldIgnore(key, path) {
  if (IGNORE_FIELDS.has(key)) return true;
  // Also ignore if path ends with an ignored field
  const lastPart = path.split('.').pop();
  return IGNORE_FIELDS.has(lastPart);
}

/**
 * Deep compare two objects, collecting differences
 */
function findDifferences(prod, v1, path = '') {
  const diffs = {
    missingInV1: [],      // Fields in prod but not in v1
    extraInV1: [],        // Fields in v1 but not in prod
    typeMismatches: [],   // Same key, different type
    valueDiffs: [],       // Same key, different value (for primitives)
    arrayLengthDiffs: []  // Arrays with different lengths
  };

  function compare(prodVal, v1Val, currentPath) {
    const key = currentPath.split('.').pop();
    if (shouldIgnore(key, currentPath)) return;

    const prodType = getType(prodVal);
    const v1Type = getType(v1Val);

    // Both undefined/null - no diff
    if (prodVal === undefined && v1Val === undefined) return;
    if (prodVal === null && v1Val === null) return;

    // Missing in v1
    if (prodVal !== undefined && v1Val === undefined) {
      diffs.missingInV1.push({ path: currentPath, prodType, prodValue: summarizeValue(prodVal) });
      return;
    }

    // Extra in v1
    if (prodVal === undefined && v1Val !== undefined) {
      diffs.extraInV1.push({ path: currentPath, v1Type, v1Value: summarizeValue(v1Val) });
      return;
    }

    // Type mismatch
    if (prodType !== v1Type) {
      diffs.typeMismatches.push({ path: currentPath, prodType, v1Type });
      return;
    }

    // Arrays
    if (prodType === 'array') {
      if (prodVal.length !== v1Val.length) {
        diffs.arrayLengthDiffs.push({ path: currentPath, prodLength: prodVal.length, v1Length: v1Val.length });
      }
      // Compare first few items to find structural differences
      const maxItems = Math.min(3, prodVal.length, v1Val.length);
      for (let i = 0; i < maxItems; i++) {
        compare(prodVal[i], v1Val[i], `${currentPath}[${i}]`);
      }
      return;
    }

    // Objects
    if (prodType === 'object') {
      const allKeys = new Set([...Object.keys(prodVal), ...Object.keys(v1Val)]);
      for (const k of allKeys) {
        if (shouldIgnore(k, currentPath ? `${currentPath}.${k}` : k)) continue;
        compare(prodVal[k], v1Val[k], currentPath ? `${currentPath}.${k}` : k);
      }
      return;
    }

    // Primitives - track value differences for important fields
    if (prodVal !== v1Val) {
      // Only track value diffs for id/key/type fields, not all values
      if (key === 'id' || key === 'type' || key === 'plex' || key === 'key' || key === 'itemType') {
        diffs.valueDiffs.push({ path: currentPath, prod: prodVal, v1: v1Val });
      }
    }
  }

  compare(prod, v1, path);
  return diffs;
}

function summarizeValue(val) {
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (Array.isArray(val)) return `array[${val.length}]`;
  if (typeof val === 'object') return `object{${Object.keys(val).slice(0, 5).join(', ')}${Object.keys(val).length > 5 ? '...' : ''}}`;
  if (typeof val === 'string' && val.length > 50) return `"${val.slice(0, 50)}..."`;
  return JSON.stringify(val);
}

function hasDifferences(diffs) {
  return (
    diffs.missingInV1.length > 0 ||
    diffs.extraInV1.length > 0 ||
    diffs.typeMismatches.length > 0 ||
    diffs.arrayLengthDiffs.length > 0
  );
}

function formatDiffReport(diffs, maxItems = 10) {
  const lines = [];

  if (diffs.missingInV1.length > 0) {
    lines.push(`\n  Missing in v1 (${diffs.missingInV1.length}):`);
    diffs.missingInV1.slice(0, maxItems).forEach(d => {
      lines.push(`    - ${d.path} (${d.prodType}): ${d.prodValue}`);
    });
    if (diffs.missingInV1.length > maxItems) {
      lines.push(`    ... and ${diffs.missingInV1.length - maxItems} more`);
    }
  }

  if (diffs.extraInV1.length > 0) {
    lines.push(`\n  Extra in v1 (${diffs.extraInV1.length}):`);
    diffs.extraInV1.slice(0, maxItems).forEach(d => {
      lines.push(`    + ${d.path} (${d.v1Type}): ${d.v1Value}`);
    });
    if (diffs.extraInV1.length > maxItems) {
      lines.push(`    ... and ${diffs.extraInV1.length - maxItems} more`);
    }
  }

  if (diffs.typeMismatches.length > 0) {
    lines.push(`\n  Type mismatches (${diffs.typeMismatches.length}):`);
    diffs.typeMismatches.slice(0, maxItems).forEach(d => {
      lines.push(`    ! ${d.path}: ${d.prodType} (prod) vs ${d.v1Type} (v1)`);
    });
  }

  if (diffs.arrayLengthDiffs.length > 0) {
    lines.push(`\n  Array length differences (${diffs.arrayLengthDiffs.length}):`);
    diffs.arrayLengthDiffs.slice(0, maxItems).forEach(d => {
      lines.push(`    ~ ${d.path}: ${d.prodLength} items (prod) vs ${d.v1Length} items (v1)`);
    });
  }

  if (diffs.valueDiffs.length > 0) {
    lines.push(`\n  Value differences (${diffs.valueDiffs.length}):`);
    diffs.valueDiffs.slice(0, maxItems).forEach(d => {
      lines.push(`    ? ${d.path}: ${summarizeValue(d.prod)} (prod) vs ${summarizeValue(d.v1)} (v1)`);
    });
  }

  return lines.join('\n');
}

// =============================================================================
// TESTS (Jest)
// =============================================================================

const isJest = typeof describe !== 'undefined';

if (isJest) {
describe('Production vs Local v1 API Parity', () => {
  // Check servers are reachable
  beforeAll(async () => {
    console.log(`\n  Prod URL: ${PROD_URL}`);
    console.log(`  Local URL: ${LOCAL_URL}\n`);

    // Check prod
    const prodPing = await fetchJSON(PROD_URL, '/api/ping');
    if (!prodPing.ok) {
      console.warn(`  WARNING: Prod server not reachable: ${prodPing.error}`);
    }

    // Check local
    const localPing = await fetchJSON(LOCAL_URL, '/api/ping');
    if (!localPing.ok) {
      throw new Error(`Local server not running at ${LOCAL_URL}. Start with: npm run dev`);
    }
  });

  describe.each(ENDPOINT_PAIRS)('$name', ({ name, prod, v1, description }) => {
    let prodRes, v1Res;

    beforeAll(async () => {
      [prodRes, v1Res] = await Promise.all([
        fetchJSON(PROD_URL, prod),
        fetchJSON(LOCAL_URL, v1)
      ]);
    });

    it('prod endpoint returns 200', () => {
      if (!prodRes.ok) {
        console.log(`  Prod ${prod}: ${prodRes.error}`);
      }
      expect(prodRes.ok).toBe(true);
    });

    it('v1 endpoint returns 200', () => {
      if (!v1Res.ok) {
        console.log(`  v1 ${v1}: ${v1Res.error}`);
      }
      expect(v1Res.ok).toBe(true);
    });

    it('responses have compatible structure', () => {
      if (!prodRes.ok || !v1Res.ok) {
        console.log('  Skipped - endpoints not both successful');
        return;
      }

      const diffs = findDifferences(prodRes.body, v1Res.body);

      // Always log the report for visibility
      if (hasDifferences(diffs)) {
        console.log(`\n  === PARITY REPORT: ${name} ===`);
        console.log(`  Prod: ${prod}`);
        console.log(`  v1:   ${v1}`);
        console.log(formatDiffReport(diffs));
        console.log('');
      } else {
        console.log(`\n  ${name}: FULL PARITY`);
      }

      // Don't fail - this is exploratory
      // To make it strict, uncomment:
      // expect(diffs.missingInV1.length).toBe(0);
      // expect(diffs.typeMismatches.length).toBe(0);
    });
  });
});

describe('Image URL Validation', () => {
  it('v1 collection image URLs return valid images', async () => {
    const res = await fetchJSON(LOCAL_URL, '/api/v1/item/plex/671468');
    if (!res.ok) return;

    const imagesToCheck = [
      res.body.image,
      res.body.info?.image,
      ...(res.body.items?.slice(0, 3).map(i => i.image) || [])
    ].filter(Boolean);

    const results = await Promise.all(
      imagesToCheck.map(img => validateImageUrl(LOCAL_URL, img))
    );

    const invalid = results.filter(r => !r.valid);
    if (invalid.length > 0) {
      console.log('\n  Invalid images found:');
      invalid.forEach((r, i) => console.log(`    - ${imagesToCheck[i]}: ${r.error}`));
    }

    const validPercent = (results.filter(r => r.valid).length / results.length) * 100;
    expect(validPercent).toBeGreaterThanOrEqual(80);
  });

  it('v1 playable episode thumbnails return valid images', async () => {
    const res = await fetchJSON(LOCAL_URL, '/api/v1/item/plex/662027/playable');
    if (!res.ok) return;

    const items = res.body.items?.slice(0, 5) || [];
    const images = items.map(i => i.image).filter(Boolean);

    const results = await Promise.all(
      images.map(img => validateImageUrl(LOCAL_URL, img))
    );

    const invalid = results.filter(r => !r.valid);
    if (invalid.length > 0) {
      console.log('\n  Invalid episode thumbnails:');
      invalid.forEach((r, i) => console.log(`    - ${images[i]}: ${r.error}`));
    }

    expect(invalid.length).toBe(0);
  });
});
} // end isJest

// =============================================================================
// CLI RUNNER
// =============================================================================

async function runParityCheck() {
  console.log('\n========================================');
  console.log('  PROD vs V1 PARITY CHECK');
  console.log('========================================\n');
  console.log(`Prod: ${PROD_URL}`);
  console.log(`Local: ${LOCAL_URL}\n`);

  for (const pair of ENDPOINT_PAIRS) {
    console.log(`\n--- ${pair.name} ---`);
    console.log(`Prod: ${pair.prod}`);
    console.log(`v1:   ${pair.v1}`);

    const [prodRes, v1Res] = await Promise.all([
      fetchJSON(PROD_URL, pair.prod),
      fetchJSON(LOCAL_URL, pair.v1)
    ]);

    if (!prodRes.ok) {
      console.log(`  PROD ERROR: ${prodRes.error}`);
      continue;
    }
    if (!v1Res.ok) {
      console.log(`  V1 ERROR: ${v1Res.error}`);
      continue;
    }

    const diffs = findDifferences(prodRes.body, v1Res.body);

    if (hasDifferences(diffs)) {
      console.log(formatDiffReport(diffs, 20));
    } else {
      console.log('\n  FULL PARITY');
    }
  }

  console.log('\n========================================\n');
}

// Run CLI if called directly
if (process.argv[1]?.includes('prod-v1-parity') && !process.env.JEST_WORKER_ID) {
  runParityCheck().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

export { ENDPOINT_PAIRS, findDifferences, formatDiffReport };
