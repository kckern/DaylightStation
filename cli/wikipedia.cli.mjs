#!/usr/bin/env node

/**
 * Wikipedia CLI - query the self-hosted Wikipedia service via the app API
 *
 * Talks to DaylightStation's /api/v1/wikipedia proxy — the server resolves
 * where the wikipedia container actually lives (services.yml), so no host,
 * port, or data-path knowledge is needed here.
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
 *   --base-url <url>        App base URL (default: $DAYLIGHT_BASE_URL or http://localhost:3111)
 *
 * Examples:
 *   node cli/wikipedia.cli.mjs search "Isaac Newton"
 *   node cli/wikipedia.cli.mjs article "Isaac Newton" --chars 0
 *   node cli/wikipedia.cli.mjs random --json
 *
 * @module cli/wikipedia
 */

// ============================================================================
// Parse CLI args
// ============================================================================

const args = process.argv.slice(2);
const flags = { json: args.includes('--json'), limit: 10, chars: 4000, baseUrl: null };

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) flags.limit = parseInt(args[++i], 10);
  if (args[i] === '--chars' && args[i + 1]) flags.chars = parseInt(args[++i], 10);
  if (args[i] === '--base-url' && args[i + 1]) flags.baseUrl = args[++i];
}

const flagsWithValues = new Set(['--limit', '--chars', '--base-url']);
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

const BASE = (flags.baseUrl || process.env.DAYLIGHT_BASE_URL || 'http://localhost:3111').replace(/\/$/, '');
const API = `${BASE}/api/v1/wikipedia`;

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
  --chars <n>        Truncate article text (default: 4000; 0 = full)
  --base-url <url>   App base URL (default: $DAYLIGHT_BASE_URL or http://localhost:3111)`);
}

// ============================================================================
// API helper
// ============================================================================

async function api(path, { allow404 = false } = {}) {
  let res;
  try {
    res = await fetch(`${API}${path}`);
  } catch (err) {
    throw new Error(`app not reachable at ${BASE} (${err.cause?.code || err.message}) — override with --base-url`);
  }
  const body = await res.json().catch(() => null);
  if (allow404 && res.status === 404) return null;
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
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

  switch (command) {
    case 'search': {
      const query = commandArgs.join(' ');
      if (!query) { console.error('Error: search requires a query'); process.exit(1); }
      const params = new URLSearchParams({ q: query, limit: String(flags.limit) });
      const results = await api(`/search?${params}`);
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
      const article = await api(`/article/${encodeURIComponent(title)}`, { allow404: true });
      if (!article) { console.error(`Not found: ${title}`); process.exit(1); }
      printArticle(article);
      break;
    }

    case 'random': {
      printArticle(await api('/random'));
      break;
    }

    case 'health': {
      const health = await api('/health');
      console.log(flags.json ? JSON.stringify(health) : `${health.status} (book: ${health.book_id}) via ${BASE}`);
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
