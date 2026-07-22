#!/usr/bin/env node
/**
 * esp.cli.mjs — diagnostics and control for the ESP32 relay fleet.
 *
 * The question this tool exists to answer is not "what is the status" but
 * "if I scan a barcode / put food on the scale right now, does it land?".
 * Every failure in the chain looks identical from the kitchen — nothing
 * happens — so `check` walks the chain link by link and commits to a verdict.
 *
 *     DS6878 scanner --ClassicBT/SPP--> ATOM Lite --WiFi/WS--> backend
 *     SENSSUN scale  --BLE----------->  ATOM Lite --WiFi/WS--> backend
 *
 * Follows the pbctl/pkctl/fkb.cli idiom (command table + argv destructure)
 * rather than dscli's strict-JSON contract: this output is read by a human
 * standing in a kitchen deciding whether to walk over and power-cycle something.
 *
 * Usage:
 *   node cli/esp.cli.mjs <command> [device] [args]
 *   ESP_HOST=10.0.0.99 node cli/esp.cli.mjs status food-scale
 *
 * @module cli/esp
 */

import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Device registry
//
// These IPs are DHCP leases, not reservations, and only `ir-blaster` registers
// mDNS today. That makes the fleet undiscoverable in principle: a lease change
// silently breaks every entry below. The defaults are a stopgap so the tool
// works before any reflash — override with --host or ESP_HOST, or add mDNS to
// the firmware (see docs/plans/2026-07-22-esp-fleet-cli-design.md).
// ---------------------------------------------------------------------------
const REGISTRY = {
  'food-scale': {
    host: '10.0.0.47',
    kind: 'food-scale-relay',
    label: 'Kitchen food scale + UPC scanner',
  },
  'content-barcode': {
    host: '10.0.0.153',
    kind: 'content-barcode-relay',
    label: 'Content barcode scanner',
  },
  'ir-office-tv': {
    host: 'ir-office-tv.local',
    kind: 'ir-blaster',
    label: 'Office TV IR blaster',
  },
};

const OK = '\x1b[32m';
const BAD = '\x1b[31m';
const WARN = '\x1b[33m';
const DIM = '\x1b[2m';
const OFF = '\x1b[0m';

const mark = (state) => (state === true ? `${OK}OK${OFF}  ` : state === false ? `${BAD}FAIL${OFF}` : `${WARN}??${OFF}  `);

/** Seconds → the coarsest unit that still reads honestly. */
function age(seconds) {
  if (seconds === undefined || seconds === null) return 'never';
  const s = Number(seconds);
  if (!Number.isFinite(s)) return 'unknown';
  if (s < 90) return `${Math.round(s)}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  if (s < 172800) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

function resolveDevice(name) {
  const key = name || 'food-scale';
  const entry = REGISTRY[key];
  if (!entry) {
    const known = Object.keys(REGISTRY).join(', ');
    throw new Error(`unknown device "${key}" — known: ${known}`);
  }
  // Explicit override wins: a DHCP lease can move without warning, and being
  // stuck behind a stale registry entry is the one failure this tool must not have.
  const host = process.env.ESP_HOST || entry.host;
  return { ...entry, key, host };
}

async function req(device, route, { method = 'GET', timeoutMs = 6000 } = {}) {
  const url = `http://${device.host}${route}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not all routes return JSON */ }
    return { ok: res.ok, status: res.status, text, json };
  } catch (err) {
    // A timeout and a refused connection mean different things: refused is a
    // live host with nothing listening (crashed sketch, wrong port); timeout is
    // no host at all (powered off, off-network, or the lease moved).
    const reason = err.name === 'AbortError' ? 'timeout' : (err.cause?.code || err.message);
    throw new Error(`${url} unreachable (${reason})`);
  }
}

// ---------------------------------------------------------------------------
// Verdict — the point of the tool
// ---------------------------------------------------------------------------

/**
 * Reduce a food-scale-relay status payload to per-chain verdicts.
 *
 * Kept pure and separate from rendering so the reasoning can be tested without
 * a device on the bench.
 *
 * @param {object} s Parsed /status payload.
 * @returns {{links: Array, barcode: object, scale: object}}
 */
export function assessFoodScale(s) {
  const wifiUp = s?.wifi?.connected === true;
  const wsUp = s?.websocket?.connected === true;
  const bcLinked = s?.barcode?.connected === true;
  const bcListening = s?.barcode?.listening === true;
  const scaleLinked = s?.scale?.connected === true;

  const transportUp = wifiUp && wsUp;

  // A scan lands only if every link holds. Ordered nearest-cause-first so the
  // remedy names the thing actually broken rather than the first red light.
  let barcode;
  if (!bcLinked && !bcListening) {
    barcode = { land: false, why: 'SPP acceptor is not listening — firmware/BT stack fault', fix: 'esp reboot' };
  } else if (!bcLinked) {
    const everLinked = Number(s?.barcode?.open_count || 0) > 0;
    // open_count counts SUCCESSFUL SPP opens only. A scanner that pages us and
    // then fails to establish emits GAP events and increments nothing here, so
    // on pre-counter firmware a squawking scanner is byte-identical to one
    // switched off. acl_conn_count is the discriminator; when the field is
    // absent we are talking to old firmware and must not pretend to know.
    const acl = s?.barcode?.acl_conn_count;
    const haveAttemptEvidence = acl !== undefined;
    const authFails = Number(s?.barcode?.auth_fail_count || 0);

    if (everLinked) {
      barcode = {
        land: false,
        why: 'scanner link dropped — out of range, asleep, or powered off',
        fix: 'wake the scanner (pull trigger); if it stays down: esp unbond',
      };
    } else if (!haveAttemptEvidence) {
      barcode = {
        land: false,
        why: 'scanner has not completed a connection since boot — this firmware cannot tell "off/out of range" from "trying and failing"',
        fix: 'pull the trigger, then IMMEDIATELY run: esp log — ACL/auth lines mean it is reaching us. (Reflash for durable counters.)',
      };
    } else if (Number(acl) > 0) {
      // It reached us and did not complete. In range; this is a pairing/auth
      // problem, not a range problem — and re-pairing is the right remedy.
      barcode = {
        land: false,
        why: `scanner IS reaching us (${acl} ACL connects) but no SPP session completed${authFails ? ` — ${authFails} auth failures` : ''} — in range, failing to pair`,
        fix: 'esp unbond, then re-scan the pairing barcode',
      };
    } else {
      barcode = {
        land: false,
        why: 'scanner has never reached us (0 ACL connects) — powered off, out of range, or paired to a different host',
        fix: 'switch it on and pull the trigger; if still nothing, re-scan the pairing barcode for this ESP',
      };
    }
  } else if (!transportUp) {
    barcode = { land: false, why: 'scanner is linked but the backend transport is down — scans will buffer, then drop', fix: 'check WiFi / backend' };
  } else {
    barcode = { land: true, why: 'scanner linked, transport up', fix: null };
  }

  let scale;
  if (!scaleLinked) {
    const stalled = s?.scale?.scan_active === true;
    scale = {
      land: false,
      why: stalled
        ? 'scale not found — powered off or asleep (ESP is still scanning)'
        : 'scale not connected and BLE scan is not running',
      fix: stalled ? 'switch the scale on' : 'esp blescan food-scale on',
    };
  } else if (!transportUp) {
    scale = { land: false, why: 'scale linked but backend transport is down', fix: 'check WiFi / backend' };
  } else {
    scale = { land: true, why: 'scale linked, transport up', fix: null };
  }

  return { wifiUp, wsUp, bcLinked, bcListening, scaleLinked, transportUp, barcode, scale };
}

function renderFoodScale(device, s) {
  const a = assessFoodScale(s);
  const b = s.barcode || {};
  const sc = s.scale || {};
  const ws = s.websocket || {};

  console.log(`${s.device || device.kind} @ ${device.host}${DIM}   up ${age(s.uptime_s)}${OFF}`);
  console.log('');

  console.log(`  ${mark(a.wifiUp)} WiFi        ${s.wifi?.rssi ?? '?'} dBm`);

  const wsDetail = [`${ws.drops ?? 0} drops`];
  if (ws.down_s) wsDetail.push(`down ${age(ws.down_s)}, ${ws.retries ?? 0} retries`);
  console.log(`  ${mark(a.wsUp)} Backend WS  ${ws.host}:${ws.port}${DIM}  ${wsDetail.join(' · ')}${OFF}`);

  console.log(`  ${mark(a.bcLinked)} Scanner     ${b.target_name || '?'} ${DIM}(${b.mode || '?'})${OFF}`);
  const bonded = b.bonds > 0;
  console.log(`         ${DIM}bonds ${b.bonds ?? '?'}${bonded ? '' : ' — NOT PAIRED'} · ${b.open_count ?? 0} opens / ${b.close_count ?? 0} closes · listening=${b.listening}${OFF}`);
  if (b.acl_conn_count !== undefined) {
    const auth = b.auth_attempt_count ? ` · auth ${b.auth_attempt_count} tried / ${b.auth_fail_count ?? 0} failed` : '';
    const reason = b.last_acl_reason !== undefined ? ` · last ACL reason 0x${Number(b.last_acl_reason).toString(16)}` : '';
    console.log(`         ${DIM}attempts: ${b.acl_conn_count} ACL up / ${b.acl_disconn_count ?? 0} down${auth}${reason}${OFF}`);
  } else {
    console.log(`         ${WARN}no attempt counters — pre-reflash firmware${OFF}`);
  }
  if (b.last_event) console.log(`         ${DIM}last event: ${b.last_event}${b.last_event_age_s !== undefined ? ` (${age(b.last_event_age_s)} ago)` : ''}${OFF}`);
  console.log(`         ${DIM}scans ${b.scan_count ?? 0} · last ${age(b.last_scan_age_s)}${b.last_scan ? ` (${b.last_scan})` : ''}${OFF}`);
  if (b.pending_scans) console.log(`         ${WARN}${b.pending_scans} scans buffered awaiting the WS${OFF}`);
  if (b.dropped_scans) console.log(`         ${BAD}${b.dropped_scans} scans DROPPED to queue overflow${OFF}`);

  console.log(`  ${mark(a.scaleLinked)} Scale       ${sc.target_name || '?'}`);
  if (sc.have_reading) console.log(`         ${DIM}${sc.grams} ${sc.unit}${sc.stable ? ' (stable)' : ''}${OFF}`);
  if (!a.scaleLinked) console.log(`         ${DIM}scan enabled=${sc.scan_enabled} active=${sc.scan_active}${sc.scan_age_s !== undefined ? ` age ${age(sc.scan_age_s)}` : ''}${OFF}`);

  console.log('');
  const verdict = (name, v) => {
    const head = v.land ? `${OK}would land${OFF}` : `${BAD}would NOT land${OFF}`;
    console.log(`  ${name.padEnd(9)} ${head} — ${v.why}`);
    if (v.fix) console.log(`            ${DIM}try: ${v.fix}${OFF}`);
  };
  verdict('BARCODE', a.barcode);
  verdict('WEIGHT', a.scale);

  return a.barcode.land && a.scale.land ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const commands = {
  async check([name]) {
    const device = resolveDevice(name);
    let res;
    try {
      res = await req(device, '/status');
    } catch (err) {
      // "Is it on?" — a failed fetch IS the answer, and the most common one.
      console.log(`${device.kind} @ ${device.host}`);
      console.log('');
      console.log(`  ${mark(false)} Device      ${err.message}`);
      console.log('');
      console.log(`  VERDICT   ${BAD}would NOT land${OFF} — the relay itself is unreachable`);
      console.log(`            ${DIM}power-cycle the ATOM, or confirm its DHCP lease has not moved${OFF}`);
      return 1;
    }
    if (!res.json) { console.error(`unexpected non-JSON from /status: ${res.text.slice(0, 200)}`); return 1; }
    if (device.kind !== 'food-scale-relay') {
      console.log(JSON.stringify(res.json, null, 2));
      return 0;
    }
    return renderFoodScale(device, res.json);
  },

  async status([name]) {
    const device = resolveDevice(name);
    const res = await req(device, '/status');
    console.log(res.json ? JSON.stringify(res.json, null, 2) : res.text);
    return 0;
  },

  async log([name]) {
    const device = resolveDevice(name);
    const res = await req(device, '/status');
    const logs = res.json?.recent_logs || [];
    if (!logs.length) { console.log('(no recent logs)'); return 0; }

    // The ring is 24 entries with no dedup, so one chatty watchdog can evict
    // every other event. Collapse runs so a flood stays visible as a flood
    // without hiding the lines that matter.
    let last = null; let run = 0;
    const flush = () => {
      if (!last) return;
      const times = run > 1 ? ` ${DIM}(x${run})${OFF}` : '';
      console.log(`  ${String(age(last.age_s)).padStart(6)}  ${last.message}${times}`);
    };
    for (const entry of logs) {
      if (last && entry.message === last.message) { run += 1; last = entry; continue; }
      flush();
      last = entry; run = 1;
    }
    flush();
    if (logs.length >= 24) {
      console.log(`  ${DIM}— ring full (24); older events already evicted —${OFF}`);
    }
    return 0;
  },

  async test([name]) {
    const device = resolveDevice(name);
    const code = process.argv[4] || '0000000000000';
    const before = (await req(device, '/status')).json;
    if (before?.barcode?.connected !== true) {
      console.log(`${WARN}note${OFF}: scanner is not linked — this probes ESP→backend only, not the scanner.`);
    }
    const res = await req(device, `/simulate/barcode?code=${encodeURIComponent(code)}`, { method: 'POST' });
    console.log(res.ok ? `${OK}injected${OFF} ${code}` : `${BAD}failed${OFF} (${res.status}) ${res.text.slice(0, 120)}`);
    console.log(`${DIM}confirm it landed: check the backend log for barcode_relay.scan with code=${code}${OFF}`);
    return res.ok ? 0 : 1;
  },

  async reset([name]) {
    const device = resolveDevice(name);
    const res = await req(device, '/barcode/disconnect', { method: 'GET' });
    console.log(res.ok ? `${OK}link reset${OFF} — the scanner should re-initiate within a few seconds` : `${BAD}failed${OFF} ${res.text.slice(0, 120)}`);
    return res.ok ? 0 : 1;
  },

  async unbond([name]) {
    const device = resolveDevice(name);
    const res = await req(device, '/barcode/unbond', { method: 'GET' });
    console.log(res.ok ? `${OK}bonds cleared${OFF} — re-scan the pairing barcode to re-pair` : `${BAD}failed${OFF} ${res.text.slice(0, 120)}`);
    if (res.ok) {
      const s = (await req(device, '/status')).json;
      if (s?.barcode?.pairing_payload) {
        console.log(`${DIM}pairing payload for the DS6878: ${s.barcode.pairing_payload}${OFF}`);
      }
    }
    return res.ok ? 0 : 1;
  },

  async blescan([name, onoff]) {
    const device = resolveDevice(name);
    const on = onoff !== 'off' && onoff !== '0';
    const res = await req(device, `/ble/scan?on=${on ? 1 : 0}`);
    console.log(res.ok ? `${OK}BLE scan ${on ? 'enabled' : 'disabled'}${OFF}` : `${BAD}failed${OFF} ${res.text.slice(0, 120)}`);
    return res.ok ? 0 : 1;
  },

  async list() {
    for (const [key, d] of Object.entries(REGISTRY)) {
      console.log(`  ${key.padEnd(16)} ${String(d.host).padEnd(20)} ${DIM}${d.label}${OFF}`);
    }
    return 0;
  },
};

const HELP = `esp — ESP32 relay fleet diagnostics

  esp check   [device]        would a scan/weight land right now? (default: food-scale)
  esp status  [device]        raw /status JSON
  esp log     [device]        recent on-device log ring, runs collapsed
  esp test    [device] [code] inject a synthetic barcode (ESP -> backend probe)
  esp reset   [device]        drop the scanner link so it re-initiates
  esp unbond  [device]        clear BT bonds, forcing a fresh pairing
  esp blescan [device] on|off toggle the BLE scale scan
  esp list                    known devices

Host override:  ESP_HOST=10.0.0.99 esp check food-scale
`;

// Only dispatch when run directly. Tests import `assessFoodScale`, and an
// unguarded main block would call process.exit() during module evaluation.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const [, , name, ...args] = process.argv;
  if (!name || name === 'help' || name === '--help' || !commands[name]) {
    console.log(HELP);
    process.exit(name && name !== 'help' && name !== '--help' ? 1 : 0);
  }
  try {
    process.exit(await commands[name](args));
  } catch (err) {
    console.error(`${BAD}x${OFF} ${err.message}`);
    process.exit(1);
  }
}
