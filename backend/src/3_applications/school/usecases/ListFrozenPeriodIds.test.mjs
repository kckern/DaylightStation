import { describe, expect, it, vi } from 'vitest';
import { ListFrozenPeriodIds } from './ListFrozenPeriodIds.mjs';

describe('ListFrozenPeriodIds', () => {
  it('collects frozen period ids and fails open for one unreadable learner shard', () => {
    const operation = new ListFrozenPeriodIds({
      listLearners: () => [{ id: 'one' }, { id: 'broken' }, { id: 'two' }],
      listReportCards: (id) => {
        if (id === 'broken') throw new Error('bad yaml');
        return id === 'one' ? [{ periodId: 'fall' }] : [{ periodId: 'spring' }];
      },
      logger: { warn: vi.fn() },
    });
    expect(operation.execute()).toEqual(['fall', 'spring']);
  });
});
