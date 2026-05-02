// Regression: verifies the application layer hands a PlayableItem to the
// adapter, not an undefined/string-stripped ratingKey. See debugging notes
// 2026-05-01: barcode-driven prewarm broke because the service was reading
// `first.ratingKey || first.contentId` off a PlayableItem (neither field
// exists on the domain entity), so loadMediaUrl always got `undefined` and
// returned `metadata-missing`/permanent.

import { describe, it, expect, vi } from 'vitest';
import { TranscodePrewarmService } from '#apps/devices/services/TranscodePrewarmService.mjs';
import { PlayableItem } from '#domains/content/capabilities/Playable.mjs';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makePlayableItem(ratingKey) {
  return new PlayableItem({
    id: `plex:${ratingKey}`,
    source: 'plex',
    localId: String(ratingKey),
    title: 'Test Track',
    mediaType: 'audio',
    mediaUrl: `/api/v1/proxy/plex/stream/${ratingKey}`,
    duration: 168,
    resumable: false,
    metadata: {
      type: 'track',
      Media: [{ Part: [{ key: '/library/parts/1/file.mp3' }] }],
    },
  });
}

describe('TranscodePrewarmService → adapter contract (entity, not raw id)', () => {
  it('passes the PlayableItem from resolveQueue directly to adapter.loadMediaUrl', async () => {
    const playable = makePlayableItem('594480');
    const loadMediaUrl = vi.fn().mockResolvedValue({ url: 'https://plex/stream' });

    const svc = new TranscodePrewarmService({
      contentIdResolver: {
        resolve: () => ({
          source: 'plex',
          localId: '594479',
          adapter: {
            resolvePlayables: vi.fn().mockResolvedValue([playable]),
            loadMediaUrl,
          },
        }),
      },
      queueService: { resolveQueue: async (items) => items },
      httpClient: { get: vi.fn().mockResolvedValue({}) },
      logger: makeLogger(),
    });

    const result = await svc.prewarm('plex:594479');

    expect(result.status).toBe('ok');
    expect(loadMediaUrl).toHaveBeenCalledTimes(1);

    const [firstArg, secondArg] = loadMediaUrl.mock.calls[0];

    // The adapter must receive the domain entity itself.
    expect(firstArg).toBeInstanceOf(PlayableItem);
    expect(firstArg).toBe(playable);

    // It must NOT be passed `undefined` (the symptom of the original bug).
    expect(firstArg).toBeDefined();

    // It must NOT be passed a bare ratingKey string — that's a layer leak.
    expect(typeof firstArg).not.toBe('string');
    expect(typeof firstArg).not.toBe('number');

    // Options object should carry startOffset; no Plex-specific naming.
    expect(secondArg).toEqual(expect.objectContaining({ startOffset: 0 }));
  });

  it('does not depend on adapter-specific fields (ratingKey, contentId) on the entity', async () => {
    // The PlayableItem deliberately does NOT have `ratingKey` or `contentId`.
    // If the service is reaching for those fields, this test forces the
    // failure to surface here (loadMediaUrl would receive undefined).
    const playable = makePlayableItem('594480');
    expect(playable.ratingKey).toBeUndefined();
    expect(playable.contentId).toBeUndefined();
    expect(playable.localId).toBe('594480');
    expect(playable.id).toBe('plex:594480');

    const loadMediaUrl = vi.fn().mockResolvedValue({ url: 'https://plex/stream' });

    const svc = new TranscodePrewarmService({
      contentIdResolver: {
        resolve: () => ({
          source: 'plex',
          localId: '594479',
          adapter: {
            resolvePlayables: vi.fn().mockResolvedValue([playable]),
            loadMediaUrl,
          },
        }),
      },
      queueService: { resolveQueue: async (items) => items },
      httpClient: { get: vi.fn().mockResolvedValue({}) },
      logger: makeLogger(),
    });

    await svc.prewarm('plex:594479');

    // The argument actually passed must not be undefined.
    expect(loadMediaUrl.mock.calls[0][0]).toBeDefined();
    expect(loadMediaUrl.mock.calls[0][0]).toBe(playable);
  });
});
