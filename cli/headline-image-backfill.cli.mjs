#!/usr/bin/env node

/**
 * Headline Image Backfill CLI
 *
 * One-time backfill: fetch og:image for cached headline items that have no image.
 * Reads all cached headline YAML files for a user, finds items with a link but
 * no image, fetches each article page to extract og:image, then updates the cache.
 *
 * Usage:
 *   node cli/headline-image-backfill.cli.mjs [options]
 *
 * Options:
 *   --source <id>     Only backfill a specific source
 *   --username <user> Target user (default: head of household)
 *   --dry-run         Preview without writing changes
 *   --help            Show this help
 *
 * @module cli/headline-image-backfill
 */

import dotenv from 'dotenv';
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { initConfigService, configService } from '#system/config/index.mjs';
import { hydrateProcessEnvFromConfigs } from '#system/logging/config.mjs';
import { DataService } from '#system/config/DataService.mjs';
import { WebContentAdapter } from '#adapters/feed/WebContentAdapter.mjs';
import { YamlHeadlineCacheStore } from '#adapters/persistence/yaml/YamlHeadlineCacheStore.mjs';

// ============================================================================
// Bootstrap
// ============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

const isDocker = existsSync('/.dockerenv');
const baseDir = isDocker ? '/usr/src/app' : process.env.DAYLIGHT_BASE_PATH;

if (!baseDir) {
  console.error('Error: DAYLIGHT_BASE_PATH not set.');
  process.exit(1);
}

const dataDir = path.join(baseDir, 'data');
const configDir = path.join(dataDir, 'system', 'config');

hydrateProcessEnvFromConfigs(configDir);
initConfigService(dataDir);

const dataService = new DataService({ configService });
const webContent = new WebContentAdapter({});
const store = new YamlHeadlineCacheStore({ dataService });

// ============================================================================
// Parse CLI args
// ============================================================================

const args = process.argv.slice(2);
const flags = {
  source: null,
  username: null,
  dryRun: args.includes('--dry-run'),
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--source' && args[i + 1]) flags.source = args[++i];
  if (args[i] === '--username' && args[i + 1]) flags.username = args[++i];
}

if (!flags.username) {
  flags.username = configService.getHeadOfHousehold();
}

// ============================================================================
// Help
// ============================================================================

function showHelp() {
  console.log(`
headline-image-backfill -- fetch og:image for cached headlines missing images

Usage:
  node cli/headline-image-backfill.cli.mjs [options]

Options:
  --source <id>     Only backfill a specific source
  --username <user> Target user (default: head of household)
  --dry-run         Preview without writing changes
  --help            Show this help

Examples:
  node cli/headline-image-backfill.cli.mjs
  node cli/headline-image-backfill.cli.mjs --source cnn
  node cli/headline-image-backfill.cli.mjs --dry-run
  node cli/headline-image-backfill.cli.mjs --username kckern --source bbc --dry-run
`);
}

// ============================================================================
// Main
// ============================================================================

const CONCURRENCY = 3;

async function main() {
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  console.log(`Backfilling og:image for user: ${flags.username}`);
  if (flags.dryRun) console.log('  (dry-run mode — no files will be written)\n');

  const allSources = await store.loadAllSources(flags.username);
  const sourceIds = flags.source
    ? [flags.source].filter(id => allSources[id])
    : Object.keys(allSources);

  if (flags.source && !allSources[flags.source]) {
    console.error(`Source "${flags.source}" not found in cache.`);
    process.exit(1);
  }

  if (sourceIds.length === 0) {
    console.log('No cached headline sources found.');
    process.exit(0);
  }

  let total = 0;
  let enriched = 0;
  let failed = 0;

  for (const sourceId of sourceIds) {
    const data = allSources[sourceId];
    const candidates = (data.items || []).filter(i => !i.image && i.link);
    if (candidates.length === 0) continue;

    console.log(`\n[${sourceId}] ${candidates.length} items missing images (${data.items.length} total)`);
    let modified = false;

    // Concurrency-limited processing
    let active = 0;
    let idx = 0;

    await new Promise((resolve) => {
      if (candidates.length === 0) { resolve(); return; }

      const next = () => {
        while (active < CONCURRENCY && idx < candidates.length) {
          const item = candidates[idx++];
          const num = ++total;
          active++;
          webContent.extractReadableContent(item.link)
            .then(result => {
              if (result?.ogImage) {
                item.image = result.ogImage;
                modified = true;
                enriched++;
                console.log(`  [${num}] + ${item.title?.substring(0, 60) || '(untitled)'}`);
              } else {
                console.log(`  [${num}] - no og:image -- ${item.title?.substring(0, 60) || '(untitled)'}`);
              }
            })
            .catch(err => {
              failed++;
              console.log(`  [${num}] x ${err.message} -- ${item.title?.substring(0, 40) || '(untitled)'}`);
            })
            .finally(() => {
              active--;
              if (idx >= candidates.length && active === 0) resolve();
              else next();
            });
        }
      };
      next();
    });

    if (modified && !flags.dryRun) {
      await store.saveSource(sourceId, data, flags.username);
      console.log(`  -> saved ${sourceId}`);
    } else if (modified && flags.dryRun) {
      console.log(`  -> [dry-run] would save ${sourceId}`);
    }
  }

  console.log(`\nDone. ${enriched} enriched, ${failed} failed, ${total} checked.`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
