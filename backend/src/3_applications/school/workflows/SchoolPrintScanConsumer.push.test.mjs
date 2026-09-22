/**
 * The phone copy rides every grading-hook fire (2026-09-22 household push
 * notifications, Task 5). Home Assistant used to build the text from raw ids
 * and printed `None`; now the consumer composes it here, from the course's
 * catalog entry, the sheet's published title and the learner's display name.
 * The fire stays fire-and-forget: a missing or broken label source degrades
 * the copy, never the grade, the ceremony or the slip.
 */
import { describe, it, expect } from 'vitest';
import { createSchoolPrintScanConsumer } from './SchoolPrintScanConsumer.mjs';
import { findPushTextDefects } from '#domains/notification/push/pushText.mjs';

const settle = async () => { for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };

const row = (n, status, given = 'A') => ({ row: n, itemId: `q${n}`, itemType: 'multiple_choice', status, given: status === 'blank' ? null : given, points: 1, earned: status === 'correct' ? 1 : 0 });

/** The learner's card at 08:18: South Dakota rows 28-33, row 33 blank. */
const southDakota = () => ({
  cardId: '5278294', recordId: 'civilization/atlas/ws-ses-4jqdgpr5b3@ca29ac85c:v0:28-33',
  documentId: 'civilization/atlas/ws-ses-4jqdgpr5b3', rev: 'ca29ac85c', variant: 0, learnerId: 'user_4',
  sessionId: 'ses_4jqdgpr5b3', renderedAt: '2026-09-15T14:19:34.046Z', revisionSuperseded: false,
  subjectId: 'civilization', courseId: 'atlas',
  results: [row(28, 'correct'), row(29, 'correct'), row(30, 'correct'), row(31, 'correct'), row(32, 'correct'), row(33, 'blank')],
  totalPoints: 6, earnedPoints: 5, unscannedItems: [],
});

const CURRICULUM_IDS = { subjectId: 'civilization', courseId: 'atlas', unitId: null, lessonId: null };
const PARTIAL = () => ({ session: { reason: 'partial-scan', sessionId: 'ses_4jqdgpr5b3' }, curriculum: CURRICULUM_IDS });
const GRADED = () => ({
  session: { advancedTo: 'graded', sessionId: 'ses_4jqdgpr5b3', percent: 83.33, correctCount: 5, totalCount: 6 },
  curriculum: CURRICULUM_IDS,
});
const SETTLED = () => ({ result: 'passed', printed: true, remediationOf: null, studyDay: '2026-09-14' });

/**
 * An `IAsyncScheduler` fake with the same `withDeadline` semantics as
 * `NodeAsyncScheduler`, which also reports the timers it still holds.
 */
function fakeScheduler() {
  const pending = new Set();
  return {
    pending,
    withDeadline(work, { milliseconds } = {}) {
      let timer = null;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => { pending.delete(timer); reject(new Error('timed out')); }, milliseconds);
        pending.add(timer);
      });
      return Promise.race([Promise.resolve(work), deadline])
        .finally(() => { pending.delete(timer); clearTimeout(timer); });
    },
    every() { return () => {}; },
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

function harness({
  resolve = () => ({ results: [southDakota()] }),
  recordOutcome = GRADED,
  settleOutcome = SETTLED,
  labels = true,
  hook = true,
  scheduler = fakeScheduler(),
  ...overrides
} = {}) {
  let handler = null;
  const spoken = [];
  const fired = [];
  const warns = [];
  const printed = [];
  const reads = { getWork: [], studentName: [], getPublished: [] };
  const labelDeps = labels ? {
    curriculum: {
      async getWork(id) {
        reads.getWork.push(id);
        return id === 'civilization/atlas' ? { title: 'United States Regions and States', short_title: 'U.S. Atlas' } : null;
      },
    },
    studentName: (id) => { reads.studentName.push(id); return id === 'user_4' ? 'Learner4' : null; },
    today: () => '2026-09-15',
  } : {};
  createSchoolPrintScanConsumer({
    realtime: {
      onPrintSheet: (_config, cb) => { handler = cb; return () => {}; },
      printScanResolved: (announcement) => { spoken.push(announcement); },
    },
    resolveCardScan: { async execute() { return resolve(); } },
    recordCardScanOutcome: { async execute() { return recordOutcome(); } },
    closeSessionOutcome: { async execute() { return settleOutcome(); } },
    receipts: { async print(document) { printed.push(document); return { printed: true, reason: null }; } },
    printDocuments: {
      getPublished: (id, rev) => {
        reads.getPublished.push(`${id}@${rev}`);
        return id === 'civilization/atlas/ws-ses-4jqdgpr5b3' && rev === 'ca29ac85c' ? { title: 'South Dakota' } : null;
      },
    },
    gradingHook: hook ? { fire: (outcome) => { fired.push(outcome); } } : null,
    scheduler,
    logger: { info() {}, debug() {}, error() {}, warn: (event, data) => { warns.push({ event, data }); } },
    ...labelDeps,
    ...overrides,
  });
  return {
    spoken, fired, warns, reads, printed, scheduler,
    feed: async () => { handler({ testId: '5278294', answers: { 28: 'A' } }); await settle(); },
  };
}

const noDefects = (push) => {
  expect(findPushTextDefects(push.title)).toEqual([]);
  expect(findPushTextDefects(push.message)).toEqual([]);
};

describe('SchoolPrintScanConsumer — every hook fire carries the phone copy', () => {
  it('partial scan: names the child, course, sheet and the blank row', async () => {
    const { fired, feed } = harness({ recordOutcome: PARTIAL });
    await feed();
    expect(fired).toHaveLength(1);
    const { notification, ...rest } = fired[0];
    // Every key the hook already carried is still there, unchanged.
    expect(rest).toEqual({ result: 'partial', testId: '5278294', code: 'partial_scan', learnerId: 'user_4' });
    expect(notification).toMatchObject({
      title: '⚠️ Learner4 — U.S. Atlas: South Dakota',
      message: 'Row 33 blank — fill in and rescan',
    });
    expect(notification.data.tag).toBe('school-user_4-ses_4jqdgpr5b3');
    noDefects(notification);
  });

  it('graded + settled: score, and the study day of a late sheet', async () => {
    const { fired, feed } = harness();
    await feed();
    expect(fired).toHaveLength(1);
    const { notification, ...rest } = fired[0];
    expect(rest).toEqual({
      result: 'passed', testId: '5278294', learnerId: 'user_4', earned: 5, total: 6, percent: 83.33,
      sessionId: 'ses_4jqdgpr5b3', subject: 'civilization', course: 'atlas', unit: null, lesson: null,
    });
    expect(notification.title).toBe('✅ Learner4 — U.S. Atlas: South Dakota');
    expect(notification.message).toBe('5 of 6 correct · from Mon Sep 14');
    noDefects(notification);
  });

  it('a cleared retake says so', async () => {
    const { fired, feed } = harness({ settleOutcome: () => ({ ...SETTLED(), studyDay: '2026-09-15', remediationOf: 'ses_older' }) });
    await feed();
    expect(fired[0].notification.message).toBe('Retake: 5 of 6 correct');
  });

  it('Partial then Passed for the same session share one tag, so the phone replaces the first', async () => {
    const first = harness({ recordOutcome: PARTIAL });
    await first.feed();
    const second = harness();
    await second.feed();
    expect(first.fired[0].notification.data.tag).toBe('school-user_4-ses_4jqdgpr5b3');
    expect(second.fired[0].notification.data.tag).toBe(first.fired[0].notification.data.tag);
  });

  it('an unmarked old record sends nothing to the phone when other work on the card graded', async () => {
    const { fired, feed } = harness({
      resolve: () => ({ results: [southDakota()], silentLiveRecords: [{ learnerId: 'user_4', rowRange: { start: 34, end: 39 } }] }),
    });
    await feed();
    expect(fired).toHaveLength(2);
    const unmarked = fired.find((f) => f.code === 'live_record_unmarked');
    expect(unmarked).toMatchObject({ result: 'partial', testId: '5278294', silentLiveRecords: [{ learnerId: 'user_4', rowRange: { start: 34, end: 39 } }] });
    expect(unmarked).toHaveProperty('notification', null);
    const graded = fired.find((f) => f.result === 'passed');
    expect(graded.notification.title).toBe('✅ Learner4 — U.S. Atlas: South Dakota');
  });

  it('a throwing label dep cannot turn the suppressed unmarked-record push into one', async () => {
    const { fired, feed } = harness({
      resolve: () => ({ results: [southDakota()], silentLiveRecords: [{ learnerId: 'user_4', rowRange: { start: 34, end: 39 } }] }),
      studentName: () => { throw new Error('profile store down'); },
    });
    await feed();
    const unmarked = fired.find((f) => f.code === 'live_record_unmarked');
    expect(unmarked).toHaveProperty('notification', null);
  });

  it('the push and the ceremony share one published-title read', async () => {
    const { fired, spoken, reads, feed } = harness({ recordOutcome: PARTIAL });
    await feed();
    expect(spoken[0].title).toBe('South Dakota');
    expect(fired[0].notification.title).toBe('⚠️ Learner4 — U.S. Atlas: South Dakota');
    expect(reads.getPublished).toEqual(['civilization/atlas/ws-ses-4jqdgpr5b3@ca29ac85c']);
  });

  it('an unmarked record standing alone warns the phone with the row range', async () => {
    const { fired, spoken, feed } = harness({
      resolve: () => ({ results: [], silentLiveRecords: [{ learnerId: 'user_4', rowRange: { start: 34, end: 39 } }] }),
    });
    await feed();
    expect(spoken.map((a) => a.kind)).toEqual(['scan-rows-unmarked']);
    expect(fired).toHaveLength(1);
    expect(fired[0].code).toBe('live_record_unmarked');
    expect(fired[0].notification.title).toBe('⚠️ Learner4 — School card');
    expect(fired[0].notification.message).toContain('(rows 34–39)');
    noDefects(fired[0].notification);
  });

  it('unresolved: says the card number could not be read', async () => {
    const { fired, feed } = harness({ resolve: () => ({ error: { code: 'CARD_ID_UNREADABLE' } }) });
    await feed();
    expect(fired).toHaveLength(1);
    const { notification, ...rest } = fired[0];
    expect(rest).toEqual({ result: 'unresolved', testId: '5278294', code: 'CARD_ID_UNREADABLE' });
    expect(notification.message).toBe("The card number couldn't be read — rescan the card");
  });

  it('refused record: keeps its keys and gains readable copy', async () => {
    const refused = { ...southDakota(), error: { code: 'ALLOCATION_ROW_MAPPING_DRIFT' } };
    const { fired, feed } = harness({ resolve: () => ({ results: [refused] }) });
    await feed();
    expect(fired).toHaveLength(1);
    const { notification, ...rest } = fired[0];
    expect(rest).toEqual({ result: 'refused', testId: '5278294', code: 'ALLOCATION_ROW_MAPPING_DRIFT', learnerId: 'user_4' });
    expect(notification.title).toBe('⚠️ Learner4 — U.S. Atlas: South Dakota');
    noDefects(notification);
  });

  it('review: counts the answers waiting for a grown-up', async () => {
    const { fired, feed } = harness({
      recordOutcome: () => ({
        session: { reason: 'awaiting-review', sessionId: 'ses_4jqdgpr5b3', pendingReview: 2, reasons: ['ambiguous'], items: ['q30', 'q31'] },
        curriculum: CURRICULUM_IDS,
      }),
    });
    await feed();
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ result: 'review', pendingReview: 2, reasons: ['ambiguous'], items: ['q30', 'q31'] });
    expect(fired[0].notification.title).toBe('👀 Learner4 — U.S. Atlas: South Dakota');
    expect(fired[0].notification.message).toBe("2 answers need a grown-up's check — two answers filled in");
  });

  it('unknown and dead cards each carry copy', async () => {
    const unknown = harness({ resolve: () => ({ unknownCard: true, answeredRowCount: 3 }) });
    await unknown.feed();
    expect(unknown.fired[0]).toMatchObject({ result: 'unresolved', code: 'unknown_card' });
    expect(unknown.fired[0].notification.message).toBe("This card isn't one School printed — check it's the right card");
    const dead = harness({ resolve: () => ({ deadCard: true, answeredRowCount: 3, recordStatuses: [] }) });
    await dead.feed();
    expect(dead.fired[0]).toMatchObject({ result: 'unresolved', code: 'dead_card' });
    expect(dead.fired[0].notification.message).toBe('This card was already retired — print a fresh one');
  });

  it('missing label deps degrade to clean text, never ids', async () => {
    const { fired, feed } = harness({ labels: false });
    await feed();
    expect(fired).toHaveLength(1);
    const { notification } = fired[0];
    expect(notification.title).toBe('✅ South Dakota');
    expect(notification.message).toBe('5 of 6 correct');
    noDefects(notification);
  });

  it('a throwing label dep logs compose-failed and still sends the outcome, just without labels', async () => {
    const { fired, warns, spoken, feed } = harness({ studentName: () => { throw new Error('profile store down'); } });
    await feed();
    expect(spoken.map((a) => a.kind)).toEqual(['scan-graded']);
    expect(fired).toHaveLength(1);
    expect(fired[0].result).toBe('passed');
    // A passed sheet stays a pass on the progress lane — never "couldn't be graded".
    expect(fired[0].notification.title).toBe('✅ School card');
    expect(fired[0].notification.message).toBe('5 of 6 correct');
    expect(fired[0].notification.data.channel).toBe('School progress');
    // Same session tag as the real copy, so it replaces an earlier push for this sheet.
    expect(fired[0].notification.data.tag).toBe('school-user_4-ses_4jqdgpr5b3');
    expect(warns.find((w) => w.event === 'school.push.compose-failed')).toMatchObject({
      data: { testId: '5278294', kind: 'graded', error: 'profile store down' },
    });
  });

  it('a label lookup that never answers holds up neither the ceremony nor the siren', async () => {
    const { fired, spoken, printed, warns, feed } = harness({
      recordOutcome: PARTIAL,
      curriculum: { getWork: () => new Promise(() => {}) },
      pushLabelTimeoutMs: 100,
    });
    await feed();
    // The ceremony and the slip went out before the lookup was given up on.
    expect(spoken.map((a) => a.kind)).toEqual(['scan-rows-incomplete']);
    expect(printed).toHaveLength(1);
    expect(fired).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await settle();
    // The hook still fires (HA's siren branches on `result`), with fallback copy.
    expect(fired).toHaveLength(1);
    const { notification, ...rest } = fired[0];
    expect(rest).toEqual({ result: 'partial', testId: '5278294', code: 'partial_scan', learnerId: 'user_4' });
    // The outcome's own copy, minus the labels that never arrived.
    expect(notification.title).toBe('⚠️ School card');
    expect(notification.message).toBe('Row 33 blank — fill in and rescan');
    expect(notification.data.tag).toBe('school-user_4-ses_4jqdgpr5b3');
    expect(warns.find((w) => w.event === 'school.push.compose-timeout')).toMatchObject({
      data: { testId: '5278294', kind: 'partial' },
    });
  });

  it('a compose that wins the race leaves no timer behind', async () => {
    const { fired, scheduler, feed } = harness({ recordOutcome: PARTIAL, pushLabelTimeoutMs: 60_000 });
    await feed();
    expect(fired).toHaveLength(1);
    expect(fired[0].notification.title).toBe('⚠️ Learner4 — U.S. Atlas: South Dakota');
    expect(scheduler.pending.size).toBe(0);
  });

  it('no grading hook: no catalog or name reads at all', async () => {
    const { reads, spoken, feed } = harness({ hook: false, recordOutcome: PARTIAL });
    await feed();
    expect(spoken.map((a) => a.kind)).toEqual(['scan-rows-incomplete']);
    expect(reads.getWork).toEqual([]);
    expect(reads.studentName).toEqual([]);
  });
});
