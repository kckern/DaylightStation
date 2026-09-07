import { describe, it, expect, vi } from 'vitest';
import { ResolveCardScan } from './ResolveCardScan.mjs';

const answers = Object.fromEntries(['A','D','B','E','C','A','B','D','E','C','B','A'].map((v, i) => [i + 1, v]));
const record = { recordId: 'old', status: 'live', renderedAt: '2026-09-01', rowRange: { start: 1, end: 25 } };
function setup({ owner = 'old', baselineError = false } = {}) {
  const baselineStore = {
    get: vi.fn(async () => {
      if (baselineError) throw new Error('unreadable baseline');
      return { answers, owners: Object.fromEntries(Object.keys(answers).map(r => [r, owner])) };
    }), save: vi.fn(),
  };
  const allocationStore = { findByCard: vi.fn(async () => [record]), updateStatus: vi.fn() };
  const repository = { getPublished: vi.fn(async () => null) };
  return { baselineStore, allocationStore, repository,
    resolver: new ResolveCardScan({ allocationStore, repository, baselineStore, logger: {} }) };
}
describe('alignment preflight', () => {
  it('uses session state to include a satisfied allocation still awaiting review beside a live one', async () => {
    const allocationStore = { findByCard: async () => [record,
      { ...record, recordId: 'covered', status: 'satisfied', sessionId: 'session-pending', rowRange: { start: 26, end: 30 } }],
    };
    const sessions = { readEvents: async () => [
      { type: 'created', sessionId: 'session-pending', learnerId: 'kid', unitId: 'unit', at: '2026-09-01', seq: 1 },
      { type: 'issued', sessionId: 'session-pending', artifactId: 'artifact', at: '2026-09-01', seq: 2 },
      { type: 'submitted', sessionId: 'session-pending', transport: 'paper', at: '2026-09-01', seq: 3 },
    ] };
    const repository = { getPublished: vi.fn(async () => null) };
    const resolver = new ResolveCardScan({ allocationStore, repository, sessions, logger: {} });
    const result = await resolver.execute({ testId: '1234567', answers: { 26: 'C' } });
    expect(result.results.some(r => r.recordId === 'covered')).toBe(true);
    expect(repository.getPublished).toHaveBeenCalled();
  });
  it('rejects before looking up an answer key, satisfying an allocation, or replacing the baseline', async () => {
    const h = setup();
    const shifted = Object.fromEntries(Object.entries(answers).map(([r, v]) => [Number(r) + 1, v]));
    expect(await h.resolver.execute({ testId: '1234567', answers: shifted }))
      .toMatchObject({ error: { code: 'OMR_ALIGNMENT' }, results: [] });
    expect(h.repository.getPublished).not.toHaveBeenCalled();
    expect(h.allocationStore.updateStatus).not.toHaveBeenCalled();
    expect(h.baselineStore.save).not.toHaveBeenCalled();
  });
  it('does not compare rows reused for a different worksheet', async () => {
    const h = setup({ owner: 'former-worksheet' });
    const shifted = Object.fromEntries(Object.entries(answers).map(([r, v]) => [Number(r) + 1, v]));
    const result = await h.resolver.execute({ testId: '1234567', answers: shifted });
    expect(result.error).toBeUndefined();
    expect(h.repository.getPublished).toHaveBeenCalled();
    expect(h.baselineStore.save).not.toHaveBeenCalled(); // missing artifact isn't accepted evidence
  });
  it('does not silently drop history when the baseline cannot be read', async () => {
    const h = setup({ baselineError: true });
    await expect(h.resolver.execute({ testId: '1234567', answers })).rejects.toThrow('unreadable baseline');
    expect(h.repository.getPublished).not.toHaveBeenCalled();
  });
});
