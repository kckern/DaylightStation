// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { EarningsQuoteClient } from './EarningsQuoteClient.mjs';

const logger = () => ({ warn: vi.fn(), info() {}, debug() {}, error() {} });

describe('EarningsQuoteClient', () => {
  it('passes quote and ifDone through to the service', async () => {
    const service = { quote: vi.fn(async () => ({ totals: { silver: 3, gems: 0 }, lines: [] })), ifDone: vi.fn(async () => ({ silver: 2, gems: 0, dayBonus: { silver: 0, gems: 0 }, lines: [] })) };
    const c = new EarningsQuoteClient({ getService: () => service, logger: logger() });
    expect((await c.quote('learner1')).totals.silver).toBe(3);
    expect((await c.ifDone({ learnerId: 'learner1', subject: 'math' })).silver).toBe(2);
    expect(service.quote).toHaveBeenCalledWith({ learnerId: 'learner1' });
    expect(service.ifDone).toHaveBeenCalledWith({ learnerId: 'learner1', subject: 'math', unitId: null, courseId: null, finishesDay: false });
  });

  it('a getter that returns null (economy not built yet) answers null quietly', async () => {
    const log = logger();
    const c = new EarningsQuoteClient({ getService: () => null, logger: log });
    expect(await c.quote('learner1')).toBeNull();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('an error answers null and is logged', async () => {
    const log = logger();
    const c = new EarningsQuoteClient({ getService: () => ({ quote: async () => { throw new Error('cold cache'); } }), logger: log });
    expect(await c.quote('learner1')).toBeNull();
    expect(log.warn).toHaveBeenCalledWith('school.earnings-quote.failed', expect.objectContaining({ op: 'quote', learnerId: 'learner1', error: 'cold cache' }));
  });

  it('a getter that throws answers null and is logged', async () => {
    const log = logger();
    const c = new EarningsQuoteClient({ getService: () => { throw new Error('tdz'); }, logger: log });
    expect(await c.quote('learner1')).toBeNull();
    expect(log.warn).toHaveBeenCalledWith('school.earnings-quote.failed', expect.objectContaining({ op: 'quote', learnerId: 'learner1', error: 'tdz' }));
  });

  it('a hang answers null after the limit and is logged as a timeout', async () => {
    vi.useFakeTimers();
    try {
      const log = logger();
      const c = new EarningsQuoteClient({ getService: () => ({ ifDone: () => new Promise(() => {}) }), logger: log, timeoutMs: 2000 });
      const pending = c.ifDone({ learnerId: 'learner1', subject: 'math' });
      await vi.advanceTimersByTimeAsync(2000);
      expect(await pending).toBeNull();
      expect(log.warn).toHaveBeenCalledWith('school.earnings-quote.failed', expect.objectContaining({ op: 'ifDone', timeout: true }));
    } finally { vi.useRealTimers(); }
  });

  it('rewardFor asks the sheet-reward port under the same limit', async () => {
    const rewardFor = vi.fn(async () => ({ silver: 2, gems: 0 }));
    const c = new EarningsQuoteClient({ getService: () => null, rewardFor, logger: logger() });
    const unit = { unitId: 'u1', title: 'U', subject: 'math' };
    expect(await c.rewardFor({ learnerId: 'learner1', unit })).toEqual({ silver: 2, gems: 0 });
    expect(rewardFor).toHaveBeenCalledWith({ learnerId: 'learner1', unit });
  });

  it('rewardFor with no port answers null quietly', async () => {
    const log = logger();
    const c = new EarningsQuoteClient({ getService: () => null, logger: log });
    expect(await c.rewardFor({ learnerId: 'learner1', unit: {} })).toBeNull();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('prices nothing while coins are not live, without asking the economy', async () => {
    const service = { quote: vi.fn(async () => ({ totals: { silver: 3 } })), ifDone: vi.fn() };
    const rewardFor = vi.fn();
    const log = logger();
    const c = new EarningsQuoteClient({ getService: () => service, rewardFor, isLive: () => false, logger: log });
    expect(await c.quote('learner1')).toBeNull();
    expect(await c.ifDone({ learnerId: 'learner1', subject: 'math' })).toBeNull();
    expect(await c.rewardFor({ learnerId: 'learner1', unit: {} })).toBeNull();
    expect(service.quote).not.toHaveBeenCalled();
    expect(rewardFor).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('a mode reader that throws counts as not live, and is logged', async () => {
    const log = logger();
    const service = { quote: vi.fn() };
    const c = new EarningsQuoteClient({ getService: () => service, isLive: () => { throw new Error('catalog'); }, logger: log });
    expect(await c.quote('learner1')).toBeNull();
    expect(service.quote).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith('school.earnings-quote.failed', expect.objectContaining({ op: 'quote', error: 'catalog' }));
  });
});
