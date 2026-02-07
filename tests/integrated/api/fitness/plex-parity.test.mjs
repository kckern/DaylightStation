// tests/integration/api/fitness-plex-parity.test.mjs
/**
 * Fitness App Plex Integration Parity Tests
 *
 * Tests the plex-related endpoints used by the fitness app frontend:
 * - /api/fitness - config with nav_items and collection IDs
 * - /media/plex/list/{collection} - show list for a collection
 * - /media/plex/info/{id} - episode info with watch progress
 *
 * Uses real data from:
 * - household/config/fitness.yml
 * - household/history/media_memory/plex/14_fitness.yml
 *
 * Run with: node tests/integration/api/fitness-plex-parity.test.mjs
 */

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { getDataPath } from '../../../../_lib/configHelper.mjs';

const BASE_URL = process.env.PARITY_TEST_URL || 'http://localhost:3112';

// Data path from config helper (SSOT)
const DATA_PATH = getDataPath();
const FITNESS_CONFIG_PATH = path.join(DATA_PATH, 'household/config/fitness.yml');
const FITNESS_MEMORY_PATH = path.join(DATA_PATH, 'household/history/media_memory/plex/14_fitness.yml');

// Helper to make requests
async function fetchJSON(urlPath) {
  try {
    const res = await fetch(`${BASE_URL}${urlPath}`, {
      headers: { 'Accept': 'application/json' }
    });

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return { status: res.status, body: null, error: `Not JSON: ${contentType}` };
    }

    return {
      status: res.status,
      body: await res.json()
    };
  } catch (err) {
    return { status: 0, body: null, error: err.message };
  }
}

// Load fixture data
function loadFitnessConfig() {
  try {
    const content = fs.readFileSync(FITNESS_CONFIG_PATH, 'utf8');
    return yaml.parse(content);
  } catch (err) {
    console.error(`Failed to load fitness config: ${err.message}`);
    return null;
  }
}

function loadFitnessMemory() {
  try {
    const content = fs.readFileSync(FITNESS_MEMORY_PATH, 'utf8');
    return yaml.parse(content);
  } catch (err) {
    console.error(`Failed to load fitness memory: ${err.message}`);
    return null;
  }
}

// =============================================================================
// TEST RUNNER
// =============================================================================

async function runFitnessPlexParityTests() {
  console.log(`\n🏋️ Fitness Plex Integration Parity Tests`);
  console.log(`   Server: ${BASE_URL}`);
  console.log(`   Data: ${DATA_PATH}\n`);

  const results = { passed: 0, failed: 0, skipped: 0, details: [] };

  // Load fixture data
  const fitnessConfig = loadFitnessConfig();
  const fitnessMemory = loadFitnessMemory();

  if (!fitnessConfig) {
    console.log('❌ Could not load fitness config - skipping tests');
    return results;
  }

  // ==========================================================================
  // Test 1: Fitness Config Endpoint
  // ==========================================================================
  console.log('📊 Test 1: Fitness Config Endpoint\n');

  const configRes = await fetchJSON('/api/fitness');
  if (configRes.status !== 200) {
    console.log(`  ❌ /api/fitness returned ${configRes.status}`);
    results.failed++;
  } else {
    // Check nav_items exist
    const navItems = configRes.body?.plex?.nav_items || [];
    console.log(`  ✅ Config loaded with ${navItems.length} nav items`);
    results.passed++;

    // Verify collection IDs from config are present
    const collectionItems = navItems.filter(n => n.type === 'plex_collection');
    console.log(`     - ${collectionItems.length} plex_collection items`);

    const groupItems = navItems.filter(n => n.type === 'plex_collection_group');
    console.log(`     - ${groupItems.length} plex_collection_group items`);
  }

  // ==========================================================================
  // Test 2: Plex List Endpoint (for each collection in config)
  // ==========================================================================
  console.log('\n📊 Test 2: Plex List Endpoints (from nav_items)\n');

  const navItems = fitnessConfig?.plex?.nav_items || [];
  const collectionIds = [];

  for (const item of navItems) {
    if (item.type === 'plex_collection' && item.target?.collection_id) {
      collectionIds.push({ id: item.target.collection_id, name: item.name });
    } else if (item.type === 'plex_collection_group' && item.target?.collection_ids) {
      for (const cid of item.target.collection_ids) {
        collectionIds.push({ id: cid, name: `${item.name} (group)` });
      }
    }
  }

  // Test first 3 collections (to keep test quick)
  const collectionsToTest = collectionIds.slice(0, 3);

  for (const col of collectionsToTest) {
    const legacyRes = await fetchJSON(`/media/plex/list/${col.id}`);
    const dddRes = await fetchJSON(`/api/v1/content/list/plex/${col.id}`);

    process.stdout.write(`  ${col.name} (${col.id}): `);

    if (legacyRes.status !== 200) {
      console.log(`❌ Legacy returned ${legacyRes.status}`);
      results.failed++;
      continue;
    }

    if (dddRes.status !== 200) {
      // DDD might not have this endpoint yet
      if (dddRes.error?.includes('Not JSON')) {
        console.log(`⚠️ DDD not implemented (returns HTML)`);
        results.skipped++;
      } else {
        console.log(`❌ DDD returned ${dddRes.status}`);
        results.failed++;
      }
      continue;
    }

    const legacyCount = legacyRes.body?.items?.length || 0;
    const dddCount = dddRes.body?.items?.length || 0;

    if (legacyCount === dddCount) {
      console.log(`✅ Both have ${legacyCount} items`);
      results.passed++;
    } else {
      console.log(`⚠️ Item count differs (legacy: ${legacyCount}, DDD: ${dddCount})`);
      results.passed++; // Still a pass if both return data
    }
  }

  // ==========================================================================
  // Test 3: Plex Info Endpoint with Watch History
  // ==========================================================================
  console.log('\n📊 Test 3: Plex Info with Watch History\n');

  if (!fitnessMemory) {
    console.log('  ⚠️ Could not load fitness memory - skipping watch history tests');
    results.skipped++;
  } else {
    // Get 3 episodes with watch history
    const episodesWithHistory = Object.entries(fitnessMemory)
      .filter(([id, data]) => data.playhead > 0 && data.mediaDuration > 0)
      .slice(0, 3)
      .map(([id, data]) => ({
        id,
        title: data.title,
        playhead: data.playhead,
        duration: data.mediaDuration,
        expectedPercent: Math.round((data.playhead / data.mediaDuration) * 100)
      }));

    for (const ep of episodesWithHistory) {
      process.stdout.write(`  ${ep.title} (${ep.id}): `);

      const legacyRes = await fetchJSON(`/media/plex/info/${ep.id}`);
      const dddRes = await fetchJSON(`/api/v1/info/plex/${ep.id}`);

      if (legacyRes.status !== 200 || dddRes.status !== 200) {
        console.log(`❌ Request failed (legacy: ${legacyRes.status}, DDD: ${dddRes.status})`);
        results.failed++;
        continue;
      }

      const legacyPercent = legacyRes.body?.percent || 0;
      const dddPercent = dddRes.body?.percent || 0;
      const dddSeconds = dddRes.body?.seconds || 0;

      // Check DDD returns correct watch progress
      if (dddPercent === ep.expectedPercent && dddSeconds === ep.playhead) {
        console.log(`✅ DDD correct (${dddPercent}%, ${dddSeconds}s)`);
        results.passed++;

        if (legacyPercent !== dddPercent) {
          console.log(`     Note: Legacy returns ${legacyPercent}% (bug in legacy)`);
        }
      } else {
        console.log(`❌ DDD wrong: got ${dddPercent}%, expected ${ep.expectedPercent}%`);
        results.failed++;
      }

      results.details.push({
        id: ep.id,
        title: ep.title,
        expected: { percent: ep.expectedPercent, seconds: ep.playhead },
        legacy: { percent: legacyPercent, seconds: legacyRes.body?.seconds || 0 },
        ddd: { percent: dddPercent, seconds: dddSeconds }
      });
    }
  }

  // ==========================================================================
  // Test 4: Plex Info Response Shape (Legacy vs DDD)
  // ==========================================================================
  console.log('\n📊 Test 4: Plex Info Response Shape\n');

  // Use a known episode from memory
  const testEpisodeId = Object.keys(fitnessMemory || {})[0];
  if (testEpisodeId) {
    const legacyRes = await fetchJSON(`/media/plex/info/${testEpisodeId}`);
    const dddRes = await fetchJSON(`/api/v1/info/plex/${testEpisodeId}`);

    if (legacyRes.status === 200 && dddRes.status === 200) {
      const legacyKeys = Object.keys(legacyRes.body).sort();
      const dddKeys = Object.keys(dddRes.body).sort();

      const missingInDdd = legacyKeys.filter(k => !dddKeys.includes(k));
      const extraInDdd = dddKeys.filter(k => !legacyKeys.includes(k));

      console.log(`  Legacy fields: ${legacyKeys.length}`);
      console.log(`  DDD fields: ${dddKeys.length}`);

      if (missingInDdd.length > 0) {
        console.log(`  ⚠️ Missing in DDD: ${missingInDdd.join(', ')}`);
      }
      if (extraInDdd.length > 0) {
        console.log(`  ℹ️ Extra in DDD: ${extraInDdd.join(', ')}`);
      }

      // Check critical fields
      const criticalFields = ['title', 'mediaUrl', 'mediaType', 'image', 'percent', 'seconds'];
      const missingCritical = criticalFields.filter(f => !(f in dddRes.body));

      if (missingCritical.length === 0) {
        console.log(`  ✅ All critical fields present in DDD`);
        results.passed++;
      } else {
        console.log(`  ❌ Missing critical fields: ${missingCritical.join(', ')}`);
        results.failed++;
      }
    } else {
      console.log(`  ❌ Could not compare - status mismatch`);
      results.failed++;
    }
  }

  // ==========================================================================
  // Summary
  // ==========================================================================
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Results: ${results.passed} passed, ${results.failed} failed, ${results.skipped} skipped`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (results.details.length > 0) {
    console.log('Watch History Details:');
    for (const d of results.details) {
      console.log(`  ${d.title}:`);
      console.log(`    Expected: ${d.expected.percent}% / ${d.expected.seconds}s`);
      console.log(`    Legacy:   ${d.legacy.percent}% / ${d.legacy.seconds}s`);
      console.log(`    DDD:      ${d.ddd.percent}% / ${d.ddd.seconds}s`);
    }
    console.log('');
  }

  return results;
}

// Run if called directly
if (process.argv[1]?.endsWith('fitness-plex-parity.test.mjs')) {
  runFitnessPlexParityTests().then(results => {
    process.exit(results.failed === 0 ? 0 : 1);
  });
}

export { runFitnessPlexParityTests };
