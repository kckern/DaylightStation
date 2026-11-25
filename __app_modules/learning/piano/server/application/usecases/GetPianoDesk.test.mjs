import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetPianoDesk, practiceKeyOfScore } from './GetPianoDesk.mjs';
import { createCoachPlan } from '#shared/music/learnCoach.mjs';
import { createLearnSegmentsReader } from '../../composition/learnSegments.mjs';
import { projectRecord } from '../coachRecordProjection.mjs';

const SCORE = 'files:docs/sheet-music/christmas/piece.mxl';
const KEY = practiceKeyOfScore(SCORE);
const segments = { 'm0-4': {}, 'm5-8': {}, 'm9-12': {} };
// Real progress sits on the last passage, so the next step stays at the start.
const PROGRESS = { 'm9-12': { rungs: { right: { passCount: 6 } } } };
const record = (over = {}) => ({ fingerprint: { contentSha256: 'c' }, updatedAt: '2026-11-01T00:00:00Z', learn: { segments, passages: PROGRESS }, ...over });
const deskFor = (byUser, { roster = Object.keys(byUser), ids = [SCORE], pieceLog = undefined, logger = undefined, sheetmusic = undefined } = {}) => new GetPianoDesk({
  pieceLog, ...(logger ? { logger } : {}),
  datastore: { listPractice: (user) => byUser[user] ?? [], listSheetMusicIds: () => ids },
  configProjection: { roster: () => roster, profile: (id) => ({ display_name: id.toUpperCase() }), raw: () => (sheetmusic ? { sheetmusic } : {}) },
  clock: () => new Date('2026-11-18T20:00:00Z'), timezone: 'UTC',
});

test('shows the most recently practiced piece with its next step', () => {
  const older = { scoreKey: practiceKeyOfScore('files:docs/sheet-music/older.mxl'), record: record({ updatedAt: '2026-01-01T00:00:00Z' }) };
  const current = { scoreKey: KEY, record: record({ learn: { segments, passages: { 'm0-4': { rungs: { right: { passCount: 6 } } } } } }) };
  const { players } = deskFor({ a: [older, current] }, { ids: [SCORE, 'files:docs/sheet-music/older.mxl'] }).execute();
  assert.equal(players[0].piece.scoreId, SCORE);
  assert.equal(players[0].name, 'A');
  assert.deepEqual(players[0].piece.next, { passageId: 'm0-4', skill: 'left', label: 'Find the left-hand notes', start: 0, end: 4 });
  // One hand earned is real progress, but the passage is still a tomato.
  assert.deepEqual(players[0].piece.passages.map((p) => p.state), ['todo', 'todo', 'todo']);
  assert.deepEqual(players[0].piece.passages[0].steps, { done: 1, total: 4 });
});

test('a passage with both hands earned is partway (the flower)', () => {
  const both = { right: { passCount: 6 }, left: { passCount: 6 } };
  const current = { scoreKey: KEY, record: record({ learn: { segments, passages: { 'm0-4': { rungs: both } } } }) };
  const { piece } = deskFor({ a: [current] }).execute().players[0];
  assert.deepEqual(piece.passages.map((p) => p.state), ['learning', 'todo', 'todo']);
  assert.deepEqual(piece.passages[0].steps, { done: 2, total: 4 });
});

test('counts Silver and Gold from the same rules as Learn', () => {
  const r = record({ learn: { segments, passages: { 'm0-4': { complete: true } } } });
  const { piece } = deskFor({ a: [{ scoreKey: KEY, record: r }] }).execute().players[0];
  assert.deepEqual({ total: piece.total, silver: piece.silver, gold: piece.gold }, { total: 3, silver: 1, gold: 1 });
  assert.equal(piece.passages[0].state, 'gold');
  assert.equal(piece.next.passageId, 'm5-8');
});

test('skips records that have no passage plan or no known score', () => {
  const noPlan = { scoreKey: KEY, record: record({ learn: {} }) };
  const unknown = { scoreKey: 'files-gone-mxl', record: record({ updatedAt: '2027-01-01T00:00:00Z' }) };
  assert.equal(deskFor({ a: [noPlan, unknown] }).execute().players[0].piece, null);
});

test('reports a roster player with no practice, and keeps recent players first', () => {
  const { players } = deskFor({ b: [{ scoreKey: KEY, record: record() }] }, { roster: ['a', 'b'] }).execute();
  assert.deepEqual(players.map((p) => [p.userId, Boolean(p.piece)]), [['b', true], ['a', false]]);
});

test('uses coaching evidence as the latest activity and its own score id', () => {
  const id = 'files:docs/sheet-music/not-listed.mxl';
  const state = { version: 1, scoreId: id, fingerprint: 'c', revision: 1, achievements: {}, counts: {}, reviews: {}, resume: null,
    evidence: [{ id: 'e', at: '2026-11-17T00:00:00Z', task: { passageId: 'm0-4', mode: 'free', key: 'k' }, passedCredits: [], eligible: [] }] };
  const { piece } = deskFor({ a: [{ scoreKey: 'x', record: record({ learnCoach: state }) }] }, { ids: [] }).execute().players[0];
  assert.equal(piece.scoreId, id);
  assert.equal(piece.practicedAt, '2026-11-17T00:00:00Z');
});

test('a corrupt record cannot take the desk down', () => {
  const bad = { scoreKey: KEY, record: record({ fingerprint: null, learnCoach: null }) };
  assert.equal(deskFor({ a: [bad] }).execute().players[0].piece, null);
});

test('uses saved passage ranges and parts, so one-hand pieces match Learn', () => {
  const summary = { passages: [{ id: 'intro', start: 0, end: 3, parts: ['rh'] }, { id: 'tune', start: 4, end: 7, parts: ['rh'] }] };
  const r = record({ learn: { passages: { tune: { complete: true } } }, learnCoach: { version: 1, scoreId: SCORE, fingerprint: 'c', revision: 1, achievements: {}, counts: {}, evidence: [], reviews: {}, resume: null, summary } });
  const { piece } = deskFor({ a: [{ scoreKey: KEY, record: r }] }).execute().players[0];
  assert.deepEqual(piece.passages.map((p) => [p.id, p.start, p.end]), [['intro', 0, 3], ['tune', 4, 7]]);
  assert.deepEqual(piece.next, { passageId: 'intro', skill: 'silver', label: 'Play it on your own', start: 0, end: 3 });
});

test('treats an older plan as two-handed, since its rungs cannot tell', () => {
  const r = record({ learn: { segments: { 'm0-3': {}, 'm4-7': {} }, passages: { 'm0-3': { rungs: { 'test-out': { passCount: 0 } } }, 'm4-7': { rungs: { right: { passCount: 6 } } } } } });
  assert.equal(deskFor({ a: [{ scoreKey: KEY, record: r }] }).execute().players[0].piece.next.skill, 'silver');
});

test('one player failing does not take the desk down', () => {
  const desk = new GetPianoDesk({
    datastore: { listPractice: (user) => { if (user === 'bad') throw new Error('broken'); return [{ scoreKey: KEY, record: record() }]; }, listSheetMusicIds: () => [SCORE] },
    configProjection: { roster: () => ['bad', 'ok'], profile: (id) => ({ display_name: id }), raw: () => ({}) }, timezone: 'UTC', logger: { warn() {} },
  });
  assert.deepEqual(desk.execute().players.map((p) => [p.userId, Boolean(p.piece)]), [['ok', true], ['bad', false]]);
});

test('does not walk the library when every record names its score', () => {
  let walks = 0;
  const state = { version: 1, scoreId: SCORE, fingerprint: 'c', revision: 1, achievements: {}, counts: {}, evidence: [], reviews: {}, resume: null };
  new GetPianoDesk({ datastore: { listPractice: () => [{ scoreKey: KEY, record: record({ learnCoach: state }) }], listSheetMusicIds: () => { walks += 1; return []; } },
    configProjection: { roster: () => ['a'], profile: () => ({}), raw: () => ({}) }, timezone: 'UTC' }).execute();
  assert.equal(walks, 0);
});

test('skips a piece that was only browsed and shows the most recent one with real progress', () => {
  const browsed = { scoreKey: KEY, record: record({ updatedAt: '2026-11-17T00:00:00Z', learn: { segments, passages: { 'm0-4': { rungs: { 'test-out': { passCount: 0 } } } } } }) };
  const realId = 'files:docs/sheet-music/real.mxl';
  const real = { scoreKey: practiceKeyOfScore(realId), record: record({ updatedAt: '2026-11-01T00:00:00Z', learn: { segments, passages: { 'm0-4': { rungs: { right: { passCount: 6 } } } } } }) };
  const { piece } = deskFor({ a: [browsed, real] }, { ids: [SCORE, realId] }).execute().players[0];
  assert.equal(piece.scoreId, realId);
});

test('a child with only browsed pieces has no piece', () => {
  const browsed = { scoreKey: KEY, record: record({ learn: { segments, passages: {} } }) };
  assert.equal(deskFor({ a: [browsed] }).execute().players[0].piece, null);
});

test('carries the score poster when the library has one', () => {
  const current = { scoreKey: KEY, record: record() };
  const covered = new GetPianoDesk({
    datastore: { listPractice: () => [current], listSheetMusicIds: () => [SCORE], sheetMusicCover: (id) => (id === SCORE ? '/cover.jpg' : null) },
    configProjection: { roster: () => ['a'], profile: (id) => ({ display_name: id }), raw: () => ({}) },
    clock: () => new Date('2026-11-18T20:00:00Z'), timezone: 'UTC',
  });
  assert.equal(covered.execute().players[0].piece.cover, '/cover.jpg');
  assert.equal(deskFor({ a: [current] }).execute().players[0].piece.cover, null);
});

test('carries the Polish gem and diamond the piece log holds for the piece', () => {
  const entries = { a: [{ scoreId: SCORE, level: 'gold' }, { scoreId: SCORE, level: 'polish-gem' }, { scoreId: 'files:other.mxl', level: 'polish-diamond' }] };
  const pieceLog = { list: (user) => entries[user] ?? [] };
  const { piece } = deskFor({ a: [{ scoreKey: KEY, record: record() }] }, { pieceLog }).execute().players[0];
  assert.deepEqual(piece.polish, { gem: true, diamond: false });
  entries.a.push({ scoreId: SCORE, level: 'polish-diamond' });
  assert.deepEqual(deskFor({ a: [{ scoreKey: KEY, record: record() }] }, { pieceLog }).execute().players[0].piece.polish, { gem: true, diamond: true });
});

test('without a piece log, or when it cannot be read, a piece holds no Polish awards', () => {
  const desk = (pieceLog, logger) => deskFor({ a: [{ scoreKey: KEY, record: record() }] }, { pieceLog, logger }).execute().players[0].piece;
  assert.deepEqual(desk(undefined).polish, { gem: false, diamond: false });
  const warned = [];
  const piece = desk({ list: () => { throw new Error('disk'); } }, { warn: (event) => warned.push(event) });
  assert.deepEqual(piece.polish, { gem: false, diamond: false });
  assert.equal(piece.scoreId, SCORE);
  assert.deepEqual(warned, ['piano.desk.polish_unreadable']);
});


// A coached record whose passages are all Gold: the score-tempo step earned on each range.
function goldRecord(ranges, { sha = 'c', parts = ['rh', 'lh'] } = {}) {
  const plan = createCoachPlan({ scoreId: SCORE, fingerprint: sha,
    segments: ranges.map(([start, end]) => ({ id: `m${start}-${end}`, inMeasure: start, outMeasure: end, playableParts: parts })) });
  const achievements = Object.fromEntries(plan.tasks.filter((task) => task.mastery).map((task) => [task.key, { at: '2026-11-10T00:00:00Z', dayKey: '2026-11-10', provenance: 'demonstrated' }]));
  const summary = { total: ranges.length, silver: ranges.length, gold: ranges.length,
    passages: ranges.map(([start, end]) => ({ id: `m${start}-${end}`, start, end, parts, silver: 'x', gold: 'x' })) };
  return { fingerprint: { contentSha256: sha }, updatedAt: '2026-11-10T00:00:00Z',
    learnCoach: { version: 1, scoreId: SCORE, fingerprint: sha, revision: 1, achievements, counts: {}, evidence: [], reviews: {}, resume: null, summary } };
}
const learnDesk = (r, learnSegments) => new GetPianoDesk({
  learnSegments,
  datastore: { listPractice: () => [{ scoreKey: KEY, record: r }], listSheetMusicIds: () => [SCORE] },
  configProjection: { roster: () => ['a'], profile: (id) => ({ display_name: id }), raw: () => ({}) },
  clock: () => new Date('2026-11-18T20:00:00Z'), timezone: 'UTC',
}).execute().players[0].piece;
const shape = (piece) => piece.passages.map((p) => [p.id, p.start, p.end, p.state]);

test('approved segments replace the stored passages: kept ranges keep Gold, changed ones start over', () => {
  const calls = [];
  const piece = learnDesk(goldRecord([[0, 3], [4, 7]]), (id, sha) => { calls.push([id, sha]); return [{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 4, end: 9 }]; });
  assert.deepEqual(calls, [[SCORE, 'c']]);
  assert.deepEqual(shape(piece), [['a', 0, 3, 'gold'], ['b', 4, 9, 'todo']]);
  assert.deepEqual({ gold: piece.gold, total: piece.total }, { gold: 1, total: 2 });
});

test('without approved segments the stored passages stand', () => {
  const piece = learnDesk(goldRecord([[0, 3], [4, 7]]), () => null);
  assert.deepEqual(shape(piece), [['m0-3', 0, 3, 'gold'], ['m4-7', 4, 7, 'gold']]);
  assert.deepEqual({ gold: piece.gold, total: piece.total }, { gold: 2, total: 2 });
});

test('a one-hand piece keeps Gold on approved ranges it already holds, and only there', () => {
  const r = goldRecord([[0, 3], [4, 7]], { parts: ['rh'] });
  const same = learnDesk(r, () => [{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 4, end: 7 }]);
  assert.deepEqual({ gold: same.gold, total: same.total }, { gold: 2, total: 2 });
  const changed = learnDesk(r, () => [{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 4, end: 9 }]);
  assert.deepEqual(shape(changed), [['a', 0, 3, 'gold'], ['b', 4, 9, 'todo']]);
});

test('a new range takes the hands every saved passage agrees on', () => {
  const r = goldRecord([[0, 3], [4, 7]], { parts: ['rh'] });
  const piece = learnDesk(r, () => [{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 4, end: 9 }]);
  // One hand: the first step is "Find the notes", not the right hand alone.
  assert.equal(piece.next.passageId, 'b');
  assert.equal(piece.next.skill, 'silver');
});

test('a new range is two-handed when the saved passages disagree on hands', () => {
  const r = goldRecord([[0, 3], [4, 7]], { parts: ['rh'] });
  r.learnCoach.summary.passages[1].parts = ['rh', 'lh'];
  const piece = learnDesk(r, () => [{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 8, end: 9 }]);
  assert.equal(piece.next.passageId, 'b');
  assert.equal(piece.next.skill, 'silver');
});

test('hands the admin set on a segment win over the saved passage', () => {
  // Gold was earned two-handed on 0-3; the admin now says 0-3 is right hand only.
  const piece = learnDesk(goldRecord([[0, 3], [4, 7]]), () => [{ id: 'a', start: 0, end: 3, parts: ['rh'] }, { id: 'b', start: 4, end: 7 }]);
  assert.deepEqual(shape(piece), [['a', 0, 3, 'todo'], ['b', 4, 7, 'gold']]);
  assert.equal(piece.next.skill, 'silver');
});

test('a Learn file cut against other XML is ignored, end to end through the reader', () => {
  const r = goldRecord([[0, 3], [4, 7]]);
  const learnSegments = createLearnSegmentsReader({
    datastore: { getSheetMusicLearn: () => ({ contentSha256: 'not-c', segments: [{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 4, end: 9 }] }) },
    logger: { warn() { throw new Error('should not warn'); } },
  });
  assert.deepEqual(shape(learnDesk(r, learnSegments)), [['m0-3', 0, 3, 'gold'], ['m4-7', 4, 7, 'gold']]);
  const matching = createLearnSegmentsReader({
    datastore: { getSheetMusicLearn: () => ({ contentSha256: 'c', segments: [{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 4, end: 9 }] }) },
  });
  assert.deepEqual(shape(learnDesk(r, matching)), [['a', 0, 3, 'gold'], ['b', 4, 9, 'todo']]);
});

test('the desk applies the Gold ladder floor from the tempo the coach summary carries', () => {
  const segs = [{ id: 'a', inMeasure: 0, outMeasure: 3, playableParts: ['rh', 'lh'] }];
  const gold = (summary) => projectRecord({ record: record({ learnCoach: summary ? { summary } : undefined }), scoreId: SCORE, segments: segs, dayKey: '2026-11-18' })
    .segments[0].skills.filter((skill) => skill.track === 'gold').map((skill) => skill.skill);
  // 72 bpm: the slow rungs lift to 84% and merge into 85%, as on the kiosk.
  assert.deepEqual(gold({ baseBpm: 72 }), ['rhythm', 'timed-85-rh', 'timed-85-lh', 'timed-85', 'mastery']);
  // 100 bpm: 50% lifts to 60%.
  assert.deepEqual(gold({ baseBpm: 100 }), ['rhythm', 'timed-60-rh', 'timed-60-lh', 'timed-60', 'timed-70', 'timed-85', 'mastery']);
  // An older summary without a tempo keeps the configured speeds.
  assert.deepEqual(gold(null), ['rhythm', 'timed-50-rh', 'timed-50-lh', 'timed-50', 'timed-70', 'timed-85', 'mastery']);
});

test('forPlayer lists every piece with real progress, newest first, each projected like the strip', () => {
  const ids = ['files:docs/sheet-music/a.mxl', 'files:docs/sheet-music/b.mxl', 'files:docs/sheet-music/c.mxl', 'files:docs/sheet-music/browsed.mxl'];
  const entry = (id, updatedAt, passages) => ({ scoreKey: practiceKeyOfScore(id), record: record({ updatedAt, learn: { segments, passages } }) });
  const earned = { 'm0-4': { rungs: { right: { passCount: 6 } } } };
  const entries = [
    entry(ids[0], '2026-11-01T00:00:00Z', earned),
    entry(ids[1], '2026-11-10T00:00:00Z', { 'm0-4': { complete: true } }),
    entry(ids[2], '2026-11-05T00:00:00Z', earned),
    entry(ids[3], '2026-11-20T00:00:00Z', {}),
  ];
  const pieceLog = { list: () => [{ scoreId: ids[1], level: 'polish-gem' }] };
  const desk = deskFor({ a: entries, b: [] }, { ids, pieceLog });
  const player = desk.forPlayer('a');
  assert.equal(player.name, 'A');
  // The browsed piece is not offered; the rest come newest first.
  assert.deepEqual(player.pieces.map((p) => p.scoreId), [ids[1], ids[2], ids[0]]);
  assert.deepEqual({ total: player.pieces[0].total, silver: player.pieces[0].silver }, { total: 3, silver: 1 });
  assert.deepEqual(player.pieces[0].polish, { gem: true, diamond: false });
  // The first is exactly the piece the home strip shows.
  assert.deepEqual(player.pieces[0], desk.execute().players.find((p) => p.userId === 'a').piece);
  assert.deepEqual(desk.forPlayer('b').pieces, []);
  assert.equal(desk.forPlayer('stranger'), null);
});

test('forPlayer offers a score once when two records name it', () => {
  const state = (at) => ({ version: 1, scoreId: SCORE, fingerprint: 'c', revision: 1, achievements: {}, counts: {}, reviews: {}, resume: null,
    evidence: [{ id: 'e', at, task: { passageId: 'm0-4', mode: 'free', key: 'k' }, passedCredits: [], eligible: [] }] });
  const earned = { 'm0-4': { rungs: { right: { passCount: 6 } } } };
  const newer = { scoreKey: KEY, record: record({ learnCoach: state('2026-11-17T00:00:00Z'), learn: { segments, passages: earned } }) };
  const older = { scoreKey: 'old-key', record: record({ learnCoach: state('2026-11-02T00:00:00Z'), learn: { segments, passages: earned } }) };
  const { pieces } = deskFor({ a: [older, newer] }).forPlayer('a');
  assert.deepEqual(pieces.map((p) => [p.scoreId, p.practicedAt]), [[SCORE, '2026-11-17T00:00:00Z']]);
});

// ── Desk assignments (`sheetmusic.learners.<id>`): one learner's, never anyone else's ──
// 2026-11-24: one child's First Notes track (`collection`) was the only entry, the
// others tried its first score, and the newest-piece rule put that score on every
// child's card. These pin the rules that went wrong.
const TRACK = 'files:docs/sheet-music/first-notes';
const MIDDLE_C = `${TRACK}/01-middle-c.musicxml`;
const C_AND_D = `${TRACK}/02-c-and-d.musicxml`;
const CAROL = 'files:docs/sheet-music/christmas/carol.mxl';
const FUGUE = 'files:docs/sheet-music/classical/fugue.mxl';
const LIBRARY = [MIDDLE_C, C_AND_D, CAROL, FUGUE];
const practiced = (scoreId, at) => ({ scoreKey: practiceKeyOfScore(scoreId), record: record({ updatedAt: at, learnCoach: { version: 1, scoreId, fingerprint: 'c', revision: 1, achievements: {}, counts: {}, evidence: [], reviews: {}, resume: null }, learn: { segments, passages: PROGRESS } }) });
const learners = { little: { collection: TRACK }, reader: { piece: CAROL } };
const cardOf = (desk, userId) => desk.execute().players.find((p) => p.userId === userId).piece;

test("a track is its learner's: another child's newest piece inside it never takes their card", () => {
  const byUser = {
    little: [practiced(FUGUE, '2026-11-24T23:00:00Z')],
    other: [practiced(CAROL, '2026-11-24T10:00:00Z'), practiced(MIDDLE_C, '2026-11-24T22:00:00Z')],
  };
  const desk = deskFor(byUser, { ids: LIBRARY, sheetmusic: { learners: { little: { collection: TRACK } } } });
  assert.equal(cardOf(desk, 'other').scoreId, CAROL);
});

test('a learner with a track shows their newest piece in it, over a newer one outside it', () => {
  const byUser = { little: [practiced(FUGUE, '2026-11-24T23:00:00Z'), practiced(C_AND_D, '2026-11-24T20:00:00Z'), practiced(MIDDLE_C, '2026-11-24T19:00:00Z')] };
  assert.equal(cardOf(deskFor(byUser, { ids: LIBRARY, sheetmusic: { learners } }), 'little').scoreId, C_AND_D);
});

test("a learner with a track and nothing started in it shows the track's first score, fresh", () => {
  const byUser = { little: [practiced(FUGUE, '2026-11-24T23:00:00Z')] };
  const piece = cardOf(deskFor(byUser, { ids: [C_AND_D, MIDDLE_C, FUGUE], sheetmusic: { learners } }), 'little');
  assert.equal(piece.scoreId, MIDDLE_C);
  assert.equal(piece.fresh, true);
  assert.deepEqual({ total: piece.total, silver: piece.silver, passages: piece.passages, next: piece.next, practicedAt: piece.practicedAt }, { total: 0, silver: 0, passages: [], next: null, practicedAt: null });
});

test("a learner's assigned piece is their card, over newer practice, with its own progress", () => {
  const byUser = { reader: [practiced(MIDDLE_C, '2026-11-24T23:00:00Z'), practiced(CAROL, '2026-11-20T00:00:00Z')] };
  const piece = cardOf(deskFor(byUser, { ids: LIBRARY, sheetmusic: { learners } }), 'reader');
  assert.equal(piece.scoreId, CAROL);
  assert.equal(piece.total, 3);
  assert.equal(piece.fresh, undefined);
});

test('an assigned piece never practised is shown fresh; one not in the library is ignored', () => {
  const fresh = cardOf(deskFor({ reader: [] }, { ids: LIBRARY, sheetmusic: { learners } }), 'reader');
  assert.equal(fresh.scoreId, CAROL);
  assert.equal(fresh.fresh, true);
  const gone = cardOf(deskFor({ reader: [practiced(FUGUE, '2026-11-24T23:00:00Z')] }, { ids: [FUGUE], sheetmusic: { learners } }), 'reader');
  assert.equal(gone.scoreId, FUGUE);
});

test('an assignment is never anyone else\'s, and a catch-all key enrols nobody', () => {
  const warnings = [];
  const logger = { warn: (event, data) => warnings.push([event, data]) };
  const byUser = { a: [practiced(FUGUE, '2026-11-24T23:00:00Z')], reader: [] };
  const sheetmusic = { learners: { ...learners, '*': { piece: MIDDLE_C }, all: { collection: TRACK }, everyone: { piece: MIDDLE_C }, default: { piece: MIDDLE_C } } };
  const desk = deskFor(byUser, { roster: ['a', 'reader', 'little'], ids: LIBRARY, sheetmusic, logger });
  assert.equal(cardOf(desk, 'a').scoreId, FUGUE);
  assert.equal(cardOf(desk, 'reader').scoreId, CAROL);
  assert.deepEqual(warnings.filter(([e]) => e === 'piano.desk.learner-refused').map(([, d]) => d.key).sort(), ['*', 'all', 'default', 'everyone']);
});

test("the office picker's first piece is always the strip's card", () => {
  const byUser = { reader: [practiced(MIDDLE_C, '2026-11-24T23:00:00Z'), practiced(CAROL, '2026-11-20T00:00:00Z')], little: [practiced(FUGUE, '2026-11-24T23:00:00Z')] };
  const desk = deskFor(byUser, { ids: LIBRARY, sheetmusic: { learners } });
  assert.deepEqual(desk.forPlayer('reader').pieces.map((p) => p.scoreId), [CAROL, MIDDLE_C]);
  assert.deepEqual(desk.forPlayer('little').pieces.map((p) => p.scoreId), [MIDDLE_C, FUGUE]);
  assert.equal(desk.forPlayer('little').pieces[0].fresh, true);
});
