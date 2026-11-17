#!/usr/bin/env node
// daylight-device — one CLI for every DaylightStation Android device.
//
//   daylight-device <device> <command> [arguments]
//   daylight-device help
//
// Host and token come from a private file (never the repo):
//   $DAYLIGHT_ANDROID_TOKENS, else $DAYLIGHT_BASE_PATH/data/household/auth/daylight-android.yml
// Ports come from devices/<device>.yml.
//
// A device whose control.bind is none (the phone) has no control API: every command for
// it answers with how that device is debugged instead (adb).
//
// The token is sent as a header only. It is never put in a URL, and every line this
// CLI prints is passed through a filter that removes it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const HERE = dirname(fileURLToPath(import.meta.url));

const USAGE = `usage: daylight-device <device> <command> [arguments]

Device and payload
  status                           device, payload version, capabilities
  capabilities                     capabilities and every route this build serves
  info                             model, SDK level, uptime
  settings [list]                  every setting with its value and default
  settings get <key>               one setting
  settings set <key> <value>       override a setting
  settings reset <key>             back to the default
  payload [status]                 which payload runs, and the one before it
  payload push <url> <sha256>      download and swap the payload
  payload rollback                 back to the previous payload
  update [<apk-url> [sha256]]      install a new shell APK; with no URL, how the last one went
  lifeline [status|rollback|restart|reset-settings|owner-release|log]   the shell's own port, for when the payload is down

Kiosk page
  kiosk                            page, screen, foreground, battery, memory, WiFi
  load <url> [--no-wait]           load a URL (alias: url)
  load-start [--no-wait]           load the start URL
  reload [--no-wait]               reload the current page
  foreground                       bring the kiosk to the front
  renderer-reset                   respawn the WebView renderer
  restart                          restart the payload in place
  overlay text [message…]          show a message over the page; with no message, clear it
  overlay url [<url>] [--gravity top|bottom]   show a web overlay; with no URL, clear it
  overlay clear                    clear both layers

Screen, sound, apps
  screen on|off
  brightness <0-255>
  volume [get] [--stream n]        read a stream's volume
  volume set <0-100> [--stream n]  set it, as a percentage
  speak [--locale tag] <text…>     text to speech (alias: tts)
  sound <url> [--loop] [--stream n]   play a sound from an origin the kiosk trusts
  sound stop
  launch <package> [activity]      start an app that launcher.allowed permits
  launch --intent <intent-uri>
  reboot                           reboot the device (device owner only)

Lockdown
  lockdown [status]                locked, mode, what is in front, recalls
  lockdown lock                    (alias: lock)
  lockdown unlock [minutes]        unlock; it always relocks by itself (alias: unlock)
  lockdown input lock [--revision n] [--for minutes]   stop the volume keys
  lockdown input release [--revision n]
  lockdown home on|off             make this app a home candidate, or stop it being one
  lockdown owner release           undo every owner policy; stays released until resume
  lockdown owner resume            act as device owner again
  lockdown owner transfer <package/receiver>   hand device ownership to that admin

Diagnostics
  shot [file]                      screenshot to a PNG file; prints the path
  eval [--timeout ms] <js…>        run JavaScript in the live page; prints the result
  eval-file <path>                 the same, from a file
  html [file]                      the page's HTML
  fps [ms] [--min n]               frame rate of the live page; exit 1 below --min
  jank [minFps]                    wake the screen, sample for a second; exit 1 below minFps (20), 2 with no reading
  exec [--timeout ms] <command…>   run a shell command as the app (needs debug.execEnabled); exits with its code
  logcat [lines] [filter…]         the device log

Anything else
  get <path> [k=v …]               any GET route on the control port
  post <path> [k=v …] ['{json}']   any POST route; k=v becomes the query`;

export function usage() { return USAGE; }

const SIMPLE = {
  status: { method: 'GET', path: '/status' },
  capabilities: { method: 'GET', path: '/capabilities' },
  info: { method: 'GET', path: '/debug/info' },
  kiosk: { method: 'GET', path: '/kiosk/status' },
  // The kiosk answers after it has seen what it was asked for happen, which can take a while.
  foreground: { method: 'POST', path: '/kiosk/foreground', timeoutMs: 40000 },
  'renderer-reset': { method: 'POST', path: '/kiosk/renderer/reset', timeoutMs: 40000 },
  restart: { method: 'POST', path: '/kiosk/restart', timeoutMs: 40000 },
  lock: { method: 'POST', path: '/lockdown/lock' },
  reboot: { method: 'POST', path: '/device/reboot' },
};
const LIFELINE = {
  status: { method: 'GET', path: '/status' },
  rollback: { method: 'POST', path: '/payload/rollback' },
  restart: { method: 'POST', path: '/restart' },
  // For a stored setting that keeps the payload from starting: the control port is down then.
  'reset-settings': { method: 'POST', path: '/settings/reset' },
  // Where this app is device owner and the payload is broken: clears the home preference and leaves lock task.
  'owner-release': { method: 'POST', path: '/owner/release' },
  log: { method: 'GET', path: '/log' },
};

/**
 * A device built with control.bind none (the owner's phone) starts no control server
 * and no lifeline, so nothing this CLI sends could arrive. Returns what to say, or null
 * for a device that listens.
 */
export function noControlApi(name, control) {
  if (control?.bind !== 'none') return null;
  return `'${name}' has no control API (control.bind: none): this CLI cannot reach it. `
    + `Debug it over adb: adb logcat --pid=$(adb shell pidof -s <its package>), and `
    + `adb shell run-as <its package> for its files. See __docs/reference/android/phone.md.`;
}

export function resolveDevice(fleet, name) {
  const entry = fleet?.[name];
  if (!entry) throw new Error(`unknown device '${name}'; known: ${Object.keys(fleet || {}).join(', ') || '(none)'}`);
  if (!entry.token) throw new Error(`no token for '${name}' in the private tokens file`);
  if (!entry.host) throw new Error(`no host for '${name}' in the private tokens file`);
  return { host: String(entry.host), token: String(entry.token) };
}

const post = (path, body, extra = {}) => ({ plane: 'control', method: 'POST', path, ...(body === undefined ? {} : { body }), ...extra });
const get = (path, extra = {}) => ({ plane: 'control', method: 'GET', path, ...extra });

/**
 * Split `--name value` and `--flag` out of an argument list. With `leadingOnly`, only
 * options before the first plain argument count, so free text (a script, a command, a
 * sentence) may itself contain `--`.
 */
function options(args, valued = [], flags = [], { leadingOnly = false, usage: text } = {}) {
  const rest = [];
  const opts = {};
  let i = 0;
  for (; i < args.length; i += 1) {
    const a = args[i];
    if (!a.startsWith('--')) {
      if (leadingOnly) break;
      rest.push(a);
      continue;
    }
    const name = a.slice(2);
    if (valued.includes(name)) {
      if (args[i + 1] === undefined) throw new Error(text);
      opts[name] = args[i + 1];
      i += 1;
    } else if (flags.includes(name)) {
      opts[name] = true;
    } else if (leadingOnly) {
      break;
    } else {
      throw new Error(text);
    }
  }
  return { rest: leadingOnly ? args.slice(i) : rest, opts };
}

/** A whole number in [min, max], or an Error carrying the usage line. */
function integer(raw, text, min = -Infinity, max = Infinity) {
  if (raw === undefined || !/^-?\d+$/.test(String(raw))) throw new Error(text);
  const n = Number(raw);
  if (n < min || n > max) throw new Error(text);
  return n;
}

function sha256(raw) {
  if (!/^[0-9a-fA-F]{64}$/.test(String(raw))) throw new Error('sha256 must be 64 hex characters');
  return raw;
}

function parseSettings(sub, rest) {
  if (!sub || sub === 'list') return get('/settings');
  if (sub === 'get' && rest.length === 1) return get('/settings', { pick: rest[0] });
  // The value goes out as the text that was typed. The device knows the setting's
  // declared type and coerces "true" or "30" itself; guessing here would make a
  // string setting impossible to set to such text.
  if (sub === 'set' && rest.length >= 2) return post('/settings', { key: rest[0], value: rest.slice(1).join(' ') });
  if (sub === 'reset' && rest.length === 1) {
    return { plane: 'control', method: 'DELETE', path: `/settings?key=${encodeURIComponent(rest[0])}` };
  }
  throw new Error('usage: settings [list | get <key> | set <key> <value> | reset <key>]');
}

function parseLockdown(sub, rest, now) {
  const text = 'usage: lockdown [status | lock | unlock [minutes] | input lock|release … | home on|off | owner release|resume|transfer …]';
  if (!sub || sub === 'status') return get('/lockdown');
  if (sub === 'lock' && rest.length === 0) return post('/lockdown/lock');
  if (sub === 'unlock') return parseUnlock(rest);
  if (sub === 'home') {
    // The HOME alias is installed disabled. Enabling it is the cutover's switch step.
    if (rest.length !== 1 || (rest[0] !== 'on' && rest[0] !== 'off')) throw new Error('usage: lockdown home on|off');
    return post('/lockdown/home', { enabled: rest[0] === 'on' });
  }
  if (sub === 'owner') {
    const ownerUsage = 'usage: lockdown owner release | lockdown owner resume | lockdown owner transfer <package/receiver>';
    const [action, ...more] = rest;
    if ((action === 'release' || action === 'resume') && more.length === 0) return post(`/lockdown/owner/${action}`);
    // The device checks the target against lockdown.ownerTransferTarget; this only checks its shape.
    if (action === 'transfer' && more.length === 1 && /^[A-Za-z][\w.]*\/[\w.$]+$/.test(more[0])) {
      return post('/lockdown/owner/transfer', { to: more[0] });
    }
    throw new Error(ownerUsage);
  }
  if (sub === 'input') {
    const inputUsage = 'usage: lockdown input lock [--revision n] [--for minutes] | lockdown input release [--revision n]';
    const [action, ...more] = rest;
    if (action !== 'lock' && action !== 'release') throw new Error(inputUsage);
    const { rest: extra, opts } = options(more, ['revision', 'for'], [], { usage: inputUsage });
    if (extra.length) throw new Error(inputUsage);
    const body = { locked: action === 'lock' };
    if (opts.revision !== undefined) body.revision = integer(opts.revision, inputUsage, 1);
    if (opts.for !== undefined) {
      // A release carries no deadline: the device refuses one that does.
      if (action === 'release') throw new Error(inputUsage);
      body.lockedUntil = now + integer(opts.for, inputUsage, 1) * 60000;
    }
    return post('/lockdown/input', body);
  }
  throw new Error(text);
}

function parseUnlock(args) {
  const text = 'usage: lockdown unlock [minutes]';
  if (args.length > 1) throw new Error(text);
  return post('/lockdown/unlock', args.length ? { forMs: integer(args[0], text, 1) * 60000 } : {});
}

function parseVolume(args) {
  const text = 'usage: volume [get] [--stream n] | volume set <0-100> [--stream n]';
  const { rest, opts } = options(args, ['stream'], [], { usage: text });
  const stream = opts.stream === undefined ? undefined : integer(opts.stream, text, 0, 10);
  if (rest.length === 0 || (rest.length === 1 && rest[0] === 'get')) return get(`/volume?stream=${stream ?? 3}`);
  const level = rest[0] === 'set' ? rest[1] : rest[0];
  if (rest.length !== (rest[0] === 'set' ? 2 : 1)) throw new Error(text);
  const body = { level: integer(level, text, 0, 100) };
  if (stream !== undefined) body.stream = stream;
  return post('/volume', body);
}

function parseOverlay(args) {
  const text = 'usage: overlay text [message…] | overlay url [<url>] [--gravity top|bottom] | overlay clear';
  const [layer, ...rest] = args;
  // The two layers are independent: each form touches only the layer it names.
  if (layer === 'text') return post('/kiosk/overlay', { text: rest.join(' ') });
  if (layer === 'clear' && rest.length === 0) return post('/kiosk/overlay', {});
  if (layer === 'url') {
    const { rest: urls, opts } = options(rest, ['gravity'], [], { usage: text });
    if (urls.length > 1) throw new Error(text);
    if (opts.gravity !== undefined && opts.gravity !== 'top' && opts.gravity !== 'bottom') throw new Error(text);
    const body = { url: urls[0] ?? '' };
    if (opts.gravity) body.gravity = opts.gravity;
    return post('/kiosk/overlay', body);
  }
  throw new Error(text);
}

function parsePayload(sub, rest) {
  if (!sub || sub === 'status') return get('/payload');
  if (sub === 'rollback' && rest.length === 0) return post('/payload/rollback');
  if (sub === 'push') {
    if (rest.length !== 2) throw new Error('usage: payload [status | push <url> <sha256> | rollback]');
    return post('/payload', { url: rest[0], sha256: sha256(rest[1]) });
  }
  throw new Error('usage: payload [status | push <url> <sha256> | rollback]');
}

function parseKiosk(command, args, { now, readFile }) {
  switch (command) {
    case 'load':
    case 'url': {
      const { rest, opts } = options(args, [], ['no-wait'], { usage: 'usage: load <url> [--no-wait]' });
      if (rest.length !== 1) throw new Error('usage: load <url> [--no-wait]');
      // A waited load can take webview.loadTimeoutSec; give the request room.
      return post('/kiosk/load', opts['no-wait'] ? { url: rest[0], wait: false } : { url: rest[0] }, { timeoutMs: 40000 });
    }
    case 'load-start':
    case 'reload': {
      const text = `usage: ${command} [--no-wait]`;
      const { rest, opts } = options(args, [], ['no-wait'], { usage: text });
      if (rest.length) throw new Error(text);
      return post(`/kiosk/${command}`, opts['no-wait'] ? { wait: false } : undefined, { timeoutMs: 40000 });
    }
    case 'overlay': return parseOverlay(args);
    case 'screen':
      if (args.length !== 1 || (args[0] !== 'on' && args[0] !== 'off')) throw new Error('usage: screen on|off');
      return post('/screen', { on: args[0] === 'on' });
    case 'brightness':
      if (args.length !== 1) throw new Error('usage: brightness <0-255>');
      return post('/screen/brightness', { level: integer(args[0], 'usage: brightness <0-255>', 0, 255) });
    case 'volume': return parseVolume(args);
    case 'unlock': return parseUnlock(args);
    case 'launch': {
      const text = 'usage: launch <package> [activity] | launch --intent <intent-uri>';
      const { rest, opts } = options(args, ['intent'], [], { usage: text });
      if (opts.intent !== undefined) {
        if (rest.length) throw new Error(text);
        return post('/launch', { intent: opts.intent });
      }
      if (rest.length < 1 || rest.length > 2) throw new Error(text);
      return post('/launch', rest.length === 2 ? { package: rest[0], activity: rest[1] } : { package: rest[0] });
    }
    case 'eval':
    case 'exec': {
      const text = command === 'eval' ? 'usage: eval [--timeout ms] <js…>' : 'usage: exec [--timeout ms] <command…>';
      const { rest, opts } = options(args, ['timeout'], [], { leadingOnly: true, usage: text });
      if (!rest.length) throw new Error(text);
      const body = command === 'eval' ? { js: rest.join(' ') } : { cmd: rest.join(' ') };
      const timeoutMs = opts.timeout === undefined ? undefined : integer(opts.timeout, text, 100, 60000);
      if (timeoutMs !== undefined) body.timeoutMs = timeoutMs;
      // The request outlasts the longest the device will run it for.
      return post(command === 'eval' ? '/debug/eval' : '/debug/exec', body, { print: command, timeoutMs: 75000 });
    }
    case 'eval-file':
      if (args.length !== 1) throw new Error('usage: eval-file <path>');
      return post('/debug/eval', { js: readFile(args[0]) }, { print: 'eval', timeoutMs: 75000 });
    case 'speak':
    case 'tts': {
      const text = 'usage: speak [--locale tag] <text…>';
      const { rest, opts } = options(args, ['locale'], [], { leadingOnly: true, usage: text });
      if (!rest.length) throw new Error(text);
      return post('/speak', opts.locale === undefined ? { text: rest.join(' ') } : { text: rest.join(' '), locale: opts.locale });
    }
    case 'sound': {
      const text = 'usage: sound <url> [--loop] [--stream n] | sound stop';
      const { rest, opts } = options(args, ['stream'], ['loop'], { usage: text });
      if (rest.length !== 1) throw new Error(text);
      if (rest[0] === 'stop') return post('/sound', { stop: true });
      const body = { url: rest[0] };
      if (opts.loop) body.loop = true;
      if (opts.stream !== undefined) body.stream = integer(opts.stream, text, 0, 10);
      return post('/sound', body, { timeoutMs: 30000 });
    }
    case 'shot':
      if (args.length > 1) throw new Error('usage: shot [file]');
      return get('/debug/screenshot', { saveTo: args[0] || `daylight-${now}.png`, print: 'shot', timeoutMs: 30000 });
    case 'html':
      if (args.length > 1) throw new Error('usage: html [file]');
      return get('/debug/html', { print: 'html', ...(args[0] ? { saveTo: args[0] } : {}), timeoutMs: 30000 });
    case 'fps': {
      const text = 'usage: fps [ms] [--min n]';
      const { rest, opts } = options(args, ['min'], [], { usage: text });
      if (rest.length > 1) throw new Error(text);
      const ms = rest.length ? integer(rest[0], text, 100, 10000) : 1000;
      const extra = opts.min === undefined ? {} : { minFps: integer(opts.min, text, 0) };
      return get(`/debug/fps?ms=${ms}`, { ...extra, timeoutMs: ms + 20000 });
    }
    case 'jank': {
      // What `fkb jank` did, without reloading the page: wake the screen (no frame runs
      // with the display off), then sample the live page for a second.
      if (args.length > 1) throw new Error('usage: jank [minFps]');
      const minFps = args.length ? integer(args[0], 'usage: jank [minFps]', 0) : 20;
      return get('/debug/fps?ms=1000', { minFps, jank: true, timeoutMs: 21000, pre: post('/screen', { on: true }) });
    }
    case 'logcat': {
      const text = 'usage: logcat [lines] [filter…]';
      const lines = args.length ? integer(args[0], text, 1, 5000) : 500;
      const filter = args.length > 1 ? `&filter=${encodeURIComponent(args.slice(1).join(' '))}` : '';
      return get(`/debug/logcat?lines=${lines}${filter}`, { print: 'logcat', timeoutMs: 30000 });
    }
    case 'update': {
      if (args.length === 0) return get('/update');
      if (args.length > 2) throw new Error('usage: update [<apk-url> [sha256]]');
      const body = { url: args[0] };
      if (args[1] !== undefined) body.sha256 = sha256(args[1]);
      // The device answers after the download and the commit.
      return post('/update', body, { timeoutMs: 600000 });
    }
    default: return null;
  }
}

/**
 * Arguments → what to send. Pure: the clock and the file reader are passed in.
 * The result carries plane, method, path and body, plus what to do with the answer
 * (saveTo, print, minFps, jank, pick) and an optional request to send first (pre).
 */
export function parseArgs(args, env = {}) {
  const now = env.now ?? Date.now();
  const readFile = env.readFile ?? ((path) => readFileSync(path, 'utf8'));
  const [command, sub, ...rest] = args;
  const tail = [sub, ...rest].filter((a) => a !== undefined);
  if (SIMPLE[command]) return { plane: 'control', ...SIMPLE[command] };
  if (command === 'settings') return parseSettings(sub, rest);
  if (command === 'lockdown') return parseLockdown(sub, rest, now);
  if (command === 'payload') return parsePayload(sub, rest);
  if (command === 'lifeline') {
    const route = LIFELINE[sub || 'status'];
    if (!route) throw new Error(`unknown lifeline command '${sub}'; known: ${Object.keys(LIFELINE).join(', ')}`);
    return { plane: 'lifeline', ...route };
  }
  // Every route on the control port, for the ones with no named command yet.
  if (command === 'get' || command === 'post') {
    if (!sub || !sub.startsWith('/')) throw new Error(`${command}: path must start with '/'`);
    const json = rest.find((a) => a.startsWith('{'));
    const query = rest.filter((a) => !a.startsWith('{') && a.includes('='))
      .map((a) => { const i = a.indexOf('='); return `${encodeURIComponent(a.slice(0, i))}=${encodeURIComponent(a.slice(i + 1))}`; })
      .join('&');
    const parsed = { plane: 'control', method: command.toUpperCase(), path: sub + (query ? `?${query}` : '') };
    if (json) {
      try { parsed.body = JSON.parse(json); } catch (e) { throw new Error(`${command}: the JSON body does not parse (${e.message})`); }
    }
    return parsed;
  }
  const kiosk = parseKiosk(command, tail, { now, readFile });
  if (kiosk) return kiosk;
  throw new Error(`unknown command '${command}'; run 'daylight-device help' for the list`);
}

export function buildRequest(device, ports, parsed) {
  const port = parsed.plane === 'lifeline' ? ports.lifelinePort : ports.port;
  const headers = { 'X-Daylight-Token': device.token };
  let body;
  if (parsed.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(parsed.body);
  }
  return { url: `http://${device.host}:${port}${parsed.path}`, method: parsed.method, headers, body };
}

function tokensPath() {
  if (process.env.DAYLIGHT_ANDROID_TOKENS) return process.env.DAYLIGHT_ANDROID_TOKENS;
  if (process.env.DAYLIGHT_BASE_PATH) return join(process.env.DAYLIGHT_BASE_PATH, 'data/household/auth/daylight-android.yml');
  throw new Error('set DAYLIGHT_ANDROID_TOKENS or DAYLIGHT_BASE_PATH to locate the private tokens file');
}

/** Removes the token from anything about to be printed: a device, a proxy or an error could echo it. */
function redactor(token) {
  return (text) => (token ? String(text).split(token).join('[token]') : String(text));
}

const PNG_SIGNATURE = '89504e470d0a1a0a';

/** Lines without their final newline, so console output does not gain a blank line. */
const trimEnd = (text) => String(text).replace(/\n$/, '');

/**
 * Sends one request, prints the response, and returns the exit code.
 * 0 for success; 1 for a non-2xx status, an `ok:false` answer or a reading below --min.
 * `jank` answers 2 when there is no reading at all; `exec` answers the command's own code.
 * Options: the parsed command (saveTo, print, minFps, jank, pick, timeoutMs) and writeFile.
 */
export async function send(request, fetchImpl = fetch, out = console, opts = {}) {
  const clean = redactor(request.headers?.['X-Daylight-Token']);
  const log = (line) => out.log(clean(line));
  const fail = (line) => out.error(clean(line));
  const writeFile = opts.writeFile ?? writeFileSync;
  let res;
  try {
    res = await fetchImpl(request.url, {
      method: request.method, headers: request.headers, body: request.body, signal: AbortSignal.timeout(opts.timeoutMs || 15000),
    });
  } catch (e) {
    if (opts.jank) { fail(`jank: no reading (${e.message || e})`); return 2; }
    throw new Error(clean(e.message || e));
  }
  const type = (res.headers?.get?.('content-type') || '').toLowerCase();

  if (opts.print === 'shot' && res.ok && type.startsWith('image/')) {
    const bytes = Buffer.from(await res.arrayBuffer());
    // A PNG starts with these eight bytes. Anything else is not a screenshot.
    if (bytes.subarray(0, 8).toString('hex') !== PNG_SIGNATURE) { fail('✗ the device did not return a PNG'); return 1; }
    writeFile(opts.saveTo, bytes);
    log(opts.saveTo);
    return 0;
  }

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON: plain text */ }
  const failed = !res.ok || (json && json.ok === false);

  if (opts.jank) {
    if (failed || typeof json?.fps !== 'number') {
      const why = json?.message || json?.error || (res.ok ? 'the answer has no fps' : `HTTP ${res.status}`);
      fail(`jank: no reading (${why}; screen off? page not loaded?)`);
      return 2;
    }
    const ok = json.fps >= opts.minFps;
    log(`rAF fps = ${json.fps}  [${ok ? 'OK' : 'JANK'}]  (threshold ${opts.minFps}, 60=smooth)`);
    return ok ? 0 : 1;
  }

  if (failed) {
    log(json ? JSON.stringify(json, null, 2) : trimEnd(text));
    if (!res.ok) fail(`✗ HTTP ${res.status}`);
    else fail(`✗ ${json.error || 'failed'}`);
    return 1;
  }

  if (opts.print === 'eval' && json) {
    const result = json.result;
    log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    return 0;
  }
  if (opts.print === 'exec' && json) {
    if (json.stdout) out.log(clean(trimEnd(json.stdout)));
    if (json.stderr) out.error(clean(trimEnd(json.stderr)));
    if (json.timedOut) return 124;
    return json.exitCode >= 0 && json.exitCode <= 255 ? json.exitCode : 1;
  }
  if (opts.print === 'html' && json && typeof json.html === 'string') {
    if (opts.saveTo) { writeFile(opts.saveTo, json.html); log(opts.saveTo); } else log(json.html);
    return 0;
  }
  if (opts.print === 'logcat') {
    log(trimEnd(text));
    if (res.headers?.get?.('x-daylight-log-scope') === 'own') {
      fail("(this app's lines only: READ_LOGS is not granted on this device)");
    }
    return 0;
  }
  if (opts.pick !== undefined && json) {
    const found = (json.settings || []).find((s) => s.key === opts.pick);
    if (!found) { fail(`✗ no such setting: ${opts.pick}`); return 1; }
    log(`${found.key} = ${JSON.stringify(found.value)}`);
    return 0;
  }

  log(json ? JSON.stringify(json, null, 2) : trimEnd(text));
  if (opts.minFps !== undefined && json && typeof json.fps === 'number' && json.fps < opts.minFps) {
    fail(`✗ ${json.fps} fps is below ${opts.minFps}`);
    return 1;
  }
  return 0;
}

/** One parsed command against one device: the request to send first, if any, then the command. */
export async function run(device, ports, parsed, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const out = deps.out ?? console;
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  if (parsed.pre) {
    // Best effort and not printed: a device that cannot do it (no way to wake the screen) is still measured.
    const unprinted = { log() {}, error() {} };
    try { await send(buildRequest(device, ports, parsed.pre), fetchImpl, unprinted, parsed.pre); } catch { /* the command itself reports */ }
    await sleep(1000);
  }
  return send(buildRequest(device, ports, parsed), fetchImpl, out, { ...parsed, writeFile: deps.writeFile });
}

export async function main(argv) {
  const [name, ...args] = argv;
  if (!name || name === 'help' || args.length === 0) {
    console.log(USAGE);
    return name && name !== 'help' ? 1 : 0;
  }
  // A device with no control API is answered before the private file is opened: there
  // is no host or token for it to hold.
  const deviceFile = join(HERE, '..', 'devices', `${name}.yml`);
  const known = /^[a-z][a-z0-9]*$/.test(name) && existsSync(deviceFile);
  const unreachable = known ? noControlApi(name, parse(readFileSync(deviceFile, 'utf8')).control) : null;
  if (unreachable) throw new Error(unreachable);
  const device = resolveDevice(parse(readFileSync(tokensPath(), 'utf8')), name);
  const ports = parse(readFileSync(deviceFile, 'utf8')).control;
  const clean = redactor(device.token);
  try {
    return await run(device, ports, parseArgs(args));
  } catch (e) {
    throw new Error(clean(e.message || e));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error('✗ ' + (e.message || e)); process.exit(1); });
}
