// tests/isolated/contract/feed/ISelectionTrackingStore.test.mjs
import { describe, test, expect } from '@jest/globals';
import { ISelectionTrackingStore } from '#apps/feed/ports/ISelectionTrackingStore.mjs';

describe('ISelectionTrackingStore contract', () => {
  test('getAll throws not implemented', async () => {
    const store = new ISelectionTrackingStore();
    await expect(store.getAll('user')).rejects.toThrow('Not implemented');
  });

  test('incrementBatch throws not implemented', async () => {
    const store = new ISelectionTrackingStore();
    await expect(store.incrementBatch(['id1'], 'user')).rejects.toThrow('Not implemented');
  });
});
