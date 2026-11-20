import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLearnSegmentsReader } from './learnSegments.mjs';

const SCORE = 'files:docs/sheet-music/piece.mxl';
const file = { contentSha256: 'c', segments: [{ id: 'b', start: 4, end: 7 }, { id: 'a', start: 0, end: 3 }] };
const reader = (getSheetMusicLearn, warnings = []) => createLearnSegmentsReader({
  datastore: { getSheetMusicLearn }, logger: { warn: (event, data) => warnings.push([event, data]) },
});

test('reads the approved segments for the content the child practised', () => {
  const warnings = [];
  const read = reader((id) => (id === SCORE ? file : null), warnings);
  assert.deepEqual(read(SCORE, 'c').map((s) => [s.id, s.start, s.end]), [['a', 0, 3], ['b', 4, 7]]);
  assert.equal(read(SCORE, 'other-sha'), null);
  assert.equal(read('files:none.mxl', 'c'), null);
  // A file cut against other XML, or no file, is normal: no warning.
  assert.deepEqual(warnings, []);
});

test('without a content sha there is nothing to match, so nothing is read', () => {
  let reads = 0;
  const read = reader(() => { reads += 1; return file; });
  assert.equal(read(SCORE, null), null);
  assert.equal(read(SCORE, undefined), null);
  assert.equal(reads, 0);
});

test('an unreadable Learn file answers null and warns once per score', () => {
  const warnings = [];
  const read = reader(() => { throw new Error('bad yaml'); }, warnings);
  assert.equal(read(SCORE, 'c'), null);
  assert.equal(read(SCORE, 'c'), null);
  assert.equal(read('files:other.mxl', 'c'), null);
  assert.deepEqual(warnings, [
    ['piano.sheetmusic.learn-read-failed', { scoreId: SCORE, error: 'bad yaml' }],
    ['piano.sheetmusic.learn-read-failed', { scoreId: 'files:other.mxl', error: 'bad yaml' }],
  ]);
});

test('a matching file whose segments do not validate answers null and warns once per score', () => {
  const warnings = [];
  const broken = { contentSha256: 'c', segments: [{ id: 'a', start: 0, end: 5 }, { id: 'b', start: 3, end: 8 }] };
  const read = reader(() => broken, warnings);
  assert.equal(read(SCORE, 'c'), null);
  assert.equal(read(SCORE, 'c'), null);
  assert.equal(read(SCORE, 'other-sha'), null);
  assert.deepEqual(warnings, [['piano.sheetmusic.learn-invalid', { scoreId: SCORE }]]);
});

test('each reader keeps its own latch', () => {
  const warnings = [];
  const fail = () => { throw new Error('x'); };
  reader(fail, warnings)(SCORE, 'c');
  reader(fail, warnings)(SCORE, 'c');
  assert.equal(warnings.length, 2);
});

const overrideReader = (pianoConfig, getSheetMusicLearn = () => file, warnings = []) => createLearnSegmentsReader({
  datastore: { getSheetMusicLearn },
  pianoConfig: () => pianoConfig,
  logger: { warn: (event, data) => warnings.push([event, data]) },
});

test('a household segment override wins over the approved file, with no sha check', () => {
  const config = { sheetmusic: { learn: { pieces: { [SCORE]: { segments: [
    { id: 'y', inMeasure: 2, outMeasure: 5, name: 'Middle' }, { id: 'x', start: 0, end: 1 },
  ] } } } } };
  const read = overrideReader(config);
  assert.deepEqual(read(SCORE, 'other-sha'), [{ id: 'x', start: 0, end: 1 }, { id: 'y', start: 2, end: 5, name: 'Middle' }]);
  // Another piece still reads its approved file.
  assert.equal(read('files:docs/sheet-music/else.mxl', 'c').length, 2);
});

test('the single configured piano\'s own sheetmusic.learn is the one read, as the kiosk resolves it', () => {
  const config = {
    sheetmusic: { learn: { pieces: { [SCORE]: { segments: [{ id: 'shared', start: 0, end: 7 }] } } } },
    pianos: { one: { sheetmusic: { learn: { pieces: { [SCORE]: { segments: [{ id: 'own', start: 0, end: 3 }] } } } } } },
  };
  assert.deepEqual(overrideReader(config)(SCORE, 'c').map((s) => s.id), ['own']);
  // A piano without its own sheetmusic.learn inherits the shared one.
  assert.deepEqual(overrideReader({ ...config, pianos: { one: { sheetmusic: { collections: [] } } } })(SCORE, 'c').map((s) => s.id), ['shared']);
});

test('no override reads the approved file as before; an invalid override answers null and warns once', () => {
  assert.deepEqual(overrideReader({ sheetmusic: {} })(SCORE, 'c').map((s) => s.id), ['a', 'b']);
  assert.deepEqual(overrideReader(null)(SCORE, 'c').map((s) => s.id), ['a', 'b']);
  const warnings = [];
  const bad = overrideReader({ sheetmusic: { learn: { pieces: { [SCORE]: { segments: [{ id: 'x', start: 0, end: 4 }, { id: 'y', start: 3, end: 6 }] } } } } }, () => file, warnings);
  assert.equal(bad(SCORE, 'c'), null);
  assert.equal(bad(SCORE, 'c'), null);
  assert.deepEqual(warnings, [['piano.sheetmusic.override-invalid', { scoreId: SCORE }]]);
});
