import { describe, it, expect } from 'vitest';
import { SchoolService } from './SchoolService.mjs';

const bank = {
  id: 'generated:locations', title: 'Locations', audience: 'generic',
  items: [{ id: 'location-1', type: 'region_click', prompt: 'Click A', asset: 'regions', answer: 'A' }],
};
const bankSource = { resolve: (bankId) => (bankId === bank.id ? bank : null), listSummaries: () => [] };

function harness() {
  const attempts = [];
  const ds = {
    readBankRaw: () => null,
    readAllBankRaws: async () => [],
    readAllAttempts: () => attempts,
    appendAttempt: (uid, a) => { attempts.push(a); return { ok: true }; },
    readQuizRequests: () => [],
  };
  const users = { getProfile: () => ({ id: 'u1' }), getHouseholdRoster: () => [{ id: 'u1' }] };
  const svc = new SchoolService({ datastore: ds, userService: users,
    logger: { info() {}, warn() {}, error() {} }, now: () => 1000,
    bankSources: [bankSource] });
  return { svc, attempts };
}

it('accepts drill mode and grades like quiz (returns correct + expected)', () => {
  const { svc } = harness();
  const { sessionId } = svc.openSession({ userId: 'u1', bankId: bank.id, mode: 'drill' });
  const item = svc.getBank(bank.id).items[0];
  const res = svc.answer({ sessionId, itemId: item.id, given: item.answer });
  expect(res.correct).toBe(true);
  expect(res.expected).toBe(item.answer);
});

it('records drill attempts into the drill lane, NOT quiz', () => {
  const { svc } = harness();
  const { sessionId } = svc.openSession({ userId: 'u1', bankId: bank.id, mode: 'drill' });
  const item = svc.getBank(bank.id).items[0];
  svc.answer({ sessionId, itemId: item.id, given: 'ZZ' }); // wrong
  const res = svc.getResults('u1', { bankId: bank.id });
  expect(res.drill.attempts).toBe(1);
  expect(res.quiz.attempts).toBe(0);
});

it('empty-default result object carries a drill lane', () => {
  const { svc } = harness();
  const res = svc.getResults('u1', { bankId: 'geo:never-touched' });
  expect(res.drill).toEqual({ attempts: 0, correct: 0, lastAt: null });
});

it('keeps learning-probe responses in their own lane and idempotently replays one client response', () => {
  const { svc, attempts } = harness();
  const { sessionId } = svc.openSession({ userId: 'u1', bankId: bank.id, mode: 'learning_probe' });
  const command = {
    sessionId, itemId: 'location-1', given: 'A', probeAttemptNumber: 1,
    responseId: `${sessionId}:location-1:1`,
  };
  expect(svc.answer(command)).toMatchObject({ correct: true });
  expect(svc.answer(command)).toMatchObject({ correct: true });
  expect(attempts).toHaveLength(1);
  expect(svc.getResults('u1', { bankId: bank.id })).toMatchObject({
    quiz: { attempts: 0 }, drill: { attempts: 0 }, learningProbe: { attempts: 1, correct: 1 },
  });
  expect(() => svc.answer({ ...command, given: 'B' })).toThrow(/responseId conflict/);
});

it('rejects an unknown mode', () => {
  const { svc } = harness();
  expect(() => svc.openSession({ userId: 'u1', bankId: bank.id, mode: 'bogus' })).toThrow(/quiz\|flashcard\|drill/);
});

it('returns durable completed Catalog quiz evidence only to the owning learner', () => {
  const { svc } = harness();
  const learningContext = {
    catalogId: 'core', subjectId: 'geography', courseId: 'places',
    unitId: 'locations', lessonId: 'regions', moduleId: 'check',
  };
  const { sessionId } = svc.openResolvedSession({
    userId: 'u1', bankSnapshot: bank, mode: 'quiz', learningContext,
  });
  expect(() => svc.completedQuizAssessment({ sessionId, learnerId: 'u1' }))
    .toThrow(/must be complete/i);
  svc.answer({ sessionId, itemId: 'location-1', given: 'A' });
  expect(svc.completedQuizAssessment({ sessionId, learnerId: 'u1' })).toMatchObject({
    sessionId, learnerId: 'u1', bank: { id: bank.id }, learning: learningContext,
    responses: [{ itemId: 'location-1', given: 'A' }],
  });
  expect(() => svc.completedQuizAssessment({ sessionId, learnerId: 'u2' }))
    .toThrow(/does not belong/i);
});
