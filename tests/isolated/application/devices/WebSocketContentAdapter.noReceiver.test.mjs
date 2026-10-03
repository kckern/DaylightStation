// PR-10 / RELY.6a: a load broadcast to a screen topic nobody is subscribed to
// reaches nothing. It must be reported as not delivered, never as sent.
import { describe, it, expect, vi } from 'vitest';
import { WebSocketContentAdapter } from '../../../../backend/src/1_adapters/devices/WebSocketContentAdapter.mjs';

function adapter(subscribers) {
  const wsBus = { broadcast: vi.fn(async () => {}), getTopicSubscriberCount: vi.fn(() => subscribers) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { wsBus, a: new WebSocketContentAdapter({ deviceId: 'tv', topic: 'homeline:tv' }, { wsBus, logger }) };
}

describe('WebSocketContentAdapter with no receiver', () => {
  it('does not broadcast and reports the screen as not connected', async () => {
    const { wsBus, a } = adapter(0);
    const result = await a.load('/screen/x', { play: 'plex:1', dispatchId: 'd-1' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not connected/i);
    expect(wsBus.broadcast).not.toHaveBeenCalled();
  });

  it('still delivers when a receiver is subscribed', async () => {
    const { wsBus, a } = adapter(1);
    const result = await a.load('/screen/x', { play: 'plex:1', dispatchId: 'd-1' });
    expect(result.ok).toBe(true);
    expect(wsBus.broadcast).toHaveBeenCalledTimes(1);
  });
});
