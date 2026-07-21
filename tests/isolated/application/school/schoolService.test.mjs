import { describe, it, expect, beforeEach } from 'vitest';
import { SchoolService } from '#apps/school/SchoolService.mjs';
import { GuestForbiddenError, SessionGoneError } from '#domains/school/errors.mjs';

const BANKS = {
  'caps': { id: 'caps', title: 'Caps', audience: 'assigned', items: [
    { id: 'q1', type: 'multiple_choice', prompt: 'WA?', answer: 'Olympia', choices: ['Seattle', 'Olympia'] },
    { id: 'q2', type: 'short_answer', prompt: 'OR?', answer: 'Salem' },
  ] },
  'animals': { id: 'animals', title: 'Animals', audience: 'generic', items: [
    { id: 'a1', type: 'multiple_choice', prompt: 'Dog?', answer: 'Mammal', choices: ['Mammal', 'Bird'] },
  ] },
  'broken': { id: 'broken', title: 'Broken', items: [] }, // invalid: empty items
};

let ds, svc, clock, warned;
beforeEach(() => {
  clock = { t: 1_000_000 };
  warned = [];
  ds = {
    appended: [],
    listBankIds: () => Object.keys(BANKS),
    readBankRaw: (id) => BANKS[id] || null,
    appendAttempt: (userId, a) => { ds.appended.push({ userId, ...a }); return a; },
    readAllAttempts: () => [],
  };
  const userService = {
    getProfile: (id) => (['kid1', 'kid2'].includes(id) ? { username: id, display_name: id.toUpperCase() } : null),
    getAllProfiles: () => new Map([['kid1', { username: 'kid1', display_name: 'KID1' }], ['kid2', { username: 'kid2', display_name: 'KID2' }]]),
  };
  svc = new SchoolService({ datastore: ds, userService, logger: { warn: (e, d) => warned.push(e), info: () => {}, error: () => {} }, now: () => clock.t });
});

describe('banks', () => {
  it('lists only valid banks, with itemCount; invalid bank warns and is skipped', () => {
    const list = svc.listBanks();
    expect(list.map((b) => b.id).sort()).toEqual(['animals', 'caps']);
    expect(list.find((b) => b.id === 'caps').itemCount).toBe(2);
    expect(warned).toContain('school.bank.invalid');
  });
  it('audience filter', () => {
    expect(svc.listBanks({ audience: 'generic' }).map((b) => b.id)).toEqual(['animals']);
  });
  it('getBank throws EntityNotFoundError for unknown and for invalid banks', () => {
    expect(() => svc.getBank('nope')).toThrow();
    expect(() => svc.getBank('broken')).toThrow();
  });
});

describe('sessions + answers', () => {
  it('claimed quiz: grades, appends with attributedTo, returns verdict', () => {
    const { sessionId } = svc.openSession({ userId: 'kid1', bankId: 'caps', mode: 'quiz' });
    const r = svc.answer({ sessionId, itemId: 'q1', given: 'Olympia' });
    expect(r).toMatchObject({ correct: true, expected: 'Olympia' });
    expect(ds.appended).toHaveLength(1);
    expect(ds.appended[0]).toMatchObject({ userId: 'kid1', attributedTo: 'kid1', mode: 'quiz', given: 'Olympia', correct: true });
  });
  it('guest session on generic bank: verdicts but appends NOTHING', () => {
    const { sessionId } = svc.openSession({ bankId: 'animals', mode: 'quiz' });
    const r = svc.answer({ sessionId, itemId: 'a1', given: 'Bird' });
    expect(r.correct).toBe(false);
    expect(r.attemptId).toBe(null);
    expect(ds.appended).toHaveLength(0);
  });
  it('guest against assigned bank -> GuestForbiddenError', () => {
    expect(() => svc.openSession({ bankId: 'caps', mode: 'quiz' })).toThrow(GuestForbiddenError);
  });
  it('unknown user / unknown bank / bad mode on open', () => {
    expect(() => svc.openSession({ userId: 'ghost', bankId: 'caps', mode: 'quiz' })).toThrow(/user/i);
    expect(() => svc.openSession({ userId: 'kid1', bankId: 'nope', mode: 'quiz' })).toThrow();
    expect(() => svc.openSession({ userId: 'kid1', bankId: 'caps', mode: 'exam' })).toThrow(/mode/i);
  });
  it('flashcard: selfGrade recorded verbatim with given null, never graded', () => {
    const { sessionId } = svc.openSession({ userId: 'kid1', bankId: 'caps', mode: 'flashcard' });
    const r = svc.answer({ sessionId, itemId: 'q2', selfGrade: 'incorrect' });
    expect(r).toEqual({ attemptId: expect.stringMatching(/^att_/) });
    expect(ds.appended[0]).toMatchObject({ mode: 'flashcard', given: null, correct: false });
  });
  it('mode contract is strict both ways', () => {
    const quiz = svc.openSession({ userId: 'kid1', bankId: 'caps', mode: 'quiz' }).sessionId;
    const cards = svc.openSession({ userId: 'kid1', bankId: 'caps', mode: 'flashcard' }).sessionId;
    expect(() => svc.answer({ sessionId: quiz, itemId: 'q1', selfGrade: 'correct' })).toThrow(/selfGrade/);
    expect(() => svc.answer({ sessionId: cards, itemId: 'q1', given: 'Olympia' })).toThrow(/given/);
    expect(ds.appended).toHaveLength(0);
  });
  it('unknown item and wrong given shape reject without appending', () => {
    const { sessionId } = svc.openSession({ userId: 'kid1', bankId: 'caps', mode: 'quiz' });
    expect(() => svc.answer({ sessionId, itemId: 'zz', given: 'x' })).toThrow(/item/i);
    expect(() => svc.answer({ sessionId, itemId: 'q1', given: ['x'] })).toThrow();
    expect(ds.appended).toHaveLength(0);
  });
  it('unknown session -> SessionGoneError; expired session too', () => {
    expect(() => svc.answer({ sessionId: 'ses_nope', itemId: 'q1', given: 'x' })).toThrow(SessionGoneError);
    const { sessionId } = svc.openSession({ userId: 'kid1', bankId: 'caps', mode: 'quiz' });
    clock.t += 2 * 60 * 60 * 1000 + 1;
    expect(() => svc.answer({ sessionId, itemId: 'q1', given: 'Olympia' })).toThrow(SessionGoneError);
  });
});

describe('results', () => {
  it('folds the log per bank, quiz and flashcard never merged; items quiz-only', () => {
    ds.readAllAttempts = () => [
      { bankId: 'caps', itemId: 'q1', mode: 'quiz', correct: true, at: '2026-07-21T10:00:00Z' },
      { bankId: 'caps', itemId: 'q1', mode: 'quiz', correct: false, at: '2026-07-21T11:00:00Z' },
      { bankId: 'caps', itemId: 'q2', mode: 'flashcard', correct: true, at: '2026-07-21T12:00:00Z' },
    ];
    const r = svc.getResults('kid1', { bankId: 'caps' });
    expect(r.quiz).toEqual({ attempts: 2, correct: 1, lastAt: '2026-07-21T11:00:00Z' });
    expect(r.flashcard).toEqual({ attempts: 1, correct: 1, lastAt: '2026-07-21T12:00:00Z' });
    expect(r.items.q1).toEqual({ quizAttempts: 2, quizCorrect: 1, lastCorrect: false });
    expect(r.items.q2).toBeUndefined(); // flashcard-only item never enters items
  });
  it('without bankId returns an array of per-bank rollups', () => {
    ds.readAllAttempts = () => [
      { bankId: 'caps', itemId: 'q1', mode: 'quiz', correct: true, at: '2026-07-21T10:00:00Z' },
      { bankId: 'animals', itemId: 'a1', mode: 'quiz', correct: true, at: '2026-07-21T10:05:00Z' },
    ];
    expect(svc.getResults('kid1').map((b) => b.bankId).sort()).toEqual(['animals', 'caps']);
  });
});
