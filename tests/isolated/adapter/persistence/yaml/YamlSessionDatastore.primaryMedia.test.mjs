/**
 * YamlSessionDatastore — primary-media derivation (characterization)
 *
 * Locks the behavior of findByDate()'s "no summary.media → pick primary from
 * timeline events" fallback (YamlSessionDatastore.mjs ~L368-395). This path is
 * taken by legacy/degraded sessions that lack a structured summary.media block.
 *
 * The fixture uses three `type: 'media'` timeline events with meaningfully
 * differing durations. `durationSeconds` is set proportional to the on-screen
 * span (end - start), so BOTH the historical inline "longest by (end - start)"
 * loop AND the delegated domain `selectPrimaryMedia` (longest real workout by
 * durationSeconds) select the same event — the 30-minute strength workout.
 *
 * Written BEFORE the delegation swap and must pass unchanged after it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { YamlSessionDatastore } from '#adapters/persistence/yaml/YamlSessionDatastore.mjs';
import { saveYaml } from '#system/utils/FileIO.mjs';

describe('YamlSessionDatastore — primary media from timeline events (findByDate fallback)', () => {
  let store;
  let tmpDir;
  const DATE = '2026-04-02';
  const SESSION_ID = '20260402180000';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-primary-media-test-'));
    const configService = {
      getHouseholdPath: (subPath) => path.join(tmpDir, subPath),
    };
    store = new YamlSessionDatastore({ configService });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function mediaEvent({ title, grandparentTitle, contentId, start, durationSeconds }) {
    return {
      type: 'media',
      timestamp: start,
      data: {
        contentId,
        title,
        grandparentTitle,
        parentTitle: null,
        grandparentId: null,
        parentId: null,
        contentType: 'episode',
        start,
        end: start + durationSeconds * 1000,
        durationSeconds,
      },
    };
  }

  it('picks the longest real workout as primary when summary.media is absent', async () => {
    const base = 1_800_000_000_000;
    const sessionData = {
      sessionId: SESSION_ID,
      startTime: base,
      endTime: base + 3_600_000,
      durationMs: 3_600_000,
      timezone: 'America/Los_Angeles',
      participants: { john: { display_name: 'John' } },
      // NO summary.media block → forces the timeline-events fallback
      summary: { participants: {} },
      timeline: {
        events: [
          mediaEvent({ title: 'Warm-Up Spin', grandparentTitle: 'Peloton', contentId: 'plex:1001', start: base + 0, durationSeconds: 240 }),      // 4 min (warmup)
          mediaEvent({ title: 'Cardio Blast', grandparentTitle: 'Fitness Blender', contentId: 'plex:1002', start: base + 400_000, durationSeconds: 540 }),  // 9 min
          mediaEvent({ title: 'Main Strength Workout', grandparentTitle: 'Fitness Blender', contentId: 'plex:1003', start: base + 1_000_000, durationSeconds: 1800 }), // 30 min
        ],
      },
    };

    const sessionsDir = path.join(tmpDir, 'history/fitness', DATE);
    fs.mkdirSync(sessionsDir, { recursive: true });
    saveYaml(path.join(sessionsDir, SESSION_ID), sessionData);

    const sessions = await store.findByDate(DATE);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].media).not.toBeNull();
    expect(sessions[0].media.primary.title).toBe('Main Strength Workout');
    expect(sessions[0].media.primary.contentId).toBe('plex:1003');
    expect(sessions[0].media.primary.showTitle).toBe('Fitness Blender');
  });
});
