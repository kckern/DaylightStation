#!/usr/bin/env node
// piano-midi-e2e.cli.mjs — end-to-end health probe for the piano MIDI link.
//
// Why this exists: on 2026-08-22 the kiosk sat one-way for hours — keys lit up on
// screen while every outbound message (voice changes, studio playback) vanished.
// Nothing detected it. The frontend's own health signal read HEALTHY the whole
// time, because it judged the link on `port.state` (the DEVICE is present) rather
// than on whether anything actually arrived at the other end.
//
// So this probe deliberately does not trust any single layer. It reads the two
// halves of the path from OPPOSITE ends and compares them:
//
//   piano →USB→ JamCorder →BLE→ tablet →WS→ browser      (IN)
//   browser →BLE→ JamCorder →USB/DIN→ piano              (OUT)
//
// The decisive evidence for OUT is the JamCorder's own `ble.in` counter: it counts
// messages the hub RECEIVED from the tablet. The browser cannot fake it, and Web
// MIDI's fire-and-forget send() gives no delivery signal of its own.
//
// Usage:
//   node cli/piano-midi-e2e.cli.mjs                 # read-only health probe
//   node cli/piano-midi-e2e.cli.mjs --send          # ACTIVE test: reload the kiosk,
//                                                   # then prove ble.in climbed
//   node cli/piano-midi-e2e.cli.mjs --json          # machine-readable
//
// Exit code is 0 only when both directions are healthy, so it can be scheduled.
//
// Hosts come from data/household/hardware/devices.yml (`midi-recorder.host` and
// the piano tablet), overridable with JAMCORDER_HOST / PB_HOST / FKB_HOST.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const ACTIVE = args.includes('--send');
const JSON_OUT = args.includes('--json');

// ── Host resolution (config first, env override, no silent hardcoding) ────────
function dataDir() {
  if (process.env.DAYLIGHT_DATA_PATH) return process.env.DAYLIGHT_DATA_PATH;
  const base = process.env.DAYLIGHT_BASE_PATH;
  if (base) return `${base}/data`;
  // .env in the repo root is how this workspace points at the Dropbox tree.
  try {
    const env = readFileSync(new URL('../.env', import.meta.url), 'utf-8');
    const m = env.match(/^DAYLIGHT_BASE_PATH=(.+)$/m);
    if (m) return `${m[1].trim()}/data`;
  } catch { /* fall through */ }
  return null;
}

function jamcorderHostFromConfig() {
  const d = dataDir();
  if (!d) return null;
  const p = `${d}/household/hardware/devices.yml`;
  if (!existsSync(p)) return null;
  const yml = readFileSync(p, 'utf-8');
  // Narrow read: the `host:` inside the midi-recorder block. Deliberately not a
  // YAML dependency — this CLI must run before/without the app.
  const block = yml.split(/^\s{2}midi-recorder:\s*$/m)[1];
  if (!block) return null;
  const m = block.match(/^\s+host:\s*(\S+)/m);
  return m ? m[1] : null;
}

const JAMCORDER = process.env.JAMCORDER_HOST || jamcorderHostFromConfig();
const PB = process.env.PB_HOST || '10.0.0.245:8770';
const FKB = process.env.FKB_HOST || '10.0.0.245:2323';

if (!JAMCORDER) {
  console.error('Could not resolve the JamCorder host (devices.yml midi-recorder.host).');
  console.error('Set JAMCORDER_HOST=<ip> and retry.');
  process.exit(2);
}

// ── Fetch helpers ────────────────────────────────────────────────────────────
async function getText(url, ms = 12000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  const buf = Buffer.from(await res.arrayBuffer());
  // The JamCorder gzips device-state and sometimes answers without the header.
  const body = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf;
  return body.toString('utf-8');
}
async function getJson(url, ms = 12000) { return JSON.parse(await getText(url, ms)); }

// device-state is a large gzipped blob; pull just the counter block out of it
// rather than parsing the whole thing (it contains non-UTF8 device strings that
// break a strict JSON.parse).
function extractBlock(raw, key) {
  const at = raw.indexOf(`"${key}"`);
  if (at < 0) return null;
  const open = raw.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < raw.length; i += 1) {
    if (raw[i] === '{') depth += 1;
    else if (raw[i] === '}') { depth -= 1; if (depth === 0) return raw.slice(open, i + 1); }
  }
  return null;
}
function counters(raw) {
  const block = extractBlock(raw, 'midiMsgCounts');
  if (!block) return null;
  const out = {};
  for (const [, name, body] of block.matchAll(/"(uart|usb|ble|ws)":\s*\{([^}]*)\}/g)) {
    out[name] = Object.fromEntries(
      [...body.matchAll(/"(\w+)":\s*(\d+)/g)].map(([, k, v]) => [k, Number(v)]),
    );
  }
  return out;
}

async function jamcorderState() {
  // Retried: the device intermittently answers a truncated body.
  for (let i = 0; i < 4; i += 1) {
    try {
      const raw = await getText(`http://${JAMCORDER}/api/device-state/get`);
      const c = counters(raw);
      if (c) return c;
    } catch { /* retry */ }
  }
  return null;
}

// ── Probes ───────────────────────────────────────────────────────────────────
async function probeJamcorder() {
  const out = { host: JAMCORDER, reachable: false };
  try {
    out.routing = await getJson(`http://${JAMCORDER}/api/midi-io/settings/get`);
    out.reachable = true;
  } catch (e) { out.error = String(e.message || e); return out; }
  try {
    const bt = await getJson(`http://${JAMCORDER}/api/bluetooth/state/get`);
    out.bleName = bt.gapDeviceName;
    out.bleClients = (bt.clients || []).length;
  } catch { /* non-fatal */ }
  out.counters = await jamcorderState();
  return out;
}

async function probeBridge() {
  const out = { host: PB, reachable: false };
  try {
    const s = await getJson(`http://${PB}/status`);
    out.reachable = true;
    out.ble = s.ble || {};
    out.wsClients = s.wsClients;
  } catch (e) { out.error = String(e.message || e); return out; }
  try {
    // The authoritative Android-side truth for the OUT path. `mInputPortOpen` is
    // the device's INPUT port — the one you WRITE to. False means nothing on this
    // tablet can reach the piano, no matter what the browser believes.
    const r = await getJson(`http://${PB}/exec?cmd=${encodeURIComponent('dumpsys midi')}`, 25000);
    const txt = r.stdout || '';
    out.inputPortOpen = /mInputPortOpen=\[true\]/.test(txt);
    out.outputPortOpenCount = Number(txt.match(/mOutputPortOpenCount=\[(\d+)\]/)?.[1] ?? -1);
    out.deviceConnections = Number(txt.match(/DeviceConnection count:\s*(\d+)/)?.[1] ?? -1);
  } catch (e) { out.dumpsysError = String(e.message || e); }
  try {
    // The rolling verdict from the APK's own loopback probe — the piano's echo,
    // refreshed every heartbeat (~1/min). This is the ONLY read-only signal that
    // says "OUT delivers NOW" rather than "OUT delivered at some point".
    const r = await getJson(`http://${PB}/loopback`);
    out.loopback = r.loopback || null;
  } catch (e) { out.loopbackError = String(e.message || e); }
  return out;
}

function reloadKiosk() {
  const pw = process.env.FKB_PW
    || (existsSync('/tmp/fkb_piano_pw') ? readFileSync('/tmp/fkb_piano_pw', 'utf-8').trim() : null);
  if (!pw) throw new Error('no FKB password (set FKB_PW or /tmp/fkb_piano_pw)');
  const url = `http://${FKB}/?cmd=loadStartUrl&password=${encodeURIComponent(pw)}`;
  execFileSync('curl', ['-s', '--max-time', '15', '-o', '/dev/null', url]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Main ─────────────────────────────────────────────────────────────────────
const report = { at: new Date().toISOString() };
report.jamcorder = await probeJamcorder();
report.bridge = await probeBridge();

// IN verdict: the piano's notes reach the tablet. usb.in counts what the hub read
// from the piano; usb.bleOut counts what it forwarded over BLE. They move together.
const c = report.jamcorder.counters;
report.in = {
  hubReadFromPiano: c?.usb?.in ?? null,
  hubForwardedToTablet: c?.usb?.bleOut ?? null,
  bridgeConnected: report.bridge.ble?.state === 'CONNECTED',
};
report.in.healthy = !!(report.in.bridgeConnected && (c?.usb?.in ?? 0) > 0);

// OUT verdict: bytes actually ARRIVED at the hub from the tablet, and the hub
// forwarded them to the piano.
report.out = {
  hubReceivedFromTablet: c?.ble?.in ?? null,
  hubForwardedToPianoUsb: c?.ble?.usbOut ?? null,
  hubForwardedToPianoDin: c?.ble?.uartOut ?? null,
  androidInputPortOpen: report.bridge.inputPortOpen ?? null,
  bleToDin: report.jamcorder.routing?.bleToDin ?? null,
  sysexFilteringOff: report.jamcorder.routing?.filtering === false,
};
// Verdict, in order of what a signal can actually prove.
//
// 2026-08-26: this check used to be `androidInputPortOpen && hubReceivedFromTablet > 0`
// — a LIFETIME cumulative counter thresholded at zero. A counter frozen 19 hours
// earlier still satisfied it, so this CLI printed "healthy (both directions)"
// throughout the exact outage it was written to catch. `ble.in > 0` means "the hub
// received something once", never "OUT works now". Same class of error as trusting
// port.state: a signal that cannot go false while the fault is present.
//
// The APK's loopback verdict IS live — it sends an inaudible probe note and waits
// for the piano's own echo, once per heartbeat. Prefer it absolutely; fall back to
// the counter heuristic only when the bridge can't be asked, and say so.
const lb = report.bridge.loopback;
report.out.verified = lb?.outVerified ?? null;
report.out.echoAgoMs = lb?.lastEchoAgoMs ?? null;
report.out.consecutiveMisses = lb?.consecutiveMisses ?? null;
report.out.lastRttMs = lb?.lastRttMs ?? null;
if (lb && typeof lb.outVerified === 'boolean') {
  report.out.healthy = lb.outVerified;
  report.out.verdictSource = 'loopback-echo';
} else {
  // Weak fallback: cannot distinguish "delivered once, long ago" from "delivering".
  report.out.healthy = report.out.androidInputPortOpen === true
    && (report.out.hubReceivedFromTablet ?? 0) > 0;
  report.out.verdictSource = 'counters-weak';
}

if (ACTIVE) {
  // A kiosk reload makes the page re-run requestMIDIAccess and fire its control
  // burst (local-control + CC + voice), so ble.in must climb if OUT is alive.
  const before = c?.ble?.in ?? 0;
  reloadKiosk();
  let after = before;
  for (let i = 0; i < 8; i += 1) {
    await sleep(5000);
    const now = await jamcorderState();
    after = now?.ble?.in ?? after;
    if (after > before) break;
  }
  report.activeTest = { bleInBefore: before, bleInAfter: after, delivered: after > before };
  report.out.healthy = report.activeTest.delivered;
  report.bridge = await probeBridge(); // re-read: the port should now be open
  report.out.androidInputPortOpen = report.bridge.inputPortOpen ?? null;
}

report.healthy = report.in.healthy && report.out.healthy;

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const tick = (b) => (b === true ? '✓' : b === false ? '✗' : '?');
  console.log(`JamCorder ${JAMCORDER}  ${tick(report.jamcorder.reachable)} reachable`
    + `  ble=${report.jamcorder.bleName ?? '—'} clients=${report.jamcorder.bleClients ?? '?'}`);
  console.log(`  routing        : bleToDin=${tick(report.out.bleToDin)}`
    + `  filtering-off=${tick(report.out.sysexFilteringOff)}  (both required for OUT + SysEx)`);
  console.log(`Bridge APK ${PB}  ${tick(report.bridge.reachable)} reachable`
    + `  ble=${report.bridge.ble?.state ?? '—'}`
    + ` uptime=${report.bridge.ble?.connectedSeconds ?? '?'}s`
    + ` reconnects=${report.bridge.ble?.reconnects ?? '?'}`);
  console.log('');
  console.log(`IN   piano → screen        ${tick(report.in.healthy)}`);
  console.log(`  hub read from piano  : ${report.in.hubReadFromPiano}`);
  console.log(`  forwarded to tablet  : ${report.in.hubForwardedToTablet}`);
  console.log('');
  console.log(`OUT  screen → piano       ${tick(report.out.healthy)}`);
  console.log(`  piano ECHOED the probe   : ${tick(report.out.verified)}`
    + `   <- the decisive signal (${report.out.verdictSource})`);
  if (report.out.verified === false) {
    console.log(`  unanswered probes        : ${report.out.consecutiveMisses}`
      + `   (last echo: ${report.out.echoAgoMs === -1 ? 'NEVER' : `${report.out.echoAgoMs}ms ago`})`);
  } else if (report.out.verified === true) {
    console.log(`  echo round-trip          : ${report.out.lastRttMs}ms`);
  }
  console.log(`  hub received from tablet : ${report.out.hubReceivedFromTablet}   (cumulative — NOT proof of now)`);
  console.log(`  forwarded to piano (USB) : ${report.out.hubForwardedToPianoUsb}`);
  console.log(`  forwarded to piano (DIN) : ${report.out.hubForwardedToPianoDin}`);
  console.log(`  android write port open  : ${tick(report.out.androidInputPortOpen)}`);
  if (report.activeTest) {
    console.log(`  active test              : ble.in ${report.activeTest.bleInBefore}`
      + ` → ${report.activeTest.bleInAfter}  ${tick(report.activeTest.delivered)}`);
  }
  console.log('');
  if (!report.healthy && !ACTIVE) {
    console.log('Counters are cumulative since the hub last booted, so a fresh zero is');
    console.log('ambiguous. Re-run with --send to force traffic and settle it.');
  }
  console.log(report.healthy ? 'VERDICT: healthy (both directions)' : 'VERDICT: NOT healthy');
}

process.exit(report.healthy ? 0 : 1);
