/**
 * Backfill Strava-home session matching.
 *
 * Runs `StravaHarvester.matchBacklog` for all existing Strava summary entries
 * against home fitness session files, stamping `homeSessionId` where a stored
 * activity lines up with a locally recorded session.
 *
 * @module cli/lib/fitness/matchHome
 */

import path from 'path';
import { parseArgs, str, num } from './argv.mjs';
import { CliError } from './context.mjs';

export const spec = {
  name: 'match-home',
  summary: 'match stored strava activities against home fitness sessions',
  usage: 'fitness strava match-home [--days=N] [--user=NAME]',
  details: `  --days=N      Days back to scan (default: 90)
  --user=NAME   User whose strava summary to match (default: DAYLIGHT_USER)

Bare positionals are still accepted for back-compat: match-home [days] [user].`,
};

/**
 * @param {string[]} argv - argv tail AFTER the group+command tokens
 * @param {Object} ctx - from `getContext()`
 * @returns {Promise<{username: string, daysBack: number, fitnessHistoryDir: string,
 *   totalEntries: number, alreadyMatched: number, matchedAfter: number, newMatches: number}>}
 */
export async function run(argv, ctx) {
  const { positional, flags } = parseArgs(argv, { valueFlags: ['user'] });

  // Named flags win; bare positionals kept for back-compat with the old
  // `node cli/backfill-strava-home-sessions.mjs [daysBack] [username]` form.
  const daysBack = num(flags, 'days', parseInt(positional[0] || '90', 10));
  const username = str(flags, 'user') || positional[1] || ctx.username;

  if (!Number.isFinite(daysBack)) {
    throw new CliError(`Invalid --days value: ${str(flags, 'days') ?? positional[0]}`);
  }

  const configDir = path.join(ctx.dataDir, 'system', 'config');

  // Bootstrap config. Imported here (not at module scope) because loading these
  // modules initializes singletons — the dispatcher imports this file only to
  // read `spec`, so module import must stay side-effect free.
  const { hydrateProcessEnvFromConfigs } = await import('#system/logging/config.mjs');
  const { initConfigService, configService } = await import('#system/config/index.mjs');
  const { YamlLifelogDatastore } = await import('#adapters/harvester/YamlLifelogDatastore.mjs');
  const { StravaHarvester } = await import('#adapters/harvester/fitness/StravaHarvester.mjs');

  hydrateProcessEnvFromConfigs(configDir);
  await initConfigService(ctx.dataDir);

  console.log(`Backfilling Strava-home session matching for ${username}, ${daysBack} days back...`);

  const { DataService } = await import('#adapters/persistence/files/DataService.mjs');
  const dataService = new DataService({ configService });

  const io = {
    userLoadFile: (u, service) => dataService.user.read(`lifelog/${service}`, u),
    userSaveFile: (u, service, data) => dataService.user.write(`lifelog/${service}`, data, u),
  };

  const lifelogStore = new YamlLifelogDatastore({ io });

  const fitnessHistoryDir = configService.getHouseholdPath('fitness/log');

  // Create a minimal strava client stub (not used by matchBacklog)
  const stubStravaClient = {
    refreshToken: () => { throw new Error('stub'); },
    getActivities: () => { throw new Error('stub'); },
    getActivityStreams: () => { throw new Error('stub'); },
  };

  const harvester = new StravaHarvester({
    stravaClient: stubStravaClient,
    lifelogStore,
    getUserAuth: (service, user) => configService.getUserAuth(service, user),
    getUserDir: (user) => configService.getUserDir(user),
    clientId: configService.getSystemAuth('strava', 'client_id'),
    redirectUri: configService.getSystemAuth('strava', 'redirect_uri') || configService.getSecret('STRAVA_URL'),
    mediaDir: configService.getMediaDir?.(),
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

  return {
    username,
    daysBack,
    fitnessHistoryDir,
    totalEntries,
    alreadyMatched,
    matchedAfter,
    newMatches,
  };
}
