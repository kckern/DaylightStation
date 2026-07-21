#!/usr/bin/env node
// pkctl.mjs — Portal Keys control CLI (HTTP control plane on :8771).
//
// The APK serves REST on the same NanoHTTPD socket as its WebSocket, bound on all
// interfaces, so this works over the LAN with no ADB. Mirrors pbctl.mjs.
// Host: PK_HOST env or default 10.0.0.92:8771.
//
//   node pkctl.mjs status                 # serviceBound + keysSeen + display + config
//   node pkctl.mjs log                    # recent key/screen/config events
//   node pkctl.mjs config                 # effective config (password redacted)
//   node pkctl.mjs config set <k> <v>     # patch ONE key
//   node pkctl.mjs fkbpw                  # push the FKB password from 1Password/cache
//   node pkctl.mjs watch                  # stream key events over the WebSocket
//
// `status` leads with serviceBound because the dominant failure mode is the Android
// accessibility grant being dropped — the app CANNOT re-grant itself. See README.

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const HOST = process.env.PK_HOST || '10.0.0.92:8771';
const BASE = `http://${HOST}`;
const PW_CACHE = '/tmp/fkb_piano_pw';

async function req(path) {
  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

function pretty(o) { console.log(typeof o === 'string' ? o : JSON.stringify(o, null, 2)); }

/** Config keys the device understands (mirrors Config.java). */
const Config = { SCREEN_TOGGLE: 'screenToggleEnabled' };

/** FKB REST lives on the same box as the control plane, port 2323. */
function fkbHost() {
  return `${HOST.split(':')[0]}:2323`;
}

/**
 * The wake locks that stop a sleeping Portal from dropping off the network.
 *
 * `preventSleepWhileScreenOff` + `setWifiWakelock` are the load-bearing pair — without
 * them the display going dark also takes FKB REST, pkctl and ADB-over-WiFi with it, and
 * only a physical button press brings the panel back.
 */
// NOT `setCpuWakelock` — that key does not exist in FKB. `keepawake` was setting it and
// FKB reported "Saved and applied" anyway (echoing the raw key name instead of a friendly
// label, which is the tell). listSettings has no such field. preventSleepWhileScreenOff is
// the real CPU-side control.
const REQUIRED_WAKE_SETTINGS = [
  'setWifiWakelock',
  'preventSleepWhileScreenOff',
];

async function preflight() {
  const lines = [];
  let pw;
  try {
    pw = fkbPassword();
  } catch (e) {
    return { ok: false, lines: ['✗ could not read FKB password: ' + e.message] };
  }

  const u = new URL(`http://${fkbHost()}/`);
  u.searchParams.set('cmd', 'listSettings');
  u.searchParams.set('type', 'json'); // MANDATORY — without it FKB serves its login page
  u.searchParams.set('password', pw);

  let settings;
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(10000) });
    settings = await res.json();
  } catch (e) {
    return { ok: false, lines: ['✗ FKB unreachable at ' + fkbHost() + ': ' + e.message] };
  }

  let ok = true;
  for (const key of REQUIRED_WAKE_SETTINGS) {
    const on = settings[key] === true || settings[key] === 'true';
    lines.push(`${on ? '✓' : '✗'} ${key.padEnd(28)} ${JSON.stringify(settings[key])}`);
    if (!on) ok = false;
  }
  return { ok, lines };
}

/** Same resolution order as fkb.cli.mjs — env, then cache, then 1Password. */
function fkbPassword() {
  if (process.env.FKB_PW) return process.env.FKB_PW.trim();
  if (existsSync(PW_CACHE)) {
    const v = readFileSync(PW_CACHE, 'utf8').trim();
    if (v) return v;
  }
  return execSync('op read "op://Private/Fully Kiosk Piano/value"', { encoding: 'utf8' }).trim();
}

const commands = {
  async status() {
    const s = await req('/status');
    if (typeof s === 'string') { console.log(s); return; }
    // Lead with the thing that is actually wrong when buttons stop working.
    console.log(`serviceBound : ${s.serviceBound ? '✓ yes' : '✗ NO — accessibility grant dropped; re-enable via adb (see README)'}`);
    console.log(`uptime       : ${s.uptimeSeconds}s`);
    console.log(`keysSeen     : ${s.keysSeen}`);
    console.log(`displayOn    : ${s.displayOn}`);
    console.log(`wsClients    : ${s.wsClients}${s.wsClients === 0 ? '  (SPA not connected)' : ''}`);
    console.log(`config       : ${JSON.stringify(s.config)}`);
    if (!s.config?.fkbPasswordSet) {
      console.log('\n⚠ fkbPassword not set — the camera button cannot drive the backlight.');
      console.log('  Fix: node pkctl.mjs fkbpw');
    }
  },

  async log() {
    const lines = await req('/log');
    if (!Array.isArray(lines)) { pretty(lines); return; }
    for (const l of lines) {
      const [ts, ...rest] = l.split(' ');
      console.log(new Date(Number(ts)).toLocaleTimeString(), rest.join(' '));
    }
  },

  async config([sub, key, ...rest]) {
    if (sub !== 'set') { pretty(await req('/config')); return; }
    if (!key || !rest.length) {
      console.error('usage: config set <key> <value>');
      process.exit(1);
    }
    const value = rest.join(' ');

    // Guard the one setting that can make the panel unreachable. Enabling sleep on a
    // panel without wake locks means the first successful sleep drops WiFi and takes
    // FKB REST, pkctl and ADB with it — recoverable only by physically pressing a
    // button. Refuse rather than let someone rediscover that.
    if (key === Config.SCREEN_TOGGLE && /^true$/i.test(value)) {
      const pf = await preflight();
      if (!pf.ok) {
        console.error('✗ refusing to enable screenToggleEnabled — wake locks not set.\n');
        for (const line of pf.lines) console.error('  ' + line);
        console.error('\n  Fix first:  FKB_HOST=' + fkbHost() + ' node cli/fkb.cli.mjs keepawake');
        console.error('  Override (you accept the panel may strand):  --force');
        if (!process.argv.includes('--force')) process.exit(1);
        console.error('\n  --force given; proceeding anyway.');
      }
    }

    pretty(await req(`/config?key=${encodeURIComponent(key)}&value=${encodeURIComponent(value)}`));
  },

  // Verifies the panel can survive its own sleep before the gesture is switched on.
  async preflight() {
    const pf = await preflight();
    for (const line of pf.lines) console.log(line);
    console.log(pf.ok
      ? '\n✓ safe to enable: node pkctl.mjs config set screenToggleEnabled true'
      : '\n✗ NOT safe. Run: FKB_HOST=' + fkbHost() + ' node cli/fkb.cli.mjs keepawake');
    process.exit(pf.ok ? 0 : 1);
  },

  // The password never lives in the repo — it is read from 1Password (or the local
  // cache fkb.cli.mjs already populates) and pushed straight to the device.
  async fkbpw() {
    const pw = fkbPassword();
    const out = await req(`/config?key=fkbPassword&value=${encodeURIComponent(pw)}`);
    if (out?.fkbPasswordSet) console.log('✓ fkbPassword pushed to device');
    else pretty(out);
  },

  // ADB-free APK deploy. ADB-over-WiFi cannot survive a reboot on this panel (`adb root`
  // is refused on a production build, `setprop persist.adb.tcp.port` needs root), so this
  // is the durable upgrade path. Requires REQUEST_INSTALL_PACKAGES, granted once over USB.
  // Android still shows a one-tap confirm on the panel — no silent path exists here.
  async update([url]) {
    if (!url) {
      console.error('usage: update <apk-url>   (must be reachable FROM the panel)');
      process.exit(1);
    }
    console.log('→ ' + url);
    pretty(await req(`/update?url=${encodeURIComponent(url)}`));
    console.log('\n⚠ tap "Install" on the panel to complete.');
  },

  // Our own log lines straight off the device — the thing whose absence turned a
  // one-line manifest bug into a whole debugging round.
  async logcat([n]) {
    const lines = Number(n) || 200;
    const res = await fetch(`${BASE}/logcat?lines=${lines}`, { signal: AbortSignal.timeout(15000) });
    console.log(await res.text());
  },

  async watch() {
    const url = `ws://${HOST}/`;
    console.log(`connecting ${url} … (ctrl-c to stop)`);
    const ws = new WebSocket(url);
    ws.onopen = () => console.log('✓ connected — press the Portal buttons');
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === 'key') {
          console.log(`${new Date(m.ts).toLocaleTimeString()}  ${m.key.padEnd(20)} ${m.action}  interactive=${m.interactive}`);
        } else {
          console.log(e.data);
        }
      } catch { console.log(e.data); }
    };
    ws.onerror = (e) => console.error('✗ ws error', e.message || '');
    ws.onclose = () => { console.log('closed'); process.exit(0); };
    await new Promise(() => {});
  },
};

const [, , name, ...args] = process.argv;
if (!name || name === 'help' || !commands[name]) {
  console.log(`pkctl — Portal Keys control (${BASE})\n`);
  console.log('Commands:');
  console.log('  status                 serviceBound / keysSeen / display / config');
  console.log('  log                    recent key, screen-toggle and config events');
  console.log('  config                 show config (password redacted)');
  console.log('  config set <k> <v>     patch one key');
  console.log('  preflight              verify wake locks BEFORE enabling the sleep gesture');
  console.log('  fkbpw                  push the FKB password from 1Password/cache');
  console.log('  update <apk-url>       ADB-free APK upgrade (one tap on the panel)');
  console.log('  logcat [lines]         our log lines off the device, no ADB needed');
  console.log('  watch                  live-stream key events over the WebSocket');
  console.log('\nKeys: fkbHost, fkbPassword, screenToggleEnabled, consumeVolume');
  process.exit(name && name !== 'help' ? 1 : 0);
}
try { await commands[name](args); } catch (e) { console.error('✗ ' + (e.message || e)); process.exit(1); }
