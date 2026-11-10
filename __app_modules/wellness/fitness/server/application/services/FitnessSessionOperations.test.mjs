import { describe, expect, it, vi } from 'vitest';
import { FitnessSessionOperations } from "./FitnessSessionOperations.mjs";

describe('FitnessSessionOperations State Gates refresh seam', () => {
  it('notifies after saved, ended, and deleted session state changes', async () => {
    const changed = vi.fn();
    const sessions = {
      saveSessionWithReceipt: vi.fn(async () => ({ sessionId: 's1' })),
      endSession: vi.fn(async () => ({ sessionId: 's1', durationMs: 100 })),
      getSession: vi.fn(async () => ({ sessionId: 's1' })),
      deleteSession: vi.fn(async () => {}),
    };
    const operations = new FitnessSessionOperations({ sessions, onSessionsChanged: changed });
    await operations.save({ sessionData: { sessionId: 's1' }, householdId: 'home', userAgent: 'test' });
    await operations.end('s1', 'home', '2026-08-30T12:00:00Z');
    await operations.delete('s1', 'home');
    expect(changed.mock.calls.map(([value]) => value.operation)).toEqual(['saved', 'ended', 'deleted']);
  });

  it('does not fail an already-committed fitness write when refresh notification throws', async () => {
    const operations = new FitnessSessionOperations({
      sessions: { saveSessionWithReceipt: async () => ({ sessionId: 's1' }) },
      onSessionsChanged: () => { throw new Error('State Gates unavailable'); },
      logger: { warn: vi.fn() },
    });
    await expect(operations.save({ sessionData: { sessionId: 's1' }, householdId: 'home' }))
      .resolves.toMatchObject({ kind: 'saved', sessionId: 's1' });
  });
});

describe('FitnessSessionOperations ended publication', () => {
  const session = (over = {}) => ({ sessionId: { toString: () => '20261109120000' }, startTime: 1000, endTime: 5000, finalized: true, participants: { 'test-learner': { rings: 3 } }, ...over });

  it('end publishes fitness.session.ended, finalized', async () => {
    const ended = vi.fn();
    const sessions = { endSession: vi.fn(async () => session()) };
    await new FitnessSessionOperations({ sessions, publications: { ended } }).end('20261109120000', 'home', 5000);
    expect(ended).toHaveBeenCalledWith({ sessionId: '20261109120000', learnerIds: ['test-learner'], endMs: 5000, startMs: 1000, finalized: true });
  });

  it('save publishes an ended, unfinalized session; a running one publishes nothing', async () => {
    const ended = vi.fn();
    const saved = { value: { session: session({ finalized: false }) } };
    const sessions = { saveSessionWithReceipt: vi.fn(async () => saved.value) };
    const ops = new FitnessSessionOperations({ sessions, publications: { ended } });
    await ops.save({ sessionData: { sessionId: 's' }, householdId: 'home' });
    expect(ended).toHaveBeenCalledWith(expect.objectContaining({ finalized: false, endMs: 5000 }));
    ended.mockClear();
    saved.value = { session: session({ endTime: null }) };
    await ops.save({ sessionData: { sessionId: 's' }, householdId: 'home' });
    expect(ended).not.toHaveBeenCalled();
  });

  it('a throwing publisher never fails the write', async () => {
    const sessions = { endSession: vi.fn(async () => session()) };
    const ops = new FitnessSessionOperations({ sessions, publications: { ended: () => { throw new Error('bus'); } }, logger: { warn: vi.fn(), info: vi.fn() } });
    await expect(ops.end('s', 'home', 5000)).resolves.toBeTruthy();
  });
});

describe('FitnessSessionOperations save publishes transitions only', () => {
  const rec = (over = {}) => ({ sessionId: 's', startTime: 1000, endTime: 5000, finalized: true, participants: { 'test-learner': { rings: 3 } }, ...over });
  const run = async (before, after) => {
    const ended = vi.fn();
    const sessions = { getSession: vi.fn(async () => before), saveSessionWithReceipt: vi.fn(async () => ({ session: after })) };
    await new FitnessSessionOperations({ sessions, publications: { ended } }).save({ sessionData: { sessionId: 's' }, householdId: 'home' });
    return ended;
  };

  it('a re-save of an already-finalized session publishes nothing', async () => {
    expect(await run(rec(), rec())).not.toHaveBeenCalled();
  });
  it('a re-save of an unchanged ended-unfinalized session publishes nothing', async () => {
    expect(await run(rec({ finalized: false }), rec({ finalized: false }))).not.toHaveBeenCalled();
  });
  it('unfinalized -> finalized publishes once', async () => {
    expect(await run(rec({ finalized: false }), rec())).toHaveBeenCalledTimes(1);
  });
  it('running -> ended publishes; a moved endTime re-publishes', async () => {
    expect(await run(rec({ endTime: null }), rec({ finalized: false }))).toHaveBeenCalledTimes(1);
    expect(await run(rec({ finalized: false }), rec({ finalized: false, endTime: 9000 }))).toHaveBeenCalledTimes(1);
  });
  it('an unreadable previous record still publishes', async () => {
    const ended = vi.fn();
    const sessions = { getSession: vi.fn(async () => { throw new Error('io'); }), saveSessionWithReceipt: vi.fn(async () => ({ session: rec() })) };
    await new FitnessSessionOperations({ sessions, publications: { ended } }).save({ sessionData: { sessionId: 's' }, householdId: 'home' });
    expect(ended).toHaveBeenCalledTimes(1);
  });
});
