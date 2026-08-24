import { describe, expect, it, vi } from 'vitest';
import { collectProgramStatuses } from '#apps/school/programStatusCollection.mjs';

describe('collectProgramStatuses', () => {
  it('reads and keys each program instance independently, deduplicating exact instances', async () => {
    const status = vi.fn(async ({ programInstance }) => ({
      doneToday: programInstance === 'korean', progressLabel: programInstance, score: null,
    }));
    const result = await collectProgramStatuses({
      learnerId: 'kid1',
      plan: { entries: [
        { program: 'language', programInstance: 'korean' },
        { program: 'language', programInstance: 'spanish' },
        { program: 'language', programInstance: 'korean' },
      ] },
      launchers: new Map([['language', { status }]]),
    });

    expect(status).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenCalledWith({ userId: 'kid1', programInstance: 'korean' });
    expect(status).toHaveBeenCalledWith({ userId: 'kid1', programInstance: 'spanish' });
    expect(result).toEqual({
      'language::korean': { doneToday: true, progressLabel: 'korean', score: null },
      'language::spanish': { doneToday: false, progressLabel: 'spanish', score: null },
    });
  });

  it('contains a failure to the failing instance key', async () => {
    const result = await collectProgramStatuses({
      learnerId: 'kid1',
      plan: { entries: [
        { program: 'missing', programInstance: 'one' },
        { program: 'working', programInstance: 'two' },
      ] },
      launchers: new Map([['working', { status: async () => ({ doneToday: false }) }]]),
      logger: { warn: vi.fn() },
    });

    expect(result).toEqual({
      'missing::one': { error: true },
      'working::two': { doneToday: false },
    });
  });
});
