// A list item's `params` belong to the item's type. For an app item they must
// ride along on the open action so the opened app receives them.
import { describe, it, expect, vi } from 'vitest';

vi.mock('#system/utils/FileIO.mjs', () => ({
  dirExists: vi.fn(() => false),
  listEntries: vi.fn(() => []),
  fileExists: vi.fn(() => true),
  loadYaml: vi.fn(() => null),
  getStats: vi.fn(() => ({ mtimeMs: 1 })),
}));

const { ListAdapter } = await import('./ListAdapter.mjs');
const { normalizeListConfig } = await import('./ListConfigCodec.mjs');
const { toListItem } = await import('../../../api/list.mjs');

function makeAdapter(rawItems) {
  const adapter = new ListAdapter({
    dataPath: '/fake/data',
    registry: null,
    mediaProgressMemory: null,
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  });
  adapter._listCache.set('menus:fhe', { mtime: 1, data: normalizeListConfig({ items: rawItems }, 'fhe') });
  return adapter;
}

async function menuChildren(rawItems) {
  const list = await makeAdapter(rawItems).getList('menu:fhe');
  return list.children;
}

describe('ListAdapter — list item params on the open action', () => {
  it('carries item params onto actions.open and through the API projection', async () => {
    const [child] = await menuChildren([
      { label: 'Charades', input: 'app:party-games/charades:fhe', action: 'Open', params: { autostart: true } },
    ]);
    expect(child.actions.open).toEqual({ app: 'party-games/charades:fhe', params: { autostart: true } });
    expect(toListItem(child).open).toEqual({ app: 'party-games/charades:fhe', params: { autostart: true } });
  });

  it('leaves no params key on open when the item has none', async () => {
    const [child] = await menuChildren([
      { label: 'Charades', input: 'app:party-games/charades:fhe', action: 'Open' },
    ]);
    expect(child.actions.open).toEqual({ app: 'party-games/charades:fhe' });
    expect('params' in child.actions.open).toBe(false);
    expect('params' in toListItem(child).open).toBe(false);
  });
});
