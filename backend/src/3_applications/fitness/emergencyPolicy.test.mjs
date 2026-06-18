import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEmergencyCandidates, EMERGENCY_LOCK } from './emergencyPolicy.mjs';

const profiles = {
  alice: { identities: { admin: true, fingerprints: [{ id: 'uuid-a1', finger: 'right-index' }, { id: 'uuid-a2', finger: 'left-index' }] } },
  bob: { identities: { admin: true, fingerprints: [{ id: 'uuid-b1', finger: 'right-thumb' }] } },
};
const userService = { getProfile: (u) => profiles[u] || null };

test('resolves admin fingerprint uuids for the emergency lock', () => {
  const fitnessConfig = { locks: { [EMERGENCY_LOCK]: ['alice', 'bob'] } };
  const out = resolveEmergencyCandidates({ fitnessConfig, userService });
  assert.deepEqual(out, [
    { uuid: 'uuid-a1', username: 'alice' },
    { uuid: 'uuid-a2', username: 'alice' },
    { uuid: 'uuid-b1', username: 'bob' },
  ]);
});

test('returns [] when no emergency lock configured', () => {
  assert.deepEqual(resolveEmergencyCandidates({ fitnessConfig: { locks: {} }, userService }), []);
  assert.deepEqual(resolveEmergencyCandidates({ fitnessConfig: {}, userService }), []);
});

test('skips users without a profile or without fingerprints', () => {
  const fitnessConfig = { locks: { [EMERGENCY_LOCK]: ['alice', 'ghost'] } };
  const out = resolveEmergencyCandidates({ fitnessConfig, userService });
  assert.deepEqual(out, [
    { uuid: 'uuid-a1', username: 'alice' },
    { uuid: 'uuid-a2', username: 'alice' },
  ]);
});

test('tolerates missing args', () => {
  assert.deepEqual(resolveEmergencyCandidates(), []);
  assert.deepEqual(resolveEmergencyCandidates({}), []);
});
