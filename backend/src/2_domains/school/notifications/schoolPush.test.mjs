import { composeSchoolPush } from './schoolPush.mjs';
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
  it('tags a piano lesson per learner per study day', () => {
    expect(composeSchoolPush({ learnerId: 'user_4', kind: 'piano', lesson: 'Sharps', studyDay: '2026-09-04' }).data.tag)
      .toBe('school-user_4-piano-2026-09-04');
  });
});
