// Real YAML store + real use cases: two screens on one item, then a mark.
// Guards the seams the unit tests fake: undefined-vs-null lastDevice, spot
// carry-over by spot-unaware writers, and what a reader sees afterwards.
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { YamlMediaProgressMemory } from '#adapters/persistence/yaml/YamlMediaProgressMemory.mjs';
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';
import { RecordPlaybackProgress } from '#apps/content/usecases/RecordPlaybackProgress.mjs';
import { MarkContentWatched } from '#apps/content/usecases/MarkContentWatched.mjs';
import { openSpotsOf } from '#domains/content/services/mediaSpots.mjs';

describe('per-screen spots through the real YAML store', () => {
  let dir; let memory; let tick;
  const catalog = {
    resolveSource: () => ({ source: 'plex', localId: '1' }),
    progressNamespace: async () => 'plex/6_movies',
    getItem: async () => ({ title: 'Film', type: 'movie', metadata: { type: 'movie', duration: 7_200_000 } }),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'spots-roundtrip-'));
    memory = new YamlMediaProgressMemory({ basePath: dir });
    tick = 0;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const record = () => new RecordPlaybackProgress({
    contentCatalog: catalog, mediaProgressMemory: memory, createMediaProgress: (p) => new MediaProgress(p),
    nowTimestamp: () => `2026-10-02 08:00:${String(tick++).padStart(2, '0')}`, logger,
  });
  const beat = (deviceId, seconds) => record().execute({ type: 'plex', assetId: 'plex:1', seconds, percent: (seconds / 7200) * 100, spotDeviceId: deviceId });

  test('two screens keep their own spots, watchTime counts each screen once, a mark closes both', async () => {
    await beat('fleet:livingroom-tv', 4800);
    await beat('browser:kid', 720);
    await beat('fleet:livingroom-tv', 4830);
    await beat('browser:kid', 750);
    let stored = await memory.findProgress('plex:1', 'plex/6_movies');
    expect(Object.keys(stored.spots).sort()).toEqual(['browser:kid', 'fleet:livingroom-tv']);
    expect(stored.spots['fleet:livingroom-tv'].playhead).toBe(4830);
    // A screen's FIRST report has no spot of its own, so it is measured against
    // the shared playhead as before (kid starting below it = a new play, no
    // watch time); after that each screen is measured against its own spot.
    expect(stored.watchTime).toBe(4800 + 0 + 30 + 30);
    expect(stored.playCount).toBe(2);
    expect(openSpotsOf(stored).map((s) => s.deviceId)).toEqual(['browser:kid', 'fleet:livingroom-tv']);

    // a spot-unaware writer (bookmark-style rebuild) keeps the spots
    await memory.saveProgress(new MediaProgress({ contentId: 'plex:1', playhead: 750, duration: 7200 }), 'plex/6_movies');
    stored = await memory.findProgress('plex:1', 'plex/6_movies');
    expect(Object.keys(stored.spots)).toHaveLength(2);
    expect(stored.lastDevice).toBe('browser:kid');

    await new MarkContentWatched({ contentCatalog: catalog, mediaProgressMemory: memory, nowTimestamp: () => '2026-10-02 09:00:00', logger })
      .execute({ contentId: 'plex:1', watched: true });
    stored = await memory.findProgress('plex:1', 'plex/6_movies');
    expect(stored.isWatched()).toBe(true);
    expect(stored.spots).toEqual({});
    expect(stored.lastDevice).toBeNull();
    expect(openSpotsOf(stored)).toEqual([]);
    expect(readFileSync(join(dir, 'plex/6_movies.yml'), 'utf8')).not.toContain('lastDevice');
  });
});
