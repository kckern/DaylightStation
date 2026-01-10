#!/usr/bin/env node
/**
 * Production Config Validation Script
 *
 * Run this script against the production data directory to validate
 * that the new ConfigService can load all config correctly.
 *
 * Usage:
 *   DAYLIGHT_DATA_PATH=/data node backend/lib/config/validate-production.mjs
 *
 * Or in Docker:
 *   docker exec daylight-station node backend/lib/config/validate-production.mjs
 */

import { loadConfig } from './configLoader.mjs';
import { validateConfig, ConfigValidationError } from './configValidator.mjs';
import { ConfigService } from './ConfigService.mjs';

const dataDir = process.env.DAYLIGHT_DATA_PATH || process.env.path?.data;

if (!dataDir) {
  console.error('ERROR: Set DAYLIGHT_DATA_PATH environment variable');
  process.exit(1);
}

console.log(`\n=== ConfigService v2 Production Validation ===`);
console.log(`Data directory: ${dataDir}\n`);

try {
  // Step 1: Load config
  console.log('1. Loading config from disk...');
  const config = loadConfig(dataDir);
  console.log('   ✓ Config loaded successfully');

  // Step 2: Validate config
  console.log('\n2. Validating config against schema...');
  validateConfig(config, dataDir);
  console.log('   ✓ Config validation passed');

  // Step 3: Create service and test methods
  console.log('\n3. Testing ConfigService methods...');
  const svc = new ConfigService(config);

  // System
  console.log(`   - Default household: ${svc.getDefaultHouseholdId()}`);
  console.log(`   - Data dir: ${svc.getDataDir()}`);
  console.log(`   - Config dir: ${svc.getConfigDir()}`);

  // Households
  const defaultHid = svc.getDefaultHouseholdId();
  const head = svc.getHeadOfHousehold();
  const users = svc.getHouseholdUsers(defaultHid);
  const tz = svc.getHouseholdTimezone(defaultHid);
  console.log(`   - Head of household: ${head}`);
  console.log(`   - Household users: [${users.join(', ')}]`);
  console.log(`   - Household timezone: ${tz}`);

  // Users
  const profiles = svc.getAllUserProfiles();
  console.log(`   - User profiles loaded: ${profiles.size}`);

  // Secrets (just check existence, don't print values)
  const hasOpenAI = svc.getSecret('OPENAI_API_KEY') !== null;
  console.log(`   - OPENAI_API_KEY present: ${hasOpenAI}`);

  // Identity mappings
  const identityPlatforms = Object.keys(config.identityMappings);
  console.log(`   - Identity platforms: [${identityPlatforms.join(', ')}]`);

  // Apps
  const appNames = Object.keys(config.apps);
  console.log(`   - App configs loaded: [${appNames.join(', ')}]`);

  // Auth
  const userAuthCount = Object.keys(config.auth.users).length;
  const householdAuthCount = Object.keys(config.auth.households).length;
  console.log(`   - User auth entries: ${userAuthCount}`);
  console.log(`   - Household auth entries: ${householdAuthCount}`);

  console.log('\n=== VALIDATION PASSED ===\n');
  console.log('The new ConfigService v2 can load your production config correctly.');
  console.log('You can proceed with Phase 2 of the migration.\n');

} catch (err) {
  if (err instanceof ConfigValidationError) {
    console.error('\n=== VALIDATION FAILED ===\n');
    console.error(err.message);
    console.error('\nFix the issues above before proceeding with migration.\n');
  } else {
    console.error('\n=== ERROR ===\n');
    console.error(err.stack);
  }
  process.exit(1);
}
