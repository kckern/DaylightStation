#!/usr/bin/env node

/**
 * Wikipedia CLI - query the self-hosted Wikipedia service (kiwix-backed)
 *
 * Talks directly to the wikipedia container (no app server needed).
 * Base URL resolves from services.yml (services.wikipedia.<env>), with
 * WIKIPEDIA_URL env var as an override.
 *
 * Usage:
 *   node cli/wikipedia.cli.mjs <command> [options]
 *
 * Commands:
 *   search <query>          Full-text search
 *   article <title>         Fetch an article as plain text (fuzzy title fallback)
 *   random                  Fetch a random article
 *   health                  Service health (kiwix reachability + book id)
 *
 * Options:
 *   --json                  Output as JSON
 *   --limit <n>             Max search results (default: 10)
 *   --chars <n>             Truncate article text to n characters (default: 4000; 0 = full)
 *
 * Examples:
 *   node cli/wikipedia.cli.mjs search "Isaac Newton"
 *   node cli/wikipedia.cli.mjs article "Isaac Newton" --chars 0
 *   node cli/wikipedia.cli.mjs random --json
 *
 * @module cli/wikipedia
 */

import dotenv from 'dotenv';
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { initConfigService, configService } from '#system/config/index.mjs';
import { WikipediaAdapter } from '#adapters/reference/WikipediaAdapter.mjs';

// ============================================================================
// Bootstrap
// ============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

async function resolveBaseUrl() {
  if (process.env.WIKIPEDIA_URL) return process.env.WIKIPEDIA_URL;

  const isDocker = existsSync('/.dockerenv');
  const baseDir = isDocker ? '/usr/src/app' : process.env.DAYLIGHT_BASE_PATH;
  if (!baseDir) {
    console.error('Error: DAYLIGHT_BASE_PATH not set and no WIKIPEDIA_URL override.');
    process.exit(1);
  }
  await initConfigService(path.join(baseDir, 'data'));
  const url = configService.resolveServiceUrl('wikipedia');
  if (!url) {
    console.error('Error: Wikipedia service URL not configured.');
    console.error('Expected: services.wikipedia.<env> in data/system/config/services.yml');
    process.exit(1);
  }
  return url;
}

// ============================================================================
// Parse CLI args
// ============================================================================

const args = process.argv.slice(2);
const flags = { json: args.includes('--json'), limit: 10, chars: 4000 };

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) flags.limit = parseInt(args[++i], 10);
  if (args[i] === '--chars' && args[i + 1]) flags.chars = parseInt(args[++i], 10);
}

const flagsWithValues = new Set(['--limit', '--chars']);
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    if (flagsWithValues.has(args[i])) i++;
    continue;
  }
  positional.push(args[i]);
}

const command = positional[0];
const commandArgs = positional.slice(1);

function usage() {
  console.log(`Usage: node cli/wikipedia.cli.mjs <command> [options]

Commands:
  search <query>     Full-text search
  article <title>    Fetch an article as plain text
  random             Fetch a random article
  health             Service health

Options:
  --json             Output as JSON
  --limit <n>        Max search results (default: 10)
  --chars <n>        Truncate article text (default: 4000; 0 = full)`);
}

function printArticle(article) {
  if (flags.json) {
    console.log(JSON.stringify(article, null, 2));
    return;
  }
  const text = flags.chars > 0 && article.text.length > flags.chars
    ? `${article.text.slice(0, flags.chars)}\n… [truncated at ${flags.chars} chars — use --chars 0 for full text]`
    : article.text;
  console.log(`# ${article.title}\n`);
  console.log(text);
}

// ============================================================================
// Commands
// ============================================================================

async function main() {
  if (!command || command === 'help') {
    usage();
    process.exit(command ? 0 : 1);
  }

  const baseUrl = await resolveBaseUrl();
  const adapter = new WikipediaAdapter({
    baseUrl,
    logger: { debug: () => {}, info: () => {}, warn: console.warn, error: console.error },
  });

  switch (command) {
    case 'search': {
      const query = commandArgs.join(' ');
      if (!query) { console.error('Error: search requires a query'); process.exit(1); }
      const results = await adapter.search(query, { limit: flags.limit });
      if (flags.json) {
        console.log(JSON.stringify(results, null, 2));
      } else if (!results.length) {
        console.log('No results.');
      } else {
        results.forEach((r, i) => {
          const snippet = r.snippet ? ` — ${r.snippet.replace(/\s+/g, ' ').trim()}` : '';
          console.log(`${String(i + 1).padStart(2)}. ${r.title}${snippet}`);
        });
      }
      break;
    }

    case 'article': {
      const title = commandArgs.join(' ');
      if (!title) { console.error('Error: article requires a title'); process.exit(1); }
      const article = await adapter.getArticle(title);
      if (!article) { console.error(`Not found: ${title}`); process.exit(1); }
      printArticle(article);
      break;
    }

    case 'random': {
      printArticle(await adapter.random());
      break;
    }

    case 'health': {
      const health = await adapter.health();
      console.log(flags.json ? JSON.stringify(health) : `${health.status} (book: ${health.book_id}) @ ${baseUrl}`);
      break;
    }

    default:
      console.error(`Unknown command: ${command}\n`);
      usage();
      process.exit(1);
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
