// tests/isolated/domain/school/schoolDebrief.test.mjs
import { describe, it, expect } from 'vitest';
import {
  SCHOOL_DEBRIEF_PROGRAM_ID, PROMPTS, validateSchoolDebriefEnrollment, deriveDebriefState,
  fallbackQuestions, debriefConfigOf, previousStudyDay,
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
    expect(s.next).toEqual({ kind: 'prompt', id: 'learned' });
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
  it('late is true if any event is late', () => {
    expect(deriveDebriefState([{ type: 'opened', late: true, at: at(0) }]).late).toBe(true);
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
  it('builds at least two choice questions from the entries, answer among options', () => {
    const qs = fallbackQuestions({ classes: { text: 'math, science, art' }, learned: { text: 'fractions' } });
    const choices = qs.filter((q) => q.kind === 'choice');
    expect(choices.length).toBeGreaterThanOrEqual(2);
    for (const q of choices) expect(q.options).toContain(q.answer);
  });
});

describe('debriefConfigOf / previousStudyDay', () => {
  it('fills defaults', () => {
    expect(debriefConfigOf({})).toEqual({
      questioner: { model: 'gpt-5-mini', timeoutMs: 30000 }, judge: { model: 'gpt-5-nano', timeoutMs: 8000 },
      substantiveScore: 6, clarifyBelow: 4, quizPassRatio: 0.67,
    });
    expect(debriefConfigOf({ debrief: { clarify_below: 3 } }).clarifyBelow).toBe(3);
  });
  it('steps back across a month boundary', () => {
    expect(previousStudyDay('2026-11-01')).toBe('2026-10-31');
  });
});
