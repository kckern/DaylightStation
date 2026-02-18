#!/usr/bin/env node

/**
 * Pre-fetch ABS Ebook Chapter Cache
 *
 * Downloads EPUBs, extracts chapter TOC + content, and caches to disk
 * so the feed adapter can serve chapters without per-request downloads.
 *
 * Usage:
 *   node cli/prefetch-abs-ebooks.mjs              # prefetch uncached
 *   node cli/prefetch-abs-ebooks.mjs --force       # rebuild all
 *   node cli/prefetch-abs-ebooks.mjs --dry-run     # show what would be fetched
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { existsSync, readdirSync } from 'fs';

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

hydrateProcessEnvFromConfigs(configDir);
initConfigService(dataDir);

const { ABSEbookFeedAdapter } = await import('#adapters/feed/sources/ABSEbookFeedAdapter.mjs');
const { AudiobookshelfClient } = await import('#adapters/content/readable/audiobookshelf/AudiobookshelfClient.mjs');
const { default: axios } = await import('axios');
const { dataService } = await import('#system/config/index.mjs');

const args = process.argv.slice(2);
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');

// Load ABS config
const absHost = configService.resolveServiceUrl('audiobookshelf');
const absAuth = configService.getHouseholdAuth('audiobookshelf');
if (!absHost || !absAuth?.token) {
  console.error('Audiobookshelf not configured (missing host or token)');
  process.exit(1);
}

const absConfig = { host: absHost, token: absAuth.token };
const mediaDir = configService.getMediaDir();

const adapter = new ABSEbookFeedAdapter({
  absClient: new AudiobookshelfClient(absConfig, { httpClient: axios }),
  token: absConfig.token,
  mediaDir,
});

// Load user queries (abs-ebooks type)
const username = 'kckern';
const userQueriesPath = path.join(dataDir, 'users', username, 'config', 'queries');
let absQueries = [];

// Household queries
const householdQueriesPath = configService.getHouseholdPath('config/lists/queries');
if (householdQueriesPath && existsSync(householdQueriesPath)) {
  const files = readdirSync(householdQueriesPath).filter(f => f.endsWith('.yml'));
  for (const file of files) {
    const key = file.replace('.yml', '');
    const data = dataService.household.read(`config/lists/queries/${key}`);
    if (data?.type === 'abs-ebooks') absQueries.push(data);
  }
}

// User queries
if (existsSync(userQueriesPath)) {
  const files = readdirSync(userQueriesPath).filter(f => f.endsWith('.yml'));
  for (const file of files) {
    const key = file.replace('.yml', '');
    const data = dataService.user.read(`config/queries/${key}`, username);
    if (data?.type === 'abs-ebooks') absQueries.push(data);
  }
}

if (absQueries.length === 0) {
  console.error('No abs-ebooks queries found');
  process.exit(1);
}

console.log(`Found ${absQueries.length} abs-ebooks query config(s)`);
if (force) console.log('Force mode: rebuilding all cache files');
if (dryRun) console.log('Dry-run mode: showing what would be fetched');

for (const query of absQueries) {
  const label = query.params?.genres?.join(', ') || 'all genres';
  console.log(`\nProcessing library ${query.params?.library} [${label}]...`);

  if (dryRun) {
    // Just show what would be prefetched
    const result = await adapter.prefetchAll(query, {
      force,
      onProgress: ({ title, current, total }) => {
        console.log(`  [${current}/${total}] Would cache "${title}"`);
      },
    });
    console.log(`Would cache: ${result.cached}, already cached: ${result.skipped}, failed: ${result.failed}`);
  } else {
    const result = await adapter.prefetchAll(query, {
      force,
      onProgress: ({ title, current, total }) => {
        console.log(`  [${current}/${total}] Cached "${title}"`);
      },
    });
    console.log(`Done: ${result.cached} cached, ${result.skipped} skipped, ${result.failed} failed`);
  }
}
