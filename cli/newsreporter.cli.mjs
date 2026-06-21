#!/usr/bin/env node
/**
 * Ad-hoc trigger for a newsreporter report.
 *
 * Drives the running app's manual-run endpoint
 * (POST /api/v1/newsreporter/:id/run), so it reuses the app's exact wiring —
 * sources, consolidator, sinks, renderer — and always matches what's deployed.
 * No service construction in the CLI.
 *
 * Usage:
 *   node cli/newsreporter.cli.mjs <reporter-id> [options]
 *
 * Options:
 *   --date <YYYY-MM-DD>   run for a specific day (resolves {{yesterday}}/{{date}})
 *   --printer <name>      override every printer sink's target
 *   --dry-run             render to stdout, no paper
 *   --force               ignore on_empty:skip
 *   --base-url <url>      app base URL (default: $DAYLIGHT_BASE_URL or http://localhost:3111)
 *   -h, --help            show this help
 *
 * Examples:
 *   # preview without printing
 *   node cli/newsreporter.cli.mjs world-cup-reporter --dry-run --force
 *   # re-print a past day to a test printer
 *   node cli/newsreporter.cli.mjs world-cup-reporter --date 2026-06-19 --printer downstairs
 *   # against prod from inside the container
 *   ssh homeserver.local 'docker exec daylight-station \
 *     node cli/newsreporter.cli.mjs world-cup-reporter --dry-run'
 */

const DEFAULT_BASE = process.env.DAYLIGHT_BASE_URL || 'http://localhost:3111';

export function parse(argv) {
  let id = null;
  let date = null;
  let printer = null;
  let dryRun = false;
  let force = false;
  let baseUrl = DEFAULT_BASE;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') help = true;
    else if (a === '--date') date = argv[++i];
    else if (a === '--printer') printer = argv[++i];
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--force') force = true;
    else if (a === '--base-url') baseUrl = argv[++i];
    else if (a.startsWith('--')) { throw new Error(`unknown flag: ${a}`); }
    else if (!id) id = a;
    else { throw new Error(`unexpected argument: ${a}`); }
  }
  return { id, date, printer, dryRun, force, baseUrl, help };
}

function usage() {
  process.stdout.write(
    'Usage: node cli/newsreporter.cli.mjs <reporter-id> [--date <YYYY-MM-DD>] ' +
    '[--printer <name>] [--dry-run] [--force] [--base-url <url>]\n' +
    `  default base-url: ${DEFAULT_BASE}\n`
  );
}

export function buildBody({ date, printer, dryRun, force }) {
  const body = {};
  if (date) body.date = date;
  if (printer) body.printer = printer;
  if (dryRun) body.dryRun = true;
  if (force) body.force = true;
  return body;
}

async function main() {
  let parsed;
  try { parsed = parse(process.argv.slice(2)); }
  catch (err) { process.stderr.write(`${err.message}\n`); usage(); process.exit(2); }

  const { id, dryRun, baseUrl, help } = parsed;
  if (help || !id) { usage(); process.exit(help ? 0 : 2); }

  const base = baseUrl.replace(/\/+$/, '');
  const url = `${base}/api/v1/newsreporter/${encodeURIComponent(id)}/run`;
  const body = JSON.stringify(buildBody(parsed));

  let res, json;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    json = await res.json().catch(() => ({}));
  } catch (err) {
    process.stderr.write(`✗ ${id}  ${err.message}\n`);
    process.exit(1);
  }

  if (res.status !== 200) {
    process.stderr.write(`✗ ${id}  HTTP ${res.status} ${JSON.stringify(json)}\n`);
    process.exit(1);
  }

  console.log(`status: ${json.status}`);
  if (json.sourceCounts) console.log(`sourceCounts: ${JSON.stringify(json.sourceCounts)}`);
  if (dryRun && json.preview) {
    console.log('\n--- preview ---');
    console.log(json.preview);
  }

  process.exit(json.status === 'error' ? 1 : 0);
}

// Only run main() when invoked directly (not when imported by a test). Detect
// direct invocation via the entry script name to avoid `import.meta`, which the
// Jest/babel CJS transform rewrites into an unavailable `require`.
const entry = process.argv[1] || '';
if (entry.endsWith('newsreporter.cli.mjs')) main();
