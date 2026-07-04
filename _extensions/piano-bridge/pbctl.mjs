#!/usr/bin/env node
// pbctl.mjs — Piano Bridge control CLI (HTTP control plane on :8770).
//
// The bridge APK serves a REST control plane on the same NanoHTTPD socket as its
// WebSocket. NanoHTTPD binds all interfaces, so this works over the LAN — no ADB.
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
//   node pbctl.mjs update <apk-url>  # ADB-free self-update (one-tap confirm on device)
//   node pbctl.mjs quiet <s> <e>     # daily MIDI-wake quiet window "HH:mm" (or: quiet off)
//   node pbctl.mjs suppress <ms>     # mute MIDI-wake for <ms> from now (0 = clear)

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
function fmtDur(ms) {
  if (!ms && ms !== 0) return '?';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h${m}m` : m ? `${m}m${s % 60}s` : `${s}s`;
}

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
    const w = s.watchdog;
    if (w) {
      const age = w.lastBeatAgoMs == null ? 'no-beats' : `${Math.round(w.lastBeatAgoMs / 1000)}s ago`;
      console.log(`kiosk (fkb)  : ${w.verdict}  fps=${w.lastFps} beat=${age}${w.recovering ? '  [RECOVERING]' : ''}`);
    }
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

  // --- ADB-free self-update + wake-policy config -----------------------------
  async update([url]) {
    if (!url) { console.error('usage: update <apk-url>'); process.exit(1); }
    console.log('→ ' + BASE + ' fetching + installing ' + url);
    pretty(await req('POST', `/update?url=${encodeURIComponent(url)}`));
    console.log('  (tap "Update" on the tablet when Android prompts — no ADB needed)');
  },
  async quiet([start, end]) {
    // Daily MIDI-wake quiet window (local "HH:mm"). One merged POST = one reconnect.
    const cur = await req('GET', '/config');
    const vals = { ...(cur.values || {}) };
    if (start === 'off' || start === 'clear') { vals.fkbWakeQuietStart = ''; vals.fkbWakeQuietEnd = ''; }
    else if (start && end) { vals.fkbWakeQuietStart = start; vals.fkbWakeQuietEnd = end; }
    else { console.error('usage: quiet <HH:mm start> <HH:mm end>   |   quiet off'); process.exit(1); }
    const yaml = Object.entries(vals).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n';
    pretty(await req('POST', '/config', yaml));
  },
  async suppress([ms]) {
    // Mute note-wake until now+ms (0 or omitted = clear). Backend can do the same
    // by POSTing fkbWakeSuppressUntilEpochMs directly for arbitrary policy.
    const n = Number(ms);
    const until = Number.isFinite(n) && n > 0 ? Date.now() + n : 0;
    await cmds.config(['set', 'fkbWakeSuppressUntilEpochMs', String(until)]);
    console.log(until ? `wake muted until ${new Date(until).toISOString()}` : 'wake suppression cleared');
  },

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

  // --- consolidated diagnostics + kiosk watchdog -----------------------------
  async diag() {
    // Full "see everything" health dashboard: time, cpu, mem, thermal, battery,
    // bridge, and the two kiosk views (WebView watchdog + FKB app).
    const d = await req('GET', '/diagnostics');
    if (typeof d === 'string' || !d.ok) { pretty(d); return; }
    const t = d.time || {}, dev = d.device || {}, mem = dev.mem || {}, bat = dev.battery || {};
    const cpu = d.cpu || {}, th = d.thermal || {}, br = d.bridge || {}, k = d.kiosk || {};
    const wv = k.webview || {}, fkb = k.fkbApp || {}, cr = d.crash || {};
    console.log(`── time ─────`);
    console.log(`  ${t.iso}   uptime ${fmtDur(t.uptimeMs)}   tz ${t.timezone}`);
    console.log(`── cpu / mem ─────`);
    console.log(`  process ${cpu.processCpuPct ?? '?'}%  (${cpu.threadCount ?? '?'} threads)`);
    if (cpu.threads) for (const x of cpu.threads.slice(0, 4)) console.log(`    ${String(x.cpuPct).padStart(5)}%  ${x.name}`);
    console.log(`  mem ${mem.availMb ?? '?'}/${mem.totalMb ?? '?'} MB free${mem.lowMemory ? '  [LOW]' : ''}`);
    console.log(`── thermal / power ─────`);
    if (th.zones && th.zones.length) for (const z of th.zones) {
      // Client-side normalization too (older APKs may report a ×10 scale ≈ 325°C).
      let t = z.tempC; while (Math.abs(t) > 150) t /= 10;
      console.log(`  ${Math.round(t * 10) / 10}°C  ${z.type}`);
    }
    else console.log(`  (no thermal zones: ${th.note || 'n/a'})`);
    console.log(`  battery ${bat.percent ?? '?'}%  ${bat.temperatureC ?? '?'}°C  status=${bat.status ?? '?'} plugged=${bat.plugged ?? '?'}`);
    console.log(`── bridge ─────`);
    console.log(`  engine=${br.engine}  ble=${br.ble?.state ?? '?'}  speaker=${br.speaker?.connected ? 'on' : 'off'}`);
    console.log(`── kiosk: WebView (is it presenting frames?) ─────`);
    console.log(`  verdict=${wv.verdict}  fps=${wv.lastFps}  beat=${wv.lastBeatAgoMs == null ? 'NONE' : Math.round(wv.lastBeatAgoMs / 1000) + 's ago'}  vis=${wv.lastVisibility}`);
    console.log(`  recovering=${wv.recovering}  counts=${JSON.stringify(wv.recoveryCounts || {})}`);
    if (wv.lastOutcome) console.log(`  last: ${wv.lastAction} → ${wv.lastOutcome}`);
    console.log(`── kiosk: FKB app (is Fully itself alive?) ─────`);
    if (fkb.reachable) console.log(`  reachable  screenOn=${fkb.screenOn}  url=${fkb.currentPageUrl}  ram ${fkb.ramFreeMb}/${fkb.ramTotalMb} MB${fkb.authOk === false ? '  [AUTH FAIL — set fkbPassword]' : ''}`);
    else console.log(`  UNREACHABLE — FKB itself may be wedged (${fkb.error || '?'})`);
    if (cr.prevDeathUnclean) console.log(`── ⚠ previous bridge death was UNCLEAN (crash/kill/reboot) — see \`pbctl crashlog\``);
  },
  async kiosk() { pretty(await req('GET', '/kiosk')); },
  async crashlog() {
    const r = await req('GET', '/crashlog');
    if (typeof r === 'string' || !r.ok) { pretty(r); return; }
    console.log(`prevDeathUnclean: ${r.prevDeathUnclean}   lastRebootAt: ${r.lastRebootAt ? new Date(r.lastRebootAt).toISOString() : 'never'}`);
    console.log('--- events ---');
    (r.events || []).forEach((l) => console.log(l));
  },
  async props([key]) {
    const r = await req('GET', `/props${key ? `?key=${encodeURIComponent(key)}` : ''}`);
    process.stdout.write((r.stdout || JSON.stringify(r)) + '\n');
  },
  // ADB-free `settings get/put` (WRITE_SECURE_SETTINGS). ns = secure|global|system.
  // e.g. disable Play Protect so OTA self-update isn't blocked (persists):
  //   pbctl setsetting global package_verifier_enable 0
  async getsetting([ns, key]) {
    if (!key) { console.error('usage: getsetting <secure|global|system> <key>'); process.exit(1); }
    pretty(await req('GET', `/getsetting?ns=${encodeURIComponent(ns)}&key=${encodeURIComponent(key)}`));
  },
  async setsetting([ns, key, value]) {
    if (value === undefined) { console.error('usage: setsetting <secure|global|system> <key> <value>'); process.exit(1); }
    pretty(await req('GET', `/setsetting?ns=${encodeURIComponent(ns)}&key=${encodeURIComponent(key)}&value=${encodeURIComponent(value)}`));
  },
};

const [, , name, ...args] = process.argv;
if (!name || !cmds[name]) {
  console.log(`pbctl — Piano Bridge control (${BASE})\n`);
  console.log('  status | connect | forget | scan [ms] | config [set k v|push f] | log | panic');
  console.log('  wake:  update <apk-url> | quiet <HH:mm> <HH:mm>|off | suppress <ms>');
  console.log('  health: diag | kiosk | crashlog        (full snapshot / WebView watchdog / durable death log)');
  console.log('  diag:  logcat [lines] [tag] | exec <cmd…> | cpu [ms] | info | props [key]');
  console.log('  sys:   getsetting <ns> <k> | setsetting <ns> <k> <v>   (ns=secure|global|system)');
  process.exit(name ? 1 : 0);
}
try { await cmds[name](args); } catch (e) { console.error('✗ ' + (e.message || e) + `  (is the bridge running + reachable at ${BASE}?)`); process.exit(1); }
