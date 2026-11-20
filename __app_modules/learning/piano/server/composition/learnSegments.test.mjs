import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLearnSegmentsReader } from './learnSegments.mjs';

const SCORE = 'files:docs/sheet-music/piece.mxl';
const file = { contentSha256: 'c', segments: [{ id: 'b', start: 4, end: 7 }, { id: 'a', start: 0, end: 3 }] };
const reader = (getSheetMusicLearn, warnings = []) => createLearnSegmentsReader({
  datastore: { getSheetMusicLearn }, logger: { warn: (event, data) => warnings.push([event, data]) },
});

test('reads the approved segments for the content the child practised', () => {
  const read = reader((id) => (id === SCORE ? file : null));
  assert.deepEqual(read(SCORE, 'c').map((s) => [s.id, s.start, s.end]), [['a', 0, 3], ['b', 4, 7]]);
  assert.equal(read(SCORE, 'other-sha'), null);
  assert.equal(read('files:none.mxl', 'c'), null);
});

test('without a content sha there is nothing to match, so nothing is read', () => {
  let reads = 0;
  const read = reader(() => { reads += 1; return file; });
  assert.equal(read(SCORE, null), null);
  assert.equal(read(SCORE, undefined), null);
  assert.equal(reads, 0);
});

test('an unreadable Learn file answers null and warns', () => {
  const warnings = [];
  const read = reader(() => { throw new Error('bad yaml'); }, warnings);
  assert.equal(read(SCORE, 'c'), null);
  assert.deepEqual(warnings, [['piano.sheetmusic.learn-read-failed', { scoreId: SCORE, error: 'bad yaml' }]]);
});
