// tests/unit/adapters/persistence/YamlWatchStateStore.test.mjs
import { YamlWatchStateStore } from '../../../../backend/src/adapters/persistence/yaml/YamlWatchStateStore.mjs';
import { WatchState } from '../../../../backend/src/domains/content/entities/WatchState.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDataPath = path.resolve(__dirname, '../../../_fixtures/watch-state');

describe('YamlWatchStateStore', () => {
  let store;

  beforeAll(() => {
    fs.mkdirSync(testDataPath, { recursive: true });
  });

  beforeEach(() => {
    store = new YamlWatchStateStore({ basePath: testDataPath });
  });

  afterEach(() => {
    // Clean up test files
    try {
      const files = fs.readdirSync(testDataPath);
      for (const file of files) {
        fs.unlinkSync(path.join(testDataPath, file));
      }
    } catch (e) {}
  });

  test('set and get watch state', async () => {
    const state = new WatchState({
      itemId: 'plex:12345',
      playhead: 3600,
      duration: 7200
    });

    await store.set(state, 'plex');
    const retrieved = await store.get('plex:12345', 'plex');

    expect(retrieved).not.toBeNull();
    expect(retrieved.itemId).toBe('plex:12345');
    expect(retrieved.playhead).toBe(3600);
  });

  test('get returns null for missing item', async () => {
    const result = await store.get('nonexistent:123', 'test');
    expect(result).toBeNull();
  });

  test('getAll returns all states for storage path', async () => {
    await store.set(new WatchState({ itemId: 'plex:1', playhead: 100, duration: 1000 }), 'plex');
    await store.set(new WatchState({ itemId: 'plex:2', playhead: 200, duration: 2000 }), 'plex');

    const all = await store.getAll('plex');
    expect(all.length).toBe(2);
  });

  test('clear removes all states for storage path', async () => {
    await store.set(new WatchState({ itemId: 'plex:1', playhead: 100, duration: 1000 }), 'plex');
    await store.clear('plex');

    const all = await store.getAll('plex');
    expect(all.length).toBe(0);
  });

  test('throws error when basePath is missing', () => {
    expect(() => new YamlWatchStateStore({})).toThrow('requires basePath');
  });
});
