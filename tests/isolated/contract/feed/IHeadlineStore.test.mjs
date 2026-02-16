// tests/isolated/contract/feed/IHeadlineStore.test.mjs
import { describe, test, expect } from '@jest/globals';
import { IHeadlineStore } from '#apps/feed/ports/IHeadlineStore.mjs';

describe('IHeadlineStore contract', () => {
  test('all methods throw "Not implemented"', async () => {
    const store = new IHeadlineStore();
    await expect(store.loadSource('cnn', 'user1')).rejects.toThrow('Not implemented');
    await expect(store.saveSource('cnn', [], 'user1')).rejects.toThrow('Not implemented');
    await expect(store.loadAllSources('user1')).rejects.toThrow('Not implemented');
    await expect(store.pruneOlderThan('cnn', new Date(), 'user1')).rejects.toThrow('Not implemented');
  });
});
