#!/usr/bin/env node
// daylight-acceptance — the roadmap's per-device acceptance list, run over the control API.
//
//   daylight-acceptance <device> [options]
//   daylight-acceptance <device> --list
//
// Prints one line per check: PASS, FAIL, MANUAL (a person has to do it; the line says
// what to do and what to look for) or SKIP (an option it needs was not given). Exits 1
// when any line is FAIL.
//
// The host is never assumed. It comes from --host, else from the device's entry in the
// private tokens file ($DAYLIGHT_ANDROID_TOKENS, else $DAYLIGHT_BASE_PATH/data/household/auth/
// daylight-android.yml). The token comes from that file only, is sent as a header only, and
// every printed line is passed through a filter that removes it.
//
// Roadmap: ops:docs/superpowers/plans/2026-11-16-daylight-android-roadmap.md (acceptance list)
// Plan:    ops:docs/superpowers/plans/2026-11-17-daylight-android-phases-4-6-cutover.md
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const HERE = dirname(fileURLToPath(import.meta.url));

const USAGE = `usage: daylight-acceptance <device> [options]

Runs the acceptance list against one device over its control API. Without
--active, --restart, --launch, --kill, --reboot or a bad payload option it only
reads: every request is a GET (a wrong-token GET included), plus one read-only
LogsQL query with --log-store.

  --host <address>                 the device's address (default: its entry in the private tokens file)
  --only <ids>                     comma-separated check ids or groups (core, kiosk, screen, ...)
  --skip <ids>                     the same, left out
  --list                           print the checks and exit; contacts nothing
  --active                         also run the checks that change the device's state (each SKIP line says what)
  --restart                        also restart the payload (MIDI, synth, page and mic drop for a few seconds)
  --brightness <0-255>             set the brightness to this and read it back
  --launch <package>               launch this app, see it in front, return to the kiosk
  --fps-baseline <n>               fail when the live page's frame rate is more than 10% below n
  --rtt-baseline <ms>              fail when the MIDI loopback round trip is more than 10% above ms
  --kill                           kill the app's process through /debug/exec and wait for it to come back
  --bad-payload-url <url>          push this file (not a payload) with --bad-payload-sha256 and expect a rollback
  --bad-payload-sha256 <hex>
  --serve-bad-payload <addr:port>  serve a generated bad payload from this machine at addr:port instead
  --reboot                         reboot (route where the device allows it, else by hand) and wait for the API
  --reboot-wait <seconds>          how long to wait for the device after a reboot or kill (default 300)
  --log-store <url>                read-only LogsQL check for this device's events
  --log-window <duration>          LogsQL time window (default 1h)`;

export function usage() { return USAGE; }

/** The routes each capability serves, from the capability sources. A test keeps this in step with them. */
export const CORE_ROUTES = [
  'GET /status', 'GET /capabilities', 'GET /settings', 'POST /settings', 'DELETE /settings',
  'GET /payload', 'POST /payload', 'POST /payload/rollback', 'GET /update', 'POST /update',
  'GET /beat', 'POST /beat', 'GET /wifi', 'GET /log', 'GET /crashlog', 'GET /diagnostics',
  'POST /accessibility/enable',
];
export const CAPABILITY_ROUTES = {
  'webview-host': ['GET /kiosk/status', 'POST /kiosk/foreground', 'POST /kiosk/load', 'POST /kiosk/load-start',
    'POST /kiosk/overlay', 'POST /kiosk/reload', 'POST /kiosk/renderer/reset', 'POST /kiosk/restart'],
  'debug-tools': ['GET /debug/fps', 'GET /debug/html', 'GET /debug/info', 'GET /debug/logcat', 'GET /debug/screenshot',
    'POST /debug/eval', 'POST /debug/exec', 'POST /sound', 'POST /speak'],
  accessibility: [],
  lockdown: ['GET /lockdown', 'POST /lockdown/home', 'POST /lockdown/input', 'POST /lockdown/lock',
    'POST /lockdown/owner/release', 'POST /lockdown/owner/resume', 'POST /lockdown/owner/transfer', 'POST /lockdown/unlock'],
  'screen-power': ['POST /device/reboot', 'POST /screen', 'POST /screen/brightness'],
  volume: ['GET /volume', 'POST /volume'],
  'app-launcher': ['POST /launch'],
  'volume-keys': ['POST /accessibility/silence-beep'],
  'hid-input': ['GET /hid/bluetooth', 'GET /hid/bluetooth/diag', 'GET /hid/bluetooth/radio', 'GET /hid/bluetooth/radio/scan',
    'GET /input', 'GET /usb-hid', 'POST /hid/bluetooth/bond', 'POST /hid/bluetooth/connect-hid', 'POST /hid/bluetooth/gatt',
    'POST /hid/bluetooth/gatt-direct', 'POST /hid/bluetooth/gatt-disconnect', 'POST /hid/bluetooth/scan',
    'POST /hid/bluetooth/scan-direct', 'POST /usb-hid/config', 'POST /usb-hid/retry'],
  presence: ['GET /presence'],
  synth: ['POST /panic'],
  'midi-bridge': ['GET /loopback', 'GET /midi/send', 'GET /midi/tap', 'POST /connect', 'POST /forget', 'POST /loopback',
    'POST /midi/send', 'POST /reset', 'POST /scan', 'POST /tone'],
  'bluetooth-controls': ['GET /bluetooth'],
  'audio-guard': ['GET /speaker', 'POST /audio-guard/bootstrap', 'POST /audio-guard/override', 'POST /audio-guard/volume-check',
    'POST /speaker', 'POST /speaker/bt-cycle', 'POST /speaker/reconnect'],
  'mic-bridge': ['GET /mic/status', 'POST /mic/restart'],
  'lease-gate': ['GET /lease'],
};

const PNG_SIGNATURE = '89504e470d0a1a0a';
const FOREIGN_URL = 'https://www.example.org/';
const ABSENT_PACKAGE = 'com.example.absent';

// ─── options ────────────────────────────────────────────────────────────────

const VALUED = ['host', 'only', 'skip', 'brightness', 'launch', 'fps-baseline', 'rtt-baseline', 'bad-payload-url',
  'bad-payload-sha256', 'serve-bad-payload', 'reboot-wait', 'log-store', 'log-window'];
const FLAGS = ['list', 'kill', 'reboot', 'active', 'restart'];

export function parseOptions(argv) {
  const [device, ...rest] = argv;
  if (!device || device === 'help' || device.startsWith('--')) throw new Error(USAGE);
  const opts = { device };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument '${a}'\n${USAGE}`);
    const name = a.slice(2);
    if (FLAGS.includes(name)) { opts[name] = true; continue; }
    if (!VALUED.includes(name)) throw new Error(`unknown option '${a}'\n${USAGE}`);
    if (rest[i + 1] === undefined) throw new Error(`${a} needs a value`);
    opts[name] = rest[i + 1];
    i += 1;
  }
  const num = (key, min, max) => {
    if (opts[key] === undefined) return;
    const n = Number(opts[key]);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`--${key} must be a number from ${min} to ${max}`);
    opts[key] = n;
  };
  num('brightness', 0, 255);
  num('fps-baseline', 1, 240);
  num('rtt-baseline', 1, 10000);
  num('reboot-wait', 5, 3600);
  if (opts['bad-payload-url'] && !/^[0-9a-fA-F]{64}$/.test(String(opts['bad-payload-sha256'] || ''))) {
    throw new Error('--bad-payload-url needs --bad-payload-sha256 <64 hex characters>');
  }
  if (opts['bad-payload-url'] && opts['serve-bad-payload']) throw new Error('use --bad-payload-url or --serve-bad-payload, not both');
  if (opts['serve-bad-payload'] && !/^[^:\s]+:\d{1,5}$/.test(opts['serve-bad-payload'])) {
    throw new Error('--serve-bad-payload takes <address the device reaches this machine at>:<port>');
  }
  if (opts['log-window'] && !/^\d+[smhd]$/.test(opts['log-window'])) throw new Error('--log-window is like 30m, 1h or 2d');
  const list = (key) => (opts[key] ? String(opts[key]).split(',').map((s) => s.trim()).filter(Boolean) : null);
  opts.only = list('only');
  opts.skip = list('skip');
  return opts;
}

// ─── results ────────────────────────────────────────────────────────────────

const pass = (evidence) => ({ status: 'PASS', evidence });
const fail = (evidence) => ({ status: 'FAIL', evidence });
const manual = (evidence) => ({ status: 'MANUAL', evidence });
const skip = (evidence) => ({ status: 'SKIP', evidence });
const short = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > 160 ? `${s.slice(0, 157)}...` : s;
};

// ─── transport ──────────────────────────────────────────────────────────────

/**
 * Requests to one device. `control` and `lifeline` answer {status, json, text, bytes, headers}
 * or {error} when nothing answered. They never throw.
 */
export function deviceApi({ host, ports, token, fetchImpl = fetch }) {
  const call = async (port, method, path, { body, timeoutMs = 15000, withToken = true, tokenValue, binary = false } = {}) => {
    const headers = {};
    if (withToken) headers['X-Daylight-Token'] = tokenValue ?? token;
    let payload;
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    try {
      const res = await fetchImpl(`http://${host}:${port}${path}`, {
        method, headers, body: payload, signal: AbortSignal.timeout(timeoutMs),
      });
      if (binary) {
        const bytes = Buffer.from(await res.arrayBuffer());
        return { status: res.status, bytes, headers: res.headers };
      }
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* text */ }
      return { status: res.status, json, text, headers: res.headers };
    } catch (e) {
      return { error: e?.cause?.code || e?.name || String(e?.message || e) };
    }
  };
  return {
    control: (method, path, options) => call(ports.port, method, path, options),
    lifeline: (method, path, options) => call(ports.lifelinePort, method, path, options),
  };
}

const ok = (r) => r && !r.error && r.status >= 200 && r.status < 300 && r.json?.ok !== false;
const why = (r) => (r?.error ? `no answer (${r.error})` : `HTTP ${r?.status}${r?.json?.error ? ` ${r.json.error}` : ''}${r?.json?.message ? `: ${short(r.json.message)}` : ''}`);

// ─── checks ─────────────────────────────────────────────────────────────────

/**
 * Every check for one device, in the order they run. Disruptive checks come last
 * (restart, kill, bad payload, reboot), then the log store, then the MANUAL lines.
 * @param {{id:string, capabilities:string[]}} deviceFile
 */
export function buildChecks(deviceFile, opts = {}) {
  const caps = new Set(deviceFile.capabilities || []);
  const id = deviceFile.id;
  const has = (c) => caps.has(c);
  const checks = [];
  // `needs` identifies device writes and describes which options arm the check.
  const add = (checkId, title, run, when = true, needs = null) => { if (when) checks.push({ id: checkId, title, run, needs }); };
  const active = (effect) => ({ flag: 'active', effect });
  const optIn = (armed, skipEvidence) => ({ armed, skipEvidence });

  // ── core ──
  // Read-only: three GETs. The control port and the lifeline answer 401 before any route
  // runs and neither logs nor rate-limits a refusal (Router, ControlServer, ShellServer).
  add('core.auth', 'a missing or wrong token is refused on both ports', async ({ api }) => {
    const none = await api.control('GET', '/status', { withToken: false });
    const wrong = await api.control('GET', '/status', { tokenValue: 'wrong-token-'.padEnd(40, 'x') });
    const life = await api.lifeline('GET', '/status', { tokenValue: 'wrong-token-'.padEnd(40, 'x') });
    const got = `no token ${none.status ?? none.error}, wrong token ${wrong.status ?? wrong.error}, lifeline wrong token ${life.status ?? life.error}`;
    return none.status === 401 && wrong.status === 401 && life.status === 401 ? pass(got) : fail(got);
  });
  add('core.status', 'GET /status names this device and exactly its capabilities', async ({ api, state }) => {
    const r = await api.control('GET', '/status');
    if (!ok(r) || r.json?.ok !== true) return fail(`/status ${why(r)}`);
    state.status = r.json;
    const live = Array.isArray(r.json.capabilities) ? [...r.json.capabilities].sort() : [];
    const want = [...caps].sort();
    const problems = [];
    if (r.json.device === undefined || r.json.device === null || r.json.device === '') {
      problems.push(`missing device ID, expected '${id}'`);
    } else if (r.json.device !== id) {
      problems.push(`device '${short(r.json.device)}', expected '${id}'`);
    }
    if (!Array.isArray(r.json.capabilities)) problems.push('missing or invalid capabilities');
    if (JSON.stringify(live) !== JSON.stringify(want)) {
      problems.push(`capabilities differ: missing [${want.filter((c) => !live.includes(c))}] extra [${live.filter((c) => !want.includes(c))}]`);
    }
    if (r.json.settingsProblem) problems.push(`settingsProblem: ${short(r.json.settingsProblem)}`);
    const switches = Object.entries(r.json.switches || {}).map(([k, v]) => `${k}=${v?.active ? 'active' : 'off'}`).join(' ');
    const evidence = `payload ${r.json.payloadVersion}, shell ${r.json.shellVersionCode}, app ${r.json.appVersion}${switches ? `, switches ${switches}` : ''}`;
    return problems.length ? fail(`${problems.join('; ')} (${evidence})`) : pass(evidence);
  });
  add('core.clock', "the device's clock is within 60 s of this machine's", async ({ api }) => {
    const t0 = Date.now();
    const r = await api.control('GET', '/status');
    const t1 = Date.now();
    if (!ok(r)) return fail(`/status ${why(r)}`);
    if (typeof r.json.nowMs !== 'number') return fail('/status has no nowMs (a build older than the clock field)');
    const skew = Math.round(r.json.nowMs - (t0 + t1) / 2);
    return Math.abs(skew) > 60_000 ? fail(`skew ${skew} ms, more than 60 s: holds and deadlines will be off by that much`) : pass(`skew ${skew} ms`);
  });
  add('core.info', 'GET /debug/info answers with the model and SDK level', async ({ api, state }) => {
    const r = await api.control('GET', '/debug/info');
    if (!ok(r) || typeof r.json.sdkInt !== 'number') return fail(`/debug/info ${why(r)}`);
    state.info = r.json;
    return pass(`model ${r.json.model}, sdk ${r.json.sdkInt}, up ${Math.round((r.json.elapsedRealtimeMs || 0) / 60000)} min`);
  }, has('debug-tools'));
  add('routes.inventory', 'GET /capabilities lists every route this build should serve', async ({ api }) => {
    const r = await api.control('GET', '/capabilities');
    if (!ok(r)) return fail(`/capabilities ${why(r)}`);
    const live = new Set(r.json.routes || []);
    const want = [...CORE_ROUTES, ...[...caps].flatMap((c) => CAPABILITY_ROUTES[c] || [])];
    const missing = want.filter((route) => !live.has(route));
    const extra = [...live].filter((route) => !want.includes(route) && !route.startsWith('POST /bluetooth/'));
    if (missing.length) return fail(`missing ${missing.join(', ')}`);
    return pass(`${live.size} routes${extra.length ? `; also serves ${extra.join(', ')}` : ''}`);
  });
  add('settings.resolved', 'no setting holds an unresolved {placeholder}', async ({ api, state }) => {
    const r = await api.control('GET', '/settings');
    if (!ok(r)) return fail(`/settings ${why(r)}`);
    state.settings = Object.fromEntries((r.json.settings || []).map((s) => [s.key, s.value]));
    // Keys only in the evidence: a value can be private.
    const unresolved = (r.json.settings || []).filter((s) => typeof s.value === 'string' && /\{[a-z][a-z0-9_]*\}/.test(s.value)).map((s) => s.key);
    return unresolved.length ? fail(`unresolved: ${unresolved.join(', ')}`) : pass(`${(r.json.settings || []).length} settings, all resolved`);
  });
  add('lifeline.status', 'the lifeline answers and reports the same shell', async ({ api, state }) => {
    const r = await api.lifeline('GET', '/status');
    if (!ok(r) || r.json.shell !== true) return fail(`lifeline /status ${why(r)}`);
    const shellCode = state.status?.shellVersionCode;
    if (shellCode !== undefined && r.json.versionCode !== shellCode) return fail(`lifeline versionCode ${r.json.versionCode}, control port says ${shellCode}`);
    return pass(`versionCode ${r.json.versionCode}, payload ${r.json.payload?.activeVersion ?? r.json.payload?.active ?? 'none'}`);
  });
  add('payload.status', 'GET /payload and GET /update answer', async ({ api, state }) => {
    const p = await api.control('GET', '/payload');
    const u = await api.control('GET', '/update');
    if (!ok(p)) return fail(`/payload ${why(p)}`);
    if (!ok(u)) return fail(`/update ${why(u)}`);
    state.payload = p.json;
    return pass(`active ${p.json.active}, previous ${p.json.previous}, lastFailed ${p.json.lastFailed}, update ${u.json.state}`);
  });

  // ── kiosk ──
  const kiosk = has('webview-host');
  add('kiosk.status', 'the page is ready, its renderer alive and its bridge available', async ({ api }) => {
    const r = await api.control('GET', '/kiosk/status');
    if (!ok(r)) return fail(`/kiosk/status ${why(r)}`);
    const k = r.json;
    const problems = [];
    if (k.ready !== true) problems.push('ready false');
    if (k.rendererAlive !== true) problems.push('renderer not alive');
    if (k.bridge && k.bridge !== 'available') problems.push(`bridge ${k.bridge} (${k.bridgeReason})`);
    if (k.lastLoad && k.lastLoad.ok === false) problems.push(`last load failed: ${short(k.lastLoad.error)}`);
    const evidence = `screenOn ${k.screenOn}, in front ${k.kioskInForeground}, foreground ${k.foreground}, battery ${k.batteryLevel}, ram free ${k.ramFreeMb} MB`;
    return problems.length ? fail(`${problems.join('; ')} (${evidence})`) : pass(evidence);
  }, kiosk);
  add('kiosk.reload', 'POST /kiosk/reload waits for the page and reports the load time', async ({ api }) => {
    const r = await api.control('POST', '/kiosk/reload', { timeoutMs: 40000 });
    return ok(r) && r.json.loaded === true ? pass(`loaded in ${r.json.loadTimeMs} ms`) : fail(`/kiosk/reload ${why(r)}`);
  }, kiosk, active('reloads the page'));
  add('kiosk.load-async', 'POST /kiosk/load-start without waiting, then lastLoad carries its loadId', async ({ api, sleep, pollMs }) => {
    const r = await api.control('POST', '/kiosk/load-start', { body: { wait: false } });
    if (!ok(r) || !r.json.loadId) return fail(`/kiosk/load-start ${why(r)}`);
    for (let i = 0; i < Math.ceil(30000 / pollMs); i += 1) {
      await sleep(pollMs);
      const s = await api.control('GET', '/kiosk/status');
      const last = s.json?.lastLoad;
      if (last?.loadId === r.json.loadId) return last.ok ? pass(`loadId matched, ok`) : fail(`loadId matched, load failed: ${short(last.error)}`);
    }
    return fail(`lastLoad never carried loadId ${r.json.loadId} within 30 s`);
  }, kiosk, active('loads the start URL'));
  add('kiosk.origin-guard', 'a URL outside the allowed origins is refused', async ({ api }) => {
    const r = await api.control('POST', '/kiosk/load', { body: { url: FOREIGN_URL } });
    const text = `${r.json?.error || ''} ${r.json?.message || ''}`;
    if (r.status === 400 && /origin_not_allowed/.test(text)) return pass('400 origin_not_allowed');
    const back = await api.control('POST', '/kiosk/load-start', { timeoutMs: 40000 });
    return fail(`expected 400 origin_not_allowed, got ${why(r)}; start URL loaded back: ${ok(back) ? 'yes' : why(back)}`);
  }, kiosk, active('asks the kiosk to load a foreign URL (refused when the guard works; the start URL is loaded back if not)'));
  add('kiosk.foreground', 'POST /kiosk/foreground puts the kiosk in front', async ({ api }) => {
    const r = await api.control('POST', '/kiosk/foreground', { timeoutMs: 40000 });
    return ok(r) && r.json.kioskInForeground === true ? pass(`foreground ${r.json.foreground}`) : fail(`/kiosk/foreground ${why(r)}`);
  }, kiosk, active('brings the kiosk to the front'));
  add('kiosk.renderer-reset', 'POST /kiosk/renderer/reset brings a new renderer back', async ({ api }) => {
    const r = await api.control('POST', '/kiosk/renderer/reset', { timeoutMs: 40000 });
    return ok(r) && r.json.rendererAlive === true ? pass('rendererAlive') : fail(`/kiosk/renderer/reset ${why(r)}`);
  }, kiosk, active('restarts the page renderer'));
  add('kiosk.overlay', 'an overlay message shows and clears', async ({ api }) => {
    const on = await api.control('POST', '/kiosk/overlay', { body: { text: 'acceptance check' } });
    const off = await api.control('POST', '/kiosk/overlay', { body: { text: '' } });
    if (!ok(on) || on.json.shown !== true) return fail(`showing: ${why(on)} shown=${on.json?.shown}`);
    const textShown = off.json?.text?.shown ?? off.json?.shown;
    return ok(off) && textShown === false ? pass('shown, then cleared') : fail(`clearing: ${why(off)} text.shown=${textShown}`);
  }, kiosk, active('shows a message over the page for a moment'));

  // ── screen, volume, launch, lockdown ──
  add('screen.sleep-wake', 'the screen goes off and comes back on, read back from the display', async ({ api, sleep, restorer }) => {
    const k = await api.control('GET', '/kiosk/status');
    if (!ok(k) || typeof k.json.screenOn !== 'boolean') return fail(`could not read the screen state first: ${why(k)}`);
    const was = k.json.screenOn;
    const restore = restorer(`screen ${was ? 'on' : 'off'}`, () => api.control('POST', '/screen', { body: { on: was }, timeoutMs: 20000 }));
    try {
      const off = await api.control('POST', '/screen', { body: { on: false }, timeoutMs: 20000 });
      if (!ok(off) || off.json.screenOn !== false) return fail(`off: ${why(off)} screenOn=${off.json?.screenOn}`);
      await sleep(2000);
      const still = await api.control('GET', '/status');
      if (!ok(still)) return fail(`control API did not answer with the screen off: ${why(still)}`);
      const on = await api.control('POST', '/screen', { body: { on: true }, timeoutMs: 20000 });
      return ok(on) && on.json.screenOn === true ? pass(`off, API answered while dark, on; left ${was ? 'on' : 'off'} as found`) : fail(`on: ${why(on)} screenOn=${on.json?.screenOn}`);
    } finally {
      await restore();
    }
  }, has('screen-power') && kiosk, active('turns the screen off for about two seconds, then puts it back as it was'));
  add('screen.brightness', 'brightness is set and read back', async ({ api, opts: o }) => {
    const r = await api.control('POST', '/screen/brightness', { body: { level: o.brightness } });
    return ok(r) && r.json.level === o.brightness ? pass(`level ${r.json.level}`) : fail(`/screen/brightness ${why(r)} level=${r.json?.level}`);
  }, has('screen-power'), {
    ...active('sets the brightness to --brightness'),
    ...optIn((o) => o.brightness !== undefined, 'pass --brightness <0-255> to set the level this device should keep'),
  });
  add('volume.read-write', 'the media volume is read, written back unchanged and read back', async ({ api }) => {
    const before = await api.control('GET', '/volume?stream=3');
    if (!ok(before)) return fail(`GET /volume ${why(before)}`);
    const r = await api.control('POST', '/volume', { body: { level: before.json.level, stream: 3 } });
    // The audio guard may hold the stream; it then answers volume_unchanged with the true index.
    const index = r.json?.index;
    if ((ok(r) || r.json?.error === 'volume_unchanged') && index === before.json.index) {
      return pass(`level ${before.json.level}, index ${index}/${before.json.maxIndex}${r.json?.error ? ' (held by the audio guard)' : ''}`);
    }
    return fail(`POST /volume ${why(r)}, index ${index} vs ${before.json.index}`);
  }, has('volume'), active('writes the media volume back at the level it reads'));
  add('launch.absent', 'launching an app that is not installed is refused by name', async ({ api }) => {
    const r = await api.control('POST', '/launch', { body: { package: ABSENT_PACKAGE } });
    return r.json?.ok === false && ['not_installed', 'not_allowed'].includes(r.json.error) ? pass(r.json.error) : fail(`expected not_installed or not_allowed, got ${why(r)}`);
  }, has('app-launcher'), active('asks to launch a package that is not installed (refused)'));
  add('launch.app', 'the given app opens, is seen in front, and the kiosk comes back', async ({ api, opts: o, sleep }) => {
    const r = await api.control('POST', '/launch', { body: { package: o.launch }, timeoutMs: 20000 });
    if (!ok(r) || r.json.launched !== true) return fail(`/launch ${why(r)}`);
    await sleep(3000);
    const l = await api.control('GET', '/lockdown');
    const front = l.json?.foreground;
    const back = await api.control('POST', '/kiosk/foreground', { timeoutMs: 40000 });
    if (front !== o.launch) return fail(`after launch the front was ${front}`);
    return ok(back) && back.json.kioskInForeground ? pass(`${r.json.component} in front, kiosk back`) : fail(`returning: ${why(back)}`);
  }, has('app-launcher') && has('lockdown') && kiosk,
  optIn((o) => o.launch, 'pass --launch <package> (an app in launcher.allowed)'));
  add('lockdown.status', 'GET /lockdown reports the lock state and mode', async ({ api, state }) => {
    const r = await api.control('GET', '/lockdown');
    if (!ok(r) || typeof r.json.locked !== 'boolean') return fail(`/lockdown ${why(r)}`);
    state.lockdown = r.json;
    const l = r.json;
    return pass(`enabled ${l.enabled}, locked ${l.locked}, mode ${l.mode}, owner ${l.deviceOwner}, home ${l.homeIsKiosk}, recalls ${l.recallsSinceBoot}${l.allowedAppsError ? `, allowedAppsError ${short(l.allowedAppsError)}` : ''}`);
  }, has('lockdown'));

  // ── debug ──
  const debug = has('debug-tools');
  add('debug.screenshot', 'GET /debug/screenshot returns a PNG', async ({ api }) => {
    const r = await api.control('GET', '/debug/screenshot', { binary: true, timeoutMs: 30000 });
    if (r.error) return fail(`no answer (${r.error})`);
    return r.status === 200 && r.bytes.subarray(0, 8).toString('hex') === PNG_SIGNATURE ? pass(`${r.bytes.length} bytes`) : fail(`HTTP ${r.status}, not a PNG`);
  }, debug && kiosk);
  add('debug.eval', 'POST /debug/eval runs in the live page', async ({ api }) => {
    const r = await api.control('POST', '/debug/eval', { body: { js: '6*7' }, timeoutMs: 30000 });
    return ok(r) && Number(r.json.result) === 42 ? pass('6*7 = 42') : fail(`/debug/eval ${why(r)} result=${short(r.json?.result)}`);
  }, debug && kiosk, active('runs 6*7 in the live page'));
  add('debug.html', 'GET /debug/html returns the document', async ({ api }) => {
    const r = await api.control('GET', '/debug/html', { timeoutMs: 30000 });
    return ok(r) && typeof r.json.html === 'string' && r.json.html.includes('<') ? pass(`${r.json.html.length} characters`) : fail(`/debug/html ${why(r)}`);
  }, debug && kiosk);
  add('debug.fps', 'GET /debug/fps samples the live page', async ({ api, opts: o }) => {
    const r = await api.control('GET', '/debug/fps?ms=1000', { timeoutMs: 25000 });
    if (!ok(r) || typeof r.json.fps !== 'number') return fail(`/debug/fps ${why(r)} (screen off? page not loaded?)`);
    const base = o['fps-baseline'];
    if (base !== undefined && r.json.fps < base * 0.9) return fail(`${r.json.fps} fps, more than 10% below the baseline ${base}`);
    return r.json.fps > 0 ? pass(`${r.json.fps} fps${base !== undefined ? ` (baseline ${base})` : ''}`) : fail('0 fps');
  }, debug && kiosk);
  add('debug.logcat', 'GET /debug/logcat returns the device log', async ({ api }) => {
    const r = await api.control('GET', '/debug/logcat?lines=50', { timeoutMs: 30000 });
    if (r.error || r.status !== 200 || !r.text) return fail(`/debug/logcat ${why(r)}`);
    const scope = r.headers?.get?.('x-daylight-log-scope') === 'own' ? " (this app's lines only: READ_LOGS not granted)" : '';
    return pass(`${r.text.split('\n').length} lines${scope}`);
  }, debug);
  add('debug.exec', 'POST /debug/exec runs, or is refused while debug.execEnabled is false', async ({ api }) => {
    const r = await api.control('POST', '/debug/exec', { body: { cmd: 'id' }, timeoutMs: 30000 });
    if (r.status === 501) return pass('refused: debug.execEnabled is false');
    return ok(r) && r.json.exitCode === 0 ? pass(`ran as ${short(String(r.json.stdout || '').trim())}`) : fail(`/debug/exec ${why(r)}`);
  }, debug, active('runs `id` as the app, or is refused while debug.execEnabled is false'));
  add('debug.log', 'GET /log answers', async ({ api }) => {
    const r = await api.control('GET', '/log');
    return !r.error && r.status === 200 ? pass(`${(r.text || '').length} characters`) : fail(`/log ${why(r)}`);
  });

  // ── device helpers ──
  // A coexistence switch counts as handed over only when /status reports it active.
  const switchActive = (status, key) => status?.switches?.[key]?.active === true;
  const readStatus = async (api) => { const r = await api.control('GET', '/status'); return ok(r) ? { status: r.json } : { error: `/status ${why(r)}` }; };
  const settingOn = (state, key) => state.settings?.[key] === true || state.settings?.[key] === 'true';
  add('midi.status', 'the MIDI link is connected and its output verified by echo', async ({ api }) => {
    const { status, error } = await readStatus(api);
    if (error) return fail(error);
    if (!switchActive(status, 'midi.enabled')) return pass(`midi.enabled is not active (coexistence); ble ${short(status.ble?.state ?? status.ble)}`);
    const ble = status.ble?.state;
    return ble === 'CONNECTED' && status.outVerified === true ? pass('CONNECTED, output verified') : fail(`ble ${ble}, outVerified ${status.outVerified}`);
  }, has('midi-bridge'));
  add('midi.loopback', 'a loopback probe echoes back from the instrument', async ({ api, opts: o }) => {
    const { status, error } = await readStatus(api);
    if (error) return fail(error);
    if (!switchActive(status, 'midi.enabled')) return skip('midi.enabled is not active; turn it on at the hand-over step');
    const r = await api.control('POST', '/loopback', { timeoutMs: 20000 });
    if (!ok(r) || r.json.echoed !== true) return fail(`/loopback ${why(r)} echoed=${r.json?.echoed}`);
    const base = o['rtt-baseline'];
    if (base !== undefined && r.json.rttMs > base * 1.1) return fail(`round trip ${r.json.rttMs} ms, more than 10% above the baseline ${base}`);
    return pass(`round trip ${r.json.rttMs} ms${base !== undefined ? ` (baseline ${base})` : ''}`);
  }, has('midi-bridge'), active('sends a probe note to the instrument'));
  add('speaker.status', 'GET /speaker answers; the speaker is connected once handed over', async ({ api }) => {
    const { status, error } = await readStatus(api);
    if (error) return fail(error);
    const r = await api.control('GET', '/speaker');
    if (!ok(r)) return fail(`/speaker ${why(r)}`);
    if (!switchActive(status, 'speaker.enabled')) return pass('speaker.enabled is not active (coexistence)');
    return r.json.speaker?.connected === true ? pass(`connected, guard ${short(r.json.guard?.state ?? r.json.guard?.reason ?? '')}`) : fail(`speaker ${short(r.json.speaker)}`);
  }, has('audio-guard'));
  add('bluetooth.status', 'GET /bluetooth answers', async ({ api }) => {
    const r = await api.control('GET', '/bluetooth');
    return ok(r) ? pass(short(r.json.mode ?? r.json.devices?.length ?? 'answered')) : fail(`/bluetooth ${why(r)}`);
  }, has('bluetooth-controls'));
  add('mic.status', 'the microphone stream runs with nothing holding the mic', async ({ api }) => {
    const { status, error } = await readStatus(api);
    if (error) return fail(error);
    const r = await api.control('GET', '/mic/status');
    if (!ok(r)) return fail(`/mic/status ${why(r)}`);
    const m = r.json;
    if (!switchActive(status, 'mic.enabled')) return pass('mic.enabled is not active (coexistence)');
    return m.running === true && !m.lastError && m.heldByOther !== true
      ? pass(`running, streaming ${m.streaming}, clients ${m.clients}`)
      : fail(`running ${m.running}, heldByOther ${m.heldByOther}, lastError ${m.lastError} ${short(m.lastErrorDetail || '')}`);
  }, has('mic-bridge'));
  add('lease.status', 'GET /lease answers', async ({ api }) => {
    const r = await api.control('GET', '/lease');
    return ok(r) ? pass(`configured ${r.json.configured}, ready ${r.json.ready}, enforcement ${r.json.enforcement}`) : fail(`/lease ${why(r)}`);
  }, has('lease-gate'));
  add('presence.status', 'GET /presence answers', async ({ api }) => {
    const r = await api.control('GET', '/presence');
    return ok(r) ? pass('answered') : fail(`/presence ${why(r)}`);
  }, has('presence'));
  add('hid.status', 'GET /usb-hid and GET /input answer', async ({ api }) => {
    const a = await api.control('GET', '/usb-hid');
    const b = await api.control('GET', '/input');
    return ok(a) && ok(b) ? pass('answered') : fail(`/usb-hid ${why(a)}, /input ${why(b)}`);
  }, has('hid-input'));

  // ── recovery (disruptive) ──
  add('crash.restart', 'POST /kiosk/restart restarts the payload and the API comes back', async ({ api, sleep, pollMs }) => {
    const before = await api.control('GET', '/status');
    if (!ok(before)) return fail(`/status ${why(before)}`);
    const r = await api.control('POST', '/kiosk/restart', { timeoutMs: 40000 });
    if (!ok(r)) return fail(`/kiosk/restart ${why(r)}`);
    const t0 = Date.now();
    for (let i = 0; i < Math.ceil(60000 / pollMs); i += 1) {
      await sleep(pollMs);
      const s = await api.control('GET', '/status');
      if (ok(s) && s.json.uptimeMs < before.json.uptimeMs) return pass(`back after ~${Math.round((Date.now() - t0) / 1000)} s`);
    }
    return fail('the payload did not report a restart within 60 s');
  }, kiosk, { flag: 'restart', effect: 'restarts the payload: MIDI, synth, page and mic drop for a few seconds' });
  add('crash.kill', "killing the app's process: it comes back by itself", async ({ api, sleep, pollMs, opts: o, state, restorer }) => {
    const info = await api.control('GET', '/debug/info');
    if (!ok(info)) return fail(`/debug/info ${why(info)}`);
    const prior = settingOn(state, 'debug.execEnabled');
    let restored = null;
    const restore = prior ? async () => {} : restorer('debug.execEnabled false', async () => {
      restored = await api.control('POST', '/settings', { body: { key: 'debug.execEnabled', value: false } });
    });
    let result;
    try {
      if (!prior) {
        const s = await api.control('POST', '/settings', { body: { key: 'debug.execEnabled', value: true } });
        if (!ok(s)) return fail(`could not turn on debug.execEnabled: ${why(s)}`);
      }
      // The shell that runs the command is a child of the app's process.
      await api.control('POST', '/debug/exec', { body: { cmd: 'kill -9 $PPID' }, timeoutMs: 10000 });
      result = await waitBack(api, { sleep, pollMs, waitMs: (o['reboot-wait'] ?? 300) * 1000, before: info.json.elapsedRealtimeMs, rebooted: false });
    } finally {
      await restore();
    }
    if (restored && !ok(restored)) return fail(`${result.evidence}; debug.execEnabled could not be put back to false: ${why(restored)}`);
    return result.ok ? pass(result.evidence) : fail(result.evidence);
  }, debug, optIn((o) => o.kill, 'pass --kill (turns debug.execEnabled on for the check and puts back the value it had)'));
  add('payload.bad', 'a payload that cannot start is rolled back and the lifeline stays up', async ({ api, sleep, pollMs, opts: o, badPayload }) => {
    const source = badPayload || { url: o['bad-payload-url'], sha256: o['bad-payload-sha256'] };
    const before = await api.control('GET', '/payload');
    if (!ok(before)) return fail(`/payload ${why(before)}`);
    const r = await api.control('POST', '/payload', { body: { url: source.url, sha256: source.sha256 }, timeoutMs: 60000 });
    if (!ok(r)) return fail(`POST /payload ${why(r)}`);
    let lifelineMisses = 0;
    for (let i = 0; i < Math.ceil(120000 / pollMs); i += 1) {
      await sleep(pollMs);
      const life = await api.lifeline('GET', '/status');
      if (!ok(life)) { lifelineMisses += 1; continue; }
      const p = life.json.payload || {};
      if (p.lastFailed && p.lastFailed !== before.json.lastFailed) {
        const control = await api.control('GET', '/status');
        if (!ok(control)) continue;
        // The rollback may have finished between the two reads: read the lifeline again.
        const again = await api.lifeline('GET', '/status');
        if (!ok(again)) { lifelineMisses += 1; continue; }
        const now = again.json.payload || {};
        const back = now.active === before.json.active;
        const evidence = `lastFailed ${now.lastFailed}, active ${now.active}, lifeline missed ${lifelineMisses} polls`;
        return back && lifelineMisses === 0 ? pass(evidence) : fail(evidence);
      }
    }
    return fail(`no rollback seen within 120 s (lifeline missed ${lifelineMisses} polls)`);
  }, true, optIn((o) => o['bad-payload-url'] || o['serve-bad-payload'],
    'pass --bad-payload-url and --bad-payload-sha256, or --serve-bad-payload <addr:port>'));
  add('reboot.survives', 'after a reboot the lifeline and the control API answer with no ADB and no touch', async ({ api, sleep, pollMs, opts: o, out }) => {
    const info = await api.control('GET', '/debug/info');
    if (!ok(info)) return fail(`/debug/info ${why(info)}`);
    const r = has('screen-power') ? await api.control('POST', '/device/reboot') : { status: 501 };
    if (r.status === 501 || r.json?.ok === false) {
      out(`MANUAL reboot.survives      this device cannot reboot itself (${r.json?.reason || r.json?.error || 'no route'}): power-cycle it now; waiting up to ${o['reboot-wait'] ?? 300} s`);
    } else if (!ok(r)) {
      return fail(`/device/reboot ${why(r)}`);
    }
    const result = await waitBack(api, { sleep, pollMs, waitMs: (o['reboot-wait'] ?? 300) * 1000, before: info.json.elapsedRealtimeMs, rebooted: true });
    if (!result.ok || !kiosk) return result.ok ? pass(result.evidence) : fail(result.evidence);
    const k = await api.control('GET', '/kiosk/status');
    return ok(k) && k.json.ready ? pass(`${result.evidence}; page ready`) : fail(`${result.evidence}; page not ready: ${why(k)}`);
  }, debug, optIn((o) => o.reboot, 'pass --reboot (stage 8 of the cutover runbook first)'));

  // ── log store ──
  add('logstore.events', "the device's events are in the log store under its context.app", async ({ state, opts: o, fetchImpl }) => {
    if (!o['log-store']) return skip('pass --log-store <url> (read-only LogsQL query)');
    const app = (typeof state.settings?.['logstore.app'] === 'string' && state.settings['logstore.app']) || `daylight-${id}`;
    const query = `context.app:"${app}" AND _time:${o['log-window'] || '1h'}`;
    try {
      const res = await fetchImpl(`${String(o['log-store']).replace(/\/+$/, '')}/select/logsql/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ query, limit: '500' }).toString(),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) return fail(`log store HTTP ${res.status} for ${query}`);
      const rows = (await res.text()).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      if (!rows.length) return fail(`no events for ${query}`);
      const newest = rows.map((r) => r._time).filter(Boolean).sort().at(-1);
      const kinds = [...new Set(rows.map((r) => r._msg).filter(Boolean))].slice(0, 5);
      return pass(`${rows.length}${rows.length === 500 ? '+' : ''} events for ${query}; newest ${newest}; e.g. ${kinds.join(', ')}`);
    } catch (e) {
      return fail(`log store did not answer: ${e?.cause?.code || e?.message || e}`);
    }
  });

  // ── by hand ──
  const locked = (state) => (state.lockdown?.locked ? '' : ' [lockdown is off: run this after the switch]');
  const escape = (key, what) => add(`escape.${key}`, `escape attempt: ${what}`, async ({ state }) => manual(
    `${what}. Look for: the kiosk back in front within about 2 s; 'dd lockdown' recallsSinceBoot one higher; lastRecall names what was in front.${locked(state)}`,
  ), has('lockdown'));
  escape('home', 'press Home');
  escape('recents', 'open Recents');
  escape('status-bar', 'pull down the status bar');
  if (id === 'portal') escape('control-center', 'swipe up the Control Center');
  if (id === 'shield') escape('assistant', "press the remote's assistant button");
  else escape('power-menu', 'long-press power for the power menu');
  add('network.drop', 'network dropped for five minutes: the page recovers', async () => manual(
    "Note 'dd kiosk' lastLoad.loadId. Take WiFi away for five minutes (router, or Settings during an unlock), then give it back. Look for: the page still showing, and the same loadId (a healthy page is not reloaded); with the error page showing, a reload at once.",
  ), kiosk);
  add('keys.volume', 'volume keys change the app volume and reach the page', async () => manual(
    "Run: dd eval 'window.__seen=[];addEventListener(\"daylight:key\",e=>__seen.push(e.detail));1'. Press volume up, then down. Run: dd eval '__seen'. Look for: two daylight:key events, the system volume not moved, no beep.",
  ), has('volume-keys'));
  add('keys.sleep-wake', 'the double volume-down sleep and wake gesture', async ({ state }) => manual(
    `Press volume-down twice quickly: the screen goes off. Press again: it comes on.${settingOn(state, 'keys.screenToggleEnabled') ? '' : ' [keys.screenToggleEnabled is off: set it first if the gesture is wanted]'}`,
  ), has('volume-keys'));
  add('touch.page', 'touch works on the page and the exit gesture raises the PIN prompt', async () => manual(
    'Tap through the page: buttons respond. Seven quick taps top-left: the PIN prompt (only with lockdown.exitPin set).',
  ), kiosk && id !== 'shield');
  add('keys.remote', 'remote keys reach the page', async () => manual(
    'D-pad, select, back, play/pause on the menu: each moves or acts as it does under Fully (compare with the fkb.keyCapture audit).',
  ), id === 'shield');
  add('mic.call', 'a Home Line call from a phone, five minutes both ways', async () => manual(
    "Call the TV from a phone. Look for: audio and video both ways; 'dd get /mic/status' streaming true, clients 1.",
  ), has('mic-bridge'));
  add('synth.audible', 'synth voices are audible on the speaker and the guard holds', async () => manual(
    "Play keys: sound from the configured speaker, never the tablet's own. Switch the speaker off: silence (the output gate closes). On again: it reconnects.",
  ), has('synth'));
  add('bluetooth.pairing', 'the Bluetooth pairing dialog stays in front', async () => manual(
    "Start a pairing from the page. Look for: Android's pairing dialog stays; 'dd lockdown' pairingDialogAllowed true while it waits.",
  ), has('bluetooth-controls') && has('lockdown') && id !== 'shield');
  add('sound.audible', 'speech and a sound are audible', async () => manual(
    "Run: dd speak hello, then dd sound <an audio URL on the app's origin>, then dd sound stop. Look for: both heard.",
  ), debug);

  return checks;
}

/** Waits for a device that went away to answer again. `rebooted` says which kind of return proves it. */
async function waitBack(api, { sleep, pollMs, waitMs, before, rebooted }) {
  const t0 = Date.now();
  let wentAway = false;
  let lifelineAt = null;
  for (let i = 0; i < Math.ceil(waitMs / pollMs); i += 1) {
    await sleep(pollMs);
    const life = await api.lifeline('GET', '/status', { timeoutMs: 5000 });
    if (!ok(life)) { wentAway = true; continue; }
    if (lifelineAt === null && wentAway) lifelineAt = Date.now() - t0;
    const info = await api.control('GET', '/debug/info', { timeoutMs: 5000 });
    if (!ok(info)) { wentAway = true; continue; }
    const elapsed = info.json.elapsedRealtimeMs;
    const didReboot = typeof elapsed === 'number' && elapsed < before;
    if (rebooted && didReboot) {
      return { ok: true, evidence: `rebooted; lifeline after ~${Math.round((lifelineAt ?? Date.now() - t0) / 1000)} s, control API after ~${Math.round((Date.now() - t0) / 1000)} s` };
    }
    if (!rebooted && wentAway) {
      return didReboot
        ? { ok: false, evidence: 'the device rebooted instead of restarting the app' }
        : { ok: true, evidence: `process back after ~${Math.round((Date.now() - t0) / 1000)} s, no reboot` };
    }
  }
  return { ok: false, evidence: wentAway ? `did not answer again within ${Math.round(waitMs / 1000)} s` : `never went away within ${Math.round(waitMs / 1000)} s` };
}

/** --only entries that select no check of this device: a typo must not pass by selecting nothing. */
export function unmatchedOnly(deviceFile, opts) {
  if (!opts.only) return [];
  const ids = buildChecks(deviceFile, opts).map((c) => c.id);
  return opts.only.filter((sel) => !ids.some((id) => id === sel || id.startsWith(`${sel}.`)));
}

/** True when a check id is selected by --only / --skip (a group name selects every check in it). */
export function selected(checkId, opts) {
  const match = (sel) => sel.some((s) => checkId === s || checkId.startsWith(`${s}.`));
  if (opts.only && !match(opts.only)) return false;
  if (opts.skip && match(opts.skip)) return false;
  return true;
}

/** Serves a file that is not a payload, so the loader must refuse it and roll back. */
export async function serveBadPayload(spec, listen = createServer) {
  const [address, portText] = spec.split(':');
  const bytes = Buffer.concat([Buffer.from('not a payload\n'), randomBytes(2048)]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const server = listen((req, res) => {
    if (req.url === '/bad-payload.jar') { res.writeHead(200, { 'Content-Type': 'application/java-archive' }); res.end(bytes); return; }
    res.writeHead(404); res.end();
  });
  // Bound to that one address, not every interface.
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(portText), address, resolve); });
  const { port, address: boundAddress } = server.address();
  return { url: `http://${address}:${port}/bad-payload.jar`, sha256, boundAddress, close: () => new Promise((r) => server.close(r)) };
}

/**
 * Runs the selected checks in order and prints a line for each. Returns the exit code.
 * deps: fetchImpl, out (a line printer), sleep, pollMs.
 */
export async function runAcceptance({ deviceFile, host, token, opts, deps = {} }) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const clean = (text) => (token ? String(text).split(token).join('[token]') : String(text));
  const print = deps.out ?? ((line) => console.log(line));
  const out = (line) => print(clean(line));
  const unmatched = unmatchedOnly(deviceFile, opts);
  if (unmatched.length) {
    for (const sel of unmatched) out(`✗ --only ${sel} selects no check for ${deviceFile.id}`);
    return 1;
  }
  // State a check changed and has not put back yet. An interrupt (Ctrl-C) puts it back
  // before exiting, so a run stopped halfway does not leave exec on or the screen dark.
  const signals = deps.signals ?? process;
  const exit = deps.exit ?? ((code) => process.exit(code));
  const pending = new Map();
  let nextRestore = 0;
  const restorer = (what, undo) => {
    const key = nextRestore += 1;
    pending.set(key, { what, undo });
    return async () => {
      if (!pending.has(key)) return;
      pending.delete(key);
      await undo();
    };
  };
  const onInterrupt = async () => {
    const left = [...pending.values()].reverse();
    pending.clear();
    for (const { what, undo } of left) {
      try { await undo(); out(`interrupted: put back ${what}`); } catch (e) { out(`interrupted: could not put back ${what}: ${e?.message || e}`); }
    }
    exit(130);
  };
  signals.on('SIGINT', onInterrupt);
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const pollMs = deps.pollMs ?? 2000;
  const api = deviceApi({ host, ports: deviceFile.control, token, fetchImpl });
  const availableChecks = buildChecks(deviceFile, opts);
  const checks = availableChecks.filter((c) => selected(c.id, opts));
  const state = {};
  const counts = { PASS: 0, FAIL: 0, MANUAL: 0, SKIP: 0 };
  let badPayload = null;
  // Settings feed the switch-aware checks; read them first even when that check is not selected.
  if (!checks.some((c) => c.id === 'settings.resolved')) {
    const r = await api.control('GET', '/settings');
    if (ok(r)) state.settings = Object.fromEntries((r.json.settings || []).map((s) => [s.key, s.value]));
  }
  if (!checks.some((c) => c.id === 'lockdown.status') && deviceFile.capabilities?.includes('lockdown')) {
    const r = await api.control('GET', '/lockdown');
    if (ok(r)) state.lockdown = r.json;
  }
  out(`acceptance: ${deviceFile.id} (${checks.length} checks)`);
  const context = { api, state, opts, sleep, pollMs, out, fetchImpl, restorer };
  const preflightChecks = new Map(availableChecks
    .filter((check) => check.id === 'core.status' || check.id === 'core.auth')
    .map((check) => [check.id, check]));
  const preflightResults = new Map();
  const runPreflightCheck = async (id) => {
    if (!preflightResults.has(id)) {
      preflightResults.set(id, await preflightChecks.get(id).run(context));
    }
    return preflightResults.get(id);
  };

  async function runCheck(check) {
    if (preflightChecks.has(check.id)) return runPreflightCheck(check.id);
    const needs = check.needs;
    if (needs) {
      if (needs.flag && !opts[needs.flag]) return skip(`pass --${needs.flag}: ${needs.effect}`);
      if (needs.armed && !needs.armed(opts)) return skip(needs.skipEvidence);
      // Reuse the core diagnostics, even if --only or --skip hid their output.
      for (const id of ['core.status', 'core.auth']) {
        const result = await runPreflightCheck(id);
        if (result.status !== 'PASS') return fail(`preflight ${id}: ${result.evidence}`);
      }
      if (check.id === 'payload.bad' && opts['serve-bad-payload']) {
        badPayload = await (deps.serveBadPayload ?? serveBadPayload)(opts['serve-bad-payload']);
      }
    }
    return check.run({ ...context, badPayload });
  }

  try {
    for (const check of checks) {
      let result;
      try {
        result = await runCheck(check);
      } catch (e) {
        result = fail(`check threw: ${e?.message || e}`);
      }
      counts[result.status] += 1;
      out(`${result.status.padEnd(6)} ${check.id.padEnd(20)} ${result.evidence}`);
    }
  } finally {
    signals.off('SIGINT', onInterrupt);
    await badPayload?.close?.();
  }
  out(`${counts.PASS} pass, ${counts.FAIL} fail, ${counts.MANUAL} manual, ${counts.SKIP} skip`);
  return counts.FAIL > 0 ? 1 : 0;
}

function tokensPath() {
  if (process.env.DAYLIGHT_ANDROID_TOKENS) return process.env.DAYLIGHT_ANDROID_TOKENS;
  if (process.env.DAYLIGHT_BASE_PATH) return join(process.env.DAYLIGHT_BASE_PATH, 'data/household/auth/daylight-android.yml');
  throw new Error('set DAYLIGHT_ANDROID_TOKENS or DAYLIGHT_BASE_PATH to locate the private tokens file');
}

/** The device file, refused for a device with no control API. */
export function loadDeviceFile(name, dir = join(HERE, '..', 'devices')) {
  const path = join(dir, `${name}.yml`);
  if (!/^[a-z][a-z0-9]*$/.test(name) || !existsSync(path)) throw new Error(`unknown device '${name}'`);
  const file = parse(readFileSync(path, 'utf8'));
  if (file.control?.bind === 'none') throw new Error(`'${name}' has no control API (control.bind: none); see __docs/runbooks/android/phone-acceptance.md`);
  return file;
}

/** Host from --host, else the private file; the token from the private file only. Never a default host. */
export function resolveTarget(name, opts, fleet) {
  const entry = fleet?.[name];
  if (!entry?.token) throw new Error(`no token for '${name}' in the private tokens file`);
  const host = opts.host || entry.host;
  if (!host) throw new Error(`no host for '${name}': pass --host or add host to its entry in the private tokens file`);
  const overridden = !!opts.host && String(opts.host) !== String(entry.host ?? '');
  return { host: String(host), token: String(entry.token), overridden };
}

/**
 * The private tokens file, parsed. A YAML error message quotes the lines around the
 * fault, and those can hold a token, so only the line number is passed on.
 */
export function readTokensFile(path, read = (p) => readFileSync(p, 'utf8')) {
  const text = read(path);
  try {
    return parse(text);
  } catch (e) {
    const line = e?.linePos?.[0]?.line;
    throw new Error(`tokens file is not valid YAML${line ? ` (line ${line})` : ''}`);
  }
}

export async function main(argv, deps = {}) {
  const opts = parseOptions(argv);
  const deviceFile = loadDeviceFile(opts.device, deps.devicesDir);
  if (opts.list) {
    const unmatched = unmatchedOnly(deviceFile, opts);
    if (unmatched.length) throw new Error(unmatched.map((sel) => `--only ${sel} selects no check for ${deviceFile.id}`).join('; '));
    for (const c of buildChecks(deviceFile, opts).filter((x) => selected(x.id, opts))) {
      console.log(`${c.id.padEnd(20)} ${c.title}${c.needs?.flag ? ` [--${c.needs.flag}]` : ''}`);
    }
    return 0;
  }
  const fleet = deps.fleet ?? readTokensFile(tokensPath());
  const { host, token, overridden } = resolveTarget(opts.device, opts, fleet);
  if (overridden) (deps.out ?? ((line) => console.log(line)))(`the token goes to ${host} (--host), not the tokens file's host`);
  return runAcceptance({ deviceFile, host, token, opts, deps });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(`✗ ${e.message || e}`); process.exit(1); });
}
