import { composeSchoolPush } from "./schoolPush.mjs";
import { findPushTextDefects } from '#domains/notification/push/pushText.mjs';

const base = { learnerId: 'user_4', child: 'Learner4', testId: '5278294', sessionId: 'ses_a' };
const labels = { course: 'U.S. Atlas', lesson: 'New York' };

const CASES = [
  ['passed', { ...base, ...labels, kind: 'graded', result: 'passed', earned: 6, total: 6 },
    { title: '✅ Learner4 — U.S. Atlas: New York', message: '6 of 6 correct', channel: 'School progress' }],
  ['passed, late', { ...base, ...labels, kind: 'graded', result: 'passed', earned: 4, total: 5, studyDay: '2026-09-14', today: '2026-09-20' },
    { message: '4 of 5 correct · from Mon Sep 14' }],
  ['retake cleared', { ...base, ...labels, kind: 'graded', result: 'passed', earned: 3, total: 3, retake: true },
    { title: '✅ Learner4 — U.S. Atlas: New York', message: 'Retake: 3 of 3 correct' }],
  ['needs remediation', { ...base, ...labels, kind: 'graded', result: 'needs_remediation', earned: 2, total: 6 },
    { title: '🔁 Learner4 — U.S. Atlas: New York', message: '2 of 6 correct — retake is on the receipt', channel: 'School needs you' }],
  ['review', { ...base, ...labels, kind: 'review', pendingReview: 2, reasons: ['ambiguous'] },
    { title: '👀 Learner4 — U.S. Atlas: New York', message: "2 answers need a grown-up's check — two answers filled in" }],
  ['partial', { ...base, ...labels, kind: 'partial', blankRows: [4, 6], ambiguousRows: [] },
    { title: '⚠️ Learner4 — U.S. Atlas: New York', message: 'Rows 4 and 6 blank — fill in and rescan' }],
  ['partial, double mark', { ...base, ...labels, kind: 'partial', blankRows: [], ambiguousRows: [3] },
    { message: 'Row 3 has two marks — fill in and rescan' }],
  ['unmarked, alone', { testId: '5278294', kind: 'unmarked', rowRanges: [{ start: 34, end: 39 }], otherWorkGraded: false },
    { title: '⚠️ Unknown card — School card', message: "Nothing new was marked on this card (rows 34–39) — fill in today's rows and rescan" }],
  ['unresolved, known code', { testId: '1', kind: 'unresolved', code: 'CARD_ID_UNREADABLE' },
    { title: '⚠️ Unknown card — School card', message: "The card number couldn't be read — rescan the card" }],
  ['refused, unknown code', { ...base, ...labels, kind: 'refused', code: 'SOMETHING_NEW' },
    { message: "Card couldn't be graded — check the School teacher view" }],
  ['piano', { learnerId: 'user_4', child: 'Learner4', kind: 'piano', lesson: 'How to Play “Lavender’s Blue”', studyDay: '2026-09-21', unitProgress: { label: 'Folk Songs', completed: 3, total: 8 } },
    { title: '🎹 Learner4 — How to Play “Lavender’s Blue”', message: 'Piano lesson done · Folk Songs: 3 of 8 lessons', channel: 'School progress' }],
  ['piano, lesson title ending in ?', { learnerId: 'user_4', child: 'Learner4', kind: 'piano', lesson: 'What Are Flats in Music?' },
    { title: '🎹 Learner4 — What Are Flats in Music?', message: 'Piano lesson done' }],
  ['card ladder concern, with a note', { learnerId: 'user_4', child: 'Learner4', kind: 'card-ladder', package: 'lang-basics', deck: 'Korean Words', day: '2026-09-21', notes: ['Credited with no words quizzed.'] },
    { title: '🔤 Learner4 — Korean Words', message: 'Credited with no words quizzed · Mon Sep 21', channel: 'School needs you' }],
  ['card ladder concern, an unsafe note', { learnerId: 'user_4', child: 'Learner4', kind: 'card-ladder', package: 'lang-basics', deck: 'Korean Words', day: '2026-09-21', notes: ['batch.newPerDay hit its cap_hits'] },
    { title: '🔤 Learner4 — Korean Words', message: "Word practice needs a grown-up's look · Mon Sep 21" }],
  ['card ladder concern, a note naming a setting id', { learnerId: 'user_4', child: 'Learner4', kind: 'card-ladder', package: 'lang-basics', deck: 'Korean Words', day: '2026-09-21', notes: ['Lowered batch.newPerDay after cap hits; review.gapScale held.'] },
    { message: 'Lowered new words per day after cap hits; review spacing held · Mon Sep 21' }],
  ['card ladder concern, a note naming an unknown dotted id', { learnerId: 'user_4', child: 'Learner4', kind: 'card-ladder', package: 'lang-basics', deck: 'Korean Words', notes: ['Raised session.capMinutes'] },
    { message: "Word practice needs a grown-up's look" }],
  ['card ladder concern, no labels', { learnerId: 'user_4', kind: 'card-ladder', package: 'lang-basics', notes: [] },
    { title: '🔤 Word practice', message: "Word practice needs a grown-up's look" }],
];

describe('composeSchoolPush — catalog', () => {
  it.each(CASES)('%s', (_name, event, expected) => {
    const push = composeSchoolPush(event);
    if (expected.title) expect(push.title).toBe(expected.title);
    if (expected.message) expect(push.message).toBe(expected.message);
    if (expected.channel) expect(push.data.channel).toBe(expected.channel);
  });

  it.each(CASES)('%s renders without defects', (_name, event) => {
    const push = composeSchoolPush(event);
    expect(findPushTextDefects(push.title)).toEqual([]);
    expect(findPushTextDefects(push.message)).toEqual([]);
  });
});

describe('composeSchoolPush — suppression and fallbacks', () => {
  it('says "Unknown card" only when the learner itself is unknown, not when just the name is missing', () => {
    const known = { learnerId: 'user_4', testId: '5278294', sessionId: 'ses_a' };
    expect(composeSchoolPush({ ...known, kind: 'unresolved', code: 'SOMETHING_NEW' }).title).toBe('⚠️ School card');
    expect(composeSchoolPush({ ...known, ...labels, kind: 'partial', blankRows: [4] }).title).toBe('⚠️ U.S. Atlas: New York');
    expect(composeSchoolPush({ testId: '5278294', kind: 'unresolved', code: 'SOMETHING_NEW' }).title).toBe('⚠️ Unknown card — School card');
  });
  it('sends nothing for an unmarked old record when other work on the card graded', () => {
    expect(composeSchoolPush({ testId: '1', kind: 'unmarked', otherWorkGraded: true })).toBeNull();
  });
  it('sends nothing for an unknown kind', () => {
    expect(composeSchoolPush({ kind: 'nope' })).toBeNull();
  });
  it('never renders None when every label is missing', () => {
    const push = composeSchoolPush({ kind: 'graded', result: 'passed', earned: null, total: null });
    expect(push.title).toBe('✅ School card');
    expect(push.message).toBe('Passed');
  });
});

describe('composeSchoolPush — delivery metadata', () => {
  it('tags by session so a rescan replaces the earlier push, grouped per learner', () => {
    const partial = composeSchoolPush({ ...base, kind: 'partial', blankRows: [4] });
    const passed = composeSchoolPush({ ...base, kind: 'graded', result: 'passed', earned: 6, total: 6 });
    expect(partial.data.tag).toBe('school-user_4-ses_a');
    expect(passed.data.tag).toBe(partial.data.tag);
    expect(passed.data.group).toBe('school-user_4');
  });
  it('falls back to the card id when there is no session', () => {
    expect(composeSchoolPush({ testId: '9', kind: 'unresolved', code: 'dead_card' }).data)
      .toMatchObject({ tag: 'school-card-9', group: 'school', channel: 'School needs you', importance: 'high' });
  });
  it('tags a card-ladder concern per learner per package, so a second day replaces the first', () => {
    expect(composeSchoolPush({ learnerId: 'user_4', kind: 'card-ladder', package: 'lang-basics', day: '2026-09-21' }).data)
      .toMatchObject({ tag: 'school-user_4-card-ladder-lang-basics', group: 'school-user_4', channel: 'School needs you' });
  });
  it('tags a piano lesson per learner per study day', () => {
    expect(composeSchoolPush({ learnerId: 'user_4', kind: 'piano', lesson: 'Sharps', studyDay: '2026-09-04' }).data.tag)
      .toBe('school-user_4-piano-2026-09-04');
  });
});

describe('composeSchoolPush — the parent digest', () => {
  const learners = [
    { learnerId: 'learner_a', child: 'Learner A', served: 3, asked: 3, judged: true, silverEarned: 12, passesUsed: 1, failure: null },
    { learnerId: 'learner_b', child: 'Learner B', served: 1, asked: 2, judged: true, silverEarned: 0, passesUsed: 0, failure: 'print_failed' },
    { learnerId: 'learner_c', child: 'Learner C', served: 0, asked: 0, judged: true, silverEarned: null, passesUsed: null, failure: null },
    { learnerId: 'learner_d', child: 'Learner D', served: 0, asked: 0, judged: false, silverEarned: null, passesUsed: 2, failure: 'code_rejected' },
  ];
  const digest = (extra = {}) => composeSchoolPush({ kind: 'digest', studyDay: '2026-10-20', today: '2026-10-20', coins: 'live', learners, ...extra });

  it('one line per child: served of asked, silver, passes and the first failure', () => {
    const push = digest();
    expect(push.title).toBe('School today');
    expect(push.message.split('\n')).toEqual([
      'Learner A: 3 of 3 done · 12 silver · 1 pass used',
      'Learner B: 1 of 2 done · a print failed',
      'Learner C: nothing asked',
      "Learner D: couldn't be checked · 2 passes used · a code was turned away",
    ]);
    expect(push.data).toMatchObject({ tag: 'school-digest', group: 'school', channel: 'School progress' });
  });

  it('says the coins are not live in dry-run, and never shows a silver figure', () => {
    const lines = digest({ coins: 'dry-run' }).message.split('\n');
    expect(lines[0]).toBe('Learner A: 3 of 3 done · 1 pass used');
    expect(lines.at(-1)).toBe('Coins not live yet');
  });

  it('says nothing about coins when the economy is off', () => {
    const push = digest({ coins: 'off' });
    expect(push.message).not.toMatch(/silver|Coins/);
  });

  it('names the day when it is not today', () => {
    expect(digest({ today: '2026-10-21' }).title).toBe('School · Tue Oct 20');
  });

  it('caps the body: a long line drops its tail clauses, extra children fold into a count', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      learnerId: `learner_${i}`, child: `Learner ${i} With A Rather Long Display Name`, served: 1, asked: 4, judged: true,
      silverEarned: 1234, passesUsed: 3, failure: 'issue_failed',
    }));
    const push = digest({ learners: many });
    const lines = push.message.split('\n');
    expect(push.message.length).toBeLessThanOrEqual(600);
    expect(lines.every((line) => line.length <= 100)).toBe(true);
    expect(lines.at(-1)).toMatch(/^\+\d+ more in the teacher view$/);
    expect(findPushTextDefects(push.message)).toEqual([]);
  });

  it('says an old code was typed for an expired code', () => {
    const push = digest({ learners: [{ ...learners[0], failure: 'old_code', passesUsed: 0, silverEarned: 0 }] });
    expect(push.message).toBe('Learner A: 3 of 3 done · an old code was typed');
  });

  it('numbers children with no name instead of printing an id', () => {
    const push = digest({ learners: [
      { learnerId: 'learner_x', served: 1, asked: 1, judged: true },
      { learnerId: 'learner_y', child: null, served: 0, asked: 1, judged: true },
    ] });
    expect(push.message.split('\n')).toEqual(['A learner (1): 1 of 1 done', 'A learner (2): 0 of 1 done']);
  });

  it('never splits an emoji when a line is cut', () => {
    const name = '🦊'.repeat(120);
    const line = digest({ learners: [{ learnerId: 'learner_a', child: name, served: 1, asked: 1, judged: true }] }).message;
    expect(Array.from(line)).toHaveLength(100);
    expect(line).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('keeps the dry-run footer when children are folded into a count', () => {
    const huge = Array.from({ length: 12 }, (_, i) => ({ learnerId: `learner_${i}`, child: `Learner ${i} ${'N'.repeat(300)}`, served: 1, asked: 1, judged: true }));
    const push = digest({ learners: huge, coins: 'dry-run' });
    const lines = push.message.split('\n');
    expect(push.message.length).toBeLessThanOrEqual(600);
    expect(lines.slice(-2)).toEqual(['Coins not live yet', `+${12 - (lines.length - 2)} more in the teacher view`]);
  });

  it('renders without defects', () => {
    for (const coins of ['live', 'dry-run', 'off']) {
      const push = digest({ coins });
      expect(findPushTextDefects(push.title)).toEqual([]);
      expect(findPushTextDefects(push.message)).toEqual([]);
    }
  });

  it('sends nothing with no children', () => {
    expect(digest({ learners: [] })).toBeNull();
  });
});

describe('composeSchoolPush — two empty study days', () => {
  it('names the child and says it is the second study day in a row', () => {
    const push = composeSchoolPush({ kind: 'zero-days', learnerId: 'learner_a', child: 'Learner A', days: 2, studyDay: '2026-10-20' });
    expect(push.title).toBe('📭 Learner A — School');
    expect(push.message).toBe('Nothing done for the second study day in a row');
    expect(push.data).toMatchObject({ tag: 'school-learner_a-zero-days', group: 'school-learner_a', channel: 'School needs you', importance: 'high' });
    expect(findPushTextDefects(push.title)).toEqual([]);
    expect(findPushTextDefects(push.message)).toEqual([]);
  });

  it('counts past the ordinals it knows', () => {
    expect(composeSchoolPush({ kind: 'zero-days', learnerId: 'learner_a', child: 'Learner A', days: 3 }).message)
      .toBe('Nothing done for the third study day in a row');
    expect(composeSchoolPush({ kind: 'zero-days', learnerId: 'learner_a', child: 'Learner A', days: 9 }).message)
      .toBe('Nothing done for 9 study days in a row');
  });

  it('names the day when it arrives on a later day', () => {
    expect(composeSchoolPush({ kind: 'zero-days', learnerId: 'learner_a', child: 'Learner A', days: 2, studyDay: '2026-10-20', today: '2026-10-21' }).message)
      .toBe('Nothing done for the second study day in a row · from Tue Oct 20');
  });

  it('drops the name, not the push, when the name is missing', () => {
    expect(composeSchoolPush({ kind: 'zero-days', learnerId: 'learner_a', days: 2 }).title).toBe('📭 School');
  });
});
