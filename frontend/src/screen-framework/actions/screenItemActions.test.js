import { describe, it, expect, vi } from 'vitest';
import { createScreenItemActions } from './screenItemActions.js';
import { createLocalSessionController } from '../../modules/Media/session/LocalSessionController.js';

describe('screen item actions', () => {
  it('serializes rapid queue mutations across the actual asynchronous owner commit', async () => {
    const c = createLocalSessionController({ clientId: 'screen' });
    c.queue.playNow({ contentId: 'old', format: 'video' });
    const commits = [];
    const actions = createScreenItemActions({ source: {
      capture: c.portability.capture,
      applyQueue: queue => { commits.push(() => c.store.replace({ ...c.getSnapshot(), queue })); return { ok: true }; },
      adopt: c.portability.adopt,
    }, targetId: 'screen' });
    const command = id => ({ kind: 'playNext', item: { contentId: id }, operationId: id, tappedAt: Date.now() });
    const first = actions.execute(command('first'));
    const second = actions.execute(command('second'));
    const concurrentCommits = commits.length;
    commits[0]();
    await first;
    await vi.waitFor(() => expect(commits).toHaveLength(2));
    commits[1]();
    await second;
    expect(concurrentCommits).toBe(1);
    expect(c.getSnapshot().queue.items.map(item => item.contentId)).toEqual(['old', 'first', 'second']);
  });
  it('replaces an existing playback owner through validated adoption and preserves its tail', async () => {
    const c = createLocalSessionController({ clientId: 'screen' });
    c.queue.playNow({ contentId: 'old', format: 'video' });
    c.queue.add({ contentId: 'tail', format: 'video' });
    const actions = createScreenItemActions({ source: {
      capture: c.portability.capture,
      applyQueue: queue => { c.store.replace({ ...c.getSnapshot(), queue }); return { ok: true }; },
      adopt: c.portability.adopt,
    }, targetId: 'screen' });
    const result = await actions.execute({ kind: 'playNow', item: { contentId: 'new', format: 'video' }, clearRest: false, operationId: 'replace', tappedAt: Date.now() });
    expect(result).toMatchObject({ ok: true });
    expect(c.getSnapshot().queue.items.map(x => x.contentId)).toEqual(['new', 'tail']);
  });
  it('executes FIFO next and undo against the actual source without replacing current playback', async () => {
    const c = createLocalSessionController({ clientId: 'screen' });
    c.queue.playNow({ contentId: 'old', format: 'video' });
    let playbackReplaced = false;
    const source = {
      capture: c.portability.capture,
      applyQueue: (queue) => { c.store.replace({ ...c.getSnapshot(), queue }); return { ok: true }; },
      adopt: (snapshot) => { playbackReplaced = true; return c.portability.adopt(snapshot); },
    };
    const actions = createScreenItemActions({ source, targetId: 'screen' });
    for (const id of ['a', 'b']) {
      expect((await actions.execute({ kind: 'playNext', item: { contentId: id }, operationId: id, tappedAt: Date.now() })).ok).toBe(true);
    }
    expect(c.getSnapshot().queue.items.map(x => x.contentId)).toEqual(['old', 'a', 'b']);
    expect(playbackReplaced).toBe(false);
    expect((await actions.undo('b')).ok).toBe(true);
    expect(c.getSnapshot().queue.items.map(x => x.contentId)).toEqual(['old', 'a']);
    expect(playbackReplaced).toBe(false);
  });
  it('fails explicitly when the receiver has no owner', async () => {
    const actions = createScreenItemActions({ source: null, targetId: 'screen' });
    expect(await actions.execute({ kind: 'add', operationId: 'op' })).toMatchObject({ ok: false, code: 'ITEM_ACTION_UNSUPPORTED', reason: expect.any(String) });
  });
  it('guards idle held-queue undo with the action owner even without playback identity', async () => {
    const c = createLocalSessionController({ clientId: 'screen' });
    let queueRevision = 0;
    const source = {
      capture: () => ({ snapshot: c.getSnapshot(), identity: null }),
      getActionOwner: () => ({ ownerInstanceId: 'mounted', queueRevision }),
      applyQueue: queue => { queueRevision++; c.store.replace({ ...c.getSnapshot(), queue }); return { ok: true }; },
      adopt: snapshot => { queueRevision++; c.store.replace(snapshot); return { ok: true }; },
    };
    const actions = createScreenItemActions({ source, targetId: 'screen' });
    await actions.execute({ kind: 'add', item: { contentId: 'held' }, operationId: 'held', tappedAt: Date.now() });
    queueRevision++; // A newer owner action must invalidate the old Undo.
    expect(await actions.undo('held')).toMatchObject({ ok: false, code: 'UNDO_SUPERSEDED' });
  });

  it('uses snapshot adoption only for Undo of Clear that unlinked the paused current visit', async () => {
    const c = createLocalSessionController({ clientId: 'screen' });
    c.queue.playNow({ contentId: 'old', format: 'video' });
    c.queue.add({ contentId: 'tail', format: 'video' });
    const node = { currentTime: 37, paused: true };
    c.setPlayerHandle({ getMediaElement: () => node, getMountedContentId: () => 'old' });
    c.onPlayerStateChange('paused', 'old');
    const originalVisit = c.getSnapshot().queue.items[0].queueItemId;
    let queueRevision = 0;
    const adopt = vi.fn(snapshot => {
      queueRevision += 1;
      c.store.replace(snapshot);
      return { ok: true };
    });
    const actions = createScreenItemActions({ source: {
      capture: c.portability.capture,
      getActionOwner: () => ({ ownerInstanceId: 'screen', queueRevision, stopRevision: 0 }),
      applyQueue: queue => {
        queueRevision += 1;
        c.store.replace({ ...c.getSnapshot(), queue });
        return { ok: true };
      },
      adopt,
    }, targetId: 'screen' });

    expect((await actions.execute({ kind: 'clear', operationId: 'clear-current', tappedAt: Date.now() })).ok).toBe(true);
    expect(adopt).not.toHaveBeenCalled();
    node.currentTime = 0;
    c.onPlayerPositionTick(0, 'old');
    expect((await actions.undo('clear-current')).ok).toBe(true);
    const [adopted, options] = adopt.mock.calls[0];
    expect(adopted).toMatchObject({ state: 'paused', position: 37, queue: { currentIndex: 0 } });
    expect(adopted.queue.items[0].queueItemId).toBe(originalVisit);
    expect(options).toMatchObject({ autoplay: false });
  });
});
