// tests/isolated/adapter/content/list/ListAdapter.pickViaStrategy.test.mjs
//
// The office-program poetry slot (`strategy: rotation`) once every poem has
// been heard: the candidates must carry `lastPlayed` (and the progress
// `duration`) so ItemSelectionService can play the least recently heard poem
// instead of a uniform random one.
import { describe, it, expect, vi } from 'vitest';

vi.mock('#system/utils/FileIO.mjs', () => ({
  dirExists: vi.fn(() => false),
  listEntries: vi.fn(() => []),
  fileExists: vi.fn(() => true),
  loadYaml: vi.fn(() => null),
  getStats: vi.fn(() => ({ mtimeMs: 1 })),
}));

const { ListAdapter } = await import('#adapters/content/list/ListAdapter.mjs');

const poems = ['07', '59', '60'].map((n) => ({ id: `readalong:poetry/remedy/${n}`, title: `Poem ${n}` }));
const progress = [
  { contentId: 'readalong:poetry/remedy/07', percent: 100, duration: 19, lastPlayed: '2026-09-27 11:27:31' },
  { contentId: 'readalong:poetry/remedy/59', percent: 100, duration: 20, lastPlayed: '2026-08-16 07:41:26' },
  { contentId: 'readalong:poetry/remedy/60', percent: 100, duration: 17, lastPlayed: '2026-10-02 07:40:53' },
];

function makeAdapter() {
  const resolved = {
    adapter: { source: 'readalong', resolvePlayables: vi.fn(async () => poems), getStoragePath: vi.fn(async () => 'poetry') },
    localId: 'poetry/remedy',
  };
  const adapter = new ListAdapter({
    dataPath: '/fake/data',
    registry: null,
    mediaProgressMemory: { listProgress: vi.fn(async () => progress) },
  });
  return { adapter, resolved };
}

describe('ListAdapter._pickViaStrategy (rotation)', () => {
  it('passes lastPlayed and duration through so an exhausted rotation plays the least recently heard poem', async () => {
    const { adapter, resolved } = makeAdapter();
    for (let i = 0; i < 10; i++) {
      const [picked] = await adapter._pickViaStrategy('rotation', resolved, { id: 'poem:remedy', source: 'poem' });
      expect(picked.id).toBe('readalong:poetry/remedy/59');
      expect(picked.lastPlayed).toBe('2026-08-16 07:41:26');
    }
  });
});
