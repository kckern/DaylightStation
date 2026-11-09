/**
 * YamlSessionDatastore — every video a session played, in the list summary.
 *
 * Episode history credits each video a session played (not only the primary)
 * and caps a rider's minutes at how long that video ran, so the list summary
 * carries `media.items: [{contentId, playedMs, rings}]` for each video.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { YamlSessionDatastore } from "../../../../../__app_modules/wellness/fitness/server/adapters/persistence/YamlSessionDatastore.mjs";
import { saveYaml } from '#system/utils/FileIO.mjs';

describe('YamlSessionDatastore — media.items in findByDate', () => {
  let store;
  let tmpDir;
  const DATE = '2026-10-07';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-media-items-test-'));
    store = new YamlSessionDatastore({ configService: { getHouseholdPath: (sub) => path.join(tmpDir, sub) } });
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('lists each video with its played time and rings, skipping audio and videos that never played', async () => {
    const dir = path.join(tmpDir, 'fitness/log', DATE);
    fs.mkdirSync(dir, { recursive: true });
    saveYaml(path.join(dir, '20261007132927'), {
      sessionId: '20261007132927',
      startTime: 1791403767000,
      durationMs: 3600000,
      timezone: 'UTC',
      participants: { kc: { display_name: 'KC' } },
      timeline: { series: { 'kc:hr': '[[120,40]]' }, events: [] },
      summary: {
        media: [
          { contentId: 'plex:600750', title: 'Max Out Abs', mediaType: 'video', durationMs: 936516, rings: 560, primary: true },
          { contentId: 'plex:622573', title: 'Power Up Ride', mediaType: 'video', durationMs: 625927, rings: 281 },
          { contentId: 'plex:9001', title: 'A song', mediaType: 'audio', durationMs: 200000 },
          { contentId: 'plex:7', title: 'Opened by mistake', mediaType: 'video', durationMs: 0 },
          { contentId: 'plex:8', title: 'No rings recorded', durationMs: 60000 },
        ],
      },
    });

    const [session] = await store.findByDate(DATE);
    expect(session.media.items).toEqual([
      { contentId: 'plex:600750', playedMs: 936516, rings: 560 },
      { contentId: 'plex:622573', playedMs: 625927, rings: 281 },
      { contentId: 'plex:8', playedMs: 60000, rings: null },
    ]);
  });
});
