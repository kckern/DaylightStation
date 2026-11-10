import { describe, it, expect, vi } from 'vitest';
import { ResolveCardScan } from "./ResolveCardScan.mjs";
import { UNSALVABLE_REFUSALS } from "../../domain/omrAlignment.mjs";

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
  it('keeps a failed sheet with no retry opened scannable beside a live one, so fixed marks can be the retake', async () => {
    const failed = (extra = []) => ({ readEvents: async () => [
      { type: 'created', sessionId: 'session-failed', learnerId: 'kid', unitId: 'unit', at: '2026-09-01', seq: 1 },
      { type: 'issued', sessionId: 'session-failed', artifactId: 'artifact', at: '2026-09-01', seq: 2 },
      { type: 'submitted', sessionId: 'session-failed', transport: 'paper', at: '2026-09-01', seq: 3 },
      { type: 'graded', sessionId: 'session-failed', attemptIds: ['a1'], percent: 50, correctCount: 1, totalCount: 2,
        missedItemIds: ['q2'], at: '2026-09-01', seq: 4 },
      { type: 'outcome_recorded', sessionId: 'session-failed', outcomeId: 'out:session-failed',
        result: 'needs_remediation', reason: 'below_passing', at: '2026-09-01', seq: 5 },
      ...extra,
    ] });
    const allocationStore = { findByCard: async () => [record,
      { ...record, recordId: 'failed', status: 'satisfied', sessionId: 'session-failed', rowRange: { start: 26, end: 30 } }],
    };
    const repository = { getPublished: vi.fn(async () => null) };
    const open = new ResolveCardScan({ allocationStore, repository, sessions: failed(), logger: {} });
    expect((await open.execute({ testId: '1234567', answers: { 26: 'C' } })).results
      .some(r => r.recordId === 'failed')).toBe(true);

    // Once a retry is open the old sheet is history again.
    const retried = new ResolveCardScan({ allocationStore, repository, logger: {}, sessions: failed([
      { type: 'remediation_opened', sessionId: 'session-failed', newSessionId: 'session-retry', variant: 1,
        at: '2026-09-01', seq: 6 },
    ]) });
    expect((await retried.execute({ testId: '1234567', answers: { 26: 'C' } })).results
      .some(r => r.recordId === 'failed')).toBe(false);
  });
  it('rejects before looking up an answer key, satisfying an allocation, or replacing the baseline', async () => {
    const h = setup();
    const shifted = Object.fromEntries(Object.entries(answers).map(([r, v]) => [Number(r) + 1, v]));
    expect(await h.resolver.execute({ testId: '1234567', answers: shifted }))
      .toMatchObject({ error: { code: 'OMR_ALIGNMENT' }, results: [] });
    expect(h.repository.getPublished).not.toHaveBeenCalled();
    expect(h.allocationStore.updateStatus).not.toHaveBeenCalled();
    // The accepted answers are untouched; only the refused read is noted beside them.
    expect(h.baselineStore.save).toHaveBeenCalledTimes(1);
    const [, saved] = h.baselineStore.save.mock.calls[0];
    expect(saved.answers).toEqual(answers);
    expect(saved.refused).toMatchObject({ reads: [{ answers: shifted }], count: 1 });
  });
  // 2026-11-03: a child bubbled a worksheet one row high, then re-bubbled it one
  // row lower; the corrected card read identically four times and was refused
  // every time. A slip does not reproduce on a fresh feed — real marks do.
  it('accepts the same refused read fed again, and refuses a different one', async () => {
    const shifted = Object.fromEntries(Object.entries(answers).map(([r, v]) => [Number(r) + 1, v]));
    let stored = { answers, owners: Object.fromEntries(Object.keys(answers).map(r => [r, 'old'])) };
    const baselineStore = { get: vi.fn(async () => stored), save: vi.fn(async (_id, next) => { stored = next; }) };
    const allocationStore = { findByCard: vi.fn(async () => [record]), updateStatus: vi.fn() };
    const repository = { getPublished: vi.fn(async () => null) };
    const info = vi.fn();
    const resolver = new ResolveCardScan({ allocationStore, repository, baselineStore, logger: { info, warn: vi.fn() } });

    expect((await resolver.execute({ testId: '1234567', answers: shifted })).error?.code).toBe('OMR_ALIGNMENT');
    const otherShift = { ...shifted, 13: 'E' };
    expect((await resolver.execute({ testId: '1234567', answers: otherShift })).error?.code).toBe('OMR_ALIGNMENT');
    // That different read became the remembered one; feeding IT again goes through.
    const again = await resolver.execute({ testId: '1234567', answers: otherShift });
    expect(again.error).toBeUndefined();
    expect(repository.getPublished).toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith('school.scan.alignment-confirmed-by-refeed', expect.objectContaining({ cardId: '1234567' }));
  });
  it('does not confirm a refused read that is more than a day old', async () => {
    const shifted = Object.fromEntries(Object.entries(answers).map(([r, v]) => [Number(r) + 1, v]));
    const stale = { answers, owners: Object.fromEntries(Object.keys(answers).map(r => [r, 'old'])),
      refused: { answers: shifted, at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString() } };
    const baselineStore = { get: vi.fn(async () => stale), save: vi.fn() };
    const resolver = new ResolveCardScan({ allocationStore: { findByCard: async () => [record], updateStatus: vi.fn() },
      repository: { getPublished: vi.fn(async () => null) }, baselineStore, logger: {} });
    expect((await resolver.execute({ testId: '1234567', answers: shifted })).error?.code).toBe('OMR_ALIGNMENT');
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

describe('an unreadable card', () => {
  const shifted = Object.fromEntries(Object.entries(answers).map(([r, v]) => [Number(r) + 1, v]));
  function live() {
    let stored = { answers, owners: Object.fromEntries(Object.keys(answers).map(r => [r, 'old'])) };
    const baselineStore = { get: vi.fn(async () => stored), save: vi.fn(async (_id, next) => { stored = next; }) };
    const warn = vi.fn();
    const resolver = new ResolveCardScan({
      allocationStore: { findByCard: vi.fn(async () => [record]), updateStatus: vi.fn() },
      repository: { getPublished: vi.fn(async () => null) }, baselineStore, logger: { info: vi.fn(), warn },
    });
    return { resolver, warn, stored: () => stored };
  }

  it('three different refused reads mark the card unsalvable', async () => {
    expect(UNSALVABLE_REFUSALS).toBe(3);
    const h = live();
    const reads = [shifted, { ...shifted, 13: 'E' }, { ...shifted, 13: 'D' }];
    const results = [];
    for (const read of reads) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await h.resolver.execute({ testId: '1234567', answers: read }));
      expect(h.stored().refused.count).toBe(results.length);
    }
    expect(results[0].unsalvable).toBeUndefined();
    expect(results[1].unsalvable).toBeUndefined();
    expect(results[2]).toMatchObject({ error: { code: 'OMR_ALIGNMENT' }, unsalvable: { cardId: '1234567', refusals: 3 } });
    expect(h.warn).toHaveBeenCalledWith('school.scan.card-unsalvable', expect.objectContaining({ cardId: '1234567', refusals: 3 }));
  });

  it('a read that repeats after a slip confirms, and never counts toward retiring the card', async () => {
    const h = live();
    const slip = { ...shifted, 13: 'E' };
    await h.resolver.execute({ testId: '1234567', answers: shifted });
    await h.resolver.execute({ testId: '1234567', answers: slip });
    const again = await h.resolver.execute({ testId: '1234567', answers: shifted });
    expect(again.error).toBeUndefined();
    expect(again.unsalvable).toBeUndefined();
    expect(h.stored().refused.count).toBe(2);
  });

  it('a confirmed read stays confirmable on the next feed', async () => {
    const h = live();
    await h.resolver.execute({ testId: '1234567', answers: shifted });
    expect((await h.resolver.execute({ testId: '1234567', answers: shifted })).error).toBeUndefined();
    expect((await h.resolver.execute({ testId: '1234567', answers: shifted })).error).toBeUndefined();
  });

  it("a teacher's replay never counts toward retiring the card", async () => {
    const h = live();
    await h.resolver.execute({ testId: '1234567', answers: shifted });
    await h.resolver.execute({ testId: '1234567', answers: { ...shifted, 13: 'E' }, identityReview: { targetRecordId: 'old' } });
    expect(h.stored().refused.count).toBe(1);
  });

  it('the retired card fed again returns retiredCard, never an alignment refusal', async () => {
    const retired = { ...record, status: 'satisfied', cardRetiredAt: '2026-11-04T00:00:00.000Z' };
    const baselineStore = { get: vi.fn(async () => ({ answers, owners: Object.fromEntries(Object.keys(answers).map(r => [r, 'old'])) })), save: vi.fn() };
    const resolver = new ResolveCardScan({
      allocationStore: { findByCard: vi.fn(async () => [retired]), updateStatus: vi.fn() },
      repository: { getPublished: vi.fn(async () => null) }, baselineStore, logger: {},
    });
    const result = await resolver.execute({ testId: '1234567', answers: shifted });
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ retiredCard: true, deadCard: true });
    expect(baselineStore.save).not.toHaveBeenCalled();
  });
});
