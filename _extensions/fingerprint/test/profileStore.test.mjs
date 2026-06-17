// _extensions/fingerprint/test/profileStore.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { addFingerprintEntry, collectGalleryUuids } from '../src/profileStore.mjs';

test('addFingerprintEntry appends an entry under identities.fingerprints', () => {
  const profile = { username: 'test-user', identities: {} };
  const out = addFingerprintEntry(profile, { id: 'uuid-1', finger: 'right-index', enrolled: '2026-06-17' });
  assert.deepEqual(out.identities.fingerprints, [
    { id: 'uuid-1', finger: 'right-index', enrolled: '2026-06-17' }
  ]);
});

test('addFingerprintEntry preserves existing fingerprints and identities (no mutation)', () => {
  const profile = { identities: { telegram: { user_id: 'x' }, fingerprints: [{ id: 'a', finger: 'left-thumb' }] } };
  const out = addFingerprintEntry(profile, { id: 'b', finger: 'right-index', enrolled: '2026-06-17' });
  assert.equal(out.identities.fingerprints.length, 2);
  assert.equal(out.identities.telegram.user_id, 'x');
  // original is untouched
  assert.equal(profile.identities.fingerprints.length, 1);
});

test('addFingerprintEntry handles a profile with no identities block', () => {
  const out = addFingerprintEntry({ username: 'test-user' }, { id: 'u1', finger: 'right-index', enrolled: '2026-06-17' });
  assert.deepEqual(out.identities.fingerprints, [{ id: 'u1', finger: 'right-index', enrolled: '2026-06-17' }]);
});

test('collectGalleryUuids gathers uuids+usernames for authorized users only', () => {
  const profiles = {
    'test-user': { identities: { fingerprints: [{ id: 'u1' }, { id: 'u2' }] } },
    'other-user': { identities: { fingerprints: [{ id: 'u3' }] } },
    'kid': { identities: {} }
  };
  const gallery = collectGalleryUuids(profiles, ['test-user', 'other-user']);
  assert.deepEqual(gallery.map(g => g.uuid).sort(), ['u1', 'u2', 'u3']);
  assert.deepEqual(gallery.find(g => g.uuid === 'u3'), { uuid: 'u3', username: 'other-user' });
});

test('collectGalleryUuids skips users with no fingerprints and is empty for none', () => {
  assert.deepEqual(collectGalleryUuids({ kid: { identities: {} } }, ['kid']), []);
  assert.deepEqual(collectGalleryUuids({}, []), []);
});
