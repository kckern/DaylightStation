#!/usr/bin/env node
/**
 * Batch (re)generate fitness time-lapse recaps.
 *
 * Drives the running app's manual re-gen endpoint
 * (POST /api/v1/fitness/sessions/:id/timelapse, which runs with force:true), so
 * it reuses the app's exact wiring — providers, resolvers, the new renderer — and
 * always matches what's deployed. Each render runs in the BACKGROUND on the server;
 * this just enqueues them and reports the accepted status. Watch the server log for
 * `fitness.timelapse.ready` (or `.failed`) to see completion.
 *
 * Usage:
 *   node cli/regen-timelapse.cli.mjs <sessionId> [<sessionId> ...] [options]
 *
 * Options:
 *   --household <id>     household id (omit for the default household)
 *   --base-url <url>     app base URL (default: $DAYLIGHT_BASE_URL or http://localhost:3111)
 *   -h, --help           show this help
 *
 * Examples:
 *   # locally / inside the container
 *   node cli/regen-timelapse.cli.mjs 20260617193446 20260612180809
 *   # against prod from inside the container
 *   ssh homeserver.local 'docker exec daylight-station \
 *     node cli/regen-timelapse.cli.mjs 20260617193446'
 *
 * Note: only sessions whose raw screenshots still exist on disk can render — a
 * session whose frames were already cleaned up will come back `skipped`/`failed`.
 */

const DEFAULT_BASE = process.env.DAYLIGHT_BASE_URL || 'http://localhost:3111';

function parse(argv) {
  const ids = [];
  let household = null;
  let baseUrl = DEFAULT_BASE;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') help = true;
    else if (a === '--household') household = argv[++i];
    else if (a === '--base-url') baseUrl = argv[++i];
    else if (a.startsWith('--')) { throw new Error(`unknown flag: ${a}`); }
    else ids.push(a);
  }
  return { ids, household, baseUrl, help };
}

function usage() {
  process.stdout.write(
    'Usage: node cli/regen-timelapse.cli.mjs <sessionId>... [--household <id>] ' +
    `[--base-url <url>]\n  default base-url: ${DEFAULT_BASE}\n`
  );
}

async function main() {
  let parsed;
  try { parsed = parse(process.argv.slice(2)); }
  catch (err) { process.stderr.write(`${err.message}\n`); usage(); process.exit(2); }

  const { ids, household, baseUrl, help } = parsed;
  if (help || !ids.length) { usage(); process.exit(help ? 0 : 2); }

  const base = baseUrl.replace(/\/+$/, '');
  const body = JSON.stringify(household ? { household } : {});
  let accepted = 0, failed = 0;

  for (const id of ids) {
    const url = `${base}/api/v1/fitness/sessions/${encodeURIComponent(id)}/timelapse`;
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const json = await res.json().catch(() => ({}));
      if (res.status === 202 && json.ok) { accepted++; console.log(`✓ ${id}  accepted (${json.status})`); }
      else { failed++; console.log(`✗ ${id}  HTTP ${res.status} ${JSON.stringify(json)}`); }
    } catch (err) {
      failed++; console.log(`✗ ${id}  ${err.message}`);
    }
  }

  console.log(`\n${accepted} accepted, ${failed} failed.`);
  console.log('Renders run in the background — watch the server log for `fitness.timelapse.ready`.');
  process.exit(failed ? 1 : 0);
}

main();
