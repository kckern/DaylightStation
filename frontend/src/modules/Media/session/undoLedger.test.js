import { describe, it, expect, vi } from 'vitest';
import { createLocalSessionController } from './LocalSessionController.js';
import { executeItemAction } from '../actions/itemAction.js';
import { createUndoLedger } from './undoLedger.js';

function fixture() {
  let time = 1000, revision = 0, value = 'old';
  const ledger = createUndoLedger({ targetId: 'tv', now: () => time, capture: () => ({ value }), revision: () => revision, restore: snapshot => { value = snapshot.value; revision++; return { ok: true }; } });
  return { ledger, advance: ms => { time += ms; }, apply: () => { value = 'new'; revision++; }, newer: () => { value = 'newer'; revision++; }, value: () => value };
}
describe('owner undo ledger', () => {
  it('Undo before ACK cancels pending application', async () => {
    const f = fixture();
    f.ledger.begin({ operationId: 'op', tappedAt: 1000 });
    expect((await f.ledger.undo('op')).ok).toBe(true);
    expect(f.ledger.canApply('op')).toBe(false);
    expect(f.value()).toBe('old');
  });
  it('Undo after ACK restores only its applied revision', async () => {
    const f = fixture();
    f.ledger.begin({ operationId: 'op', tappedAt: 1000 });
    f.apply(); f.ledger.applied('op');
    expect(await f.ledger.undo('op')).toMatchObject({ ok: true, status: 'undone' });
    expect(f.value()).toBe('old');
  });
  it('expires at tap plus ten seconds, not ACK plus ten seconds', async () => {
    const f = fixture();
    f.ledger.begin({ operationId: 'op', tappedAt: 1000 });
    f.advance(9000); f.apply(); f.ledger.applied('op'); f.advance(1000);
    expect(await f.ledger.undo('op')).toMatchObject({ ok: false, code: 'UNDO_EXPIRED' });
    expect(f.value()).toBe('new');
  });
  it('an early cancellation also rejects late out-of-order delivery', async () => {
    const f = fixture();
    await f.ledger.undo('op'); f.advance(15000);
    f.ledger.begin({ operationId: 'op', tappedAt: 1000 });
    expect(f.ledger.canApply('op')).toBe(false);
  });
  it('a slow cold wake may still apply after the undo window has expired', async () => {
    const f = fixture();
    f.advance(20000);
    f.ledger.begin({ operationId: 'op', tappedAt: 1000 });
    expect(f.ledger.canApply('op')).toBe(true);
    expect(await f.ledger.undo('op')).toMatchObject({ ok: false, code: 'UNDO_EXPIRED' });
    expect(f.ledger.canApply('op')).toBe(true);
  });
  it('never replaces newer playback', async () => {
    const f = fixture();
    f.ledger.begin({ operationId: 'op', tappedAt: 1000 }); f.apply(); f.ledger.applied('op'); f.newer();
    expect(await f.ledger.undo('op')).toMatchObject({ ok: false, code: 'UNDO_SUPERSEDED' });
    expect(f.value()).toBe('newer');
  });
  it('undo requested while the owner is committing is applied after that commit', async () => {
    const f = fixture();
    f.ledger.begin({ operationId: 'op', tappedAt: 1000 });
    f.ledger.applying('op');
    expect(await f.ledger.undo('op')).toMatchObject({ ok: true, status: 'undo-pending' });
    f.apply();
    await f.ledger.applied('op');
    expect(f.value()).toBe('old');
  });
});

describe('local owner undo integration', () => {
  it('a newer Stop after Clear cannot be undone by the old Clear operation', async () => {
    const c = createLocalSessionController({ clientId: 'local' });
    c.queue.playNow({ contentId: 'old', format: 'video' });
    await c.execute({ kind: 'clear', operationId: 'clear-old' });
    c.transport.stop();
    expect(await c.undo('clear-old')).toMatchObject({ ok: false, code: 'UNDO_SUPERSEDED' });
  });
  it('removing the final playing entry stops the native owner and remains undoable', async () => {
    const c = createLocalSessionController({ clientId: 'local' });
    const pause = vi.fn();
    c.setPlayerHandle({ pause });
    c.queue.playNow({ contentId: 'last', format: 'video' });
    const queueItemId = c.getSnapshot().queue.items[0].queueItemId;
    await c.execute({ kind: 'remove', queueItemId, operationId: 'remove-last' });
    expect(pause).toHaveBeenCalled();
    expect(c.getSnapshot().state).toBe('idle');
    expect((await c.undo('remove-last')).ok).toBe(true);
    expect(c.getSnapshot().queue.items[0].queueItemId).toBe(queueItemId);
  });
  it('a newer Play wins while an older collection is still resolving', async () => {
    let resolve;
    const c = createLocalSessionController({ clientId: 'local', fetchImpl: () => new Promise(r => { resolve = r; }) });
    const old = executeItemAction({ kind: 'playNow', item: { contentId: 'plex:album', type: 'album' }, destination: c, operationId: 'old' });
    await executeItemAction({ kind: 'playNow', item: { contentId: 'new', format: 'video' }, destination: c, operationId: 'new' });
    resolve({ ok: true, json: async () => ({ items: [{ id: 'plex:track', type: 'track' }] }) });
    expect((await old).ok).toBe(false);
    expect(c.getSnapshot().currentItem.contentId).toBe('new');
  });
  it('removal and clear expose an undo record that restores queue entries', async () => {
    const c = createLocalSessionController({ clientId: 'local' });
    c.queue.playNow({ contentId: 'one', format: 'video' });
    c.queue.add({ contentId: 'two', format: 'video' });
    const entries = c.getSnapshot().queue.items;
    await c.execute({ kind: 'remove', queueItemId: entries[1].queueItemId, operationId: 'remove' });
    expect(c.getSnapshot().queue.items).toHaveLength(1);
    await c.undo('remove');
    expect(c.getSnapshot().queue.items.map(x => x.queueItemId)).toEqual(entries.map(x => x.queueItemId));
    await c.execute({ kind: 'clear', operationId: 'clear' });
    expect(c.getSnapshot().queue.items).toHaveLength(0);
    await c.undo('clear');
    expect(c.getSnapshot().queue.items).toHaveLength(2);
  });
  it('captures native position before replacement and restores the prior queue generation', async () => {
    const c = createLocalSessionController({ clientId: 'local' });
    c.queue.playNow({ contentId: 'old', format: 'video', duration: 120 });
    const priorId = c.getSnapshot().queue.items[0].queueItemId;
    c.onPlayerStateChange('paused');
    c.setPlayerHandle({ getMediaElement: () => node, getMountedContentId: () => 'old' });
    const node = { currentTime: 43, paused: true };
    await executeItemAction({ kind: 'playNow', item: { contentId: 'new', format: 'video' }, destination: c, operationId: 'op' });
    expect((await c.undo('op')).ok).toBe(true);
    expect(c.getSnapshot().queue.items[0].queueItemId).toBe(priorId);
    expect(c.getSnapshot().position).toBe(43);
  });
  it('restores live playback at live edge instead of replaying a stale timestamp', async () => {
    const c = createLocalSessionController({ clientId: 'local' });
    c.queue.playNow({ contentId: 'live', isLive: true });
    c.onPlayerProgress(80);
    await executeItemAction({ kind: 'playNow', item: { contentId: 'new' }, destination: c, operationId: 'op' });
    await c.undo('op');
    expect(c.getSnapshot().currentItem.contentId).toBe('live');
    expect(c.getSnapshot().position).toBe(0);
  });
});
