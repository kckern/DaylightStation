import { describe, expect, test } from 'vitest';
import { FeedPoolManager } from '#apps/feed/services/FeedPoolManager.mjs';

const TEST_SCHEDULER = { withDeadline: (work) => work };

describe('FeedPoolManager session snapshots', () => {
  test('restores independent seen state for a session', () => {
    const manager = new FeedPoolManager({ scheduler: TEST_SCHEDULER, logger: { info() {}, warn() {}, error() {} } });
    const snapshot = {
      pool: [{ id: 'one' }, { id: 'two' }],
      seenIds: ['one'],
      seenItems: [{ id: 'one' }],
      cursors: [['source', { cursor: null, exhausted: true }]],
      batchCount: 3,
      scrollConfig: { batch_size: 15 },
    };
    expect(manager.restore('alice', 'tab-a', snapshot)).toBe(true);
    expect(manager.hasSession('alice', 'tab-a')).toBe(true);
    expect(manager.hasSession('alice', 'tab-b')).toBe(false);
    expect(manager.hasMore('alice', 'tab-a')).toBe(true);
    expect(manager.snapshot('alice', 'tab-a')).toMatchObject({ seenIds: ['one'], batchCount: 3 });
    expect(manager.getSessionItems('alice', 'tab-a')).toEqual([{ id: 'one' }]);
  });
});
