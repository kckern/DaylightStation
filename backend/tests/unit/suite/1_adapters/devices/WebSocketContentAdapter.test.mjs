import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import WebSocketContentAdapter from '../../../../../src/1_adapters/devices/WebSocketContentAdapter.mjs';
import { validateCommandEnvelope } from '#shared-contracts/media/envelopes.mjs';

describe('WebSocketContentAdapter', () => {
  let wsBus;
  let adapter;

  beforeEach(() => {
    wsBus = { broadcast: jest.fn().mockResolvedValue(undefined), getSubscribers: jest.fn().mockReturnValue([]) };
    adapter = new WebSocketContentAdapter(
      { topic: 'office', deviceId: 'office-tv', daylightHost: 'http://localhost:3111' },
      { wsBus, logger: { info: jest.fn(), error: jest.fn() } }
    );
  });

  it('load() broadcasts a valid CommandEnvelope (command=queue, op=play-now)', async () => {
    const result = await adapter.load('/tv', { queue: 'office-program', shader: 'dark', shuffle: '1' });

    expect(result.ok).toBe(true);
    expect(wsBus.broadcast).toHaveBeenCalledTimes(1);
    const [topic, payload] = wsBus.broadcast.mock.calls[0];
    expect(topic).toBe('office');
    expect(payload.type).toBe('command');
    expect(payload.command).toBe('queue');
    expect(payload.targetDevice).toBe('office-tv');
    expect(payload.params).toMatchObject({
      op: 'play-now',
      contentId: 'office-program',
      shader: 'dark',
      shuffle: '1',
    });
    expect(typeof payload.commandId).toBe('string');
    expect(payload.commandId.length).toBeGreaterThan(0);

    expect(validateCommandEnvelope(payload).valid).toBe(true);
  });

  it('load() resolves contentId from query.queue|play|plex|hymn|contentId in that order', async () => {
    await adapter.load('/tv', { plex: 'plex:12345', shader: 'dark' });
    const [, payload] = wsBus.broadcast.mock.calls[0];
    expect(payload.params.contentId).toBe('plex:12345');
  });

  it('load() returns {ok:false} and logs error when no contentId can be resolved', async () => {
    const logger = { info: jest.fn(), error: jest.fn() };
    const a = new WebSocketContentAdapter(
      { topic: 'office', deviceId: 'office-tv' },
      { wsBus, logger }
    );
    const result = await a.load('/tv', { shader: 'dark' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/content/i);
    expect(wsBus.broadcast).not.toHaveBeenCalled();
  });

  it('load() propagates commandId into result so caller can correlate acks', async () => {
    const result = await adapter.load('/tv', { queue: 'office-program' });
    const [, payload] = wsBus.broadcast.mock.calls[0];
    expect(result.commandId).toBe(payload.commandId);
  });

  it('load() canonical contentId cannot be clobbered by stray query keys', async () => {
    await adapter.load('/tv', {
      queue: 'office-program',
      contentId: 'bogus',
      shader: 'dark',
    });
    const [, payload] = wsBus.broadcast.mock.calls[0];
    expect(payload.params.contentId).toBe('office-program');
    expect(payload.params.shader).toBe('dark');
  });

  it('load() honors query.op when provided (e.g. play-next)', async () => {
    const result = await adapter.load('/tv', { queue: 'plex:642120', op: 'play-next' });
    expect(result.ok).toBe(true);
    const [, payload] = wsBus.broadcast.mock.calls[0];
    expect(payload.command).toBe('queue');
    expect(payload.params.op).toBe('play-next');
    expect(payload.params.contentId).toBe('plex:642120');
  });

  it('load() defaults op to play-now when query.op is absent', async () => {
    await adapter.load('/tv', { queue: 'plex:642120' });
    const [, payload] = wsBus.broadcast.mock.calls[0];
    expect(payload.params.op).toBe('play-now');
  });

  it('load() rejects unknown ops as falling back to play-now (defensive)', async () => {
    await adapter.load('/tv', { queue: 'plex:642120', op: 'banana' });
    const [, payload] = wsBus.broadcast.mock.calls[0];
    expect(payload.params.op).toBe('play-now');
  });
});
