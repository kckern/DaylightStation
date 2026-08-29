import assert from 'node:assert/strict';
import test from 'node:test';
import { ShutdownService } from './ShutdownService.mjs';

const config = {
  duration_seconds: 1800,
  targets: { school_screen_ids: ['portal'], piano_device_ids: ['yellow-room-tablet'] },
  home_assistant: { script: 'script.kiosk_shutdown_cue' },
};

function fakes() {
  let result = { state: null, invalid: false };
  const saved = [];
  const repo = {
    async read() { return result; },
    async save(state) { saved.push(state); result = { state, invalid: false }; },
  };
  const events = [];
  const portalCalls = [];
  const haCalls = [];
  return {
    repo, saved, events, portalCalls, haCalls,
    notifier: { publishState(payload) { events.push({ topic: 'shutdown.state', payload }); } },
    portal: { async setLockdown(value) { portalCalls.push(value); } },
    cue: { async announce(value) { haCalls.push(value); } },
    invalid() { result = { state: null, invalid: true }; },
  };
}

const policy = () => ({
  durationSeconds: config.duration_seconds,
  reconcileSeconds: config.reconcile_seconds,
  targets: ['school:portal', 'piano:yellow-room-tablet'],
});

test('activation persists the configured targets, publishes first, and resets the duration on repeat scan', async () => {
  const f = fakes();
  const service = new ShutdownService({ repo: f.repo, notifier: f.notifier, getPolicy: policy, cue: f.cue, portal: f.portal });
  const first = await service.activate({ readerId: 'study-omr', tagUid: '04aa660fcb2a81', now: 1_000 });
  const repeat = await service.activate({ readerId: 'study-omr', tagUid: '04aa660fcb2a81', now: 2_000 });
  assert.equal(first.lockedUntil, '1970-01-01T00:30:01.000Z');
  assert.equal(repeat.lockedUntil, '1970-01-01T00:30:02.000Z');
  assert.deepEqual(repeat.targets, ['school:portal', 'piano:yellow-room-tablet']);
  assert.equal(f.events[0].topic, 'shutdown.state');
  assert.equal(f.events[0].payload.locked, true);
  assert.deepEqual(f.portalCalls.at(-1), { locked: true, lockedUntil: repeat.lockedUntil });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.haCalls.length, 2, 'the audible cue repeats with a repeat scan');
});

test('malformed runtime YAML fails closed and sends an indefinite Portal lock', async () => {
  const f = fakes();
  f.invalid();
  const service = new ShutdownService({ repo: f.repo, notifier: f.notifier, getPolicy: policy, portal: f.portal });
  await service.reconcile();
  assert.equal((await service.status('school:portal')).locked, true);
  assert.equal(f.events[0].payload.locked, true);
  assert.deepEqual(f.events[0].payload.targets, ['school:portal', 'piano:yellow-room-tablet']);
  assert.deepEqual(f.portalCalls[0], { locked: true, lockedUntil: null });
});

test('failed Portal synchronization is retried without changing the persisted lock', async () => {
  const f = fakes();
  let attempts = 0;
  const portal = { async setLockdown() { attempts += 1; if (attempts === 1) throw new Error('offline'); } };
  const service = new ShutdownService({ repo: f.repo, notifier: f.notifier, getPolicy: policy, portal, logger: { warn() {} } });
  await service.activate({ readerId: 'study-omr', tagUid: '04aa660fcb2a81', now: Date.now() });
  await service.reconcile();
  assert.equal(attempts, 2);
  assert.equal((await service.status('piano:yellow-room-tablet')).locked, true);
});
