import { describe, expect, it, vi } from 'vitest';
import { RegistryPlaybackSourceGateway } from './RegistryPlaybackSourceGateway.mjs';

const request = {
  contentId: 'plex:42', renditionId: 'original', sourceRevision: 'r1',
  attemptId: 'attempt-1', generation: 0, positionMs: 12_000,
  tracks: { audioId: null, subtitleId: null, subtitlesRequired: false }, client: {},
};

describe('RegistryPlaybackSourceGateway', () => {
  it('routes normalized source references without exposing an adapter to the application', async () => {
    const open = vi.fn(async ({ contentId }) => ({ kind: 'opened', handle: `handle:${contentId}` }));
    const gateway = new RegistryPlaybackSourceGateway({
      catalog: { playbackSourceReference: () => ({ source: 'plex', localId: '42' }) },
      sources: { plex: { open } },
    });

    await expect(gateway.open(request)).resolves.toEqual({ kind: 'opened', handle: 'handle:42' });
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ contentId: '42' }));
  });

  it('never intentionally opens a second resource for one attempt', async () => {
    const open = vi.fn(async () => ({ kind: 'opened', handle: 'handle:one' }));
    const gateway = new RegistryPlaybackSourceGateway({
      catalog: { playbackSourceReference: () => ({ source: 'plex', localId: '42' }) },
      sources: { plex: { open } },
    });

    await gateway.open(request);
    await expect(gateway.open(request)).resolves.toMatchObject({ kind: 'failed', reason: 'attempt-already-open' });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('reports an unsupported source explicitly', async () => {
    const gateway = new RegistryPlaybackSourceGateway({
      catalog: { playbackSourceReference: () => ({ source: 'unplayable', localId: '42' }) },
      sources: {},
    });

    await expect(gateway.describe(request)).resolves.toEqual({ kind: 'unsupported' });
  });
});
