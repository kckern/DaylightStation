import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CAPABILITY_ROUTES, CORE_ROUTES, buildChecks, loadDeviceFile, main, parseOptions, resolveTarget, runAcceptance, selected, serveBadPayload,
} from './acceptance.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKEN = 't'.repeat(48);

/**
 * A fake device: a control server and a lifeline server on loopback, with enough state
 * to answer every check. `faults` breaks one behavior at a time.
 */
async function fakeDevice({ id = 'portal', capabilities, faults = {}, settings = {} } = {}) {
  const file = loadDeviceFile(id);
  const caps = capabilities ?? file.capabilities;
  const s = {
    screenOn: true, startedAt: Date.now() - 60_000, bootAt: Date.now() - 3_600_000, down: false, loadSeq: 0,
    lastLoad: { loadId: 'l0', ok: true }, volume: { level: 40, index: 6, maxIndex: 15 },
    payload: { active: 'p-abc.jar', current: 'p-abc.jar', previous: 'baked.jar', lastFailed: null },
    front: 'net.kckern.daylight.portal', calls: [],
    settings: { 'debug.execEnabled': false, 'logstore.app': '', 'webview.startUrl': 'https://kiosk.invalid/', ...settings },
  };
  const routes = [...CORE_ROUTES, ...caps.flatMap((c) => CAPABILITY_ROUTES[c] || [])].filter((r) => !(faults.missingRoute === r));
  const goAway = (ms, reboot, schedule = setTimeout) => {
    s.down = true;
    schedule(() => {
      s.down = faults.neverBack === true;
      s.startedAt = Date.now();
      if (reboot) s.bootAt = Date.now();
    }, ms);
  };
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const read = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => resolve(b ? JSON.parse(b) : {})); });

  const control = createServer(async (req, res) => {
    if (s.down) { req.socket.destroy(); return; }
    const key = `${req.method} ${req.url.split('?')[0]}`;
    if (faults.statusDown && key === 'GET /status') { req.socket.destroy(); return; }
    s.calls.push(key);
    if (faults.noAuth !== true && req.headers['x-daylight-token'] !== TOKEN) {
      return json(res, 401, { ok: false, error: 'unauthorized', echo: faults.echoToken ? TOKEN : undefined });
    }
    const body = req.method === 'POST' ? await read(req) : {};
    switch (key) {
      case 'GET /status': return json(res, 200, {
        ok: !faults.unhealthy, device: faults.missingId ? undefined : (faults.deviceId ?? id), capabilities: faults.extraCap ? [...caps, 'synth'] : caps, payloadVersion: 'p3-kiosk', shellVersionCode: 34,
        appVersion: '0.3-kiosk', uptimeMs: Date.now() - s.startedAt, settingsProblem: null,
        ...(faults.noClock ? {} : { nowMs: Date.now() + (faults.skewMs ?? 0) }),
        switches: Object.fromEntries(['hid.enabled', 'midi.enabled', 'speaker.enabled', 'mic.enabled']
          .map((k) => [k, { setting: !!s.settings[k], active: !!s.settings[k] && !faults.switchInactive }])),
        ble: { state: s.settings['midi.enabled'] ? 'CONNECTED' : null }, outVerified: !!s.settings['midi.enabled'],
      });
      case 'GET /capabilities': return json(res, 200, { ok: true, capabilities: caps, routes });
      case 'GET /settings':
        if (faults.nonJsonSettings) { res.writeHead(200); return res.end('not JSON'); }
        return json(res, 200, {
          ok: true,
          settings: faults.objectSettings ? {} : Object.entries({
            ...s.settings, ...(faults.unresolved ? { 'heartbeat.logStoreUrl': '{log_store_insert_url}' } : {}),
          }).map(([k, v]) => ({ key: k, value: v })),
        });
      case 'POST /settings': s.settings[body.key] = body.value; return json(res, 200, { ok: true, key: body.key, value: body.value });
      case 'DELETE /settings': { const k = new URL(req.url, 'http://x').searchParams.get('key'); s.settings[k] = false; return json(res, 200, { ok: true, key: k }); }
      case 'GET /debug/info': return json(res, 200, { ok: true, device: id, model: 'Fake', sdkInt: 28, elapsedRealtimeMs: Date.now() - s.bootAt });
      case 'GET /payload': return json(res, 200, { ok: true, ...s.payload });
      case 'POST /payload':
        if (faults.rollbackAfterLifelineRead) {
          // The loader has failed the bad payload and is still swapping the old one back in:
          // the next lifeline read sees lastFailed with the bad one active, and the rollback
          // finishes right after it.
          s.payload.lastFailed = 'p-bad.jar'; s.payload.active = 'p-bad.jar'; s.rollbackPending = true;
          return json(res, 200, { ok: true, result: 'swap requested' });
        }
        setTimeout(() => {
          s.payload.lastFailed = 'p-bad.jar';
          if (faults.badPayloadSticks) s.payload.active = 'p-bad.jar';
        }, 30);
        return json(res, 200, { ok: true, result: 'swap requested' });
      case 'GET /update': return json(res, 200, { ok: true, state: 'idle' });
      case 'GET /log': res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('events');
      case 'GET /kiosk/status': return json(res, 200, {
        ok: true, ready: true, rendererAlive: true, bridge: faults.noBridge ? 'unavailable' : 'available', bridgeReason: null,
        screenOn: s.screenOn, kioskInForeground: s.front.startsWith('net.kckern'), foreground: s.front, lastLoad: s.lastLoad, batteryLevel: 90, ramFreeMb: 900,
      });
      case 'POST /kiosk/reload': return json(res, 200, { ok: true, loaded: true, loadTimeMs: 812, loadId: 'l1' });
      case 'POST /kiosk/load-start': {
        s.loadSeq += 1;
        const loadId = `q${s.loadSeq}`;
        setTimeout(() => { s.lastLoad = { loadId, ok: true }; }, 30);
        return json(res, 200, { ok: true, accepted: true, loadId });
      }
      case 'POST /kiosk/load':
        if (faults.originOpen) return json(res, 200, { ok: true, loaded: true, url: body.url });
        return json(res, 400, { ok: false, error: 'bad_request', message: 'origin_not_allowed: https://www.example.org' });
      case 'POST /kiosk/foreground': s.front = 'net.kckern.daylight.portal'; return json(res, 200, { ok: true, kioskInForeground: true, foreground: s.front });
      case 'POST /kiosk/renderer/reset': return json(res, 200, { ok: true, rendererAlive: true });
      case 'POST /kiosk/restart': json(res, 200, { ok: true, restarting: true }); setTimeout(() => { s.startedAt = Date.now(); }, 20); return undefined;
      case 'POST /kiosk/overlay': return json(res, 200, { ok: true, shown: !!body.text, kind: body.text ? 'text' : 'none', text: { shown: !!body.text } });
      case 'POST /screen':
        s.screenWrites = (s.screenWrites ?? 0) + 1;
        if (s.screenWrites === faults.restoreAt) {
          if (faults.restoreStatus) return json(res, faults.restoreStatus, { ok: false });
          if (faults.restoreWrongState) return json(res, 200, { ok: true, screenOn: body.on });
        }
        if (!(faults.screenStuckOn && body.on === false)) s.screenOn = body.on;
        return json(res, 200, { ok: true, screenOn: s.screenOn });
      case 'POST /screen/brightness': return json(res, 200, { ok: true, level: body.level });
      case 'POST /device/reboot':
        if (faults.noReboot) return json(res, 501, { ok: false, error: 'unsupported', reason: 'device owner required' });
        json(res, 200, { ok: true, rebooting: true }); goAway(60, true); return undefined;
      case 'GET /volume': return json(res, 200, { ok: true, stream: 3, ...s.volume });
      case 'POST /volume': return json(res, 200, { ok: true, stream: 3, ...s.volume });
      case 'POST /launch':
        if (body.package === 'com.example.absent') return json(res, 200, { ok: false, error: 'not_installed' });
        s.front = body.package; return json(res, 200, { ok: true, launched: true, component: `${body.package}/.Main` });
      case 'GET /lockdown': return json(res, 200, { ok: true, enabled: false, locked: false, mode: 'app', deviceOwner: false, homeIsKiosk: false, recallsSinceBoot: 0, foreground: s.front });
      case 'GET /debug/screenshot': res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(Buffer.from('89504e470d0a1a0a0000', 'hex'));
      case 'POST /debug/eval': return json(res, 200, { ok: true, result: 42 });
      case 'GET /debug/html': return json(res, 200, { ok: true, html: '<html></html>' });
      case 'GET /debug/fps': return json(res, 200, { ok: true, fps: faults.lowFps ? 20 : 58, frames: 58, ms: 1000 });
      case 'GET /debug/logcat': res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('a\nb\n');
      case 'POST /debug/exec':
        if (!s.settings['debug.execEnabled']) return json(res, 501, { ok: false, error: 'unsupported', reason: 'debug.execEnabled is false' });
        if (body.cmd === 'kill -9 $PPID') {
          goAway(faults.killDowntime ?? 60, false, faults.scheduleKillRecovery);
          faults.onKill?.();
          req.socket.destroy();
          return undefined;
        }
        return json(res, 200, { ok: true, exitCode: 0, stdout: 'uid=10123(u0_a123)' });
      case 'POST /loopback': return json(res, 200, { ok: true, echoed: true, rttMs: faults.slowEcho ? 90 : 31 });
      case 'GET /speaker': return json(res, 200, { ok: true, speaker: { connected: true }, guard: { state: 'ok' } });
      case 'GET /bluetooth': return json(res, 200, { ok: true, mode: 'roles' });
      case 'GET /mic/status': return json(res, 200, { ok: true, running: true, streaming: false, clients: 0, heldByOther: false, lastError: null, ...faults.micStatus });
      case 'GET /lease': return json(res, 200, { ok: true, configured: false, ready: false, enforcement: 'block-and-recall' });
      case 'GET /presence': case 'GET /usb-hid': case 'GET /input': return json(res, 200, { ok: true });
      default: return json(res, 404, { ok: false, error: 'unknown_route' });
    }
  });
  const lifeline = createServer((req, res) => {
    if (s.down) { req.socket.destroy(); return; }
    if (req.headers['x-daylight-token'] !== TOKEN) return json(res, 401, { ok: false, error: 'unauthorized' });
    if (req.url === '/status') {
      const body = { ok: true, shell: true, versionCode: 34, device: id, payload: { ...s.payload } };
      if (s.rollbackPending) { s.rollbackPending = false; s.payload.active = 'p-abc.jar'; }
      return json(res, 200, body);
    }
    return json(res, 404, { ok: false });
  });
  await Promise.all([control, lifeline].map((srv) => new Promise((r) => srv.listen(0, '127.0.0.1', r))));
  const deviceFile = { ...file, capabilities: caps, control: { port: control.address().port, lifelinePort: lifeline.address().port } };
  return {
    deviceFile, state: s,
    close: () => Promise.all([control, lifeline].map((srv) => { srv.closeAllConnections?.(); return new Promise((r) => srv.close(r)); })),
  };
}

async function run(dev, argv = [], extra = {}) {
  const lines = [];
  const opts = parseOptions([dev.deviceFile.id, ...argv]);
  const code = await runAcceptance({
    deviceFile: dev.deviceFile, host: '127.0.0.1', token: TOKEN, opts,
    deps: { out: (l) => lines.push(l), sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 15))), pollMs: 15, ...extra },
  });
  // A printed line is "STATUS  id  evidence", padded; this answers "STATUS evidence".
  const line = (id) => {
    const found = lines.findLast((l) => l.split(/\s+/)[1] === id);
    if (!found) return '';
    const m = found.match(/^(\S+)\s+\S+\s+(.*)$/);
    return `${m[1]} ${m[2]}`;
  };
  return { code, lines, line, text: lines.join('\n') };
}

test('a healthy portal with --active --restart passes every automatic check and lists the escape attempts as MANUAL', async () => {
  const dev = await fakeDevice({ id: 'portal' });
  try {
    const r = await run(dev, ['--active', '--restart']);
    assert.equal(r.code, 0, r.text);
    assert.doesNotMatch(r.text, /^FAIL/m);
    for (const id of ['core.auth', 'core.status', 'routes.inventory', 'settings.resolved', 'lifeline.status', 'kiosk.load-async',
      'kiosk.origin-guard', 'screen.sleep-wake', 'volume.read-write', 'launch.absent', 'debug.screenshot', 'debug.eval', 'crash.restart']) {
      assert.match(r.line(id), /^PASS/, id);
    }
    for (const id of ['escape.home', 'escape.recents', 'escape.status-bar', 'escape.control-center', 'keys.volume', 'network.drop']) {
      assert.match(r.line(id), /^MANUAL/, id);
    }
    assert.match(r.line('escape.home'), /lockdown is off/);
    assert.match(r.line('reboot.survives'), /^SKIP .*--reboot/);
    assert.match(r.line('logstore.events'), /^SKIP .*--log-store/);
    assert.match(r.text, /pass, 0 fail/);
  } finally { await dev.close(); }
});

test('the token never appears in what is printed, even when the device echoes it', async () => {
  const dev = await fakeDevice({ faults: { echoToken: true } });
  try {
    const r = await run(dev, ['--only', 'core']);
    assert.ok(!r.text.includes(TOKEN));
  } finally { await dev.close(); }
});

test('a device that answers without a token fails the auth check and the run exits 1', async () => {
  const dev = await fakeDevice({ faults: { noAuth: true } });
  try {
    const r = await run(dev, ['--only', 'core.auth']);
    assert.equal(r.code, 1);
    assert.match(r.line('core.auth'), /^FAIL .*no token 200/);
  } finally { await dev.close(); }
});

test('a missing route, an extra capability and an unresolved placeholder each fail with what was wrong', async () => {
  const dev = await fakeDevice({ faults: { missingRoute: 'POST /kiosk/overlay', extraCap: true, unresolved: true } });
  try {
    const r = await run(dev, ['--only', 'core,routes,settings']);
    assert.equal(r.code, 1);
    assert.match(r.line('routes.inventory'), /^FAIL .*missing POST \/kiosk\/overlay/);
    assert.match(r.line('core.status'), /^FAIL .*extra \[synth\]/);
    assert.match(r.line('settings.resolved'), /^FAIL .*heartbeat\.logStoreUrl/);
    assert.doesNotMatch(r.line('settings.resolved'), /log_store_insert_url/, 'values are never printed');
  } finally { await dev.close(); }
});

test('a screen that will not go off fails sleep-and-wake and is turned back on', async () => {
  const dev = await fakeDevice({ faults: { screenStuckOn: true } });
  try {
    const r = await run(dev, ['--only', 'screen', '--active']);
    assert.match(r.line('screen.sleep-wake'), /^FAIL .*screenOn=true/);
    assert.equal(dev.state.screenOn, true);
  } finally { await dev.close(); }
});

test('the page bridge being unavailable fails kiosk.status', async () => {
  const dev = await fakeDevice({ faults: { noBridge: true } });
  try {
    const r = await run(dev, ['--only', 'kiosk.status']);
    assert.match(r.line('kiosk.status'), /^FAIL .*bridge unavailable/);
  } finally { await dev.close(); }
});

const disruptiveChecks = [
  ['reboot.survives', '--reboot', ['POST /device/reboot']],
  ['crash.kill', '--kill', ['POST /settings', 'POST /debug/exec', 'POST /settings']],
  ['crash.restart', '--restart', ['POST /kiosk/restart']],
];

for (const [check, flag, expectedWrites] of disruptiveChecks) {
  for (const [name, faults, evidence] of [
    ['wrong identity', { deviceId: 'other-device' }, /device 'other-device', expected 'portal'/],
    ['missing identity', { missingId: true }, /missing device ID.*portal/],
  ]) {
    test(`${flag} refuses ${name} when core.status is filtered out`, async () => {
      const dev = await fakeDevice({ faults });
      try {
        const { code: exitCode, ...result } = await run(dev, ['--only', check, flag]);
        const writes = dev.state.calls.filter((call) => !call.startsWith('GET '));
        assert.equal(writes.length, 0, writes.join(', '));
        assert.equal(exitCode, 1, result.text);
        assert.match(result.line(check), /^FAIL /);
        assert.match(result.text, evidence);
      } finally { await dev.close(); }
    });
  }

  test(`${flag} with matching identity only writes for the selected check`, async () => {
    const dev = await fakeDevice();
    try {
      const result = await run(dev, ['--only', check, ...disruptiveChecks.map(([, option]) => option)]);
      assert.equal(result.code, 0, result.text);
      assert.deepEqual(dev.state.calls.filter((call) => !call.startsWith('GET ')), expectedWrites);
      assert.match(result.line(check), /^PASS /);
    } finally { await dev.close(); }
  });
}

for (const [name, fault] of [['non-JSON', 'nonJsonSettings'], ['a settings object', 'objectSettings']]) {
  test(`filtered reboot reports a wrong device ID when /settings returns ${name}`, async () => {
    const dev = await fakeDevice({ faults: { deviceId: 'other-device', [fault]: true } });
    const signals = new EventEmitter();
    const existing = () => {};
    signals.on('SIGINT', existing);
    try {
      const result = await run(dev, ['--only', 'reboot.survives', '--reboot'], { signals });
      assert.equal(result.code, 1, result.text);
      assert.match(result.line('reboot.survives'), /^FAIL .*device 'other-device', expected 'portal'/);
      assert.deepEqual(dev.state.calls.filter((call) => !call.startsWith('GET ')), []);
      assert.deepEqual(signals.listeners('SIGINT'), [existing]);
    } finally { await dev.close(); }
  });
}

test('the SIGINT listener is removed if initialization output throws', async () => {
  const dev = await fakeDevice();
  const signals = new EventEmitter();
  try {
    await assert.rejects(run(dev, ['--only', 'core.status'], {
      signals, out: () => { throw new Error('broken output'); },
    }), /broken output/);
    assert.equal(signals.listenerCount('SIGINT'), 0);
  } finally { await dev.close(); }
});

for (const [name, faults, evidence] of [
  ['capability mismatch', { extraCap: true }, /extra \[synth\]/],
  ['unhealthy status', { unhealthy: true }, /\/status HTTP 200.*ok=false/],
  ['unreachable status', { statusDown: true }, /\/status no answer/],
  ['authentication failure', { noAuth: true }, /no token 200/],
]) {
  test(`active checks make no writes on ${name} and still report selected diagnostics`, async () => {
    const dev = await fakeDevice({ faults });
    try {
      const result = await run(dev, ['--only', 'kiosk.reload,routes.inventory', '--active']);
      assert.deepEqual(dev.state.calls.filter((call) => !call.startsWith('GET ')), []);
      assert.equal(result.code, 1, result.text);
      assert.match(result.line('kiosk.reload'), /^FAIL /);
      assert.match(result.text, evidence);
      assert.match(result.line('routes.inventory'), /^PASS /);
    } finally { await dev.close(); }
  });
}

test('--reboot waits for the device to come back and reports how long the lifeline and the API took', async () => {
  const dev = await fakeDevice();
  try {
    const r = await run(dev, ['--only', 'reboot', '--reboot']);
    assert.equal(r.code, 0, r.text);
    assert.match(r.line('reboot.survives'), /^PASS rebooted; lifeline after ~\d+ s, control API after ~\d+ s; page ready/);
  } finally { await dev.close(); }
});

test('a device that cannot reboot itself is power-cycled by hand while the runner waits', async () => {
  const dev = await fakeDevice({ faults: { noReboot: true } });
  try {
    setTimeout(() => { dev.state.down = true; setTimeout(() => { dev.state.down = false; dev.state.bootAt = Date.now(); }, 60); }, 30);
    const r = await run(dev, ['--only', 'reboot', '--reboot']);
    assert.match(r.text, /MANUAL reboot.survives .*power-cycle it now/);
    assert.match(r.line('reboot.survives'), /^PASS rebooted/);
  } finally { await dev.close(); }
});

test('a device that never comes back after a reboot fails within --reboot-wait', async () => {
  const dev = await fakeDevice({ faults: { neverBack: true } });
  try {
    const r = await run(dev, ['--only', 'reboot', '--reboot', '--reboot-wait', '5']);
    assert.equal(r.code, 1);
    assert.match(r.line('reboot.survives'), /^FAIL did not answer again within 5 s/);
  } finally { await dev.close(); }
});

test('--kill turns exec on for the check, sees the process come back without a reboot, and turns exec off', async () => {
  const dev = await fakeDevice();
  try {
    const r = await run(dev, ['--only', 'crash.kill', '--kill']);
    assert.equal(r.code, 0, r.text);
    assert.match(r.line('crash.kill'), /^PASS process back after ~\d+ s, no reboot/);
    assert.equal(dev.state.settings['debug.execEnabled'], false);
    assert.ok(!dev.state.calls.includes('DELETE /settings'), 'restored by writing the prior value, not by a reset');
  } finally { await dev.close(); }
});

test('--kill on a device that already had exec on leaves it on', async () => {
  const dev = await fakeDevice({ settings: { 'debug.execEnabled': true } });
  try {
    const r = await run(dev, ['--only', 'crash.kill', '--kill']);
    assert.equal(r.code, 0, r.text);
    assert.equal(dev.state.settings['debug.execEnabled'], true);
  } finally { await dev.close(); }
});

test('an interrupt during --kill restores debug.execEnabled before exiting with 130', async () => {
  const dev = await fakeDevice({ faults: { neverBack: true } });
  const signals = new EventEmitter();
  const exits = [];
  try {
    const running = run(dev, ['--only', 'crash.kill', '--kill', '--reboot-wait', '5'], {
      signals, exit: (code) => exits.push(code),
    });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(dev.state.settings['debug.execEnabled'], true, 'on while the check runs');
    dev.state.down = false;   // the device answers again, so the restore can reach it
    signals.emit('SIGINT');
    await new Promise((r) => setTimeout(r, 150));
    assert.deepEqual(exits, [130]);
    assert.equal(dev.state.settings['debug.execEnabled'], false);
    dev.state.down = true;
    await running;
    assert.equal(signals.listenerCount('SIGINT'), 0, 'the handler is removed after the run');
  } finally { await dev.close(); }
});

test('interrupting while --kill has taken the process down restores exec after it returns', async () => {
  const signals = new EventEmitter();
  const exits = [];
  const dev = await fakeDevice({ faults: {
    killDowntime: 120,
    onKill: () => signals.emit('SIGINT'),
  } });
  try {
    const r = await run(dev, ['--only', 'crash.kill', '--kill', '--reboot-wait', '5'], {
      signals, exit: (code) => exits.push(code),
    });
    assert.equal(r.code, 130, r.text);
    assert.deepEqual(exits, [130]);
    assert.equal(dev.state.settings['debug.execEnabled'], false);
    assert.match(r.text, /interrupted: put back debug.execEnabled false/);
    assert.equal(signals.listenerCount('SIGINT'), 0);
  } finally { await dev.close(); }
});

for (const [args, budget, verdict] of [
  [[], 45_000, 130],
  [['--reboot-wait', '60'], 45_000, 130],
  [['--reboot-wait', '40'], 40_000, 1],
]) {
  test(`interrupted kill cleanup honors the ${args[1] ?? 'default'} recovery budget`, async (t) => {
    let now = 0;
    let recover;
    t.mock.method(performance, 'now', () => now);
    const signals = new EventEmitter();
    const dev = await fakeDevice({ faults: {
      scheduleKillRecovery: (callback) => { recover = callback; },
      onKill: () => signals.emit('SIGINT'),
    } });
    try {
      const r = await run(dev, ['--only', 'crash.kill', '--kill', ...args], {
        signals,
        exit: () => {},
        pollMs: 5000,
        sleep: async (ms) => {
          now += ms;
          if (now >= 45_000) recover?.();
        },
      });
      assert.equal(r.code, verdict, r.text);
      assert.equal(now, budget);
      assert.equal(dev.state.settings['debug.execEnabled'], verdict === 1);
    } finally { await dev.close(); }
  });
}

test('a bad payload is rolled back with the lifeline answering throughout', async () => {
  const dev = await fakeDevice();
  try {
    const r = await run(dev, ['--only', 'payload.bad', '--bad-payload-url', 'http://192.0.2.1/x.jar', '--bad-payload-sha256', 'a'.repeat(64)]);
    assert.equal(r.code, 0, r.text);
    assert.match(r.line('payload.bad'), /^PASS lastFailed p-bad.jar, active p-abc.jar, lifeline missed 0 polls/);
  } finally { await dev.close(); }
});

test('a rollback still finishing when the lifeline is first read is not a false fail', async () => {
  const dev = await fakeDevice({ faults: { rollbackAfterLifelineRead: true } });
  try {
    const r = await run(dev, ['--only', 'payload.bad', '--bad-payload-url', 'http://192.0.2.1/x.jar', '--bad-payload-sha256', 'a'.repeat(64)]);
    assert.equal(r.code, 0, r.text);
    assert.match(r.line('payload.bad'), /^PASS .*active p-abc.jar/);
  } finally { await dev.close(); }
});

test('a bad payload that stays active fails', async () => {
  const dev = await fakeDevice({ faults: { badPayloadSticks: true } });
  try {
    const r = await run(dev, ['--only', 'payload.bad', '--bad-payload-url', 'http://192.0.2.1/x.jar', '--bad-payload-sha256', 'a'.repeat(64)]);
    assert.equal(r.code, 1);
    assert.match(r.line('payload.bad'), /^FAIL .*active p-bad.jar/);
  } finally { await dev.close(); }
});

test('--serve-bad-payload serves a file whose hash matches what is pushed', async () => {
  const served = await serveBadPayload('127.0.0.1:0');
  try {
    const res = await fetch(served.url);
    const bytes = Buffer.from(await res.arrayBuffer());
    const { createHash } = await import('node:crypto');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), served.sha256);
    assert.match(served.url, /^http:\/\/127\.0\.0\.1:\d+\/bad-payload\.jar$/);
  } finally { await served.close(); }
});

test('the log store check queries the device context.app read-only and passes on events', async () => {
  const dev = await fakeDevice();
  const seen = [];
  const store = createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, query: new URLSearchParams(b).get('query') });
      res.end(seen.length === 1 ? '{"_time":"2026-11-17T10:00:00Z","_msg":"heartbeat"}\n{"_time":"2026-11-17T10:01:00Z","_msg":"kiosk.load"}\n' : '');
    });
  });
  await new Promise((r) => store.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${store.address().port}`;
    const r = await run(dev, ['--only', 'logstore', '--log-store', url, '--log-window', '30m']);
    assert.equal(r.code, 0, r.text);
    assert.deepEqual(seen[0], { method: 'POST', url: '/select/logsql/query', query: 'context.app:"daylight-portal" AND _time:30m' });
    assert.match(r.line('logstore.events'), /^PASS 2 events .*newest 2026-11-17T10:01:00Z/);
    const empty = await run(dev, ['--only', 'logstore', '--log-store', url]);
    assert.match(empty.line('logstore.events'), /^FAIL no events/);
  } finally { await dev.close(); await new Promise((r) => store.close(r)); }
});

test('the log store check reads the app name the device ships under when it is set', async () => {
  const dev = await fakeDevice({ id: 'piano', settings: { 'logstore.app': 'piano-bridge' } });
  let query;
  const store = createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { query = new URLSearchParams(b).get('query'); res.end('{"_msg":"x"}\n'); });
  });
  await new Promise((r) => store.listen(0, '127.0.0.1', r));
  try {
    await run(dev, ['--only', 'logstore', '--log-store', `http://127.0.0.1:${store.address().port}`]);
    assert.equal(query, 'context.app:"piano-bridge" AND _time:1h');
  } finally { await dev.close(); await new Promise((r) => store.close(r)); }
});

test('piano: MIDI and speaker read as handed over or not, and a slow echo fails against the baseline', async () => {
  const off = await fakeDevice({ id: 'piano' });
  try {
    const r = await run(off, ['--only', 'midi,speaker']);
    assert.match(r.line('midi.status'), /^PASS midi.enabled is not active/);
    assert.match(r.line('midi.loopback'), /^SKIP/);
  } finally { await off.close(); }
  const on = await fakeDevice({ id: 'piano', settings: { 'midi.enabled': true, 'speaker.enabled': true }, faults: { slowEcho: true } });
  try {
    const r = await run(on, ['--only', 'midi,speaker', '--rtt-baseline', '40', '--active']);
    assert.match(r.line('midi.status'), /^PASS CONNECTED, output verified/);
    assert.match(r.line('midi.loopback'), /^FAIL round trip 90 ms, more than 10% above the baseline 40/);
    assert.match(r.line('speaker.status'), /^PASS connected/);
  } finally { await on.close(); }
});

test('piano: a frame rate more than 10% under the baseline fails', async () => {
  const dev = await fakeDevice({ id: 'piano', faults: { lowFps: true } });
  try {
    const r = await run(dev, ['--only', 'debug.fps', '--fps-baseline', '50']);
    assert.match(r.line('debug.fps'), /^FAIL 20 fps, more than 10% below the baseline 50/);
  } finally { await dev.close(); }
});

test('shield: --launch opens the app, sees it in front and returns; the remote and call are MANUAL', async () => {
  const dev = await fakeDevice({ id: 'shield' });
  try {
    const r = await run(dev, ['--active', '--launch', 'com.retroarch.aarch64', '--skip', 'crash']);
    assert.equal(r.code, 0, r.text);
    assert.match(r.line('launch.app'), /^PASS com.retroarch.aarch64\/.Main in front, kiosk back/);
    assert.match(r.line('mic.status'), /^PASS mic.enabled is not active/);
    assert.match(r.line('keys.remote'), /^MANUAL/);
    assert.match(r.line('mic.call'), /^MANUAL/);
    assert.match(r.line('escape.assistant'), /^MANUAL/);
    assert.equal(r.line('escape.control-center'), '');
    assert.equal(r.line('touch.page'), '');
  } finally { await dev.close(); }
});

test('a plain run changes nothing: only GETs reach the device, and only the read-only query reaches the log store', async () => {
  for (const id of ['portal', 'piano', 'shield']) {
    const dev = await fakeDevice({ id, settings: { 'midi.enabled': true } });
    const storeCalls = [];
    const store = createServer((req, res) => { storeCalls.push(`${req.method} ${req.url}`); req.resume(); req.on('end', () => res.end('{"_msg":"x"}\n')); });
    await new Promise((r) => store.listen(0, '127.0.0.1', r));
    try {
      const r = await run(dev, ['--log-store', `http://127.0.0.1:${store.address().port}`]);
      const writes = dev.state.calls.filter((c) => !c.startsWith('GET '));
      assert.deepEqual(writes, [], `${id}: ${writes.join(', ')}`);
      assert.deepEqual(storeCalls, ['POST /select/logsql/query']);
      assert.match(r.line('kiosk.reload'), /^SKIP pass --active: reloads the page/);
      assert.match(r.line('crash.restart'), /^SKIP pass --restart: restarts the payload/);
      assert.match(r.line('debug.exec'), /^SKIP pass --active/);
      if (id === 'piano') assert.match(r.line('midi.loopback'), /^SKIP pass --active: sends a probe note/);
      assert.equal(r.code, 0, r.text);
    } finally { await dev.close(); await new Promise((res) => store.close(res)); }
  }
});

test('the screen check restores the state it found', async () => {
  const dev = await fakeDevice();
  dev.state.screenOn = false;
  try {
    const r = await run(dev, ['--only', 'screen.sleep-wake', '--active']);
    assert.match(r.line('screen.sleep-wake'), /^PASS/);
    assert.equal(dev.state.screenOn, false, 'it was dark before, so it is dark after');
  } finally { await dev.close(); }
});

for (const [label, faults, evidence] of [
  ['HTTP 500', { restoreStatus: 500 }, /HTTP 500/],
  ['wrong read-back despite HTTP 200', { restoreWrongState: true }, /read.back.*screenOn=true/],
]) {
  test(`screen restoration fails on ${label}`, async () => {
    const dev = await fakeDevice({ faults: { restoreAt: 3, ...faults } });
    dev.state.screenOn = false;
    try {
      const r = await run(dev, ['--only', 'screen.sleep-wake', '--active']);
      assert.equal(r.code, 1, r.text);
      assert.match(r.line('screen.sleep-wake'), /^FAIL .*restore/);
      assert.match(r.text, evidence);
    } finally { await dev.close(); }
  });
}

test('an interrupted run reports failed screen restoration and does not wake the display again', async () => {
  const dev = await fakeDevice({ faults: { restoreAt: 2, restoreStatus: 500 } });
  const signals = new EventEmitter();
  const exits = [];
  try {
    const r = await run(dev, ['--only', 'screen.sleep-wake', '--active'], {
      signals,
      exit: (code) => exits.push(code),
      sleep: async () => signals.emit('SIGINT'),
    });
    assert.equal(r.code, 1, r.text);
    assert.deepEqual(exits, [1]);
    assert.match(r.text, /interrupted: could not put back screen on: .*HTTP 500/);
    assert.doesNotMatch(r.text, /interrupted: put back screen on|PASS\s+screen.sleep-wake/);
    assert.equal(dev.state.screenWrites, 2);
    assert.equal(signals.listenerCount('SIGINT'), 0);
  } finally { await dev.close(); }
});

for (const [label, enabled, micStatus, verdict] of [
  ['capture disabled', false, { running: false }, 'FAIL'],
  ['zero audio frames', true, { clients: 0, streaming: false }, 'MANUAL'],
  ['a connected client with header only', true, { clients: 1, streaming: false }, 'MANUAL'],
  ['server reporting streaming', true, { clients: 1, streaming: true }, 'MANUAL'],
]) {
  test(`Shield reboot capture with ${label} yields ${verdict}`, async () => {
    const dev = await fakeDevice({ id: 'shield', faults: { micStatus }, settings: { 'mic.enabled': enabled } });
    try {
      const r = await run(dev, ['--only', 'reboot', '--reboot', '--reboot-wait', '5']);
      assert.match(r.line('reboot.survives'), /^PASS/);
      assert.match(r.line('reboot.mic-capture'), new RegExp(`^${verdict}`));
      assert.equal(r.code, verdict === 'FAIL' ? 1 : 0, r.text);
      if (verdict === 'MANUAL') assert.match(r.line('reboot.mic-capture'), /PCM.*audible speech/);
      assert.equal(dev.state.calls.filter((call) => call === 'GET /mic/status').length, 1);
    } finally { await dev.close(); }
  });
}

test('an origin guard that lets a foreign URL load fails and puts the start URL back', async () => {
  const dev = await fakeDevice({ faults: { originOpen: true } });
  try {
    const r = await run(dev, ['--only', 'kiosk.origin-guard', '--active']);
    assert.match(r.line('kiosk.origin-guard'), /^FAIL/);
    assert.ok(dev.state.calls.includes('POST /kiosk/load-start'));
  } finally { await dev.close(); }
});

test('switch-aware checks read /status switches, and fail when /status cannot be read', async () => {
  const stored = await fakeDevice({ id: 'piano', settings: { 'midi.enabled': true }, faults: { switchInactive: true } });
  try {
    const r = await run(stored, ['--only', 'midi.status']);
    assert.match(r.line('midi.status'), /^PASS midi.enabled is not active/);
  } finally { await stored.close(); }
  const down = await fakeDevice({ id: 'piano', faults: { statusDown: true } });
  try {
    const r = await run(down, ['--only', 'midi.status,speaker.status']);
    assert.match(r.line('midi.status'), /^FAIL \/status/);
    assert.match(r.line('speaker.status'), /^FAIL \/status/);
  } finally { await down.close(); }
});

test('an --only entry that selects nothing is an error, not a vacuous pass', async () => {
  const dev = await fakeDevice({ id: 'shield' });
  try {
    const r = await run(dev, ['--only', 'core.status,hid']);
    assert.equal(r.code, 1);
    assert.match(r.text, /--only hid selects no check for shield/);
    assert.equal(dev.state.calls.length, 0, 'nothing was sent');
  } finally { await dev.close(); }
});

test('the bad-payload server listens only on the address it is given', async () => {
  const served = await serveBadPayload('127.0.0.1:0');
  try { assert.equal(served.boundAddress, '127.0.0.1'); } finally { await served.close(); }
});

test('a malformed tokens file is reported by line, never by quoting it', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'acc-tokens-'));
  const secret = 'S3cr3t'.repeat(8);
  const file = join(dir, 'tokens.yml');
  writeFileSync(file, `portal:\n  host: 192.0.2.10\n  token: ${secret}\n  bad: [unclosed\n`);
  const repo = join(HERE, '..', '..', '..');
  for (const cli of ['cli/daylight-acceptance.cli.mjs', 'cli/daylight-device.cli.mjs']) {
    const args = cli.includes('acceptance') ? [join(repo, cli), 'portal'] : [join(repo, cli), 'portal', 'status'];
    const r = spawnSync(process.execPath, args, { env: { ...process.env, DAYLIGHT_ANDROID_TOKENS: file }, encoding: 'utf8' });
    assert.equal(r.status, 1, cli);
    assert.ok(!r.stderr.includes(secret) && !r.stdout.includes(secret), `${cli} printed the token`);
    assert.match(r.stderr, /tokens file is not valid YAML \(line \d+\)/, cli);
  }
});

test('--host that overrides the tokens file says where the token is going', async () => {
  const lines = [];
  const orig = console.log;
  console.log = (l) => lines.push(l);
  try {
    await main(['portal', '--host', '127.0.0.1', '--only', 'core.status'], {
      fleet: { portal: { host: '192.0.2.10', token: TOKEN } },
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
      out: (l) => lines.push(l),
    });
  } finally { console.log = orig; }
  assert.ok(lines.some((l) => /token goes to 127\.0\.0\.1 \(--host\), not the tokens file's host/.test(l)), lines.join('\n'));
});

test('the device clock is within 60 s of this machine, or the check fails', async () => {
  for (const [faults, want] of [[{}, /^PASS skew -?\d+ ms/], [{ skewMs: 120_000 }, /^FAIL .*skew 1\d{5} ms, more than 60 s/], [{ noClock: true }, /^FAIL .*no nowMs/]]) {
    const dev = await fakeDevice({ faults });
    try {
      const r = await run(dev, ['--only', 'core.clock']);
      assert.match(r.line('core.clock'), want, JSON.stringify(faults));
    } finally { await dev.close(); }
  }
});

test('selection: a group name selects its checks, --skip removes them', () => {
  assert.equal(selected('kiosk.reload', { only: ['kiosk'] }), true);
  assert.equal(selected('kioskish.x', { only: ['kiosk'] }), false);
  assert.equal(selected('crash.kill', { skip: ['crash'] }), false);
  assert.equal(selected('crash.kill', { only: ['crash.kill'], skip: null }), true);
});

test('options: numbers are bounded, a bad payload URL needs its hash, nothing has a default host', () => {
  assert.throws(() => parseOptions(['portal', '--brightness', '300']), /--brightness/);
  assert.throws(() => parseOptions(['portal', '--bad-payload-url', 'http://x/y']), /--bad-payload-sha256/);
  assert.throws(() => parseOptions(['portal', '--frobnicate']), /unknown option/);
  assert.equal(parseOptions(['portal']).host, undefined);
  assert.throws(() => resolveTarget('portal', {}, { portal: { token: TOKEN } }), /no host for 'portal': pass --host/);
  assert.deepEqual(resolveTarget('portal', { host: '192.0.2.5' }, { portal: { token: TOKEN } }), { host: '192.0.2.5', token: TOKEN, overridden: true });
  assert.equal(resolveTarget('portal', {}, { portal: { host: '192.0.2.5', token: TOKEN } }).overridden, false);
  assert.throws(() => resolveTarget('portal', { host: '192.0.2.5' }, { portal: {} }), /no token/);
});

test('--list prints the checks without opening the tokens file or contacting anything', async () => {
  const lines = [];
  const orig = console.log;
  console.log = (l) => lines.push(l);
  try {
    const code = await main(['shield', '--list'], { fleet: null });
    assert.equal(code, 0);
  } finally { console.log = orig; }
  assert.ok(lines.some((l) => l.startsWith('mic.status')));
});

test('the phone has no control API and is refused', () => {
  assert.throws(() => loadDeviceFile('phone'), /no control API/);
});

test('each kiosk device file builds checks for its own helpers only', () => {
  const ids = (dev) => buildChecks(loadDeviceFile(dev)).map((c) => c.id);
  assert.ok(ids('piano').includes('midi.loopback') && !ids('piano').includes('mic.status'));
  assert.ok(ids('shield').includes('lease.status') && !ids('shield').includes('hid.status'));
  assert.ok(ids('portal').includes('keys.volume') && !ids('portal').includes('speaker.status'));
});

const PHONE_ONLY = ['android-auto', 'bookmarks', 'car-actions', 'media-service', 'notifications', 'one-tap-actions', 'quick-input', 'widgets'];

test('CORE_ROUTES matches the routes the core sources register', () => {
  const dir = join(HERE, '..', 'core', 'src', 'main');
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const found = new Set();
  for (const f of walk(dir).filter((p) => p.endsWith('.java'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/route\("(GET|POST|DELETE)",\s*"(\/[A-Za-z0-9/_.-]*)"/g)) found.add(`${m[1]} ${m[2]}`);
  }
  assert.deepEqual([...found].sort(), [...CORE_ROUTES].sort());
});

test('every capability that serves routes is in CAPABILITY_ROUTES, unless it is phone-only', () => {
  const root = join(HERE, '..', 'capabilities');
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  for (const cap of readdirSync(root)) {
    const main = join(root, cap, 'payload', 'src', 'main');
    if (!existsSync(main)) continue;
    const serves = walk(main).some((f) => f.endsWith('.java') && /route\("(GET|POST|DELETE)"/.test(readFileSync(f, 'utf8')));
    if (serves && !PHONE_ONLY.includes(cap)) assert.ok(cap in CAPABILITY_ROUTES, `${cap} serves routes but is not in CAPABILITY_ROUTES`);
  }
});

test('CAPABILITY_ROUTES matches the routes the capability sources register', () => {
  const root = join(HERE, '..', 'capabilities');
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  for (const [cap, expected] of Object.entries(CAPABILITY_ROUTES)) {
    const main = join(root, cap, 'payload', 'src', 'main');
    const found = new Set();
    if (existsSync(main)) {
      for (const f of walk(main).filter((p) => p.endsWith('.java'))) {
        for (const m of readFileSync(f, 'utf8').matchAll(/route\("(GET|POST|DELETE)",\s*"(\/[A-Za-z0-9/_.-]*)"/g)) {
          if (!m[2].endsWith('/')) found.add(`${m[1]} ${m[2]}`);
        }
      }
    }
    assert.deepEqual([...found].sort(), [...expected].sort(), cap);
  }
});
