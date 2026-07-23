import { describe, it, expect } from 'vitest';
import { SchoolService } from './SchoolService.mjs';
import { GeographyBankSource } from './sources/GeographyBankSource.mjs';

const stubDs = {
  readBankRaw: () => null,           // no file banks in this test
  readAllBankRaws: async () => [],
  readAllAttempts: () => [],
  appendAttempt: () => ({ ok: true }),
  readQuizRequests: () => [],
};
const stubUsers = { getProfile: () => ({ id: 'u1' }), getHouseholdRoster: () => [{ id: 'u1' }] };

function service() {
  return new SchoolService({ datastore: stubDs, userService: stubUsers,
    logger: { info() {}, warn() {}, error() {} }, now: () => 1000,
    bankSources: [new GeographyBankSource()] });
}

it('getBank resolves a geo: id via the source (datastore never opens it)', () => {
  const bank = service().getBank('geo:us-state-capitals');
  expect(bank.id).toBe('geo:us-state-capitals');
  expect(bank.items.length).toBe(50);
});

it('openSession opens a generic geo bank for a guest (userId null)', () => {
  const { sessionId } = service().openSession({ userId: null, bankId: 'geo:world-flags', mode: 'quiz' });
  expect(sessionId).toMatch(/^ses_/);
});

it('unknown geo id 404s (falls through, source returns null)', () => {
  expect(() => service().getBank('geo:nope')).toThrow();
});

it('listDeckSummaries aggregates the source', () => {
  const decks = service().listDeckSummaries();
  expect(decks.map((d) => d.deckId)).toContain('world-flags');
});

it('listBanks does NOT include geo banks', async () => {
  const svc = service();
  await svc.warmBanks({ force: true });
  expect(svc.listBanks().some((b) => String(b.id).startsWith('geo:'))).toBe(false);
});
