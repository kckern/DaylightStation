import { describe, it, expect, vi } from 'vitest';
import { executeItemAction } from './itemAction.js';
import { createLocalSessionController } from '../session/LocalSessionController.js';

const item = (contentId) => ({ contentId, title: contentId, format: 'video', duration: 120 });
const ids = (controller) => controller.getSnapshot().queue.items.map(x => x.contentId);
function seeded(options) {
  const controller = createLocalSessionController({ clientId: 'local', ...options });
  controller.queue.playNow(item('old'));
  controller.queue.add(item('tail'));
  return controller;
}

describe('item actions at the owner boundary', () => {
  it.each(['add', 'playNext', 'playFirst', 'playNow'])('shuffled %s retains all unplayed visits through actual advancement and Undo', async kind => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const destination = seeded();
      destination.queue.add(item('last'));
      destination.config.setShuffle(true);
      await executeItemAction({ kind, item: item('new'), destination, operationId: 'edit' });
      const visited = [];
      for (let i = 0; i < 5 && destination.getSnapshot().state !== 'ended'; i++) {
        visited.push(destination.getSnapshot().currentItem.contentId);
        destination.transport.skipNext();
      }
      const expected = kind === 'add' ? ['old', 'tail', 'last', 'new']
        : kind === 'playNow' ? ['new', 'tail', 'last'] : ['old', 'new', 'tail', 'last'];
      expect(visited).toEqual(expected);
      const restored = seeded();
      restored.queue.add(item('last'));
      restored.config.setShuffle(true);
      await executeItemAction({ kind, item: item('new'), destination: restored, operationId: 'undo-edit' });
      expect((await restored.undo('undo-edit')).ok).toBe(true);
      const afterUndo = [];
      for (let i = 0; i < 4 && restored.getSnapshot().state !== 'ended'; i++) {
        afterUndo.push(restored.getSnapshot().currentItem.contentId);
        restored.transport.skipNext();
      }
      expect(afterUndo).toEqual(['old', 'tail', 'last']);
    } finally { random.mockRestore(); }
  });

  it.each(['add', 'playNext', 'playFirst'])('serializes overlapping collection %s intents in invocation order', async kind => {
    const resolvers = new Map();
    const destination = seeded({ fetchImpl: url => new Promise(resolve => resolvers.set(url, resolve)) });
    const args = id => ({ kind, item: { contentId: `plex:${id}`, type: 'album' }, destination, operationId: id });
    const first = executeItemAction(args('first'));
    const second = executeItemAction(args('second'));
    const resolveCollection = id => resolvers.get([...resolvers.keys()].find(key => key.endsWith(`/${id}`)))({ ok: true, json: async () => ({ items: [{ id: `plex:${id}-child`, type: 'track' }] }) });
    resolveCollection('second');
    await Promise.resolve(); await Promise.resolve();
    resolveCollection('first');
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(ids(destination)).toEqual(kind === 'add' ? ['old', 'tail', 'plex:first-child', 'plex:second-child']
      : kind === 'playFirst' ? ['old', 'plex:second-child', 'plex:first-child', 'tail']
        : ['old', 'plex:first-child', 'plex:second-child', 'tail']);
  });
  it('cancels only the undone queued intent and preserves subsequent FIFO edits', async () => {
    let resolve;
    const destination = seeded({ fetchImpl: () => new Promise(done => { resolve = done; }) });
    const first = executeItemAction({ kind: 'add', item: { contentId: 'plex:album', type: 'album' }, destination, operationId: 'first' });
    const cancelled = executeItemAction({ kind: 'add', item: item('cancelled'), destination, operationId: 'cancelled' });
    const last = executeItemAction({ kind: 'add', item: item('last'), destination, operationId: 'last' });
    expect((await destination.undo('cancelled')).ok).toBe(true);
    resolve({ ok: true, json: async () => ({ items: [{ id: 'plex:child', type: 'track' }] }) });
    expect((await first).ok).toBe(true);
    expect(await cancelled).toMatchObject({ ok: false, code: 'ITEM_ACTION_CANCELLED' });
    expect((await last).ok).toBe(true);
    expect(ids(destination)).toEqual(['old', 'tail', 'plex:child', 'last']);
  });
  it('a newer Play supersedes an older collection even if the older expansion resolves first', async () => {
    const resolves = [];
    const destination = seeded({ fetchImpl: () => new Promise(resolve => resolves.push(resolve)) });
    const command = id => ({ kind: 'playNow', item: { contentId: `plex:${id}`, type: 'album' }, destination, operationId: id });
    const old = executeItemAction(command('old-request'));
    const newer = executeItemAction(command('newer-request'));
    resolves[0]({ ok: true, json: async () => ({ items: [{ id: 'plex:old-child', type: 'track' }] }) });
    expect(await old).toMatchObject({ ok: false, code: 'ITEM_ACTION_CANCELLED' });
    expect(ids(destination)).toEqual(['old', 'tail']);
    resolves[1]({ ok: true, json: async () => ({ items: [{ id: 'plex:new-child', type: 'track' }] }) });
    expect((await newer).ok).toBe(true);
    expect(ids(destination)).toEqual(['plex:new-child']);
  });
  it('repeated same-title additions mint distinct queue generations', async () => {
    const destination = seeded();
    const existing = destination.getSnapshot().queue.items[0];
    await executeItemAction({ kind: 'add', item: existing, destination });
    const ids = destination.getSnapshot().queue.items.map(x => x.queueItemId);
    expect(new Set(ids).size).toBe(3);
  });
  it.each([
    ['playNow', ['new', 'tail']], ['playOn', ['new', 'tail']],
    ['playNext', ['old', 'new', 'tail']], ['playFirst', ['old', 'new', 'tail']],
    ['add', ['old', 'tail', 'new']], ['addOn', ['old', 'tail', 'new']],
    ['shuffle', ['new']],
  ])('%s mutates the selected owner', async (kind, expected) => {
    const destination = seeded();
    const result = await executeItemAction({ kind, item: item('new'), destination, operationId: 'op-1' });
    expect(result.ok).toBe(true);
    expect(ids(destination)).toEqual(expected);
  });

  it('details navigates without changing playback', async () => {
    const destination = seeded();
    let opened;
    await executeItemAction({ kind: 'details', item: item('new'), destination, options: { openDetails: id => { opened = id; } } });
    expect(opened).toBe('new');
    expect(ids(destination)).toEqual(['old', 'tail']);
  });

  it('Play Next is FIFO, and Play First inserts ahead of that band', async () => {
    const destination = seeded();
    for (const [kind, contentId] of [['playNext', 'a'], ['playNext', 'b'], ['playFirst', 'first']]) {
      await executeItemAction({ kind, item: item(contentId), destination });
    }
    expect(ids(destination)).toEqual(['old', 'first', 'a', 'b', 'tail']);
  });

  it('collection play replaces in natural order and switches shuffle off', async () => {
    const destination = seeded();
    destination.config.setShuffle(true);
    await executeItemAction({ kind: 'playNow', item: { ...item('album'), type: 'album' }, collectionItems: [item('one'), item('two')], destination });
    expect(ids(destination)).toEqual(['one', 'two']);
    expect(destination.getSnapshot().config.shuffle).toBe(false);
  });

  it('duplicate pending Play shares one operation and cannot enqueue twice', async () => {
    let resolve;
    const destination = seeded({ fetchImpl: () => new Promise(r => { resolve = r; }) });
    const args = { kind: 'playNow', item: { ...item('plex:album'), type: 'album' }, destination };
    const started = vi.fn();
    args.options = { onStarted: started };
    const first = executeItemAction({ ...args, operationId: 'one' });
    const second = executeItemAction({ ...args, operationId: 'two' });
    resolve({ ok: true, json: async () => ({ items: [{ id: 'plex:track', type: 'track' }] }) });
    expect(await second).toEqual(await first);
    expect(ids(destination)).toEqual(['plex:track']);
    expect(started).toHaveBeenCalledTimes(1);
  });

  it('unsupported receivers return a reason without falling back to local playback', async () => {
    const result = await executeItemAction({ kind: 'playNext', item: item('new'), destination: { id: 'old-tv' } });
    expect(result).toMatchObject({ ok: false, code: 'ITEM_ACTION_UNSUPPORTED', reason: expect.any(String) });
  });

  it('remote and local destinations receive identical canonical verbs and clearRest policy', async () => {
    for (const [kind, clearRest] of [['playNow', false], ['shuffle', true], ['playNext', false], ['playFirst', false], ['add', false]]) {
      let command;
      await executeItemAction({ kind, item: item('new'), destination: { execute: value => { command = value; return { ok: true }; } }, operationId: 'op-1' });
      expect(command).toMatchObject({ kind, clearRest, operationId: 'op-1' });
    }
  });
});
