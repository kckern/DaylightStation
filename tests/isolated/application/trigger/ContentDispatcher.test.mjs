import { describe, it, expect, vi } from 'vitest';
import { ContentDispatcher } from '#apps/trigger/ContentDispatcher.mjs';

describe('ContentDispatcher.optimistic', () => {
  it('broadcasts to the screen and does NOT fall back when an ack arrives', async () => {
    const screenBroadcast = vi.fn();
    const loadFallback = vi.fn();
    const waitForAck = vi.fn().mockResolvedValue({ type: 'content-ack', screen: 'living-room' });
    const cd = new ContentDispatcher({ screenBroadcast, waitForAck, loadFallback });
    await cd.optimistic('living-room', { queue: 'plex:1' }, {});
    expect(screenBroadcast).toHaveBeenCalledWith('living-room', expect.objectContaining({ queue: 'plex:1' }));
    expect(loadFallback).not.toHaveBeenCalled();
  });

  it('falls back to loadFallback when the ack times out', async () => {
    const screenBroadcast = vi.fn();
    const loadFallback = vi.fn().mockResolvedValue();
    const waitForAck = vi.fn().mockRejectedValue(new Error('timeout'));
    const cd = new ContentDispatcher({ screenBroadcast, waitForAck, loadFallback });
    await cd.optimistic('living-room', { queue: 'plex:1' }, {});
    expect(loadFallback).toHaveBeenCalledWith('living-room', { queue: 'plex:1' });
  });

  it('falls back immediately when no waitForAck is available', async () => {
    const loadFallback = vi.fn().mockResolvedValue();
    const cd = new ContentDispatcher({ screenBroadcast: vi.fn(), loadFallback });
    await cd.optimistic('t', { play: 'plex:2' }, {});
    expect(loadFallback).toHaveBeenCalledWith('t', { play: 'plex:2' });
  });

  it('fires onContentApproved (fire-and-forget) before broadcasting', async () => {
    const calls = [];
    const onContentApproved = vi.fn(async () => { calls.push('wake'); });
    const screenBroadcast = vi.fn(() => calls.push('broadcast'));
    const cd = new ContentDispatcher({ screenBroadcast, onContentApproved, waitForAck: vi.fn().mockResolvedValue({ type: 'content-ack', screen: 't' }) });
    await cd.optimistic('t', { queue: 'x' }, {});
    expect(onContentApproved).toHaveBeenCalledWith('t');
    expect(calls).toContain('broadcast');
  });
});
