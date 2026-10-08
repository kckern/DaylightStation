import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({}) }));

const { FitnessSession } = await import('./FitnessSession.js');

describe('FitnessSession updateSnapshot', () => {
  it('completes an active-session snapshot without referencing prune-local variables', () => {
    const session = new FitnessSession();
    session.sessionId = 'fs_snapshot';
    session.startTime = Date.now();

    expect(() => session.updateSnapshot({ playQueue: [], participantRoster: [] })).not.toThrow();
    expect(session.snapshot.playQueue).toEqual([]);
  });
});
