#!/usr/bin/env node
// daylight-device — one CLI for every DaylightStation Android device.
//
//   daylight-device <device> status
//   daylight-device <device> capabilities
//   daylight-device <device> info
//   daylight-device <device> settings [list | set <key> <value> | reset <key>]
//   daylight-device <device> lifeline [status | rollback | restart | reset-settings | log]
//   daylight-device <device> get <path> [k=v …]                 any GET route on the control port
//   daylight-device <device> post <path> [k=v …] ['{json}']     any POST route; k=v becomes the query
//
// Host and token come from a private file (never the repo):
//   $DAYLIGHT_ANDROID_TOKENS, else $DAYLIGHT_BASE_PATH/data/household/auth/daylight-android.yml
// Ports come from devices/<device>.yml.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const HERE = dirname(fileURLToPath(import.meta.url));

const SIMPLE = {
  status: { method: 'GET', path: '/status' },
  capabilities: { method: 'GET', path: '/capabilities' },
  info: { method: 'GET', path: '/debug/info' },
};
const LIFELINE = {
  status: { method: 'GET', path: '/status' },
  rollback: { method: 'POST', path: '/payload/rollback' },
  restart: { method: 'POST', path: '/restart' },
  // For a stored setting that keeps the payload from starting: the control port is down then.
  'reset-settings': { method: 'POST', path: '/settings/reset' },
  log: { method: 'GET', path: '/log' },
};

export function resolveDevice(fleet, name) {
  const entry = fleet?.[name];
  if (!entry) throw new Error(`unknown device '${name}'; known: ${Object.keys(fleet || {}).join(', ') || '(none)'}`);
  if (!entry.token) throw new Error(`no token for '${name}' in the private tokens file`);
  if (!entry.host) throw new Error(`no host for '${name}' in the private tokens file`);
  return { host: String(entry.host), token: String(entry.token) };
}

export function parseArgs(args) {
  const [command, sub, ...rest] = args;
  if (SIMPLE[command]) return { plane: 'control', ...SIMPLE[command] };
  if (command === 'settings') {
    if (!sub || sub === 'list') return { plane: 'control', method: 'GET', path: '/settings' };
    // The value goes out as the text that was typed. The device knows the setting's
    // declared type and coerces "true" or "30" itself; guessing here would make a
    // string setting impossible to set to such text.
    if (sub === 'set' && rest.length >= 2) {
      return { plane: 'control', method: 'POST', path: '/settings', body: { key: rest[0], value: rest.slice(1).join(' ') } };
    }
    if (sub === 'reset' && rest.length === 1) {
      return { plane: 'control', method: 'DELETE', path: `/settings?key=${encodeURIComponent(rest[0])}` };
    }
    throw new Error('usage: settings [list | set <key> <value> | reset <key>]');
  }
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
  throw new Error(`unknown command '${command}'; known: ${[...Object.keys(SIMPLE), 'settings', 'lifeline', 'get', 'post'].join(', ')}`);
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

export async function main(argv) {
  const [name, ...args] = argv;
  if (!name || name === 'help' || args.length === 0) {
    console.log("usage: daylight-device <device> <status|capabilities|info|settings …|lifeline …|get <path> [k=v …]|post <path> [k=v …] ['{json}']>");
    return name && name !== 'help' ? 1 : 0;
  }
  const device = resolveDevice(parse(readFileSync(tokensPath(), 'utf8')), name);
  const ports = parse(readFileSync(join(HERE, '..', 'devices', `${name}.yml`), 'utf8')).control;
  return send(buildRequest(device, ports, parseArgs(args)));
}

/** Sends one request, prints the response, and returns the exit code: 1 for any non-2xx status. */
export async function send(request, fetchImpl = fetch, out = console) {
  const res = await fetchImpl(request.url, {
    method: request.method, headers: request.headers, body: request.body, signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  try { out.log(JSON.stringify(JSON.parse(text), null, 2)); } catch { out.log(text); }
  if (!res.ok) { out.error(`✗ HTTP ${res.status}`); return 1; }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error('✗ ' + (e.message || e)); process.exit(1); });
}
