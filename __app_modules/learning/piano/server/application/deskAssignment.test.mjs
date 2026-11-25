import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inTrack, resolveDeskAssignments } from './deskAssignment.mjs';

test('an entry is one roster learner\'s; catch-all and unknown keys are refused', () => {
  const { byUser, refused } = resolveDeskAssignments({
    ' Kid ': { piece: 'files:docs/sheet-music/a.mxl', collection: 'files:docs/sheet-music/first/' },
    '*': { piece: 'files:docs/sheet-music/a.mxl' }, all: { collection: 'files:docs/sheet-music/first' }, stranger: {},
    sib: { piece: 'plex:12' },
  }, ['kid', 'sib']);
  assert.deepEqual(Object.fromEntries(byUser), {
    kid: { piece: 'files:docs/sheet-music/a.mxl', track: 'files:docs/sheet-music/first' },
    sib: { piece: null, track: null },
  });
  assert.deepEqual(refused.map((r) => [r.key, r.reason]), [['*', 'not-on-roster'], ['all', 'not-on-roster'], ['stranger', 'not-on-roster'], ['sib', 'piece-not-a-library-score']]);
});

test('a track holds the scores under its folder only', () => {
  assert.equal(inTrack('files:docs/sheet-music/first/01.musicxml', 'files:docs/sheet-music/first'), true);
  assert.equal(inTrack('files:docs/sheet-music/first-steps/01.musicxml', 'files:docs/sheet-music/first'), false);
  assert.equal(inTrack('files:docs/sheet-music/first/01.musicxml', null), false);
});
