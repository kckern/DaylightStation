import { test } from 'node:test';
import assert from 'node:assert';
import { addFingerprintEntry, collectGalleryUuids } from '../src/profileStore.mjs';

test('addFingerprintEntry appends an entry under identities.fingerprints', () => {
  const profile = { username: 'test-user', identities: {} };
  const out = addFingerprintEntry(profile, { id: 'uuid-1', finger: 'right-index', enrolled: '2026-06-17' });
  assert.deepEqual(out.identities.fingerprints, [
    { id: 'uuid-1', finger: 'right-index', enrolled: '2026-06-17' },
  ]);
});

test('addFingerprintEntry preserves existing fingerprints and identities', () => {
  const profile = { identities: { telegram: { user_id: 'x' }, fingerprints: [{ id: 'a', finger: 'left-thumb' }] } };
  const out = addFingerprintEntry(profile, { id: 'b', finger: 'right-index', enrolled: '2026-06-17' });
  assert.equal(out.identities.fingerprints.length, 2);
  assert.equal(out.identities.telegram.user_id, 'x');
});

test('addFingerprintEntry does not mutate the input profile', () => {
  const profile = { identities: { fingerprints: [{ id: 'a', finger: 'left-thumb' }] } };
  addFingerprintEntry(profile, { id: 'b', finger: 'right-index' });
  assert.equal(profile.identities.fingerprints.length, 1, 'original untouched');
});

test('addFingerprintEntry carries the simulated flag when present', () => {
  const out = addFingerprintEntry({}, { id: 'sim-1', finger: 'right-index', simulated: true });
  assert.deepEqual(out.identities.fingerprints[0], { id: 'sim-1', finger: 'right-index', simulated: true });
});

test('collectGalleryUuids gathers enrolled uuids for authorized users only', () => {
  const profilesByUser = {
    user_1: { identities: { fingerprints: [{ id: 'u1', finger: 'right-index' }, { id: 'u2', finger: 'left-index' }] } },
    guest: { identities: { fingerprints: [{ id: 'g1', finger: 'right-index' }] } },
    nofp: { identities: {} },
  };
  const gallery = collectGalleryUuids(profilesByUser, ['user_1', 'nofp']);
  assert.deepEqual(gallery, [
    { uuid: 'u1', username: 'user_1' },
    { uuid: 'u2', username: 'user_1' },
  ]);
});

test('collectGalleryUuids tolerates missing profiles / fingerprints', () => {
  assert.deepEqual(collectGalleryUuids({}, ['ghost']), []);
  assert.deepEqual(collectGalleryUuids(null, null), []);
});
