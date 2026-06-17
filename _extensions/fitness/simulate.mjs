#!/usr/bin/env node
/**
 * Fingerprint unlock SIMULATION CLI — fire from the garage box (or via SSH).
 *
 * Resolves the most-recent pending fingerprint-unlock request held by the
 * daylight-fitness container when it runs with FINGERPRINT_SIM=interactive,
 * letting you test the entire unlock chain (kiosk tap -> backend -> eventbus ->
 * container -> result -> unlock) WITHOUT the physical reader.
 *
 * Prereq: the container must be started with FINGERPRINT_SIM=interactive.
 *
 * Usage (on the garage box):
 *   node simulate.mjs match            # simulate a successful scan (sim-/first candidate)
 *   node simulate.mjs match <uuid>     # simulate a match for a specific enrolled uuid
 *   node simulate.mjs deny             # simulate a non-matching / rejected scan
 *   node simulate.mjs pending          # list the currently-pending unlock requests
 *
 * From your workstation over SSH:
 *   ssh garage 'node /opt/fitness-controller/simulate.mjs match'
 *
 * Override the container host/port via env: FP_HOST=127.0.0.1 FP_PORT=3000
 *
 * (This is a .mjs rather than a .sh because *.sh is gitignored repo-wide; Node 18+
 *  is already required by this extension and `fetch` is built in.)
 */

const HOST = process.env.FP_HOST || '127.0.0.1';
const PORT = process.env.FP_PORT || '3000';
const BASE = `http://${HOST}:${PORT}/fingerprint`;
const [action, uuid] = process.argv.slice(2);

async function post(body) {
  const res = await fetch(`${BASE}/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return text;
}

async function get(path) {
  const res = await fetch(`${BASE}/${path}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return text;
}

try {
  if (action === 'match') {
    const body = uuid ? { match: true, uuid } : { match: true };
    console.log(`→ simulate match ${JSON.stringify(body)}`);
    console.log(await post(body));
  } else if (action === 'deny') {
    console.log('→ simulate deny');
    console.log(await post({ match: false }));
  } else if (action === 'pending') {
    console.log('→ pending requests');
    console.log(await get('pending'));
  } else {
    console.error('usage: node simulate.mjs {match [uuid]|deny|pending}');
    process.exit(2);
  }
} catch (err) {
  console.error(`✗ ${err.message}`);
  console.error('  (is the container up with FINGERPRINT_SIM=interactive, and is a request pending?)');
  process.exit(1);
}
