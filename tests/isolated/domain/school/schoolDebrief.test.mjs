// tests/isolated/domain/school/schoolDebrief.test.mjs
import { describe, it, expect } from 'vitest';
import {
  SCHOOL_DEBRIEF_PROGRAM_ID, PROMPTS, validateSchoolDebriefEnrollment, deriveDebriefState,
  fallbackQuestions, debriefConfigOf, previousStudyDay,
  LEGACY_PROMPT_IDS, promptsFor, shouldProbe, filterQuestions, debriefMetrics,
} from "../../../../__app_modules/learning/school/server/domain/schoolDebrief.mjs";

const at = (m) => `2026-10-21T22:${String(m).padStart(2, '0')}:00.000Z`;
const entry = (promptId, text, m = 1) => ({ type: 'entry', promptId, text, via: 'typed', audioRef: null, at: at(m) });
const QS = [
  { id: 'q1', kind: 'choice', prompt: 'P1', options: ['a', 'b', 'c'], answer: 'b' },
  { id: 'q2', kind: 'choice', prompt: 'P2', options: ['a', 'b', 'c'], answer: 'a' },
  { id: 'q3', kind: 'short', prompt: 'P3', expected: 'x' },
];

describe('validateSchoolDebriefEnrollment', () => {
  it('normalizes to corpusId null with defaults', () => {
    const { errors, enrollment } = validateSchoolDebriefEnrollment({ programId: SCHOOL_DEBRIEF_PROGRAM_ID });
    expect(errors).toEqual([]);
    expect(enrollment).toEqual({ programId: 'school-debrief', corpusId: null, subject: 'writing', title: 'After-school debrief' });
  });
  it('refuses an unknown subject', () => {
    expect(validateSchoolDebriefEnrollment({ programId: 'school-debrief', subject: 'gym' }).errors[0]).toMatch(/subject/);
  });
});

describe('deriveDebriefState', () => {
  it('is not-started with no events, next = first prompt', () => {
    const s = deriveDebriefState([]);
    expect(s.phase).toBe('not-started');
    expect(s.next).toEqual({ kind: 'prompt', id: PROMPTS[0].id });
  });
  it('a resubmitted prompt supersedes the earlier one', () => {
    const s = deriveDebriefState([{ type: 'opened', at: at(0) }, entry('classes', 'old', 1), entry('classes', 'new', 2)]);
    expect(s.entries.classes.text).toBe('new');
    expect(s.phase).toBe('entry');
    expect(s.next).toEqual({ kind: 'prompt', id: 'moment' });
  });
  it('after all prompts, next is submit', () => {
    const s = deriveDebriefState(PROMPTS.map((p, i) => entry(p.id, 't', i)));
    expect(s.next).toEqual({ kind: 'submit', id: null });
  });
  it('a clarify request with no answer yet waits on clarify', () => {
    const s = deriveDebriefState([...PROMPTS.map((p, i) => entry(p.id, 't', i)), { type: 'clarify-asked', prompt: 'What experiment?', at: at(9) }]);
    expect(s.phase).toBe('clarify');
    expect(s.next).toEqual({ kind: 'clarify', id: null });
  });
  it('answering walks questions in order and completes', () => {
    const base = [...PROMPTS.map((p, i) => entry(p.id, 't', i)),
      { type: 'questions', substance: 7, substanceReason: 'ok', questions: QS, questioner: 'model', model: 'm', at: at(10) }];
    expect(deriveDebriefState(base).next).toEqual({ kind: 'question', id: 'q1' });
    const answered = [...base,
      { type: 'answer', questionId: 'q1', response: 'b', correct: true, at: at(11) },
      { type: 'answer', questionId: 'q2', response: 'c', correct: false, at: at(12) },
      { type: 'answer', questionId: 'q3', response: 'y', correct: null, at: at(13) }];
    const s = deriveDebriefState(answered);
    expect(s.next).toEqual({ kind: 'complete', id: null });
    expect(s.summary).toEqual({ substance: 7, substantive: null, quiz: { right: 1, graded: 2 } });
  });
  it('the first answer per question wins (a retried POST cannot re-grade)', () => {
    const s = deriveDebriefState([
      { type: 'questions', substance: 7, questions: QS, questioner: 'model', at: at(10) },
      { type: 'answer', questionId: 'q1', response: 'b', correct: true, at: at(11) },
      { type: 'answer', questionId: 'q1', response: 'a', correct: false, at: at(12) },
    ]);
    expect(s.answers.q1).toEqual({ response: 'b', correct: true });
  });
  it('completed is terminal; rejected and excused override', () => {
    const done = [{ type: 'questions', substance: 7, questions: [], questioner: 'model', at: at(1) }, { type: 'completed', late: false, at: at(2) }];
    expect(deriveDebriefState(done).phase).toBe('completed');
    expect(deriveDebriefState(done).next).toBeNull();
    expect(deriveDebriefState([...done, { type: 'rejected', by: 'p', reason: 'junk', at: at(3) }]).phase).toBe('rejected');
    expect(deriveDebriefState([{ type: 'excused', by: 'p', reason: 'sick', at: at(3) }]).phase).toBe('excused');
  });
  it('late is true if any of the child\'s events is late', () => {
    expect(deriveDebriefState([{ type: 'opened', late: true, at: at(0) }]).late).toBe(true);
  });
  it('a grown-up event never makes the day late, even if stamped late', () => {
    const onTime = [{ type: 'questions', substance: 7, questions: [], questioner: 'fallback', at: at(1) }, { type: 'completed', at: at(2) }];
    for (const type of ['excused', 'rejected', 'rescored']) {
      expect(deriveDebriefState([...onTime, { type, by: 'p', late: true, questions: [], questioner: 'model', at: at(3) }]).late).toBe(false);
    }
  });
  it('rescored replaces questions and substance', () => {
    const s = deriveDebriefState([
      { type: 'questions', substance: null, questions: QS, questioner: 'fallback', at: at(1) },
      { type: 'rescored', substance: 8, substanceReason: 'r', questions: QS.slice(0, 2), questioner: 'model', at: at(2) },
    ]);
    expect(s.substance).toBe(8); expect(s.questioner).toBe('model'); expect(s.questions).toHaveLength(2);
  });
});

describe('fallbackQuestions', () => {
  it('only f3: a short question expecting the teach text; no echo question', () => {
    const qs = fallbackQuestions({ classes: { text: 'math, science' }, teach: { text: 'how to press apples' } });
    expect(qs).toEqual([{ id: 'f3', kind: 'short', prompt: 'What is one step someone would need to try what you explained?', expected: 'how to press apples' }]);
  });
  it('falls back to the legacy learned text', () => {
    expect(fallbackQuestions({ learned: { text: 'fractions' } })[0].expected).toBe('fractions');
  });
  it('nothing to ask from: no questions', () => {
    expect(fallbackQuestions({ classes: { text: 'math' } })).toEqual([]);
  });
});

describe('prompts and config', () => {
  it('promptsFor fills teachTo', () => {
    const ps = promptsFor({ teachTo: 'Max' });
    expect(ps.map((p) => p.id)).toEqual(['classes', 'moment', 'teach', 'hard']);
    expect(ps[2].text.endsWith('Explain it so Max could try it.')).toBe(true);
    expect(ps[0].kind).toBe('chips');
    expect(ps.map((p) => p.required)).toEqual([false, true, true, false]);
    expect(LEGACY_PROMPT_IDS).toEqual(['learned', 'notable']);
  });
  it('config defaults and overrides', () => {
    const c = debriefConfigOf({});
    expect(c).toMatchObject({ richLevel: 3, teachableLevel: 4, maxProbes: 2, teachTo: 'a younger kid', priorPromptDays: 20 });
    expect(c.classOptions).toHaveLength(12);
    expect(debriefConfigOf({ debrief: { max_probes: 1, teach_to: 'Max' } })).toMatchObject({ maxProbes: 1, teachTo: 'Max' });
  });
  it('shouldProbe', () => {
    const b = { maxProbes: 2, teachableLevel: 4 };
    expect(shouldProbe({ ...b, level: 2, asked: 0 })).toBe(true);
    expect(shouldProbe({ ...b, level: 3, asked: 1 })).toBe(true);
    expect(shouldProbe({ ...b, level: 3, asked: 2 })).toBe(false);
    expect(shouldProbe({ ...b, level: 4, asked: 0 })).toBe(false);
    expect(shouldProbe({ ...b, level: null, asked: 0 })).toBe(false);
  });
});

describe('filterQuestions', () => {
  it('drops echoes and repeats of prior prompts, keeps fresh ones', () => {
    const qs = [
      { id: 'a', prompt: 'Which classes did the child say they had today?' },
      { id: 'b', prompt: 'Why is it helpful to not look at the keyboard while typing?' },
      { id: 'c', prompt: 'If you wanted more juice from the press, what would you change?' },
      { id: 'd', prompt: 'If you wanted more juice from the press what would you change' },
    ];
    expect(filterQuestions(qs, ['Why is it helpful to not look at the keyboard  while typing']).map((q) => q.id)).toEqual(['c']);
  });
});

describe('debriefMetrics and probes', () => {
  it('counts words, markers, probes, voice entries', () => {
    const text = 'We pressed apples because it was cold, then 41 cups';
    const s = deriveDebriefState([
      { type: 'entry', promptId: 'moment', text, via: 'voice', at: at(1) },
      { type: 'clarify-asked', prompt: 'P?', at: at(2) },
      { type: 'clarify', text: 'about ten of them', at: at(3) },
    ]);
    expect(debriefMetrics(s)).toEqual({ level: null, words: 10 + 4, markers: 3, probes: 1, voiceEntries: 1 });
  });
  it('two asks, one reply: second is open', () => {
    const s = deriveDebriefState([
      { type: 'opened', at: at(0) },
      { type: 'clarify-asked', prompt: 'first', at: at(1) },
      { type: 'clarify', text: 'r', at: at(2) },
      { type: 'clarify-asked', prompt: 'second', at: at(3) },
    ]);
    expect(s.probes).toHaveLength(2);
    expect(s.clarify.prompt).toBe('second');
    expect(s.phase).toBe('clarify');
  });
  it('legacy entries stay and the day continues on new prompts', () => {
    const s = deriveDebriefState([{ type: 'opened', at: at(0) }, entry('classes', 'math', 1), entry('learned', 'x', 2), entry('notable', 'y', 3)]);
    expect(s.entries.learned.text).toBe('x');
    expect(s.next).toEqual({ kind: 'prompt', id: 'moment' });
  });
  it('level/hook come from the latest questions event', () => {
    const s = deriveDebriefState([{ type: 'questions', level: 3, levelReason: 'r', hook: 'h', questions: [], at: at(1) }]);
    expect([s.level, s.levelReason, s.hook]).toEqual([3, 'r', 'h']);
  });
  it('discussed never changes phase', () => {
    const s = deriveDebriefState([{ type: 'questions', questions: [], at: at(1) }, { type: 'completed', at: at(2) }, { type: 'discussed', at: at(3) }]);
    expect(s.phase).toBe('completed');
    expect(s.discussedAt).toBe(at(3));
  });
});

describe('debriefConfigOf / previousStudyDay', () => {
  it('fills defaults', () => {
    expect(debriefConfigOf({})).toEqual({
      questioner: { model: 'gpt-5-mini', timeoutMs: 30000 }, judge: { model: 'gpt-5-nano', timeoutMs: 8000 },
      substantiveScore: 6, clarifyBelow: 4, quizPassRatio: 0.67,
      richLevel: 3, teachableLevel: 4, maxProbes: 2, teachTo: 'a younger kid', priorPromptDays: 20,
      classOptions: ['Reading', 'Writing', 'Math', 'Typing', 'Spelling', 'Grammar', 'Science', 'P.E.', 'Art', 'Music', 'Quest', 'Field trip'],
    });
    expect(debriefConfigOf({ debrief: { clarify_below: 3 } }).clarifyBelow).toBe(3);
  });
  it('steps back across a month boundary', () => {
    expect(previousStudyDay('2026-11-01')).toBe('2026-10-31');
  });
});
