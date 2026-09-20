import { describe, expect, it, vi } from 'vitest';
import { RemotePlaybackSource } from './RemotePlaybackSource.mjs';

describe('RemotePlaybackSource', () => {
  it('advertises only controls backed by a remote HLS provider', async () => {
    const source = new RemotePlaybackSource({
      provider: { describe: async () => ({ url: 'https://media.example/stream.m3u8', format: 'hls' }) },
    });

    await expect(source.describe({ contentId: 'remote:lesson', client: {}, tracks: {} })).resolves.toMatchObject({
      kind: 'available', operations: { inspect: 'unsupported', renew: 'unsupported', close: 'unsupported' },
    });
  });

  it('does not treat a successful HTTP response as decoder confirmation', async () => {
    const source = new RemotePlaybackSource({
      provider: { open: async () => ({ status: 200, url: 'https://media.example/embed' }) },
    });
    await expect(source.inspect({ attemptId: 'a', handle: 'h' })).resolves.toEqual({ kind: 'unsupported' });
  });

  it('opens normally without describing or probing first', async () => {
    const describe = vi.fn();
    const source = new RemotePlaybackSource({ provider: { describe, open: async () => ({ url: 'https://media.example/stream.m3u8', format: 'hls' }) } });
    await source.openDefault({ contentId: 'remote:lesson', attemptId: 'a', generation: 0, positionMs: 0, tracks: {}, client: {} });
    expect(describe).not.toHaveBeenCalled();
  });

  it('refuses a stale described revision without opening a remote resource', async () => {
    const open = vi.fn();
    const source = new RemotePlaybackSource({ provider: { describe: async () => ({ revision: 'rev-2', url: 'https://media.example/stream.m3u8' }), open } });
    await source.describe({ contentId: 'remote:lesson', tracks: {}, client: {} });
    await expect(source.open({ contentId: 'remote:lesson', sourceRevision: 'rev-1', attemptId: 'a', generation: 0, positionMs: 0, tracks: {}, client: {} }))
      .resolves.toMatchObject({ kind: 'failed', reason: 'source-revision-mismatch' });
    expect(open).not.toHaveBeenCalled();
  });

  it('does not intentionally create two remote deliveries for one attempt', async () => {
    const open = vi.fn(async () => ({ url: 'https://media.example/stream.m3u8', format: 'hls' }));
    const source = new RemotePlaybackSource({ provider: { open } });
    const request = { contentId: 'remote:lesson', attemptId: 'a', generation: 0, positionMs: 0, tracks: {}, client: {} };
    await source.openDefault(request);
    await expect(source.openDefault(request)).resolves.toMatchObject({ kind: 'failed', reason: 'attempt-already-open' });
    expect(open).toHaveBeenCalledTimes(1);
  });
});
