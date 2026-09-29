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

  it('stamps a successful synchronous routine transport with the routine origin', () => {
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
});
