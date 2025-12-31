/**
 * Unit tests for household auth loading
 * Run: node backend/tests/household-auth.test.mjs
 * 
 * These tests verify the three-tier auth architecture works correctly
 * without needing the full server running.
 * 
 * Tests the raw auth file structure - does not depend on io.mjs
 * to avoid circular dependency issues with process.env setup.
 */

import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';

// Bootstrap minimal environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

// Determine data path - try mount first, fall back to local
const possibleDataPaths = [
    process.env.DATA_PATH,
    '/Volumes/mounts/DockerDrive/Docker/DaylightStation/data',
    path.join(projectRoot, 'data')
].filter(Boolean);

let dataPath = null;
for (const p of possibleDataPaths) {
    if (fs.existsSync(p)) {
        dataPath = p;
        break;
    }
}

if (!dataPath) {
    console.error('❌ Could not find data directory. Tried:');
    possibleDataPaths.forEach(p => console.error(`   - ${p}`));
    process.exit(1);
}

// Simple YAML loader (mirrors io.mjs logic)
const loadYaml = (filePath) => {
    const ymlPath = filePath.endsWith('.yml') ? filePath : `${filePath}.yml`;
    const yamlPath = filePath.endsWith('.yaml') ? filePath : `${filePath}.yaml`;
    
    let fileToLoad = null;
    if (fs.existsSync(ymlPath)) {
        fileToLoad = ymlPath;
    } else if (fs.existsSync(yamlPath)) {
        fileToLoad = yamlPath;
    } else {
        return null;
    }
    
    try {
        const content = fs.readFileSync(fileToLoad, 'utf8');
        return yaml.load(content);
    } catch (e) {
        console.error(`Failed to load ${fileToLoad}:`, e.message);
        return null;
    }
};

// Auth helper functions (mirror io.mjs)
const householdLoadAuth = (householdId, service) => {
    if (!householdId || !service) return null;
    const authPath = path.join(dataPath, 'households', householdId, 'auth', service);
    return loadYaml(authPath);
};

const householdLoadConfig = (householdId) => {
    if (!householdId) return null;
    return loadYaml(path.join(dataPath, 'households', householdId, 'household'));
};

const userLoadAuth = (username, service) => {
    if (!username || !service) return null;
    return loadYaml(path.join(dataPath, 'users', username, 'auth', service));
};

const userLoadProfile = (username) => {
    if (!username) return null;
    return loadYaml(path.join(dataPath, 'users', username, 'profile'));
};

// Simple test runner
const results = { passed: 0, failed: 0, tests: [] };

const test = (name, fn) => {
    try {
        fn();
        results.passed++;
        results.tests.push({ name, status: '✅' });
        console.log(`✅ ${name}`);
    } catch (error) {
        results.failed++;
        results.tests.push({ name, status: '❌', error: error.message });
        console.log(`❌ ${name}`);
        console.log(`   Error: ${error.message}`);
    }
};

const assert = (condition, message) => {
    if (!condition) throw new Error(message || 'Assertion failed');
};

const assertEqual = (actual, expected, message) => {
    if (actual !== expected) {
        throw new Error(message || `Expected "${expected}" but got "${actual}"`);
    }
};

const assertExists = (value, message) => {
    if (value === null || value === undefined) {
        throw new Error(message || 'Value should exist but is null/undefined');
    }
};

const assertHasKey = (obj, key, message) => {
    if (!obj || !(key in obj)) {
        throw new Error(message || `Object should have key "${key}"`);
    }
};

// =============================================================================
// TESTS
// =============================================================================

console.log('\n' + '='.repeat(60));
console.log('🧪 Household Auth Unit Tests');
console.log('='.repeat(60) + '\n');

console.log('📁 Data path:', dataPath);
console.log('');

// --- Core IO Functions ---
console.log('\n--- Core Structure ---\n');

test('households/default directory exists', () => {
    const dir = path.join(dataPath, 'households', 'default');
    assert(fs.existsSync(dir), `Directory should exist: ${dir}`);
});

test('households/default/auth directory exists', () => {
    const dir = path.join(dataPath, 'households', 'default', 'auth');
    assert(fs.existsSync(dir), `Directory should exist: ${dir}`);
});

test('householdLoadConfig loads household.yml', () => {
    const config = householdLoadConfig('default');
    assertExists(config, 'Household config should exist');
    // household.yml should have head or users
    assert(config.head || config.users, 'Household config should have head or users');
});

// --- Household Auth Files ---
console.log('\n--- Household Auth Files ---\n');

test('householdLoadAuth loads plex.yml', () => {
    const auth = householdLoadAuth('default', 'plex');
    assertExists(auth, 'Plex auth should exist');
    assertHasKey(auth, 'token', 'Plex auth should have token');
    assert(auth.token.length > 10, 'Plex token should be non-empty');
});

test('householdLoadAuth loads home_assistant.yml', () => {
    const auth = householdLoadAuth('default', 'home_assistant');
    assertExists(auth, 'Home Assistant auth should exist');
    assertHasKey(auth, 'token', 'Home Assistant auth should have token');
    assertHasKey(auth, 'base_url', 'Home Assistant auth should have base_url');
});

test('householdLoadAuth loads clickup.yml', () => {
    const auth = householdLoadAuth('default', 'clickup');
    assertExists(auth, 'ClickUp auth should exist');
    assertHasKey(auth, 'api_key', 'ClickUp auth should have api_key');
    assert(auth.api_key.startsWith('pk_'), 'ClickUp API key should start with pk_');
});

test('householdLoadAuth loads weather.yml', () => {
    const auth = householdLoadAuth('default', 'weather');
    assertExists(auth, 'Weather auth should exist');
    assertHasKey(auth, 'api_key', 'Weather auth should have api_key');
});

test('householdLoadAuth loads buxfer.yml', () => {
    const auth = householdLoadAuth('default', 'buxfer');
    assertExists(auth, 'Buxfer auth should exist');
    assertHasKey(auth, 'email', 'Buxfer auth should have email');
    assertHasKey(auth, 'password', 'Buxfer auth should have password');
});

test('householdLoadAuth loads infinity.yml', () => {
    const auth = householdLoadAuth('default', 'infinity');
    assertExists(auth, 'Infinity auth should exist');
    assertHasKey(auth, 'workspace', 'Infinity auth should have workspace');
    assertHasKey(auth, 'cli_token', 'Infinity auth should have cli_token');
});

test('householdLoadAuth loads foursquare.yml', () => {
    const auth = householdLoadAuth('default', 'foursquare');
    assertExists(auth, 'Foursquare auth should exist');
    assertHasKey(auth, 'token', 'Foursquare auth should have token');
});

test('householdLoadAuth loads memos.yml', () => {
    const auth = householdLoadAuth('default', 'memos');
    assertExists(auth, 'Memos auth should exist');
    assertHasKey(auth, 'token', 'Memos auth should have token');
});

test('householdLoadAuth loads payroll.yml', () => {
    const auth = householdLoadAuth('default', 'payroll');
    assertExists(auth, 'Payroll auth should exist');
    assertHasKey(auth, 'auth_cookie', 'Payroll auth should have auth_cookie');
    assertHasKey(auth, 'company', 'Payroll auth should have company');
});

test('householdLoadAuth loads ifttt.yml', () => {
    const auth = householdLoadAuth('default', 'ifttt');
    assertExists(auth, 'IFTTT auth should exist');
    assertHasKey(auth, 'key', 'IFTTT auth should have key');
});

test('householdLoadAuth loads fully_kiosk.yml', () => {
    const auth = householdLoadAuth('default', 'fully_kiosk');
    assertExists(auth, 'Fully Kiosk auth should exist');
    assertHasKey(auth, 'password', 'Fully Kiosk auth should have password');
});

// --- Edge Cases ---
console.log('\n--- Edge Cases ---\n');

test('householdLoadAuth returns null for missing service', () => {
    const auth = householdLoadAuth('default', 'nonexistent_service_xyz');
    assertEqual(auth, null, 'Should return null for missing service');
});

test('householdLoadAuth returns null for missing household', () => {
    const auth = householdLoadAuth('nonexistent_household', 'plex');
    assertEqual(auth, null, 'Should return null for missing household');
});

test('householdLoadAuth handles null householdId gracefully', () => {
    const auth = householdLoadAuth(null, 'plex');
    assertEqual(auth, null, 'Should return null for null householdId');
});

test('householdLoadAuth handles null service gracefully', () => {
    const auth = householdLoadAuth('default', null);
    assertEqual(auth, null, 'Should return null for null service');
});

// --- User Auth (existing) ---
console.log('\n--- User Auth (existing) ---\n');

test('userLoadAuth loads strava.yml for kckern', () => {
    const auth = userLoadAuth('kckern', 'strava');
    assertExists(auth, 'Strava auth should exist for kckern');
    assertHasKey(auth, 'refresh', 'Strava auth should have refresh token');
});

test('userLoadAuth loads withings.yml for kckern', () => {
    const auth = userLoadAuth('kckern', 'withings');
    assertExists(auth, 'Withings auth should exist for kckern');
    assertHasKey(auth, 'refresh', 'Withings auth should have refresh token');
});

// --- User Auth (new Phase 2) ---
console.log('\n--- User Auth (Phase 2) ---\n');

test('userLoadAuth loads google.yml for kckern', () => {
    const auth = userLoadAuth('kckern', 'google');
    assertExists(auth, 'Google auth should exist for kckern');
    assertHasKey(auth, 'refresh_token', 'Google auth should have refresh_token');
    assert(auth.refresh_token.startsWith('1//'), 'Google refresh token should start with 1//');
});

test('userLoadAuth loads todoist.yml for kckern', () => {
    const auth = userLoadAuth('kckern', 'todoist');
    assertExists(auth, 'Todoist auth should exist for kckern');
    assertHasKey(auth, 'api_key', 'Todoist auth should have api_key');
    assert(auth.api_key.length > 20, 'Todoist API key should be non-empty');
});

test('userLoadAuth loads garmin.yml for kckern', () => {
    const auth = userLoadAuth('kckern', 'garmin');
    assertExists(auth, 'Garmin auth should exist for kckern');
    assertHasKey(auth, 'username', 'Garmin auth should have username');
    assertHasKey(auth, 'password', 'Garmin auth should have password');
});

test('userLoadAuth loads lastfm.yml for kckern', () => {
    const auth = userLoadAuth('kckern', 'lastfm');
    assertExists(auth, 'Last.fm auth should exist for kckern');
    assertHasKey(auth, 'username', 'Last.fm auth should have username');
});

test('userLoadAuth loads letterboxd.yml for kckern', () => {
    const auth = userLoadAuth('kckern', 'letterboxd');
    assertExists(auth, 'Letterboxd auth should exist for kckern');
    assertHasKey(auth, 'username', 'Letterboxd auth should have username');
});

test('userLoadAuth loads goodreads.yml for kckern', () => {
    const auth = userLoadAuth('kckern', 'goodreads');
    assertExists(auth, 'Goodreads auth should exist for kckern');
    assertHasKey(auth, 'user_id', 'Goodreads auth should have user_id');
});

// --- Summary ---
console.log('\n' + '='.repeat(60));
console.log(`📊 Results: ${results.passed} passed, ${results.failed} failed`);
console.log('='.repeat(60));

if (results.failed > 0) {
    console.log('\n❌ Failed tests:');
    results.tests.filter(t => t.status === '❌').forEach(t => {
        console.log(`   - ${t.name}: ${t.error}`);
    });
    process.exit(1);
} else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
}
