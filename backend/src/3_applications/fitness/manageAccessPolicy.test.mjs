// backend/src/3_applications/fitness/manageAccessPolicy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveManageAccess } from './manageAccessPolicy.mjs';

const fp = (id, finger = 'right-index') => ({ id, finger, enrolled: '2026-06-17' });

test('unenrolled target requires no auth (TOFU bootstrap)', () => {
  const profiles = { 'test-user': { identities: { fingerprints: [] } } };
  const out = resolveManageAccess(profiles, 'test-user');
  assert.equal(out.requiresAuth, false);
});

test('enrolled target requires auth and gallery includes own + admin uuids', () => {
  const profiles = {
    'test-user': { identities: { fingerprints: [fp('own-1')] } },
    'admin-user': { identities: { admin: true, fingerprints: [fp('adm-1')] } },
    'bystander': { identities: { fingerprints: [fp('by-1')] } },
  };
  const out = resolveManageAccess(profiles, 'test-user');
  assert.equal(out.requiresAuth, true);
  assert.deepEqual(
    out.gallery.sort((a, b) => a.uuid.localeCompare(b.uuid)),
    [{ uuid: 'adm-1', username: 'admin-user' }, { uuid: 'own-1', username: 'test-user' }],
  );
});

test('gallery dedups a uuid when the target is also an admin', () => {
  const profiles = {
    'admin-user': { identities: { admin: true, fingerprints: [fp('adm-1')] } },
  };
  const out = resolveManageAccess(profiles, 'admin-user');
  assert.equal(out.gallery.length, 1);
  assert.deepEqual(out.gallery, [{ uuid: 'adm-1', username: 'admin-user' }]);
});

test('missing target → requiresAuth false, empty gallery', () => {
  assert.deepEqual(resolveManageAccess({}, 'ghost'), { requiresAuth: false, gallery: [] });
});
