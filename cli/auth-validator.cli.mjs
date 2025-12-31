#!/usr/bin/env node
/**
 * Auth Validator CLI
 * 
 * Validates the three-tier auth architecture:
 * - System level: env vars from config.secrets.yml
 * - Household level: data/households/{hid}/auth/*.yml
 * - User level: data/users/{username}/auth/*.yml
 * 
 * Usage:
 *   node cli/auth-validator.cli.mjs
 *   node cli/auth-validator.cli.mjs --tier household --hid default
 *   node cli/auth-validator.cli.mjs --tier user --username kckern
 *   node cli/auth-validator.cli.mjs --dry-run
 *   node cli/auth-validator.cli.mjs --json
 */

import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';

// Parse CLI args
const args = process.argv.slice(2);
const flags = {
    tier: null,
    hid: 'default',
    username: 'kckern',
    dryRun: args.includes('--dry-run'),
    json: args.includes('--json'),
    help: args.includes('--help') || args.includes('-h')
};

// Parse named args
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tier' && args[i + 1]) flags.tier = args[++i];
    if (args[i] === '--hid' && args[i + 1]) flags.hid = args[++i];
    if (args[i] === '--username' && args[i + 1]) flags.username = args[++i];
}

if (flags.help) {
    console.log(`
Auth Validator CLI - Validate DaylightStation three-tier auth architecture

Usage:
  node cli/auth-validator.cli.mjs [options]

Options:
  --tier <tier>       Test specific tier: system, household, or user
  --hid <id>          Household ID (default: default)
  --username <name>   Username (default: kckern)
  --dry-run           Check files only, no API calls
  --json              Output results as JSON
  --help, -h          Show this help message

Examples:
  node cli/auth-validator.cli.mjs                          # Run all validations
  node cli/auth-validator.cli.mjs --tier household         # Household tier only
  node cli/auth-validator.cli.mjs --tier user --username elizabeth
`);
    process.exit(0);
}

// Setup paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Find data path
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
    console.error('❌ Could not find data directory');
    process.exit(1);
}

// YAML loader
const loadYaml = (filePath) => {
    const ymlPath = filePath.endsWith('.yml') ? filePath : `${filePath}.yml`;
    if (!fs.existsSync(ymlPath)) return null;
    try {
        return yaml.load(fs.readFileSync(ymlPath, 'utf8'));
    } catch (e) {
        return null;
    }
};

// Results tracking
const results = {
    system: { passed: 0, failed: 0, tests: [] },
    household: { passed: 0, failed: 0, tests: [] },
    user: { passed: 0, failed: 0, tests: [] }
};

const addResult = (tier, name, passed, details = '') => {
    results[tier].tests.push({ name, passed, details });
    if (passed) results[tier].passed++;
    else results[tier].failed++;
};

// =============================================================================
// SYSTEM TIER VALIDATION
// =============================================================================
const validateSystem = () => {
    const systemSecrets = [
        { key: 'MYSQL_HOST', required: true, desc: 'Database host' },
        { key: 'OPENAI_API_KEY', required: true, desc: 'OpenAI API key' },
        { key: 'GOOGLE_CLIENT_ID', required: true, desc: 'Google OAuth app ID' },
        { key: 'GOOGLE_CLIENT_SECRET', required: true, desc: 'Google OAuth app secret' },
        { key: 'STRAVA_CLIENT_ID', required: false, desc: 'Strava OAuth app ID' },
        { key: 'WITHINGS_CLIENT', required: false, desc: 'Withings OAuth app ID' },
        { key: 'LAST_FM_API_KEY', required: false, desc: 'Last.fm API key' },
        { key: 'TELEGRAM_NUTRIBOT_TOKEN', required: false, desc: 'Telegram bot token' },
    ];

    // Check multiple possible locations for config.secrets.yml
    const possibleSecretsPaths = [
        path.join(projectRoot, 'config', 'config.secrets.yml'),
        '/Volumes/mounts/DockerDrive/Docker/DaylightStation/config/config.secrets.yml',
        '/Volumes/mounts/DockerDrive/Docker/DaylightStation/config/config.secrets-local.yml',
    ];
    
    let secretsPath = null;
    for (const p of possibleSecretsPaths) {
        if (fs.existsSync(p)) {
            secretsPath = p;
            break;
        }
    }
    
    const secretsExist = secretsPath !== null;
    addResult('system', 'config.secrets.yml exists', secretsExist, 
        secretsExist ? secretsPath : 'Not found (OK if running in container)');

    if (secretsExist && flags.dryRun) {
        const secrets = loadYaml(secretsPath) || {};
        for (const { key, required, desc } of systemSecrets) {
            const exists = key in secrets && secrets[key];
            const status = exists ? 'Present' : (required ? 'MISSING' : 'Optional, not set');
            addResult('system', key, exists || !required, `${desc} - ${status}`);
        }
    }
};

// =============================================================================
// HOUSEHOLD TIER VALIDATION
// =============================================================================
const validateHousehold = (householdId) => {
    const householdDir = path.join(dataPath, 'households', householdId);
    const authDir = path.join(householdDir, 'auth');

    // Check directory structure
    addResult('household', `households/${householdId}/ exists`, 
        fs.existsSync(householdDir), householdDir);
    addResult('household', `households/${householdId}/auth/ exists`, 
        fs.existsSync(authDir), authDir);

    // Check household.yml
    const config = loadYaml(path.join(householdDir, 'household'));
    addResult('household', 'household.yml valid', 
        config && (config.head || config.users),
        config ? `head: ${config.head || 'N/A'}` : 'File missing or invalid');

    // Required household auth files
    const householdAuthFiles = [
        { service: 'plex', required: ['token'], desc: 'Plex media server' },
        { service: 'home_assistant', required: ['token'], desc: 'Home Assistant' },
        { service: 'clickup', required: ['api_key'], desc: 'ClickUp tasks' },
        { service: 'weather', required: ['api_key'], desc: 'Weather API' },
        { service: 'buxfer', required: ['email', 'password'], desc: 'Buxfer budget' },
        { service: 'infinity', required: ['workspace'], desc: 'Infinity board' },
        { service: 'foursquare', required: ['token'], desc: 'Foursquare' },
        { service: 'memos', required: ['token'], desc: 'Memos notes' },
        { service: 'payroll', required: ['auth_cookie'], desc: 'Payroll' },
        { service: 'ifttt', required: ['key'], desc: 'IFTTT automation' },
        { service: 'fully_kiosk', required: ['password'], desc: 'Fully Kiosk' },
    ];

    for (const { service, required, desc } of householdAuthFiles) {
        const auth = loadYaml(path.join(authDir, service));
        const hasRequired = auth && required.every(key => key in auth && auth[key]);
        const keys = auth ? Object.keys(auth).join(', ') : 'N/A';
        addResult('household', `${service}.yml`, hasRequired, 
            hasRequired ? `${desc} - keys: ${keys}` : `${desc} - Missing required: ${required.join(', ')}`);
    }
};

// =============================================================================
// USER TIER VALIDATION
// =============================================================================
const validateUser = (username) => {
    const userDir = path.join(dataPath, 'users', username);
    const authDir = path.join(userDir, 'auth');
    const lifelogDir = path.join(userDir, 'lifelog');

    // Check directory structure
    addResult('user', `users/${username}/ exists`, fs.existsSync(userDir), userDir);
    addResult('user', `users/${username}/auth/ exists`, fs.existsSync(authDir), authDir);

    // Check profile
    const profile = loadYaml(path.join(userDir, 'profile'));
    addResult('user', 'profile.yml valid', profile !== null,
        profile ? `name: ${profile.name || profile.username || username}` : 'File missing');

    // Required user auth files
    const userAuthFiles = [
        { service: 'google', required: ['refresh_token'], desc: 'Google OAuth (Gmail/Calendar)' },
        { service: 'todoist', required: ['api_key'], desc: 'Todoist tasks' },
        { service: 'garmin', required: ['username', 'password'], desc: 'Garmin fitness' },
        { service: 'strava', required: ['refresh'], desc: 'Strava workouts' },
        { service: 'withings', required: ['refresh'], desc: 'Withings scale' },
        { service: 'lastfm', required: ['username'], desc: 'Last.fm music' },
        { service: 'letterboxd', required: ['username'], desc: 'Letterboxd movies' },
        { service: 'goodreads', required: ['user_id'], desc: 'Goodreads books' },
    ];

    for (const { service, required, desc } of userAuthFiles) {
        const auth = loadYaml(path.join(authDir, service));
        const hasRequired = auth && required.every(key => key in auth && auth[key]);
        const keys = auth ? Object.keys(auth).join(', ') : 'N/A';
        addResult('user', `${service}.yml`, hasRequired,
            hasRequired ? `${desc} - keys: ${keys}` : `${desc} - Missing required: ${required.join(', ')}`);
    }

    // Check lifelog directory
    addResult('user', `users/${username}/lifelog/ exists`, fs.existsSync(lifelogDir), lifelogDir);
};

// =============================================================================
// OUTPUT
// =============================================================================
const printResults = () => {
    if (flags.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
    }

    const box = (text, width = 78) => {
        const pad = Math.max(0, width - text.length - 2);
        return `│ ${text}${' '.repeat(pad)} │`;
    };

    console.log('\n╔' + '═'.repeat(78) + '╗');
    console.log(box('DaylightStation Auth Validator'));
    console.log('╠' + '═'.repeat(78) + '╣');
    console.log(box(`Household: ${flags.hid}    User: ${flags.username}    Mode: ${flags.dryRun ? 'dry-run' : 'full'}`));
    console.log('╚' + '═'.repeat(78) + '╝');

    const printTier = (tierName, tierResults) => {
        if (tierResults.tests.length === 0) return;

        console.log('\n┌' + '─'.repeat(78) + '┐');
        console.log(box(`${tierName.toUpperCase()} LEVEL${tierName === 'household' ? ` (${flags.hid})` : tierName === 'user' ? ` (${flags.username})` : ''}`));
        console.log('├' + '─'.repeat(78) + '┤');

        for (const test of tierResults.tests) {
            const icon = test.passed ? '✅' : '❌';
            const name = test.name.padEnd(25);
            const details = test.details.length > 45 ? test.details.substring(0, 42) + '...' : test.details;
            console.log(box(`${icon} ${name} │ ${details}`));
        }

        console.log('└' + '─'.repeat(78) + '┘');
        const total = tierResults.passed + tierResults.failed;
        const status = tierResults.failed === 0 ? '✅' : '❌';
        console.log(`${' '.repeat(50)}${tierName}: ${tierResults.passed}/${total} passed ${status}`);
    };

    if (!flags.tier || flags.tier === 'system') printTier('system', results.system);
    if (!flags.tier || flags.tier === 'household') printTier('household', results.household);
    if (!flags.tier || flags.tier === 'user') printTier('user', results.user);

    // Summary
    const totalPassed = results.system.passed + results.household.passed + results.user.passed;
    const totalFailed = results.system.failed + results.household.failed + results.user.failed;
    const total = totalPassed + totalFailed;

    console.log('\n' + '═'.repeat(80));
    if (totalFailed === 0) {
        console.log(`  SUMMARY: ${totalPassed}/${total} checks passed ✅`);
    } else {
        console.log(`  SUMMARY: ${totalPassed}/${total} passed, ${totalFailed} failed ❌`);
    }
    console.log('═'.repeat(80));
};

// =============================================================================
// MAIN
// =============================================================================
const main = () => {
    if (!flags.tier || flags.tier === 'system') {
        validateSystem();
    }
    if (!flags.tier || flags.tier === 'household') {
        validateHousehold(flags.hid);
    }
    if (!flags.tier || flags.tier === 'user') {
        validateUser(flags.username);
    }

    printResults();

    const totalFailed = results.system.failed + results.household.failed + results.user.failed;
    process.exit(totalFailed > 0 ? 1 : 0);
};

main();
