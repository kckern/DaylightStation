import { jest } from '@jest/globals';
import { YamlSelectionTrackingStore } from '../../../../backend/src/1_adapters/persistence/yaml/YamlSelectionTrackingStore.mjs';

describe('YamlSelectionTrackingStore', () => {
  let store;
  let mockDataService;
  let storedData;

  beforeEach(() => {
    storedData = null;
    mockDataService = {
      user: {
        read: jest.fn(() => storedData),
        write: jest.fn((path, data) => { storedData = data; return true; }),
      },
    };
    store = new YamlSelectionTrackingStore({ dataService: mockDataService });
  });

  test('getAll returns empty Map when no data exists', async () => {
    const result = await store.getAll('testuser');
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  test('incrementBatch creates new records', async () => {
    await store.incrementBatch(['abc123', 'def456'], 'testuser');
    const result = await store.getAll('testuser');
    expect(result.get('abc123').count).toBe(1);
    expect(result.get('def456').count).toBe(1);
    expect(result.get('abc123').last).toBeDefined();
  });

  test('incrementBatch increments existing records', async () => {
    await store.incrementBatch(['abc123'], 'testuser');
    await store.incrementBatch(['abc123'], 'testuser');
    const result = await store.getAll('testuser');
    expect(result.get('abc123').count).toBe(2);
  });

  test('incrementBatch updates last timestamp', async () => {
    await store.incrementBatch(['abc123'], 'testuser');
    const first = (await store.getAll('testuser')).get('abc123').last;
    await new Promise(r => setTimeout(r, 10));
    await store.incrementBatch(['abc123'], 'testuser');
    const second = (await store.getAll('testuser')).get('abc123').last;
    expect(new Date(second).getTime()).toBeGreaterThanOrEqual(new Date(first).getTime());
  });

  test('writes to correct path', async () => {
    await store.incrementBatch(['abc123'], 'testuser');
    expect(mockDataService.user.write).toHaveBeenCalledWith(
      'current/feed/_selection_tracking',
      expect.any(Object),
      'testuser'
    );
  });
});
