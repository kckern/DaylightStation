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

const { ListAdapter, withParams } = await import('./ListAdapter.mjs');
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

describe('withParams', () => {
  it('returns the open action unchanged when the item has no params', () => {
    const open = { app: 'party-games/charades:fhe' };
    expect(withParams(open, undefined)).toBe(open);
  });

  it('lets item-level params win over params already on the open action', () => {
    expect(withParams({ app: 'x', params: { autostart: false, rounds: 3 } }, { autostart: true }))
      .toEqual({ app: 'x', params: { autostart: true, rounds: 3 } });
  });
});

describe('ListAdapter — list item params on queued app playables', () => {
  const appPlayable = (id) => ({ id: `app:${id}`, title: id, source: 'app', mediaUrl: null, mediaType: 'app', format: 'app', metadata: { contentFormat: 'app' } });

  function makeQueueAdapter(listKey, rawItems) {
    const appAdapter = { source: 'app', resolvePlayables: vi.fn(async (id) => [appPlayable(id.replace(/^app:/, ''))]) };
    const plexAdapter = { source: 'plex', resolvePlayables: vi.fn(async (id) => [{ id, title: id, mediaUrl: `/m/${id}`, format: 'video', metadata: {} }]) };
    const adapter = new ListAdapter({
      dataPath: '/fake/data',
      registry: { resolve: vi.fn((input) => {
        const [source, ...rest] = input.split(':');
        return { localId: rest.join(':'), adapter: source === 'app' ? appAdapter : plexAdapter };
      }) },
      mediaProgressMemory: null,
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    });
    adapter._listCache.set(listKey, { mtime: 1, data: normalizeListConfig({ items: rawItems }, 'x') });
    return { adapter, appAdapter };
  }

  it('gives a program app slot its item params, and leaves other slots alone', async () => {
    const { adapter } = makeQueueAdapter('programs:evening', [
      { label: 'Charades', input: 'app:party-games/charades:fhe', action: 'Play', params: { autostart: true } },
      { label: 'Song', input: 'plex:123', action: 'Play' },
      { label: 'Wrap-up', input: 'app:wrapup', action: 'Play' },
    ]);
    const items = await adapter.resolvePlayables('program:evening', { applySchedule: false });
    expect(items.map(i => i.id)).toEqual(['app:party-games/charades:fhe', 'plex:123', 'app:wrapup']);
    expect(items[0].params).toEqual({ autostart: true });
    expect('params' in items[1]).toBe(false);
    expect('params' in items[2]).toBe(false);
  });

  it('does not put params on a non-app playable even when the item has them', async () => {
    const { adapter } = makeQueueAdapter('menus:mix', [
      { label: 'Song', input: 'plex:123', action: 'Queue', params: { autostart: true } },
    ]);
    const items = await adapter.resolvePlayables('menu:mix');
    expect(items).toHaveLength(1);
    expect('params' in items[0]).toBe(false);
  });

  it('copies rather than mutating the playable the app adapter returned', async () => {
    const { adapter, appAdapter } = makeQueueAdapter('menus:fhe2', [
      { label: 'Charades', input: 'app:party-games/charades:fhe', action: 'Queue', params: { autostart: true } },
    ]);
    const original = appPlayable('party-games/charades:fhe');
    appAdapter.resolvePlayables.mockResolvedValueOnce([original]);
    const [item] = await adapter.resolvePlayables('menu:fhe2');
    expect(item.params).toEqual({ autostart: true });
    expect('params' in original).toBe(false);
  });
});
