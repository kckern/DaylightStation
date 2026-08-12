#!/usr/bin/env node
// =============================================================================
// ota-when-online.mjs — poll for the device, then OTA the staged build.
//
// The device is only reachable while the engine is running AND it is in home
// WiFi range: standby deep-sleeps it when the engine is off, and on a wake with
// the engine still off it goes straight back to sleep WITHOUT powering the
// radio. In practice that leaves the minute or two between pulling into the
// driveway and switching off — too narrow to catch by hand.
//
// So: sit on it. Poll /status, and the moment it answers, inhibit standby (so
// the window cannot close mid-upload), POST the firmware, and verify the
// version came back changed.
//
//   node tools/ota-when-online.mjs                       # wait indefinitely
//   node tools/ota-when-online.mjs --timeout-min 120     # give up after 2h
//   node tools/ota-when-online.mjs --host 10.0.0.35
//
// Build first: pio run -e freematics-oneplus-b
// =============================================================================
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIRMWARE = path.join(__dirname, '..', 'firmware', '.pio', 'build', 'freematics-oneplus-b', 'firmware.bin');

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : dflt;
};
const HOST = arg('host', '10.0.0.35');
const TIMEOUT_MIN = Number(arg('timeout-min', 0));       // 0 = forever
const POLL_S = Number(arg('poll-s', 15));
const INHIBIT_MIN = Number(arg('inhibit-min', 30));

const base = `http://${HOST}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(pathname, timeoutMs = 4000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${pathname}`, { signal: ctl.signal });
    return { ok: res.ok, status: res.status, body: await res.text() };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  if (!existsSync(FIRMWARE)) {
    console.error(`no staged build at ${FIRMWARE}\nrun: pio run -e freematics-oneplus-b`);
    process.exit(1);
  }
  const bin = readFileSync(FIRMWARE);
  console.log(`firmware: ${FIRMWARE}`);
  console.log(`          ${bin.length} bytes, built ${statSync(FIRMWARE).mtime.toISOString()}`);
  console.log(`waiting for ${HOST} (poll ${POLL_S}s${TIMEOUT_MIN ? `, timeout ${TIMEOUT_MIN}min` : ', no timeout'})…`);
  console.log('the device is only up with the engine running and in WiFi range.\n');

  const deadline = TIMEOUT_MIN ? Date.now() + TIMEOUT_MIN * 60000 : Infinity;
  let probes = 0;
  let status = null;

  while (Date.now() < deadline) {
    const res = await get('/status');
    probes += 1;
    if (res.ok) { status = res; break; }
    if (probes % 20 === 1) process.stdout.write(`  [${new Date().toLocaleTimeString()}] not up yet (${probes} probes)\n`);
    await sleep(POLL_S * 1000);
  }

  if (!status) { console.error(`\ngave up after ${probes} probes — device never answered.`); process.exit(2); }

  let before = {};
  try { before = JSON.parse(status.body); } catch { /* keep going */ }
  console.log(`\nONLINE. fw=${before.firmware} uptime=${before.uptime_s}s rssi=${before.wifi?.rssi}`);

  // Hold standby off first: without this the engine can be switched off
  // mid-upload and the device sleeps with a half-written partition.
  const inh = await get(`/standby/inhibit?minutes=${INHIBIT_MIN}`);
  console.log(`standby inhibit ${INHIBIT_MIN}min: ${inh.ok ? 'ok' : `FAILED (${inh.error || inh.status})`}`);

  console.log('uploading…');
  const form = new FormData();
  form.append('firmware', new Blob([bin], { type: 'application/octet-stream' }), 'firmware.bin');
  const up = await fetch(`${base}/update`, { method: 'POST', body: form }).catch((e) => ({ ok: false, statusText: e.message }));
  if (!up.ok) { console.error(`upload FAILED: ${up.statusText}`); process.exit(3); }
  console.log(`upload accepted: ${(await up.text()).trim()}`);

  console.log('waiting for reboot…');
  await sleep(12000);
  for (let i = 0; i < 20; i++) {
    const res = await get('/status');
    if (res.ok) {
      const after = JSON.parse(res.body);
      const changed = after.firmware !== before.firmware;
      console.log(`\nback up: fw=${after.firmware} (was ${before.firmware}) — ${changed ? 'UPDATED' : 'UNCHANGED, check the build'}`);
      console.log(`led_mode=${after.led_mode}`);
      console.log(`\nNow try, watching the car each time:\n  curl "${base}/led?mode=low"\n  curl "${base}/led?mode=high"\n  curl "${base}/led?mode=float"   # restore default`);
      process.exit(changed ? 0 : 4);
    }
    await sleep(3000);
  }
  console.error('did not come back within 72s — check it on the next drive.');
  process.exit(5);
}

main().catch((err) => { console.error(err); process.exit(1); });
