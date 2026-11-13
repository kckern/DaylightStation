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
// Expectation records are only the course index now (membership + show/season
// for preschool mode); their targets and ratings never decide credit.
const EXP = { '100': { plexId: '100', source: 'ai', targetNpm: 40, showKey: '7', seasonKey: '70' }, '200': { plexId: '200', source: 'default', targetNpm: 0, showKey: '7' }, '300': { plexId: '300', source: 'ai', targetNpm: 40, showKey: '8', seasonKey: '80' }, '301': { plexId: '301', source: 'ai', targetNpm: 40, showKey: '8', seasonKey: '80' } };
const practice = (sittingId, practiceNotes, playedSec, extra = {}) => ({ sittingId, humanNotes: practiceNotes, practiceNotes, playedSec, drillsPassed: 0, checkIns: 0, checkInsAnswered: 0, scaleCheckIns: 0, penalties: {}, ...extra });
const STATE = { lesson: { lengthMin: 10, watchedMin: 9 }, presence: { log: [] }, perMinute: [1], notes: [{ pitch: 60, onsetMs: 0, durMs: 200, velocity: 60 }] };

/** A judge double: scores by sitting id; peek answers once judge() resolved. */
function fakeJudge(scores = {}) {
  const done = new Map();
  return {
    judge: vi.fn(async ({ userId, sittingId }) => {
      const r = sittingId in scores ? { score: scores[sittingId], source: 'model' } : { score: null, source: 'fallback' };
      done.set(`${userId}|${sittingId}`, r);
      return r;
    }),
    peek: vi.fn(({ userId, sittingId }) => done.get(`${userId}|${sittingId}`) ?? null),
  };
}

function make({ records = EXP, judge = null, withLog = true } = {}) {
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), sampled: vi.fn() };
  const sittingLog = withLog ? new YamlLessonSittingLog({ configService: configService(), logger }) : null;
  const store = new YamlUserVideoProgressStore({ configService: configService(), logger, lessonExpectations: expectations(records), sittingLog, sittingJudge: judge });
  return { store, sittingLog, logger };
}

/** The play/log path: prepareCredit (the judge, bounded) then record. */
async function post(store, args) {
  await store.prepareCredit({ userId: args.userId, plexId: args.plexId, practice: args.practice });
  return store.record(args);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'uvps-credit-'));
  piano = { videos: { completion_threshold_percent: 90, user_policies: { [ADULT]: { engagement_gate: false } }, practice: {} } };
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('progress store: session good-faith credit', () => {
  it('a sitting keeps the rubric version of its judgement next to the score', async () => {
    const judge = fakeJudge({ s1: 8 });
    judge.peek = vi.fn(() => ({ score: 8, source: 'model', rubricVersion: 2 }));
    const { store } = make({ judge });
    const e = await post(store, { userId: USER, plexId: '100', percent: 95, engaged: true, practice: practice('s1', 40, 600, { goodFaith: STATE }) });
    expect(e.practice.sittings.s1).toMatchObject({ goodFaith: 8, goodFaithRubric: 2 });
  });

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
    expect(e.credit.outcome).toBe('unenforced');
  });

  it('no practice with legacy unset → today\'s rule', () => {
    const { store } = make();
    const e = store.record({ userId: USER, plexId: '100', percent: 95, engaged: true });
    expect(e.completedAt).toBeTruthy();
    expect(e.credit.outcome).toBe('legacy');
  });

  it('no practice with legacy false → nothing to go on: the smallest-evidence drill', () => {
    piano.videos.practice.legacy_clients = false;
    const { store } = make();
    const e = store.record({ userId: USER, plexId: '100', percent: 95, engaged: true });
    expect(e.completedAt).toBeNull();
    expect(e.credit).toMatchObject({ outcome: 'drill-owed', score: 0, source: 'fallback' });
  });

  it('a judged sitting at 6+ credits — the lesson\'s rating and target are never read', async () => {
    const judge = fakeJudge({ s1: 7.4 });
    const { store } = make({ judge });
    const e = await post(store, { userId: USER, plexId: '100', percent: 95, engaged: true, practice: { ...practice('s1', 10, 600), goodFaith: STATE } });
    expect(e.completedAt).toBeTruthy();
    expect(e.credit).toMatchObject({ outcome: 'credited', score: 7.4, source: 'model' });
    expect(e.credit).not.toHaveProperty('targetNpm');
    expect(e.practice.sittings.s1).toMatchObject({ goodFaith: 7.4 });
    expect(e.newlyCompleted).toBe(true);
  });

  it('a judged score below 6 owes the drill sized from it; passing the reps credits', async () => {
    const judge = fakeJudge({ s1: 3.6 });
    const { store } = make({ judge });
    const e = await post(store, { userId: USER, plexId: '100', percent: 95, engaged: true, practice: { ...practice('s1', 200, 600), goodFaith: STATE } });
    expect(e.completedAt).toBeNull();
    expect(e.credit).toMatchObject({ outcome: 'drill-owed', score: 3.6, source: 'model' });
    expect(e.credit.drill.reps).toBe(4);
    expect(e.practice.rotation).toBe(1);
    // Later posts (no state) keep the stored judgement.
    const again = store.record({ userId: USER, plexId: '100', percent: 96, engaged: true, practice: practice('s1', 200, 610, { drillsPassed: 2 }) });
    expect(again.practice.rotation).toBe(1);
    expect(again.credit.score).toBe(3.6);
    const done = store.record({ userId: USER, plexId: '100', percent: 96, engaged: true, practice: practice('s1', 200, 610, { drillsPassed: 4 }) });
    expect(done.credit.outcome).toBe('credited-after-drills');
    expect(done.newlyCompleted).toBe(true);
  });

  it('no judgement: the lenient rule — meaningful playing or an answered check-in credits', async () => {
    const { store } = make({ judge: fakeJudge({}) });
    expect((await post(store, { userId: USER, plexId: '100', percent: 95, engaged: true, practice: { ...practice('a', 6, 600), goodFaith: STATE } })).credit)
      .toMatchObject({ outcome: 'credited', source: 'fallback' });
    expect(store.record({ userId: USER, plexId: '300', percent: 95, engaged: true, practice: practice('b', 0, 600, { checkInsAnswered: 2 }) }).credit.outcome).toBe('credited');
    const d = store.record({ userId: USER, plexId: '200', percent: 95, engaged: true, practice: practice('c', 2, 600) });
    expect(d.credit).toMatchObject({ outcome: 'drill-owed', source: 'fallback', score: 0 });
  });

  it('prepareCredit asks the judge once per sitting with the server\'s preschool flag; never throws', async () => {
    piano.videos.practice.preschool_courses = ['plex:80'];
    const judge = fakeJudge({ t1: 5 });
    const { store } = make({ judge });
    await store.prepareCredit({ userId: USER, plexId: '300', practice: { ...practice('t1', 1, 60), goodFaith: { ...STATE, lesson: { ...STATE.lesson, preschool: false } } } });
    expect(judge.judge).toHaveBeenCalledWith(expect.objectContaining({ userId: USER, sittingId: 't1', preschool: true, state: expect.objectContaining({ notes: STATE.notes }) }));
    // Not enforced, no state, a guest-less store or a failing judge: nothing asked, nothing thrown.
    await store.prepareCredit({ userId: USER, plexId: '999', practice: { ...practice('x', 1, 60), goodFaith: STATE } });
    await store.prepareCredit({ userId: USER, plexId: '100', practice: practice('y', 1, 60) });
    await store.prepareCredit({ userId: ADULT, plexId: '100', practice: { ...practice('z', 1, 60), goodFaith: STATE } });
    expect(judge.judge).toHaveBeenCalledTimes(1);
    const bad = { judge: vi.fn(async () => { throw new Error('boom'); }), peek: () => null };
    const { store: s2 } = make({ judge: bad });
    await expect(s2.prepareCredit({ userId: USER, plexId: '100', practice: { ...practice('w', 1, 60), goodFaith: STATE } })).resolves.toBeUndefined();
  });

  it('an existing completedAt is kept and never re-judged', async () => {
    const { store } = make({ judge: fakeJudge({ s1: 9, s2: 0 }) });
    const first = await post(store, { userId: USER, plexId: '100', percent: 95, engaged: true, practice: { ...practice('s1', 100, 600), goodFaith: STATE } });
    const later = await post(store, { userId: USER, plexId: '100', percent: 95, engaged: true, practice: { ...practice('s2', 0, 600), goodFaith: STATE } });
    expect(later.completedAt).toBe(first.completedAt);
    expect(later.credit.outcome).toBe('credited');
  });

  it('enrich: drill-owed is not watched, carries userCredit; the kiosk gets enforcement + preschool, no target', async () => {
    piano.videos.practice.preschool_courses = ['plex:80'];
    const { store } = make({ judge: fakeJudge({ s1: 1 }) });
    await post(store, { userId: USER, plexId: '100', percent: 95, engaged: true, practice: { ...practice('s1', 10, 600), goodFaith: STATE } });
    const [item, none, pre] = store.enrich([{ id: 'plex:100' }, { id: 'plex:999' }, { plex: '300' }], USER);
    expect(item.userWatched).toBe(false);
    expect(item.userCredit.outcome).toBe('drill-owed');
    expect(item.expectation).toEqual({ enforced: true, preschool: false });
    expect(none.expectation).toBeUndefined();
    expect(pre.expectation).toEqual({ enforced: true, preschool: true });
    expect(store.summarize([{ id: 'plex:100' }], USER).completed).toBe(0);
  });

  it('enrich: the kiosk expectation carries valid drill_roots only when configured', () => {
    piano.videos.practice.drill_roots = ['D', 'A', 'x'];
    const { store } = make();
    const [item] = store.enrich([{ id: 'plex:100' }], USER);
    expect(item.expectation).toEqual({ enforced: true, preschool: false, drillRoots: ['D', 'A'] });
    delete piano.videos.practice.drill_roots;
    const [plain] = store.enrich([{ id: 'plex:100' }], USER);
    expect(plain.expectation).not.toHaveProperty('drillRoots');
  });

  it('a preschool course passes at 3 and owes a gentle drill below it', async () => {
    piano.videos.practice.preschool_courses = ['plex:80'];
    const { store } = make({ judge: fakeJudge({ t1: 3.2, t2: 1.5 }) });
    expect((await post(store, { userId: USER, plexId: '300', percent: 95, engaged: true, practice: { ...practice('t1', 10, 600), goodFaith: STATE } })).credit.outcome).toBe('credited');
    const d = await post(store, { userId: USER, plexId: '301', percent: 95, engaged: true, practice: { ...practice('t2', 10, 600), goodFaith: STATE } });
    expect(d.credit).toMatchObject({ outcome: 'drill-owed', score: 1.5, preschool: true });
    expect(d.credit.drill.spec.kind).toBe('gentle');
  });

  it('the sitting log upserts one row per sitting and lists newest first', async () => {
    const { store, sittingLog } = make({ judge: fakeJudge({ s1: 3 }) });
    store.record({ userId: USER, plexId: '100', percent: 40, engaged: true, practice: practice('s1', 10, 100), title: 'Lesson A' });
    await post(store, { userId: USER, plexId: '100', percent: 95, engaged: true, practice: { ...practice('s1', 30, 600, { checkIns: 2, checkInsAnswered: 2, scaleCheckIns: 1 }), goodFaith: STATE }, title: 'Lesson A' });
    store.record({ userId: USER, plexId: '200', percent: 95, engaged: true, practice: practice('s2', 0, 300), title: 'Lesson B' });
    const rows = sittingLog.list(USER, {});
    expect(rows.map((r) => r.sittingId)).toEqual(['s2', 's1']);
    expect(rows[1]).toMatchObject({ plexId: 'plex:100', title: 'Lesson A', percent: 95, practiceNotes: 30, score: 3, scoreSource: 'model', outcome: 'drill-owed', drillReps: 4, checkIns: 2, scaleCheckIns: 1 });
    expect(rows[1]).not.toHaveProperty('targetNpm');
    expect(rows[0]).toMatchObject({ outcome: 'drill-owed', scoreSource: 'fallback', score: 0 });
  });

  it('the sitting log caps at 300 rows', () => {
    const { sittingLog } = make();
    for (let i = 0; i < 305; i++) sittingLog.upsert(USER, { sittingId: `s${i}`, updatedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() });
    const rows = sittingLog.list(USER, {});
    expect(rows).toHaveLength(300);
    expect(rows[0].sittingId).toBe('s304');
  });

  it('a store with no expectation source (School) behaves exactly as before', async () => {
    const plain = new YamlUserVideoProgressStore({ configService: configService(), logger: { info() {} } });
    await plain.prepareCredit({ userId: USER, plexId: '100', practice: { ...practice('s1', 0, 600), goodFaith: STATE } });
    const e = plain.record({ userId: USER, plexId: '100', percent: 95, engaged: true, practice: practice('s1', 0, 600) });
    expect(e.completedAt).toBeTruthy();
    expect(e.credit).toBeUndefined();
    expect(e.practice).toBeUndefined();
  });

  it('a rewatch that lowers the stored percent never blocks a warm-up from crediting (review C1)', async () => {
    const { store } = make({ judge: fakeJudge({ s1: 3 }) });
    expect((await post(store, { userId: USER, plexId: '100', percent: 95, engaged: true, practice: { ...practice('s1', 30, 600), goodFaith: STATE } })).credit.outcome).toBe('drill-owed');
    store.record({ userId: USER, plexId: '100', percent: 30, engaged: true, practice: practice('s2', 0, 60) });
    const done = store.record({ userId: USER, plexId: '100', percent: 30, engaged: true, practice: practice('warm', 0, 0, { drillsPassed: 4 }) });
    expect(done.credit.outcome).toBe('credited-after-drills');
    expect(done.completedAt).toBeTruthy();
  });
});
