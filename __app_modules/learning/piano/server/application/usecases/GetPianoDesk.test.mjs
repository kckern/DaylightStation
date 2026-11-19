import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetPianoDesk, practiceKeyOfScore } from './GetPianoDesk.mjs';

const SCORE = 'files:docs/sheet-music/christmas/piece.mxl';
const KEY = practiceKeyOfScore(SCORE);
const segments = { 'm0-4': {}, 'm5-8': {}, 'm9-12': {} };
const record = (over = {}) => ({ fingerprint: { contentSha256: 'c' }, updatedAt: '2026-11-01T00:00:00Z', learn: { segments, passages: {} }, ...over });
const deskFor = (byUser, { roster = Object.keys(byUser), ids = [SCORE] } = {}) => new GetPianoDesk({
  datastore: { listPractice: (user) => byUser[user] ?? [], listSheetMusicIds: () => ids },
  configProjection: { roster: () => roster, profile: (id) => ({ display_name: id.toUpperCase() }), raw: () => ({}) },
  clock: () => new Date('2026-11-18T20:00:00Z'), timezone: 'UTC',
});

test('shows the most recently practiced piece with its next step', () => {
  const older = { scoreKey: practiceKeyOfScore('files:docs/sheet-music/older.mxl'), record: record({ updatedAt: '2026-01-01T00:00:00Z' }) };
  const current = { scoreKey: KEY, record: record({ learn: { segments, passages: { 'm0-4': { rungs: { right: { passCount: 6 } } } } } }) };
  const { players } = deskFor({ a: [older, current] }, { ids: [SCORE, 'files:docs/sheet-music/older.mxl'] }).execute();
  assert.equal(players[0].piece.scoreId, SCORE);
  assert.equal(players[0].name, 'A');
  assert.deepEqual(players[0].piece.next, { passageId: 'm0-4', skill: 'left', label: 'Find the left-hand notes', start: 0, end: 4 });
  assert.deepEqual(players[0].piece.passages.map((p) => p.state), ['learning', 'todo', 'todo']);
  assert.deepEqual(players[0].piece.passages[0].steps, { done: 1, total: 4 });
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
  const r = record({ learn: {}, learnCoach: { version: 1, scoreId: SCORE, fingerprint: 'c', revision: 1, achievements: {}, counts: {}, evidence: [], reviews: {}, resume: null, summary } });
  const { piece } = deskFor({ a: [{ scoreKey: KEY, record: r }] }).execute().players[0];
  assert.deepEqual(piece.passages.map((p) => [p.id, p.start, p.end]), [['intro', 0, 3], ['tune', 4, 7]]);
  assert.deepEqual(piece.next, { passageId: 'intro', skill: 'notes', label: 'Find the notes', start: 0, end: 3 });
});

test('treats an older plan as two-handed, since its rungs cannot tell', () => {
  const r = record({ learn: { segments: { 'm0-3': {} }, passages: { 'm0-3': { rungs: { 'test-out': { passCount: 0 } } } } } });
  assert.equal(deskFor({ a: [{ scoreKey: KEY, record: r }] }).execute().players[0].piece.next.skill, 'right');
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
