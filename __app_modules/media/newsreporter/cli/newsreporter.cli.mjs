#!/usr/bin/env node
/**
 * Ad-hoc trigger for a newsreporter reporter.
 *
 * Drives the running app's API (/api/v1/newsreporter), so it reuses the app's
 * exact wiring and always matches what's deployed. No service construction
 * in the CLI.
 *
 * Usage:
 *   node cli/newsreporter.cli.mjs <reporter-id> [options]
 *
 * Report reporters (POST /:id/run):
 *   --date <YYYY-MM-DD>   run for a specific day (resolves {{yesterday}}/{{date}})
 *   --printer <name>      override every printer sink's target
 *   --dry-run             render to stdout, no paper
 *   --force               ignore on_empty:skip
 *
 * Edition reporters (the office paper):
 *   --compose             POST /:id/compose (with --dry-run: store nothing)
 *   --deliver             POST /:id/deliver (with --printer, --force, --date)
 *   --out <file.png>      write the edition image: the dry run's PNG, or the
 *                         stored one after a real compose
 *
 *   --base-url <url>      app base URL (default: $DAYLIGHT_BASE_URL or http://localhost:3111)
 *   -h, --help            show this help
 *
 * Examples:
 *   # preview the office paper as an image, store nothing
 *   node cli/newsreporter.cli.mjs office-paper --compose --dry-run --out /tmp/paper.png
 *   # compose for real, then print it on the office printer
 *   node cli/newsreporter.cli.mjs office-paper --compose
 *   node cli/newsreporter.cli.mjs office-paper --deliver
 *   # reprint today's paper upstairs
 *   node cli/newsreporter.cli.mjs office-paper --deliver --force --printer upstairs
 *   # report kind: preview without printing
 *   node cli/newsreporter.cli.mjs world-cup-reporter --dry-run --force
 */
import { writeBinary } from '#system/utils/FileIO.mjs';

const DEFAULT_BASE = process.env.DAYLIGHT_BASE_URL || 'http://localhost:3111';

export function parse(argv) {
  let id = null;
  let date = null;
  let printer = null;
  let dryRun = false;
  let force = false;
  let compose = false;
  let deliver = false;
  let out = null;
  let baseUrl = DEFAULT_BASE;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') help = true;
    else if (a === '--date') date = argv[++i];
    else if (a === '--printer') printer = argv[++i];
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--force') force = true;
    else if (a === '--compose') compose = true;
    else if (a === '--deliver') deliver = true;
    else if (a === '--out') out = argv[++i];
    else if (a === '--base-url') baseUrl = argv[++i];
    else if (a.startsWith('--')) { throw new Error(`unknown flag: ${a}`); }
    else if (!id) id = a;
    else { throw new Error(`unexpected argument: ${a}`); }
  }
  if (compose && deliver) throw new Error('--compose and --deliver are separate steps; run one at a time');
  if (out && !compose) throw new Error('--out needs --compose');
  return { id, date, printer, dryRun, force, compose, deliver, out, baseUrl, help };
}

function usage() {
  process.stdout.write(
    'Usage: node cli/newsreporter.cli.mjs <reporter-id> [--date <YYYY-MM-DD>] [--printer <name>] [--dry-run] [--force]\n' +
    '       node cli/newsreporter.cli.mjs <edition-id> --compose [--dry-run] [--date <YYYY-MM-DD>] [--out <file.png>]\n' +
    '       node cli/newsreporter.cli.mjs <edition-id> --deliver [--printer <name>] [--force] [--date <YYYY-MM-DD>]\n' +
    `  [--base-url <url>]  default: ${DEFAULT_BASE}\n`
  );
}

/** Body for POST /:id/run (report kind). */
export function buildBody({ date, printer, dryRun, force }) {
  const body = {};
  if (date) body.date = date;
  if (printer) body.printer = printer;
  if (dryRun) body.dryRun = true;
  if (force) body.force = true;
  return body;
}

/** The request one invocation makes: `{ path, body }`. */
export function buildRequest(parsed) {
  const id = encodeURIComponent(parsed.id);
  if (parsed.compose) {
    return { path: `/api/v1/newsreporter/${id}/compose`, body: { ...(parsed.date ? { date: parsed.date } : {}), ...(parsed.dryRun ? { dryRun: true } : {}) } };
  }
  if (parsed.deliver) {
    return {
      path: `/api/v1/newsreporter/${id}/deliver`,
      body: { ...(parsed.date ? { date: parsed.date } : {}), ...(parsed.printer ? { printer: parsed.printer } : {}), ...(parsed.force ? { force: true } : {}), trigger: 'cli' },
    };
  }
  return { path: `/api/v1/newsreporter/${id}/run`, body: buildBody(parsed) };
}

/** Decode a dry run's `png` (base64, tolerating a data: prefix). */
export function decodePng(png) {
  const raw = String(png || '').replace(/^data:image\/png;base64,/, '');
  return raw ? Buffer.from(raw, 'base64') : null;
}

function printEdition(edition) {
  if (!edition) return;
  const stories = Array.isArray(edition.stories) ? edition.stories.length : null;
  const parts = [
    edition.date && `date: ${edition.date}`,
    edition.number != null && `no. ${edition.number}`,
    edition.image?.heightCm != null && `${edition.image.heightCm} cm`,
    stories != null && `${stories} stories`,
    edition.inputs?.headlines != null && `${edition.inputs.headlines} headlines`,
    edition.inputs?.pick?.method && `pick: ${edition.inputs.pick.method}${edition.inputs.pick.failed ? ` (${edition.inputs.pick.failed} failed)` : ''}`,
    (edition.inputs?.missing ?? edition.missing)?.length && `missing: ${(edition.inputs?.missing ?? edition.missing).join(', ')}`,
    edition.deliveredAt && `printed ${edition.deliveredAt} on ${edition.printer}`,
    edition.costUsd != null && `$${edition.costUsd}`,
  ].filter(Boolean);
  if (parts.length) console.log(parts.join(' · '));
  for (const s of edition.stories || []) console.log(`  [${s.category}] ${s.headline}${s.interest != null ? `  (interest ${s.interest})` : ''}`);
}

async function main() {
  let parsed;
  try { parsed = parse(process.argv.slice(2)); }
  catch (err) { process.stderr.write(`${err.message}\n`); usage(); process.exit(2); }

  const { id, dryRun, baseUrl, help } = parsed;
  if (help || !id) { usage(); process.exit(help ? 0 : 2); }

  const base = baseUrl.replace(/\/+$/, '');
  const { path, body } = buildRequest(parsed);

  let res, json;
  try {
    res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
  if (json.error) console.log(`error: ${json.error}`);
  if (json.sourceCounts) console.log(`sourceCounts: ${JSON.stringify(json.sourceCounts)}`);
  if (parsed.compose || parsed.deliver) printEdition(json.edition);
  if (!parsed.compose && !parsed.deliver && dryRun && json.preview) {
    console.log('\n--- preview ---');
    console.log(json.preview);
  }

  if (parsed.out && json.status === 'composed') {
    let png = dryRun ? decodePng(json.png) : null;
    if (!dryRun) {
      const date = json.edition?.date;
      const img = await fetch(`${base}/api/v1/newsreporter/${encodeURIComponent(id)}/editions/${date}/image.png`);
      png = img.ok ? Buffer.from(await img.arrayBuffer()) : null;
    }
    if (!png) { process.stderr.write('✗ no image to write\n'); process.exit(1); }
    writeBinary(parsed.out, png);
    console.log(`image: ${parsed.out} (${png.length} bytes)`);
  }

  const failed = ['error', 'failed', 'print_failed', 'compose_failed'].includes(json.status);
  process.exit(failed ? 1 : 0);
}

// Only run main() when invoked directly (not when imported by a test). Detect
// direct invocation via the entry script name to avoid `import.meta`, which the
// Jest/babel CJS transform rewrites into an unavailable `require`.
const entry = process.argv[1] || '';
if (entry.endsWith('newsreporter.cli.mjs')) main();
