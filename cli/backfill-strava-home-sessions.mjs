#!/usr/bin/env node

/**
 * Backfill Strava-Home Session Matching
 *
 * Runs matchBacklog for all existing Strava summary entries against
 * home fitness session files.
 *
 * Usage: node cli/backfill-strava-home-sessions.mjs [daysBack]
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { existsSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

dotenv.config({ path: path.join(projectRoot, '.env') });

const isDocker = existsSync('/.dockerenv');
const baseDir = isDocker ? '/usr/src/app' : process.env.DAYLIGHT_BASE_PATH;
const dataDir = path.join(baseDir, 'data');
const configDir = path.join(dataDir, 'system', 'config');

// Bootstrap config
const { hydrateProcessEnvFromConfigs } = await import('#system/logging/config.mjs');
const { initConfigService, configService } = await import('#system/config/index.mjs');
const { YamlLifelogDatastore } = await import('#adapters/harvester/YamlLifelogDatastore.mjs');
const { StravaHarvester } = await import('#adapters/harvester/fitness/StravaHarvester.mjs');

hydrateProcessEnvFromConfigs(configDir);
initConfigService(dataDir);

const daysBack = parseInt(process.argv[2] || '90', 10);
const username = process.argv[3] || 'kckern';

console.log(`Backfilling Strava-home session matching for ${username}, ${daysBack} days back...`);

// Use the singleton userDataService (initialized by initConfigService)
const { default: userDataService } = await import('#system/config/UserDataService.mjs');

const io = {
  userLoadFile: (u, service) => userDataService.getLifelogData(u, service),
  userSaveFile: (u, service, data) => userDataService.saveLifelogData(u, service, data),
};

const lifelogStore = new YamlLifelogDatastore({ io });

const fitnessHistoryDir = configService.getHouseholdPath('history/fitness');

// Create a minimal strava client stub (not used by matchBacklog)
const stubStravaClient = {
  refreshToken: () => { throw new Error('stub'); },
  getActivities: () => { throw new Error('stub'); },
  getActivityStreams: () => { throw new Error('stub'); },
};

const harvester = new StravaHarvester({
  stravaClient: stubStravaClient,
  lifelogStore,
  configService,
  fitnessHistoryDir,
});

console.log(`Fitness history dir: ${fitnessHistoryDir}`);

// Load summary to show stats before
const summaryBefore = await lifelogStore.load(username, 'strava') || {};
const totalEntries = Object.values(summaryBefore).flat().length;
const alreadyMatched = Object.values(summaryBefore).flat().filter(e => e.homeSessionId).length;
console.log(`Summary: ${totalEntries} entries, ${alreadyMatched} already matched`);

// Run backfill
await harvester.matchBacklog(username, daysBack);

// Show results
const summaryAfter = await lifelogStore.load(username, 'strava') || {};
const matchedAfter = Object.values(summaryAfter).flat().filter(e => e.homeSessionId).length;
const newMatches = matchedAfter - alreadyMatched;

console.log(`Done! ${newMatches} new matches found (${matchedAfter} total matched)`);
