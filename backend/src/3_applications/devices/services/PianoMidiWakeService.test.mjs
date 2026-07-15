// backend/src/3_applications/devices/services/PianoMidiWakeService.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PianoMidiWakeService } from './PianoMidiWakeService.mjs';
import { ScreenOverrideService } from './ScreenOverrideService.mjs';

class FakeWs { on() {} close() {} }

// Parse the flat `key: value` YAML the relay posts (mirrors DeviceConfig.parseInto).
function parseFlatYaml(body = '') {
  const out = {};
  for (const line of body.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf(':');
    if (i < 0) continue;
    out[s.slice(0, i).trim()] = s.slice(i + 1).trim();
  }
  return out;
}

function makeService(overrides = {}) {
  const screenCalls = [];
  const setScreen = (on) => { screenCalls.push(on); return Promise.resolve({ ok: true }); };
  const deviceService = { get: () => ({ setScreen }) };
  let t = 1_000_000;
  const clock = { now: () => t };
  const advance = (ms) => { t += ms; };
  const fetchCalls = [];
  // Model the APK's REAL config semantics: GET returns the live override,
  // POST /config *REPLACES* the whole override file with the posted body
  // (DeviceConfig.writeOverride truncates). So targetMac only survives a
  // suppress if the service read-merge-writes instead of posting one key.
  const store = overrides.initialConfig
    ? { ...overrides.initialConfig }
    : { targetMac: '10:65:36:36:62:66', targetName: 'jam-7e6', speakerMac: '64:49:A5:8B:9B:75' };
  delete overrides.initialConfig;
  const getFails = overrides.getFails; delete overrides.getFails;
  const fetchImpl = (url, opts = {}) => {
    const method = opts.method || 'GET';
    fetchCalls.push([url, opts]);
    if (method === 'GET') {
      if (getFails) return Promise.resolve({ ok: false, json: () => Promise.reject(new Error('boom')) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ values: { ...store } }) });
    }
    // POST replaces the whole config (truncating write, as the APK does today).
    const next = parseFlatYaml(opts.body || '');
    for (const k of Object.keys(store)) delete store[k];
    Object.assign(store, next);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ values: { ...store } }) });
  };
  const screenOverride = new ScreenOverrideService({ clock });
  const svc = new PianoMidiWakeService({
    deviceService,
    deviceId: 'yellow-room-tablet',
    bridgeUrl: 'ws://10.0.0.245:8770',
    cooldownMs: 8000,
    clock,
    fetchImpl,
    WebSocketImpl: FakeWs,
    screenOverride,
    logger: { info() {}, warn() {} },
    ...overrides,
  });
  return { svc, screenCalls, advance, fetchCalls, screenOverride, store };
}

test('suppressWakeUntil skips FKB wake pokes while suppressed, resumes after the deadline', async () => {
  const { svc, screenCalls, advance } = makeService();
  svc.suppressWakeUntil(1_000_000 + 30 * 60_000);

  // A note during suppression must NOT wake the screen.
  svc._handleNoteOnForTest();
  await Promise.resolve();
  assert.equal(screenCalls.length, 0);

  // After the deadline, a note wakes normally.
  advance(30 * 60_000 + 1);
  svc._handleNoteOnForTest();
  await Promise.resolve();
  assert.deepEqual(screenCalls, [true]);
});

test('suppressWakeUntil relays the deadline to the APK control plane over HTTP', async () => {
  const { svc, fetchCalls } = makeService();
  const deadline = 1_000_000 + 30 * 60_000;
  svc.suppressWakeUntil(deadline);
  await svc._relayDone();

  // Read-merge-write: a GET to read the live config, then a POST with the merge.
  const posts = fetchCalls.filter(([, o]) => (o.method || 'GET') === 'POST');
  assert.equal(posts.length, 1);
  const [url, opts] = posts[0];
  assert.equal(url, 'http://10.0.0.245:8770/config');
  assert.ok(fetchCalls.some(([u, o]) => u === 'http://10.0.0.245:8770/config' && (o.method || 'GET') === 'GET'),
    'must GET the live config before POSTing');
  assert.ok(opts.body.includes(`fkbWakeSuppressUntilEpochMs: ${deadline}`));
});

test('suppressWakeUntil MERGES — the wake relay must never erase targetMac (the outage)', async () => {
  const { svc, store } = makeService();
  const deadline = 1_000_000 + 30 * 60_000;
  svc.suppressWakeUntil(deadline);
  await svc._relayDone();

  // The POST replaced the whole override (truncating APK write). Because the
  // service merged, the BLE-MIDI target identities survived alongside the new key.
  assert.equal(store.targetMac, '10:65:36:36:62:66', 'targetMac must survive a wake-suppress');
  assert.equal(store.targetName, 'jam-7e6');
  assert.equal(store.speakerMac, '64:49:A5:8B:9B:75');
  assert.equal(store.fkbWakeSuppressUntilEpochMs, String(deadline));
});

test('suppressWakeUntil FAILS SAFE — if the live config is unreadable it does NOT post a partial (clobbering) config', async () => {
  const { svc, fetchCalls } = makeService({ getFails: true });
  svc.suppressWakeUntil(1_000_000 + 30 * 60_000);
  await svc._relayDone();

  const posts = fetchCalls.filter(([, o]) => (o.method || 'GET') === 'POST');
  assert.equal(posts.length, 0, 'a blind partial POST is the clobber; skip it when config can not be read');
});
