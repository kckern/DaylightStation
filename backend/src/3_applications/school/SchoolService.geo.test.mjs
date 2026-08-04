import { describe, it, expect } from 'vitest';
import { SchoolService } from './SchoolService.mjs';

const banks = new Map([
  ['geo:us-state-capitals', {
    id: 'geo:us-state-capitals', title: 'State capitals', audience: 'generic',
    items: [{ id: 'capital-1', type: 'multiple_choice', prompt: 'Capital?', choices: ['A', 'B'], answer: 'A' }],
  }],
  ['geo:world-flags', {
    id: 'geo:world-flags', title: 'World flags', audience: 'generic',
    items: [{ id: 'flag-1', type: 'asset_choice', prompt: 'Flag?', choices: [{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }], answer: 'A' }],
  }],
]);
const bankSource = {
  resolve: (bankId) => banks.get(bankId) ?? null,
  listSummaries: () => [{
    summaryId: 'world-flags', bankId: 'geo:world-flags', title: 'World flags',
    itemType: 'asset_choice', available: true, collections: ['geography'],
  }],
};

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
    bankSources: [bankSource] });
}

it('getBank resolves a geo: id via the source (datastore never opens it)', () => {
  const bank = service().getBank('geo:us-state-capitals');
  expect(bank.id).toBe('geo:us-state-capitals');
  expect(bank.items.length).toBe(1);
});

it('openSession opens a generic geo bank for a guest (userId null)', () => {
  const { sessionId } = service().openSession({ userId: null, bankId: 'geo:world-flags', mode: 'quiz' });
  expect(sessionId).toMatch(/^ses_/);
});

it('unknown geo id 404s (falls through, source returns null)', () => {
  expect(() => service().getBank('geo:nope')).toThrow();
});

it('listBankSourceSummaries filters generic source collections', () => {
  const summaries = service().listBankSourceSummaries({ collection: 'geography' });
  expect(summaries.map((entry) => entry.summaryId)).toContain('world-flags');
});

it('listBanks does NOT include geo banks', async () => {
  const svc = service();
  await svc.warmBanks({ force: true });
  expect(svc.listBanks().some((b) => String(b.id).startsWith('geo:'))).toBe(false);
});
