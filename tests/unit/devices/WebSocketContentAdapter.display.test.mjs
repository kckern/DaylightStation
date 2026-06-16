import { describe, it, expect, vi } from 'vitest';
import { WebSocketContentAdapter } from '../../../backend/src/1_adapters/devices/WebSocketContentAdapter.mjs';

const make = () => {
  const broadcast = vi.fn(async () => {});
  const adapter = new WebSocketContentAdapter(
    { topic: 'office', deviceId: 'office-tv' },
    { wsBus: { broadcast }, logger: { info() {}, warn() {}, error() {}, debug() {} } });
  return { adapter, broadcast };
};

describe('WebSocketContentAdapter display intent', () => {
  it('broadcasts a display envelope for query.display', async () => {
    const { adapter, broadcast } = make();
    const r = await adapter.load('/screen/office', { display: 'art:classical-evening' });
    expect(r.ok).toBe(true);
    expect(broadcast).toHaveBeenCalledTimes(1);
    const [topic, env] = broadcast.mock.calls[0];
    expect(topic).toBe('office');
    expect(env.command).toBe('display');
    expect(env.params.contentId).toBe('art:classical-evening');
  });

  it('still broadcasts a queue envelope for media content (unchanged)', async () => {
    const { adapter, broadcast } = make();
    const r = await adapter.load('/screen/office', { queue: 'plex:1' });
    expect(r.ok).toBe(true);
    expect(broadcast.mock.calls[0][1].command).toBe('queue');
    expect(broadcast.mock.calls[0][1].params.contentId).toBe('plex:1');
  });

  it('still errors when no contentId and no display', async () => {
    const { adapter, broadcast } = make();
    const r = await adapter.load('/screen/office', {});
    expect(r.ok).toBe(false);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
