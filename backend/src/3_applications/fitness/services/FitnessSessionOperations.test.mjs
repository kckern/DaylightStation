import { describe, expect, it, vi } from 'vitest';
import { FitnessSessionOperations } from './FitnessSessionOperations.mjs';

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
