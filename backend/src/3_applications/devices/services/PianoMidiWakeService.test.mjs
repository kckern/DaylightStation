// backend/src/3_applications/devices/services/PianoMidiWakeService.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PianoMidiWakeService } from './PianoMidiWakeService.mjs';
import { ScreenOverrideService } from './ScreenOverrideService.mjs';

class FakeWs { on() {} close() {} }

function makeService(overrides = {}) {
  const screenCalls = [];
  const setScreen = (on) => { screenCalls.push(on); return Promise.resolve({ ok: true }); };
  const deviceService = { get: () => ({ setScreen }) };
  let t = 1_000_000;
  const clock = { now: () => t };
  const advance = (ms) => { t += ms; };
  const fetchCalls = [];
  const fetchImpl = (url, opts) => { fetchCalls.push([url, opts]); return Promise.resolve({ ok: true }); };
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
  return { svc, screenCalls, advance, fetchCalls, screenOverride };
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

test('suppressWakeUntil relays the deadline to the APK control plane over HTTP', () => {
  const { svc, fetchCalls } = makeService();
  const deadline = 1_000_000 + 30 * 60_000;
  svc.suppressWakeUntil(deadline);

  assert.equal(fetchCalls.length, 1);
  const [url, opts] = fetchCalls[0];
  assert.equal(url, 'http://10.0.0.245:8770/config');
  assert.equal(opts.method, 'POST');
  assert.ok(opts.body.includes(`fkbWakeSuppressUntilEpochMs: ${deadline}`));
});
