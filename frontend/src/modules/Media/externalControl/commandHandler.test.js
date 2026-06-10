import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createIdleSessionSnapshot } from '@shared-contracts/media/shapes.mjs';
import { applyCommandEnvelope } from './commandHandler.js';

function makeController() {
  return {
    transport: { play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seekAbs: vi.fn(), seekRel: vi.fn(), skipNext: vi.fn(), skipPrev: vi.fn() },
    queue: { playNow: vi.fn(), playNext: vi.fn(), addUpNext: vi.fn(), add: vi.fn(), remove: vi.fn(), reorder: vi.fn(), jump: vi.fn(), clear: vi.fn() },
    config: { setShuffle: vi.fn(), setRepeat: vi.fn(), setShader: vi.fn(), setVolume: vi.fn() },
    lifecycle: { reset: vi.fn(), adoptSnapshot: vi.fn() },
  };
}

let c;
beforeEach(() => { c = makeController(); });

function env(command, params) {
  return { commandId: 'cmd-1', command, params, ts: '2026-06-10T00:00:00Z' };
}

describe('applyCommandEnvelope', () => {
  it('rejects envelopes that fail shared-contract validation', () => {
    const result = applyCommandEnvelope(c, { command: 'transport', params: { action: 'play' } }); // no commandId
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/commandId/);
  });

  it('routes transport actions with values', () => {
    expect(applyCommandEnvelope(c, env('transport', { action: 'seekAbs', value: 90 })).ok).toBe(true);
    expect(c.transport.seekAbs).toHaveBeenCalledWith(90);
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
});
