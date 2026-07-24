import { describe, it, expect } from 'vitest';
import { SchoolService } from './SchoolService.mjs';
import { GeographyBankSource } from './sources/GeographyBankSource.mjs';

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
    bankSources: [new GeographyBankSource()] });
  return { svc, attempts };
}

it('accepts drill mode and grades like quiz (returns correct + expected)', () => {
  const { svc } = harness();
  const { sessionId } = svc.openSession({ userId: 'u1', bankId: 'geo:us-state-locations', mode: 'drill' });
  const item = svc.getBank('geo:us-state-locations').items[0];
  const res = svc.answer({ sessionId, itemId: item.id, given: item.answer });
  expect(res.correct).toBe(true);
  expect(res.expected).toBe(item.answer);
});

it('records drill attempts into the drill lane, NOT quiz', () => {
  const { svc } = harness();
  const { sessionId } = svc.openSession({ userId: 'u1', bankId: 'geo:us-state-locations', mode: 'drill' });
  const item = svc.getBank('geo:us-state-locations').items[0];
  svc.answer({ sessionId, itemId: item.id, given: 'ZZ' }); // wrong
  const res = svc.getResults('u1', { bankId: 'geo:us-state-locations' });
  expect(res.drill.attempts).toBe(1);
  expect(res.quiz.attempts).toBe(0);
});

it('empty-default result object carries a drill lane', () => {
  const { svc } = harness();
  const res = svc.getResults('u1', { bankId: 'geo:never-touched' });
  expect(res.drill).toEqual({ attempts: 0, correct: 0, lastAt: null });
});

it('rejects an unknown mode', () => {
  const { svc } = harness();
  expect(() => svc.openSession({ userId: 'u1', bankId: 'geo:world-flags', mode: 'bogus' })).toThrow(/quiz\|flashcard\|drill/);
});
