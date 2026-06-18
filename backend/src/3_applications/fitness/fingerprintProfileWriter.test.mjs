// backend/src/3_applications/fitness/fingerprintProfileWriter.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addFingerprintEntry,
  removeFingerprintEntry,
  createFingerprintProfileWriter,
} from './fingerprintProfileWriter.mjs';

test('addFingerprintEntry appends without mutating input', () => {
  const profile = { username: 'test-user', identities: { admin: true } };
  const next = addFingerprintEntry(profile, { id: 'u1', finger: 'right-index', enrolled: '2026-06-17' });
  assert.equal(profile.identities.fingerprints, undefined); // original untouched
  assert.equal(next.identities.admin, true);                // preserved
  assert.deepEqual(next.identities.fingerprints, [{ id: 'u1', finger: 'right-index', enrolled: '2026-06-17' }]);
});

test('removeFingerprintEntry drops the matching uuid only', () => {
  const profile = { identities: { fingerprints: [{ id: 'u1' }, { id: 'u2' }] } };
  const next = removeFingerprintEntry(profile, 'u1');
  assert.deepEqual(next.identities.fingerprints, [{ id: 'u2' }]);
  assert.deepEqual(profile.identities.fingerprints, [{ id: 'u1' }, { id: 'u2' }]); // input untouched
});

test('writer.addFingerprint reads → mutates → writes → reloads cache', async () => {
  let written; let reloaded;
  const datastore = {
    readProfile: () => ({ identities: { fingerprints: [] } }),
    writeProfile: (u, c) => { written = { u, c }; },
  };
  const configService = { reloadUserProfile: (u) => { reloaded = u; } };
  const writer = createFingerprintProfileWriter({ datastore, configService });
  await writer.addFingerprint('test-user', { id: 'u9', finger: 'left-thumb', enrolled: '2026-06-17' });

  assert.equal(written.u, 'test-user');
  assert.deepEqual(written.c.identities.fingerprints, [{ id: 'u9', finger: 'left-thumb', enrolled: '2026-06-17' }]);
  assert.equal(reloaded, 'test-user');
});

test('writer.removeFingerprint reads → removes → writes → reloads cache', async () => {
  let written; let reloaded;
  const datastore = {
    readProfile: () => ({ identities: { fingerprints: [{ id: 'u1' }, { id: 'u2' }] } }),
    writeProfile: (_u, c) => { written = c; },
  };
  const configService = { reloadUserProfile: (u) => { reloaded = u; } };
  const writer = createFingerprintProfileWriter({ datastore, configService });
  await writer.removeFingerprint('test-user', 'u1');
  assert.deepEqual(written.identities.fingerprints, [{ id: 'u2' }]);
  assert.equal(reloaded, 'test-user');
});
