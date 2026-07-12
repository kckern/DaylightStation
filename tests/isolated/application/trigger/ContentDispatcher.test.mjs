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

  it('does NOT await the fallback — optimistic resolves even if loadFallback never settles', async () => {
    const loadFallback = vi.fn(() => new Promise(() => {})); // never resolves
    const waitForAck = vi.fn().mockRejectedValue(new Error('timeout'));
    const cd = new ContentDispatcher({ screenBroadcast: vi.fn(), waitForAck, loadFallback });
    // If optimistic awaited the fallback, this would hang forever.
    await cd.optimistic('t', { queue: 'x' }, {});
    expect(loadFallback).toHaveBeenCalledWith('t', { queue: 'x' });
  });

  it('swallows a fallback rejection without throwing (fire-and-forget)', async () => {
    const loadFallback = vi.fn().mockRejectedValue(new Error('boom'));
    const waitForAck = vi.fn().mockRejectedValue(new Error('timeout'));
    const logger = { info: vi.fn(), warn: vi.fn() };
    const cd = new ContentDispatcher({ screenBroadcast: vi.fn(), waitForAck, loadFallback, logger });
    await expect(cd.optimistic('t', { queue: 'x' }, {})).resolves.toBeUndefined();
    // Let the background catch run before asserting the warn log.
    await new Promise((r) => setImmediate(r));
    expect(logger.warn).toHaveBeenCalledWith('trigger.content.fallback_failed', expect.objectContaining({ target: 't', error: 'boom' }));
  });
});
