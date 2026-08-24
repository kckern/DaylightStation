import { describe, expect, test, vi } from 'vitest';
import { FeedStateService } from '#apps/feed/services/FeedStateService.mjs';

function createStore() {
  let data = { version: 1, items: {}, aliases: {} };
  return {
    load: () => data,
    getMany: (_username, keys) => new Map(keys.map(key => [key, data.items[key] || null])),
    update: async (_username, updater) => { data = await updater(data); return data; },
  };
}

function createHistory() {
  const docs = new Map();
  return {
    record: (_username, items) => { for (const item of items) docs.set(item.id, item); },
    setSaved: vi.fn(),
    findById: (_username, id) => docs.get(id) || null,
    search: (_username, { states }) => ({
      items: [...docs.values()],
      total: docs.size,
      nextOffset: null,
      states,
    }),
    summarize: (_username, states) => ({
      unread: [...docs.values()].filter(doc => !(states.get(doc.stateKey)?.isRead ?? doc.isRead)).length,
      saved: [...states.values()].filter(state => state.isSaved).length,
      archived: [...states.values()].filter(state => state.isArchived).length,
    }),
    exportDocuments: () => [...docs.values()],
  };
}

describe('FeedStateService', () => {
  test('enriches, persists, and returns state consistently', async () => {
    const history = createHistory();
    const service = new FeedStateService({ store: createStore(), historyStore: history });
    const [item] = service.enrich('alice', [{ id: 'one', title: 'One', link: 'https://example.com/one' }], 'reader');
    await service.mutate('alice', [item.id], 'save');
    expect(history.setSaved).toHaveBeenCalledWith('alice', [expect.objectContaining({ id: 'one' })], true);
    const [again] = service.enrich('alice', [{ id: 'one', title: 'One', link: 'https://example.com/one' }], 'reader');
    expect(again.state.isSaved).toBe(true);
  });

  test('keeps local state and reports pending when FreshRSS sync fails', async () => {
    const adapter = { sourceType: 'freshrss', markRead: vi.fn().mockRejectedValue(new Error('offline')) };
    const service = new FeedStateService({ store: createStore(), historyStore: createHistory(), sourceAdapters: [adapter], logger: { warn: vi.fn() } });
    const [item] = service.enrich('alice', [{ id: 'tag:google.com,2005:reader/item/abc', title: 'One', link: 'https://example.com/one' }], 'reader');
    const [result] = await service.mutate('alice', [item.id], 'read');
    expect(result.state).toMatchObject({ isRead: true, syncStatus: 'pending' });
    expect(adapter.markRead).toHaveBeenCalledWith(['tag:google.com,2005:reader/item/abc'], 'alice');
  });

  test('backfills FreshRSS history in the background', async () => {
    const adapter = {
      sourceType: 'freshrss',
      getHistoryPage: vi.fn().mockResolvedValue({
        items: [{ id: 'old-news', title: 'Indexed article', published: new Date().toISOString() }],
        continuation: null,
      }),
    };
    const history = createHistory();
    const service = new FeedStateService({ store: createStore(), historyStore: history, sourceAdapters: [adapter] });
    const progress = service.ensureHistoryBackfill('alice');
    await progress.promise;
    expect(service.historyBackfillStatus('alice')).toMatchObject({ status: 'complete', indexed: 1 });
    expect(service.search('alice', { query: 'indexed' }).items).toHaveLength(1);
  });

  test('surfaces legacy dismissals as archived during lazy migration', () => {
    const service = new FeedStateService({
      store: createStore(),
      historyStore: createHistory(),
      legacyDismissedStore: { load: () => new Set(['legacy-id']) },
    });
    const [item] = service.enrich('alice', [{ id: 'legacy-id', title: 'Old card' }], 'scroll');
    expect(item.state.isArchived).toBe(true);
  });

  test('persists failed source synchronization and clears it after retry', async () => {
    const adapter = { sourceType: 'freshrss', markRead: vi.fn().mockRejectedValueOnce(new Error('offline')) };
    const service = new FeedStateService({ store: createStore(), historyStore: createHistory(), sourceAdapters: [adapter], logger: { warn() {}, info() {} } });
    const [item] = service.enrich('alice', [{ id: 'tag:google.com,2005:reader/item/retry', title: 'Retry', link: 'https://example.com/retry' }], 'reader');
    await service.mutate('alice', [item.id], 'read');
    expect(service.summary('alice').pendingSync).toBe(1);
    adapter.markRead.mockResolvedValueOnce(undefined);
    await service.retryPending('alice', { force: true });
    expect(service.summary('alice').pendingSync).toBe(0);
    expect(adapter.markRead).toHaveBeenLastCalledWith(['tag:google.com,2005:reader/item/retry'], 'alice');
  });

  test('persists normalized reading preferences and per-mode checkpoints', async () => {
    const service = new FeedStateService({ store: createStore(), historyStore: createHistory() });
    await service.updatePreferences('alice', { theme: 'sepia', fontScale: 99, measure: 57, unknown: 'ignored' });
    const checkpoint = await service.recordCheckpoint('alice', 'reader', { itemId: 'article-9', scrollOffset: 123.6 });

    expect(service.getWorkspace('alice')).toEqual({
      preferences: { theme: 'sepia', density: 'comfortable', fontScale: 1.5, lineHeight: 1.65, measure: 57, sessionBudget: 0 },
      preferencesStored: true,
      sourcePreferences: {},
      checkpoints: { reader: checkpoint },
    });
    await expect(service.recordCheckpoint('alice', 'invalid', {})).rejects.toThrow('Unsupported feed checkpoint mode');
  });

  test('creates, edits, lists, and deletes annotations without changing item identity', async () => {
    const history = createHistory();
    const service = new FeedStateService({ store: createStore(), historyStore: history });
    const [item] = service.enrich('alice', [{ id: 'annotated', title: 'Article', link: 'https://example.com/a' }], 'reader');
    const locator = JSON.stringify({ type: 'TextQuoteSelector', exact: 'Key sentence', prefix: 'A ', suffix: ' here.' });
    const created = await service.createAnnotation('alice', { itemId: item.id, quote: 'Key sentence', note: 'Remember this', color: 'green', locator });
    const updated = await service.updateAnnotation('alice', created.id, { itemId: 'different', stateKey: 'different', note: 'Revised' });

    expect(updated).toMatchObject({ id: created.id, itemId: item.id, stateKey: item.stateKey, quote: 'Key sentence', note: 'Revised', color: 'green', locator });
    expect(service.listAnnotations('alice', item.id)).toHaveLength(1);
    expect(await service.deleteAnnotation('alice', created.id)).toBe(true);
    expect(service.listAnnotations('alice', item.id)).toEqual([]);
  });

  test('preserves a client annotation id for ordered offline replay', async () => {
    const history = createHistory();
    const service = new FeedStateService({ store: createStore(), historyStore: history });
    const [item] = service.enrich('alice', [{ id: 'offline-note', title: 'Article' }], 'reader');
    const created = await service.createAnnotation('alice', { id: 'client-note-1', itemId: item.id, note: 'Queued note' });

    expect(created.id).toBe('client-note-1');
    await expect(service.createAnnotation('alice', { id: 'client-note-1', itemId: item.id, note: 'Duplicate' })).rejects.toThrow('Annotation already exists');
  });

  test('persists reversible per-source ranking preferences', async () => {
    const service = new FeedStateService({ store: createStore(), historyStore: createHistory() });
    expect(await service.updateSourcePreference('alice', 'reddit', 'less')).toEqual({ reddit: 'less' });
    expect(await service.updateSourcePreference('alice', 'headlines', 'mute')).toEqual({ reddit: 'less', headlines: 'mute' });
    expect(service.getSourcePreferences('alice')).toEqual({ reddit: 'less', headlines: 'mute' });
    expect(await service.updateSourcePreference('alice', 'reddit', 'normal')).toEqual({ headlines: 'mute' });
    await expect(service.updateSourcePreference('alice', 'reddit', 'invalid')).rejects.toThrow('Unsupported source preference');
  });

  test('round-trips portable state, checkpoints, annotations, and history safely', async () => {
    const source = new FeedStateService({ store: createStore(), historyStore: createHistory() });
    const [item] = source.enrich('alice', [{ id: 'portable', title: 'Portable article', link: 'https://example.com/portable', summary: 'Useful summary' }], 'reader');
    await source.mutate('alice', [item.id], 'save');
    await source.recordCheckpoint('alice', 'reader', { itemId: item.id, scrollOffset: 80 });
    await source.createAnnotation('alice', { itemId: item.id, note: 'Takeaway' });
    await source.updatePreferences('alice', { theme: 'light' });

    const payload = source.exportData('alice');
    const target = new FeedStateService({ store: createStore(), historyStore: createHistory() });
    const imported = await target.importData('bob', payload);

    expect(imported).toEqual({ states: 1, annotations: 1, items: 1 });
    expect(target.getWorkspace('bob')).toMatchObject({ preferences: { theme: 'light' }, checkpoints: { reader: { itemId: item.id, scrollOffset: 80 } } });
    expect(target.search('bob', { query: 'portable' }).items[0]).toMatchObject({ title: 'Portable article', state: { isSaved: true } });
    expect(target.listAnnotations('bob', item.id)[0]).toMatchObject({ note: 'Takeaway' });
  });
});
