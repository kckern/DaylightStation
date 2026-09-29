import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createIdleSessionSnapshot } from '@shared-contracts/media/shapes.mjs';
import { applyCommandEnvelope } from './commandHandler.js';
import { createLocalSessionController } from '../session/LocalSessionController.js';

function makeController() {
  return {
    transport: { play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seekAbs: vi.fn(), seekRel: vi.fn(), skipNext: vi.fn(), skipPrev: vi.fn() },
    queue: { playNow: vi.fn(), playNext: vi.fn(), addUpNext: vi.fn(), add: vi.fn(), remove: vi.fn(), reorder: vi.fn(), jump: vi.fn(), clear: vi.fn() },
    config: { setShuffle: vi.fn(), setRepeat: vi.fn(), setShader: vi.fn(), setVolume: vi.fn() },
    lifecycle: { reset: vi.fn(), adoptSnapshot: vi.fn() },
    setOrigin: vi.fn(),
    clearOrigin: vi.fn(),
  };
}

let c;
beforeEach(() => { c = makeController(); });

function env(command, params) {
  return { commandId: 'cmd-1', command, params, ts: '2026-06-10T00:00:00Z' };
}

describe('applyCommandEnvelope', () => {
  it('returns typed unsupported for valid handoff envelopes without touching the local owner', () => {
    const c = makeController();
    expect(applyCommandEnvelope(c, env('handoff', { version: 1, transferId: 'transfer-1', op: 'capture' }))).toEqual({
      ok: false, reason: 'HANDOFF_UNSUPPORTED', code: 'HANDOFF_UNSUPPORTED',
      handoff: { transferId: 'transfer-1', phase: 'failed', code: 'HANDOFF_UNSUPPORTED' },
    });
    expect(c.transport.stop).not.toHaveBeenCalled();
  });
  it('rejects envelopes that fail shared-contract validation', () => {
    const result = applyCommandEnvelope(c, { command: 'transport', params: { action: 'play' } }); // no commandId
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/commandId/);
  });

  it('routes transport actions with values', () => {
    expect(applyCommandEnvelope(c, env('transport', { action: 'seekAbs', value: 90 })).ok).toBe(true);
    expect(c.transport.seekAbs).toHaveBeenCalledWith(90);
  });

  it('applies routine origin before the command changes the published snapshot', () => {
    const origin = { kind: 'routine', name: 'Breakfast', triggerId: 'daily-0700' };
    expect(applyCommandEnvelope(c, { ...env('transport', { action: 'play' }), origin }).ok).toBe(true);
    expect(c.setOrigin).toHaveBeenCalledWith(origin);
    expect(c.setOrigin.mock.invocationCallOrder[0]).toBeLessThan(c.transport.play.mock.invocationCallOrder[0]);
  });

  it('routes queue play-now with clearRest', () => {
    expect(applyCommandEnvelope(c, env('queue', { op: 'play-now', contentId: 'plex:1', clearRest: true })).ok).toBe(true);
    expect(c.queue.playNow).toHaveBeenCalledWith({ contentId: 'plex:1' }, { clearRest: true });
  });

  it('routes queue reorder by id list or from/to', () => {
    applyCommandEnvelope(c, env('queue', { op: 'reorder', items: ['a', 'b'] }));
    expect(c.queue.reorder).toHaveBeenCalledWith({ items: ['a', 'b'] });
    applyCommandEnvelope(c, env('queue', { op: 'reorder', from: 'a', to: 'b' }));
    expect(c.queue.reorder).toHaveBeenCalledWith({ from: 'a', to: 'b' });
  });

  it('routes config setters', () => {
    applyCommandEnvelope(c, env('config', { setting: 'volume', value: 80 }));
    expect(c.config.setVolume).toHaveBeenCalledWith(80);
    applyCommandEnvelope(c, env('config', { setting: 'repeat', value: 'all' }));
    expect(c.config.setRepeat).toHaveBeenCalledWith('all');
  });

  it('routes adopt-snapshot with autoplay flag (full valid snapshot required)', () => {
    const snapshot = createIdleSessionSnapshot({ sessionId: 'x', ownerId: 'c9' });
    const result = applyCommandEnvelope(c, env('adopt-snapshot', { snapshot, autoplay: false }));
    expect(result.ok).toBe(true);
    expect(c.lifecycle.adoptSnapshot).toHaveBeenCalledWith(snapshot, { autoplay: false });
  });

  it('rejects adopt-snapshot with a partial snapshot', () => {
    const result = applyCommandEnvelope(c, env('adopt-snapshot', { snapshot: { sessionId: 'x' } }));
    expect(result.ok).toBe(false);
    expect(c.lifecycle.adoptSnapshot).not.toHaveBeenCalled();
  });

  it('rejects unknown command kinds via validation', () => {
    const result = applyCommandEnvelope(c, env('self-destruct', {}));
    expect(result.ok).toBe(false);
  });

  it('does not mutate origin for a rejected supported envelope', () => {
    const origin = { kind: 'routine', name: 'Breakfast', triggerId: 'daily-0700' };
    const result = applyCommandEnvelope(c, { ...env('queue', { op: 'not-an-operation' }), origin });
    expect(result.ok).toBe(false);
    expect(c.setOrigin).not.toHaveBeenCalled();
  });

  it.each([
    ['rejected item action', { op: 'item-action', operationId: 'expired-action', kind: 'playNow', item: { contentId: 'plex:1' }, tappedAt: 1 }, 'execute'],
    ['expired undo', { op: 'undo', operationId: 'expired-undo' }, 'undo'],
  ])('clears staged routine provenance after an async %s before the next human action', async (_label, params, method) => {
    const controller = createLocalSessionController({ clientId: 'origin-owner' });
    controller[method] = vi.fn(async () => ({ ok: false, reason: 'expired' }));
    const origin = { kind: 'routine', name: 'Breakfast', triggerId: 'daily-0700' };

    await expect(applyCommandEnvelope(controller, { ...env('queue', params), origin })).resolves.toMatchObject({ ok: false });
    controller.config.setVolume(42);

    expect(controller.getSnapshot().meta.origin).toEqual({ kind: 'device', id: 'browser:origin-owner' });
  });

  it('clears staged routine provenance after a no-op transport before the next human action', () => {
    const controller = createLocalSessionController({ clientId: 'origin-owner' });
    const origin = { kind: 'routine', name: 'Breakfast', triggerId: 'daily-0700' };

    expect(applyCommandEnvelope(controller, { ...env('transport', { action: 'play' }), origin })).toEqual({ ok: true });
    controller.config.setVolume(42);

    expect(controller.getSnapshot().meta.origin).toEqual({ kind: 'device', id: 'browser:origin-owner' });
  });

  it('stamps a successful synchronous routine config change with the routine origin', () => {
    const controller = createLocalSessionController({ clientId: 'origin-owner' });
    const origin = { kind: 'routine', name: 'Breakfast', triggerId: 'daily-0700' };
    expect(applyCommandEnvelope(controller, { ...env('config', { setting: 'volume', value: 30 }), origin }).ok).toBe(true);
    expect(controller.getSnapshot().meta.origin).toEqual(origin);
  });

  it('stamps a successful async routine item action with the routine origin', async () => {
    const controller = createLocalSessionController({ clientId: 'origin-owner' });
    const origin = { kind: 'routine', name: 'Breakfast', triggerId: 'daily-0700' };
    const realExecute = controller.execute;
    controller.execute = vi.fn(async (p) => { await Promise.resolve(); return realExecute(p); });
    await applyCommandEnvelope(controller, { ...env('queue', {
      op: 'item-action', operationId: 'ok-1', kind: 'playNow', item: { contentId: 'plex:1' }, tappedAt: Date.now(),
    }), origin });
    expect(controller.getSnapshot().meta.origin).toEqual(origin);
  });

  it('stamps a routine transport.play with the routine origin synchronously — no player event needed — and player events never restamp it', () => {
    // Round 1/2 tried an "expected transition" ticket consumed by the next
    // matching player event. Three real failure modes killed that design:
    // seekAbs armed a ticket nothing was ever guaranteed to consume; a
    // no-op PLAYER_OBSERVATION (timeupdate with no actual state change)
    // still burned the ticket, since the action object — and the
    // ticket-consuming call baked into it — is built before the reducer
    // ever decides the dispatch is a no-op; and the ticket survived across
    // LOAD_ITEM/skip, so the NEXT item's first 'playing' could still be
    // wrongly stamped with a stale origin. The replacement: provenance is
    // "who last commanded this screen," stamped SYNCHRONOUSLY at command
    // time. Player-driven dispatches never touch meta.origin at all — it
    // stays sticky until the next actual command.
    const controller = createLocalSessionController({ clientId: 'origin-owner' });
    controller.setPlayerHandle({ play: vi.fn(), pause: vi.fn(), seek: vi.fn() });
    controller.queue.add({ contentId: 'plex:1', format: 'video' });
    controller.transport.play();
    controller.onPlayerStateChange('playing');
    controller.transport.pause();
    controller.onPlayerStateChange('paused');
    expect(controller.getSnapshot().state).toBe('paused');

    const routineOrigin = { kind: 'routine', name: 'Breakfast', triggerId: 'daily-0700' };
    expect(applyCommandEnvelope(controller, { ...env('transport', { action: 'play' }), origin: routineOrigin })).toEqual({ ok: true });
    // Stamped immediately — no player event needed, and playback state
    // itself hasn't even changed yet (resuming dispatches nothing on its
    // own beyond the origin stamp).
    expect(controller.getSnapshot().state).toBe('paused');
    expect(controller.getSnapshot().meta.origin).toEqual(routineOrigin);

    // A human on the TV's own native remote presses play, then pause —
    // PlayerBridge reports both exactly like any other player-driven
    // transition, via onPlayerStateChange. Neither restamps: this is the
    // pre-existing sticky-origin semantics, asserted explicitly.
    controller.onPlayerStateChange('playing');
    expect(controller.getSnapshot().state).toBe('playing');
    expect(controller.getSnapshot().meta.origin).toEqual(routineOrigin);
    controller.onPlayerStateChange('paused');
    expect(controller.getSnapshot().state).toBe('paused');
    expect(controller.getSnapshot().meta.origin).toEqual(routineOrigin);

    // Only an actual human COMMAND restamps.
    expect(applyCommandEnvelope(controller, env('transport', { action: 'pause' }))).toEqual({ ok: true });
    expect(controller.getSnapshot().meta.origin).toEqual({ kind: 'device', id: 'browser:origin-owner' });
  });

  it('stamps a routine seekAbs synchronously, and a later human play restamps human', () => {
    const controller = createLocalSessionController({ clientId: 'origin-owner' });
    controller.setPlayerHandle({ play: vi.fn(), pause: vi.fn(), seek: vi.fn() });
    controller.queue.add({ contentId: 'plex:1', format: 'video' });
    controller.transport.play();
    controller.onPlayerStateChange('playing');

    const routineOrigin = { kind: 'routine', name: 'Breakfast', triggerId: 'daily-0700' };
    expect(applyCommandEnvelope(controller, { ...env('transport', { action: 'seekAbs', value: 30 }), origin: routineOrigin })).toEqual({ ok: true });
    expect(controller.getSnapshot().meta.origin).toEqual(routineOrigin);

    expect(applyCommandEnvelope(controller, env('transport', { action: 'play' }))).toEqual({ ok: true });
    expect(controller.getSnapshot().meta.origin).toEqual({ kind: 'device', id: 'browser:origin-owner' });
  });

  it('stamps skipNext to the next item human even right after a routine play, never routine', () => {
    const controller = createLocalSessionController({ clientId: 'origin-owner' });
    controller.setPlayerHandle({ play: vi.fn(), pause: vi.fn(), seek: vi.fn() });
    controller.queue.add({ contentId: 'plex:1', format: 'video' });
    controller.queue.add({ contentId: 'plex:2', format: 'video' });
    controller.transport.play();
    controller.onPlayerStateChange('playing');

    const routineOrigin = { kind: 'routine', name: 'Breakfast', triggerId: 'daily-0700' };
    expect(applyCommandEnvelope(controller, { ...env('transport', { action: 'play' }), origin: routineOrigin })).toEqual({ ok: true });
    expect(controller.getSnapshot().meta.origin).toEqual(routineOrigin);

    expect(applyCommandEnvelope(controller, env('transport', { action: 'skipNext' }))).toEqual({ ok: true });
    expect(controller.getSnapshot().currentItem.contentId).toBe('plex:2');
    expect(controller.getSnapshot().meta.origin).toEqual({ kind: 'device', id: 'browser:origin-owner' });
  });

  it('stamps an interleaved human config change human and a still-pending routine item action routine, not each other', async () => {
    // A CONTAINER item action genuinely goes async inside execute() itself
    // (container expansion, ~470-489) — this is the real shape of the
    // overlap, not an artificial wrapper around `controller.execute`: the
    // origin must be captured at the moment execute() is CALLED, not
    // whenever its internal fetch happens to resolve.
    //
    // The interleaved human action is a volume change. Round 1 of this fix
    // found that ANY config change (including volume/shader, which change
    // neither the queue's contents nor its order) tripped
    // LocalSessionController's item-action ledger supersede guard
    // (queueFingerprint included the whole `config` object), legitimately
    // but overbroadly cancelling a still-expanding "Play now" underneath the
    // person who tapped it. Round 2 narrows the guard's OWN fingerprint
    // (itemActionFingerprint — a private cousin of queueFingerprint, NOT the
    // shared queueRevision used for cross-controller identity) to
    // shuffle/repeat, which genuinely change what plays. So this now
    // exercises BOTH fixes at once: the origin survives the interleave, AND
    // the item action is no longer wrongly superseded by it.
    let resolveFetch;
    const fetchImpl = () => new Promise((resolve) => { resolveFetch = resolve; });
    const controller = createLocalSessionController({ clientId: 'origin-owner', fetchImpl });
    const routineOrigin = { kind: 'routine', name: 'Breakfast', triggerId: 'daily-0700' };

    const pending = applyCommandEnvelope(controller, { ...env('queue', {
      op: 'item-action', operationId: 'interleave-1', kind: 'playNow',
      item: { contentId: 'plex:album-1', itemType: 'container', childCount: 2 },
      tappedAt: Date.now(),
    }), origin: routineOrigin });

    // The routine item action's container fetch is still in flight — no
    // response has arrived — when a human config change lands on the SAME
    // controller.
    expect(applyCommandEnvelope(controller, env('config', { setting: 'volume', value: 55 }))).toEqual({ ok: true });
    expect(controller.getSnapshot().meta.origin).toEqual({ kind: 'device', id: 'browser:origin-owner' });

    resolveFetch({ ok: true, json: async () => ({ items: [{ id: 'plex:track-1', play: { contentId: 'plex:track-1' }, title: 'Track 1' }] }) });
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(controller.getSnapshot().meta.origin).toEqual(routineOrigin);
  });

  it('stamps a still-pending routine enqueue (the legacy queue.playNow path) routine even after an interleaved human config change', async () => {
    // enqueue()'s container-expansion path (~470-489) is the OTHER place an
    // operation's own mutation can land well after another command has
    // interleaved — and unlike item actions, it has no revision-supersede
    // guard at all, so it must protect its own origin end to end.
    // commandHandler's wire protocol only forwards `contentId` for a plain
    // `play-now` queue op (no container markers survive the envelope), so a
    // container tap is driven directly at the controller here, exactly as
    // `applyWithOrigin` would stage it.
    let resolveFetch;
    const fetchImpl = () => new Promise((resolve) => { resolveFetch = resolve; });
    const controller = createLocalSessionController({ clientId: 'origin-owner', fetchImpl });
    const routineOrigin = { kind: 'routine', name: 'Breakfast', triggerId: 'daily-0700' };

    controller.setOrigin(routineOrigin);
    const pending = controller.queue.playNow({ contentId: 'plex:album-1', itemType: 'container', childCount: 2 });

    // The routine enqueue's container fetch is still in flight when a human
    // config change lands on the SAME controller.
    expect(applyCommandEnvelope(controller, env('config', { setting: 'volume', value: 55 }))).toEqual({ ok: true });
    expect(controller.getSnapshot().meta.origin).toEqual({ kind: 'device', id: 'browser:origin-owner' });

    resolveFetch({ ok: true, json: async () => ({ items: [{ id: 'plex:track-1', play: { contentId: 'plex:track-1' }, title: 'Track 1' }] }) });
    await pending;
    expect(controller.getSnapshot().meta.origin).toEqual(routineOrigin);
  });

  it('still supersedes a pending item action when shuffle changes underneath it, unlike volume/shader', async () => {
    // Proves the item-action ledger's narrower fingerprint (itemActionFingerprint)
    // wasn't gutted: it excludes ONLY volume/shader, which change neither the
    // queue's contents nor its order — shuffle genuinely changes what plays
    // next, so it must still supersede a stale pending "Play now".
    let resolveFetch;
    const fetchImpl = () => new Promise((resolve) => { resolveFetch = resolve; });
    const controller = createLocalSessionController({ clientId: 'origin-owner', fetchImpl });
    const routineOrigin = { kind: 'routine', name: 'Breakfast', triggerId: 'daily-0700' };

    const pending = applyCommandEnvelope(controller, { ...env('queue', {
      op: 'item-action', operationId: 'shuffle-interleave-1', kind: 'playNow',
      item: { contentId: 'plex:album-1', itemType: 'container', childCount: 2 },
      tappedAt: Date.now(),
    }), origin: routineOrigin });

    expect(applyCommandEnvelope(controller, env('config', { setting: 'shuffle', value: true }))).toEqual({ ok: true });

    resolveFetch({ ok: true, json: async () => ({ items: [{ id: 'plex:track-1', play: { contentId: 'plex:track-1' }, title: 'Track 1' }] }) });
    const result = await pending;
    expect(result).toMatchObject({ ok: false, code: 'ITEM_ACTION_CANCELLED' });
  });
});
