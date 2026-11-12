import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YamlUserVideoProgressStore } from './YamlUserVideoProgressStore.mjs';
import { YamlLessonSittingLog } from './YamlLessonSittingLog.mjs';

const USER = 'test-learner';
const ADULT = 'test-adult';
let root;
let piano;

function configService() {
  return {
    getUserProfile: (id) => ([USER, ADULT].includes(id) ? { id } : null),
    getUserDir: (id) => path.join(root, id),
    getHouseholdAppConfig: () => piano,
  };
}
const expectations = (records) => ({ get: (id) => records[String(id).replace(/^plex:/, '')] ?? null });
const EXP = { '100': { plexId: '100', source: 'ai', targetNpm: 10, showKey: '7', seasonKey: '70' }, '200': { plexId: '200', source: 'ai', targetNpm: 0, showKey: '7' }, '300': { plexId: '300', source: 'ai', targetNpm: 10, showKey: '8', seasonKey: '80' } };
const practice = (sittingId, practiceNotes, playedSec, extra = {}) => ({ sittingId, humanNotes: practiceNotes, practiceNotes, playedSec, drillsPassed: 0, checkIns: 0, scaleCheckIns: 0, penalties: {}, ...extra });

function make({ records = EXP, judgements = null, withLog = true } = {}) {
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), sampled: vi.fn() };
  const sittingLog = withLog ? new YamlLessonSittingLog({ configService: configService(), logger }) : null;
  const store = new YamlUserVideoProgressStore({ configService: configService(), logger, lessonExpectations: expectations(records), sittingLog, legitJudgements: judgements });
  return { store, sittingLog, logger };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'uvps-credit-'));
  piano = { videos: { completion_threshold_percent: 90, user_policies: { [ADULT]: { engagement_gate: false } }, practice: {} } };
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('progress store: good-faith credit', () => {
  it('no record → today\'s rule', () => {
    const { store } = make({ records: {} });
    const e = store.record({ userId: USER, plexId: '999', percent: 95, engaged: true, practice: practice('s1', 0, 600) });
    expect(e.completedAt).toBeTruthy();
    expect(e.credit.outcome).toBe('unenforced');
  });

  it('a gate-off user gets today\'s rule', () => {
    const { store } = make();
    const e = store.record({ userId: ADULT, plexId: '100', percent: 95, engaged: true, practice: practice('s1', 0, 600) });
    expect(e.completedAt).toBeTruthy();
  });

  it('no practice with legacy unset → today\'s rule (RF1)', () => {
    const { store } = make();
    const e = store.record({ userId: USER, plexId: '100', percent: 95, engaged: true });
    expect(e.completedAt).toBeTruthy();
    expect(e.credit.outcome).toBe('legacy');
  });

  it('no practice with legacy false → drill-owed, score 0', () => {
    piano.videos.practice.legacy_clients = false;
    const { store } = make();
    const e = store.record({ userId: USER, plexId: '100', percent: 95, engaged: true });
    expect(e.completedAt).toBeNull();
    expect(e.credit).toMatchObject({ outcome: 'drill-owed', score: 0 });
  });

  it('a target-0 lesson is credited on engaged', () => {
    const { store } = make();
    expect(store.record({ userId: USER, plexId: '200', percent: 95, engaged: true, practice: practice('s1', 0, 600) }).completedAt).toBeTruthy();
  });

  it('score ≥ 6 → completedAt and credited', () => {
    const { store } = make();
    const e = store.record({ userId: USER, plexId: '100', percent: 95, engaged: true, practice: practice('s1', 70, 600) });
    expect(e.completedAt).toBeTruthy();
    expect(e.credit).toMatchObject({ outcome: 'credited', score: 7, source: 'ai' });
    expect(e.newlyCompleted).toBe(true);
  });

  it('the same sittingId posted 3 times keeps the max (RF4)', () => {
    const { store } = make();
    store.record({ userId: USER, plexId: '100', percent: 40, engaged: true, practice: practice('s1', 20, 200) });
    store.record({ userId: USER, plexId: '100', percent: 60, engaged: true, practice: practice('s1', 40, 400) });
    const e = store.record({ userId: USER, plexId: '100', percent: 95, engaged: true, practice: practice('s1', 40, 600) });
    expect(Object.keys(e.practice.sittings)).toEqual(['s1']);
    expect(e.practice.sittings.s1).toMatchObject({ practiceNotes: 40, playedSec: 600 });
    expect(e.credit.score).toBe(4);
  });

  it('two sittings on two days bank together (RF2)', () => {
    const { store } = make();
    store.record({ userId: USER, plexId: '100', percent: 50, engaged: true, practice: practice('day1', 40, 300) });
    const e = store.record({ userId: USER, plexId: '100', percent: 95, engaged: true, practice: practice('day2', 40, 300) });
    expect(e.credit).toMatchObject({ outcome: 'credited', score: 8 });
  });

  it('score 3 → 4-rep drill, no completedAt, rotation advances; passing it → credited-after-drills', () => {
    const { store } = make();
    const e = store.record({ userId: USER, plexId: '100', percent: 95, engaged: true, practice: practice('s1', 30, 600) });
    expect(e.completedAt).toBeNull();
    expect(e.credit).toMatchObject({ outcome: 'drill-owed', score: 3 });
    expect(e.credit.drill.reps).toBe(4);
    expect(e.practice.rotation).toBe(1);
    const again = store.record({ userId: USER, plexId: '100', percent: 95, engaged: true, practice: practice('s1', 30, 600, { drillsPassed: 2 }) });
    expect(again.practice.rotation).toBe(1);
    expect(again.completedAt).toBeNull();
    const done = store.record({ userId: USER, plexId: '100', percent: 95, engaged: true, practice: practice('s1', 30, 600, { drillsPassed: 4 }) });
    expect(done.credit.outcome).toBe('credited-after-drills');
    expect(done.newlyCompleted).toBe(true);
  });

  it('an existing completedAt is kept and never re-judged', () => {
    const { store } = make();
    const first = store.record({ userId: USER, plexId: '100', percent: 95, engaged: true, practice: practice('s1', 100, 600) });
    const later = store.record({ userId: USER, plexId: '100', percent: 95, engaged: true, practice: practice('s2', 0, 600) });
    expect(later.completedAt).toBe(first.completedAt);
    expect(later.credit.outcome).toBe('credited');
  });

  it('enrich: drill-owed is not watched, carries userCredit', () => {
    const { store } = make();
    store.record({ userId: USER, plexId: '100', percent: 95, engaged: true, practice: practice('s1', 10, 600) });
    const [item] = store.enrich([{ id: 'plex:100' }], USER);
    expect(item.userWatched).toBe(false);
    expect(item.userCredit.outcome).toBe('drill-owed');
    expect(store.summarize([{ id: 'plex:100' }], USER).completed).toBe(0);
  });

  it('borderline score uses the cached end-of-lesson judgement', () => {
    const judgements = { get: vi.fn(() => ({ probability: 0.85, source: 'model' })) };
    const { store } = make({ judgements });
    const e = store.record({ userId: USER, plexId: '100', percent: 95, engaged: true, practice: practice('s1', 55, 600) });
    expect(judgements.get).toHaveBeenCalledWith({ userId: USER, sittingId: 's1', kind: 'end-of-lesson' });
    expect(e.credit).toMatchObject({ outcome: 'credited', reviewed: true, reviewProbability: 0.85 });
  });

  it('a preschool course passes at 3 and owes a gentle drill below it', () => {
    piano.videos.practice.preschool_courses = ['plex:7'];
    const { store } = make();
    expect(store.record({ userId: USER, plexId: '100', percent: 95, engaged: true, practice: practice('s1', 30, 600) }).credit.outcome).toBe('credited');
    const e = store.record({ userId: USER, plexId: '100', percent: 95, engaged: true, practice: practice('s9', 0, 0) });
    expect(e.credit.outcome).toBe('credited');
    piano.videos.practice.preschool_courses = ['plex:80'];   // a course listed by season
    const { store: s2 } = make();
    const d = s2.record({ userId: USER, plexId: '300', percent: 95, engaged: true, practice: practice('t1', 10, 600) });
    expect(d.credit).toMatchObject({ outcome: 'drill-owed', score: 1 });
    expect(d.credit.drill.spec.kind).toBe('gentle');
  });

  it('the sitting log upserts one row per sitting and lists newest first', () => {
    const { store, sittingLog } = make();
    store.record({ userId: USER, plexId: '100', percent: 40, engaged: true, practice: practice('s1', 10, 100), title: 'Lesson A' });
    store.record({ userId: USER, plexId: '100', percent: 95, engaged: true, practice: practice('s1', 30, 600, { checkIns: 2, scaleCheckIns: 1 }), title: 'Lesson A' });
    store.record({ userId: USER, plexId: '200', percent: 95, engaged: true, practice: practice('s2', 0, 300), title: 'Lesson B' });
    const rows = sittingLog.list(USER, {});
    expect(rows.map((r) => r.sittingId)).toEqual(['s2', 's1']);
    expect(rows[1]).toMatchObject({ plexId: 'plex:100', title: 'Lesson A', percent: 95, practiceNotes: 30, score: 3, outcome: 'drill-owed', drillReps: 4, checkIns: 2, scaleCheckIns: 1, targetNpm: 10, expectationSource: 'ai' });
  });

  it('the sitting log caps at 300 rows', () => {
    const { sittingLog } = make();
    for (let i = 0; i < 305; i++) sittingLog.upsert(USER, { sittingId: `s${i}`, updatedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() });
    const rows = sittingLog.list(USER, {});
    expect(rows).toHaveLength(300);
    expect(rows[0].sittingId).toBe('s304');
  });

  it('a store with no expectation source (School) behaves exactly as before', () => {
    const plain = new YamlUserVideoProgressStore({ configService: configService(), logger: { info() {} } });
    const e = plain.record({ userId: USER, plexId: '100', percent: 95, engaged: true, practice: practice('s1', 0, 600) });
    expect(e.completedAt).toBeTruthy();
    expect(e.credit).toBeUndefined();
    expect(e.practice).toBeUndefined();
  });

  it('enrich carries the kiosk expectation only when a record exists', () => {
    piano.videos.practice.preschool_courses = ['plex:80'];
    const { store } = make();
    const [a, b, c] = store.enrich([{ id: 'plex:100' }, { id: 'plex:999' }, { plex: '300' }], USER);
    expect(a.expectation).toEqual({ targetNpm: 10, source: 'ai', preschool: false });
    expect(b.expectation).toBeUndefined();
    expect(c.expectation).toEqual({ targetNpm: 10, source: 'ai', preschool: true });
  });
  it('a rewatch that lowers the stored percent never blocks a warm-up from crediting (review C1)', () => {
    const { store } = make();
    expect(store.record({ userId: USER, plexId: '100', percent: 95, engaged: true, practice: practice('s1', 30, 600) }).credit.outcome).toBe('drill-owed');
    store.record({ userId: USER, plexId: '100', percent: 30, engaged: true, practice: practice('s2', 0, 60) });
    const done = store.record({ userId: USER, plexId: '100', percent: 30, engaged: true, practice: practice('warm', 0, 0, { drillsPassed: 4 }) });
    expect(done.credit.outcome).toBe('credited-after-drills');
    expect(done.completedAt).toBeTruthy();
  });
});
