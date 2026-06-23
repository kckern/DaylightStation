#!/usr/bin/env node
// pianobridge.cli.mjs — Piano Bridge control CLI (HTTP control plane on :8770).
// (Canonical copy for DaylightStation devs; mirrors _extensions/piano-bridge/pbctl.mjs.)
//
// The PianoBridge APK (source: _extensions/piano-bridge/app) serves a REST control
// plane on the same NanoHTTPD socket as its WebSocket. NanoHTTPD binds all
// interfaces, so this works over the LAN — no ADB. It is also the ADB-replacement
// diagnostic channel for the piano tablet (logcat/exec/cpu, see the diag subcommands).
// Host: PB_HOST env or default 10.0.0.245:8770.
//
//   node pbctl.mjs status            # BLE/MIDI connection state (diagnose)
//   node pbctl.mjs connect           # force scan + connect the configured WIDI
//   node pbctl.mjs forget            # drop the connection
//   node pbctl.mjs scan [ms]         # list nearby BLE-MIDI devices (name/mac/rssi)
//   node pbctl.mjs config            # show effective device config
//   node pbctl.mjs config set <k> <v># patch one key (re-points target, etc.) + reconnect
//   node pbctl.mjs config push <f>   # replace config from a YAML file + reconnect
//   node pbctl.mjs log               # recent bridge events
//   node pbctl.mjs panic             # all-notes-off on the synth

const HOST = process.env.PB_HOST || '10.0.0.245:8770';
const BASE = `http://${HOST}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'text/plain' } : undefined,
    body,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

function pretty(o) { console.log(typeof o === 'string' ? o : JSON.stringify(o, null, 2)); }

const cmds = {
  async status() {
    const s = await req('GET', '/status');
    const b = s.ble || {};
    console.log(`state        : ${b.state}`);
    console.log(`target       : ${b.targetName} (${b.targetMac})`);
    console.log(`connected    : ${b.connectedName ?? '—'} ${b.connectedMac ? '(' + b.connectedMac + ')' : ''}`);
    console.log(`uptime       : ${b.connectedSeconds ?? 0}s   reconnects: ${b.reconnects ?? 0}`);
    console.log(`bluetooth/loc: ${b.bluetoothOn ? 'on' : 'OFF'} / ${b.locationOn ? 'on' : 'OFF'}`);
    console.log(`lastError    : ${b.lastError ?? '—'}`);
    console.log(`ws clients   : ${s.wsClients}   engine: ${s.engine}`);
  },
  async connect() { pretty(await req('POST', '/connect')); },
  async forget() { pretty(await req('POST', '/forget')); },
  async scan([ms]) {
    process.stdout.write('scanning…\n');
    const r = await req('POST', `/scan?ms=${ms || 4000}`);
    for (const d of (r.devices || [])) {
      const tag = d.isTarget ? ' ← TARGET' : d.isBlocklisted ? ' ← blocklisted' : '';
      console.log(`${String(d.rssi).padStart(4)} dBm  ${(d.name || '?').padEnd(22)} ${d.mac}${tag}`);
    }
  },
  async config(args) {
    if (args[0] === 'set') {
      const [, key, ...rest] = args;
      const cur = await req('GET', '/config');
      const vals = { ...(cur.values || {}) };
      vals[key] = rest.join(' ');
      const yaml = Object.entries(vals).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n';
      pretty(await req('POST', '/config', yaml));
    } else if (args[0] === 'push') {
      const { readFileSync } = await import('node:fs');
      pretty(await req('POST', '/config', readFileSync(args[1], 'utf8')));
    } else {
      pretty((await req('GET', '/config')).values);
    }
  },
  async log() {
    const r = await req('GET', '/log');
    (r.log || []).forEach((l) => console.log(l));
  },
  async panic() { pretty(await req('POST', '/panic')); },

  // --- ADB-replacement diagnostics (see CLAUDE.md for the SELinux ceiling) ---
  async logcat([lines, tag]) {
    const q = new URLSearchParams({ lines: lines || '200', ...(tag ? { tag } : {}) });
    const r = await req('GET', `/logcat?${q}`);
    process.stdout.write((r.stdout || r.stderr || JSON.stringify(r)) + '\n');
  },
  async exec(args) {
    const cmd = args.join(' ');
    if (!cmd) { console.error('usage: exec <shell command>'); process.exit(1); }
    const r = await req('GET', `/exec?cmd=${encodeURIComponent(cmd)}`);
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    if (typeof r.exit === 'number' && r.exit !== 0) console.error(`[exit ${r.exit}]`);
  },
  async cpu([ms]) {
    const r = await req('GET', `/cpu?ms=${ms || 600}`);
    if (r.threads) {
      console.log(`process ${r.processCpuPct}%  (${r.threadCount} threads, hz=${r.hz})`);
      for (const t of r.threads.slice(0, 12)) console.log(`  ${String(t.cpuPct).padStart(5)}%  ${t.name} [${t.tid}]`);
      if (r.note) console.log(`(${r.note})`);
    } else pretty(r);
  },
  async info() { pretty(await req('GET', '/info')); },
  async props([key]) {
    const r = await req('GET', `/props${key ? `?key=${encodeURIComponent(key)}` : ''}`);
    process.stdout.write((r.stdout || JSON.stringify(r)) + '\n');
  },
};

const [, , name, ...args] = process.argv;
if (!name || !cmds[name]) {
  console.log(`pbctl — Piano Bridge control (${BASE})\n`);
  console.log('  status | connect | forget | scan [ms] | config [set k v|push f] | log | panic');
  console.log('  diag:  logcat [lines] [tag] | exec <cmd…> | cpu [ms] | info | props [key]');
  process.exit(name ? 1 : 0);
}
try { await cmds[name](args); } catch (e) { console.error('✗ ' + (e.message || e) + `  (is the bridge running + reachable at ${BASE}?)`); process.exit(1); }
