import { describe, expect, it, vi } from 'vitest';
import { FilePlaybackSource } from './FilePlaybackSource.mjs';

describe('FilePlaybackSource', () => {
  it('keeps file references opaque while opening the provider delivery', async () => {
    const source = new FilePlaybackSource({
      provider: { open: async () => ({ url: '/api/content/file-token-1', format: 'mp4' }) },
    });

    const result = await source.open({ contentId: 'file:opaque-ref', renditionId: 'original', sourceRevision: 'file:opaque-ref', attemptId: 'a', generation: 0, positionMs: 0, tracks: {}, client: {} });
    expect(result).toMatchObject({ kind: 'opened', delivery: { url: '/api/content/file-token-1' } });
    expect(JSON.stringify(result)).not.toContain('opaque-ref');
  });

  it('makes unsupported resource observation explicit', async () => {
    const source = new FilePlaybackSource({ provider: {} });
    await expect(source.inspect({ attemptId: 'a', handle: 'h' })).resolves.toEqual({ kind: 'unsupported' });
  });

  it('opens normally without asking the provider to describe or prepare first', async () => {
    const describe = vi.fn();
    const source = new FilePlaybackSource({ provider: { describe, open: async () => ({ url: '/api/file' }) } });
    await source.openDefault({ contentId: 'opaque', attemptId: 'a', generation: 0, positionMs: 0, tracks: {}, client: {} });
    expect(describe).not.toHaveBeenCalled();
  });

  it('refuses a stale described revision without opening a file resource', async () => {
    const open = vi.fn();
    const source = new FilePlaybackSource({ provider: { describe: async () => ({ revision: 'rev-2' }), open } });
    await source.describe({ contentId: 'opaque', tracks: {}, client: {} });
    await expect(source.open({ contentId: 'opaque', sourceRevision: 'rev-1', attemptId: 'a', generation: 0, positionMs: 0, tracks: {}, client: {} }))
      .resolves.toMatchObject({ kind: 'failed', reason: 'source-revision-mismatch' });
    expect(open).not.toHaveBeenCalled();
  });
});
