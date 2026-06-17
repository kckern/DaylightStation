import { test } from 'node:test';
import assert from 'node:assert';
import { resolveCandidateUuids } from './unlockPolicy.mjs';

const fitness = { locks: { dance_party: ['test-user', 'other-user'] } };
const profiles = {
  'test-user': { identities: { fingerprints: [{ id: 'u1' }, { id: 'u2' }] } },
  'other-user': { identities: { fingerprints: [{ id: 'u3' }] } },
  'kid': { identities: {} }
};

test('resolves uuids for authorized users of a lock', () => {
  const r = resolveCandidateUuids(fitness, profiles, 'dance_party');
  assert.deepEqual(r.map(x => x.uuid).sort(), ['u1', 'u2', 'u3']);
});
test('unknown lock → empty', () => {
  assert.deepEqual(resolveCandidateUuids(fitness, profiles, 'nope'), []);
});
