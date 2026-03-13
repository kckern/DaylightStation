# Strava Session Enrichment Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix UTC conversion bug in Strava-only session creation and enrich those sessions with HR timeline, zones, and coins from Strava stream data.

**Architecture:** Extract the HR→zones→coins reconstruction logic from `cli/reconstruct-fitness-sessions.mjs` into a shared domain-level builder. Use it in `_createStravaOnlySession` after fetching HR data from the lifelog archive (if harvester already ran) or the Strava streams API (if not). Fix the `start_date_local` timezone bug on the same code path.

**Tech Stack:** moment-timezone, vitest, existing TimelineService RLE encoding, existing StravaClientAdapter streams API

---

### Task 1: Create StravaSessionBuilder domain service

**Files:**
- Create: `backend/src/2_domains/fitness/services/StravaSessionBuilder.mjs`
- Test: `tests/isolated/domain/fitness/services/StravaSessionBuilder.test.mjs`

These are the pure functions currently duplicated in `cli/reconstruct-fitness-sessions.mjs:65-191`. Extract them into a proper domain service.

**Step 1: Write the failing tests**

```js
// tests/isolated/domain/fitness/services/StravaSessionBuilder.test.mjs
import { describe, it, expect } from 'vitest';
import {
  resampleHR,
  deriveZones,
  deriveCoins,
  computeZoneMinutes,
  computeBuckets,
  computeHRStats,
  buildStravaSessionTimeline,
} from '#domains/fitness/services/StravaSessionBuilder.mjs';

describe('StravaSessionBuilder', () => {
  describe('resampleHR', () => {
    it('samples every 5th value from per-second data', () => {
      // 15 seconds of data → 3 samples (indices 0, 5, 10)
      const perSecond = [100, 101, 102, 103, 104, 110, 111, 112, 113, 114, 120, 121, 122, 123, 124];
      expect(resampleHR(perSecond, 5)).toEqual([100, 110, 120]);
    });

    it('handles data shorter than interval', () => {
      expect(resampleHR([100, 101], 5)).toEqual([100]);
    });

    it('handles empty array', () => {
      expect(resampleHR([], 5)).toEqual([]);
    });
  });

  describe('deriveZones', () => {
    it('maps HR values to zone shortcodes', () => {
      //                     cool   active  warm    hot     fire
      const samples =       [80,    105,    125,    145,    165];
      expect(deriveZones(samples)).toEqual(['c', 'a', 'w', 'h', 'fire']);
    });

    it('maps null to null', () => {
      expect(deriveZones([null, 120, null])).toEqual([null, 'w', null]);
    });
  });

  describe('deriveCoins', () => {
    it('accumulates coins by zone', () => {
      // cool=0, active=1, warm=2, hot=3, fire=5
      const samples = [80, 105, 125, 145, 165];
      expect(deriveCoins(samples)).toEqual([0, 1, 3, 6, 11]);
    });

    it('carries forward on null', () => {
      expect(deriveCoins([105, null, 125])).toEqual([1, 1, 3]);
    });
  });

  describe('computeZoneMinutes', () => {
    it('counts ticks per zone and converts to minutes', () => {
      // 12 ticks of 'active' at 5s each = 1 minute
      const zones = Array(12).fill('a');
      const result = computeZoneMinutes(zones, 5);
      expect(result).toEqual({ active: 1 });
    });

    it('skips null ticks', () => {
      const zones = [null, 'a', null, 'w'];
      const result = computeZoneMinutes(zones, 5);
      expect(result.active).toBeCloseTo(0.08, 1);
      expect(result.warm).toBeCloseTo(0.08, 1);
    });
  });

  describe('computeBuckets', () => {
    it('sums coins by zone color', () => {
      // active→green(1), warm→yellow(2), hot→orange(3), fire→red(5)
      const zones = ['c', 'a', 'w', 'h', 'fire'];
      expect(computeBuckets(zones)).toEqual({
        blue: 0, green: 1, yellow: 2, orange: 3, red: 5,
      });
    });
  });

  describe('computeHRStats', () => {
    it('returns avg, max, min from samples', () => {
      const stats = computeHRStats([100, 120, 140, null, 160]);
      expect(stats.hrAvg).toBe(130);
      expect(stats.hrMax).toBe(160);
      expect(stats.hrMin).toBe(100);
    });

    it('returns zeros for empty array', () => {
      expect(computeHRStats([])).toEqual({ hrAvg: 0, hrMax: 0, hrMin: 0 });
    });
  });

  describe('buildStravaSessionTimeline', () => {
    it('orchestrates full reconstruction from per-second HR', () => {
      // 25 seconds of data at ~130 bpm (warm zone, 2 coins/tick)
      const hrPerSecond = Array(25).fill(130);
      const result = buildStravaSessionTimeline(hrPerSecond);

      expect(result.hrSamples).toHaveLength(5); // 25/5
      expect(result.zoneSeries).toHaveLength(5);
      expect(result.coinsSeries).toHaveLength(5);
      expect(result.totalCoins).toBe(10); // 5 ticks × 2 coins
      expect(result.hrStats.hrAvg).toBe(130);
      expect(result.buckets.yellow).toBe(10);
      expect(result.zoneMinutes.warm).toBeCloseTo(0.42, 1);
    });

    it('returns null for empty/missing HR data', () => {
      expect(buildStravaSessionTimeline(null)).toBeNull();
      expect(buildStravaSessionTimeline([])).toBeNull();
      expect(buildStravaSessionTimeline([0])).toBeNull();
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/isolated/domain/fitness/services/StravaSessionBuilder.test.mjs`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```js
// backend/src/2_domains/fitness/services/StravaSessionBuilder.mjs
/**
 * StravaSessionBuilder — Pure functions to reconstruct fitness session
 * timeline data (HR, zones, coins) from per-second heart rate arrays.
 *
 * Used by:
 * - FitnessActivityEnrichmentService (webhook pipeline, Strava-only sessions)
 * - cli/reconstruct-fitness-sessions.mjs (backfill script)
 *
 * @module domains/fitness/services/StravaSessionBuilder
 */

const INTERVAL_SECONDS = 5;

const ZONES = [
  { name: 'cool',   short: 'c',    min: 0,   color: 'blue',   coins: 0 },
  { name: 'active', short: 'a',    min: 100, color: 'green',  coins: 1 },
  { name: 'warm',   short: 'w',    min: 120, color: 'yellow', coins: 2 },
  { name: 'hot',    short: 'h',    min: 140, color: 'orange', coins: 3 },
  { name: 'fire',   short: 'fire', min: 160, color: 'red',    coins: 5 },
];

function getZone(hr) {
  for (let i = ZONES.length - 1; i >= 0; i--) {
    if (hr >= ZONES[i].min) return ZONES[i];
  }
  return ZONES[0];
}

export function resampleHR(hrPerSecond, interval = INTERVAL_SECONDS) {
  const result = [];
  for (let i = 0; i < hrPerSecond.length; i += interval) {
    result.push(hrPerSecond[i]);
  }
  return result;
}

export function deriveZones(hrSamples) {
  return hrSamples.map(hr => hr == null ? null : getZone(hr).short);
}

export function deriveCoins(hrSamples) {
  const coins = [];
  let cumulative = 0;
  for (const hr of hrSamples) {
    if (hr != null) cumulative += getZone(hr).coins;
    coins.push(cumulative);
  }
  return coins;
}

export function computeZoneMinutes(zoneSeries, interval = INTERVAL_SECONDS) {
  const tickCounts = {};
  for (const z of zoneSeries) {
    if (z == null) continue;
    const zoneDef = ZONES.find(zd => zd.short === z);
    if (!zoneDef) continue;
    tickCounts[zoneDef.name] = (tickCounts[zoneDef.name] || 0) + 1;
  }
  const result = {};
  for (const [name, count] of Object.entries(tickCounts)) {
    const minutes = Math.round(((count * interval) / 60) * 100) / 100;
    if (minutes > 0) result[name] = minutes;
  }
  return result;
}

export function computeBuckets(zoneSeries) {
  const bucketMap = { blue: 0, green: 0, yellow: 0, orange: 0, red: 0 };
  for (const z of zoneSeries) {
    if (z == null) continue;
    const zoneDef = ZONES.find(zd => zd.short === z);
    if (!zoneDef || zoneDef.coins === 0) continue;
    bucketMap[zoneDef.color] += zoneDef.coins;
  }
  return bucketMap;
}

export function computeHRStats(hrSamples) {
  const valid = hrSamples.filter(h => h != null && h > 0);
  if (valid.length === 0) return { hrAvg: 0, hrMax: 0, hrMin: 0 };
  return {
    hrAvg: Math.round(valid.reduce((s, h) => s + h, 0) / valid.length),
    hrMax: Math.max(...valid),
    hrMin: Math.min(...valid),
  };
}

/**
 * Build full timeline data from per-second HR array.
 * @param {number[]} hrPerSecond - Per-second heart rate values from Strava
 * @returns {{ hrSamples, zoneSeries, coinsSeries, totalCoins, zoneMinutes, buckets, hrStats }|null}
 */
export function buildStravaSessionTimeline(hrPerSecond) {
  if (!hrPerSecond || !Array.isArray(hrPerSecond) || hrPerSecond.length < 2) return null;

  const hrSamples = resampleHR(hrPerSecond);
  const zoneSeries = deriveZones(hrSamples);
  const coinsSeries = deriveCoins(hrSamples);
  const totalCoins = coinsSeries.length > 0 ? coinsSeries[coinsSeries.length - 1] : 0;

  return {
    hrSamples,
    zoneSeries,
    coinsSeries,
    totalCoins,
    zoneMinutes: computeZoneMinutes(zoneSeries),
    buckets: computeBuckets(zoneSeries),
    hrStats: computeHRStats(hrSamples),
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/isolated/domain/fitness/services/StravaSessionBuilder.test.mjs`
Expected: All PASS

**Step 5: Commit**

```bash
git add backend/src/2_domains/fitness/services/StravaSessionBuilder.mjs \
        tests/isolated/domain/fitness/services/StravaSessionBuilder.test.mjs
git commit -m "feat(fitness): extract StravaSessionBuilder from CLI backfill script"
```

---

### Task 2: Fix UTC bug and enrich `_createStravaOnlySession` with HR data

**Files:**
- Modify: `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs:22-26` (imports), `:125-181` (attemptEnrichment — pass stravaClient), `:421-515` (_createStravaOnlySession)
- Test: `tests/isolated/application/fitness/strava-session-creation.test.mjs`

**Step 1: Update the existing test file to cover UTC fix and HR enrichment**

Add these tests to the existing describe block in `strava-session-creation.test.mjs`:

```js
// Add to imports at top
import { loadYamlSafe } from '#system/utils/FileIO.mjs';

// --- New tests to add inside existing describe block ---

it('derives sessionId from start_date (UTC) converted to local, not start_date_local', async () => {
  // start_date: '2026-03-01T18:00:00Z' → PST = 10:00 AM → sessionId 20260301100000
  // Bug was: start_date_local '2026-03-01T10:00:00' parsed as UTC then converted → 02:00 AM
  await service._attemptEnrichment(ACTIVITY_ID);

  const dateDir = path.join(tmpDir, '2026-03-01');
  const files = fs.readdirSync(dateDir).filter(f => f.endsWith('.yml'));
  expect(files[0]).toBe('20260301100000.yml');

  const data = loadYamlSafe(path.join(dateDir, files[0]));
  expect(data.sessionId).toBe('20260301100000');
  expect(data.session.start).toBe('2026-03-01 10:00:00');
});

it('populates HR timeline, zones, coins when getActivityStreams returns data', async () => {
  // 15 seconds of HR at 130 bpm → 3 samples at 5s interval, warm zone (2 coins each)
  const hrData = Array(15).fill(130);
  mockStravaClient.getActivityStreams = vi.fn().mockResolvedValue({
    heartrate: { data: hrData },
  });

  await service._attemptEnrichment(ACTIVITY_ID);

  const dateDir = path.join(tmpDir, '2026-03-01');
  const files = fs.readdirSync(dateDir).filter(f => f.endsWith('.yml'));
  const data = loadYamlSafe(path.join(dateDir, files[0]));

  // Timeline should have encoded HR, zone, and coin series
  expect(data.timeline.series['testuser:hr']).toBeTruthy();
  expect(data.timeline.series['testuser:zone']).toBeTruthy();
  expect(data.timeline.series['testuser:coins']).toBeTruthy();
  expect(data.timeline.series['global:coins']).toBeTruthy();

  // Summary should have real stats
  expect(data.treasureBox.totalCoins).toBe(6); // 3 ticks × 2 coins
  expect(data.summary.participants.testuser.hr_avg).toBe(130);
  expect(data.summary.participants.testuser.coins).toBe(6);
});

it('falls back to empty timeline when getActivityStreams fails', async () => {
  mockStravaClient.getActivityStreams = vi.fn().mockRejectedValue(new Error('rate limited'));

  await service._attemptEnrichment(ACTIVITY_ID);

  const dateDir = path.join(tmpDir, '2026-03-01');
  const files = fs.readdirSync(dateDir).filter(f => f.endsWith('.yml'));
  const data = loadYamlSafe(path.join(dateDir, files[0]));

  // Should still create the session, just with empty timeline
  expect(data.version).toBe(3);
  expect(data.timeline.series).toEqual({});
  expect(data.treasureBox.totalCoins).toBe(0);
});

it('skips HR fetch when activity has no heartrate data', async () => {
  const noHrActivity = { ...stravaActivity, has_heartrate: false };
  mockStravaClient.getActivity.mockResolvedValue(noHrActivity);
  mockStravaClient.getActivityStreams = vi.fn();

  await service._attemptEnrichment(ACTIVITY_ID);

  // Should not call streams API
  expect(mockStravaClient.getActivityStreams).not.toHaveBeenCalled();

  // Session should still be created with empty timeline
  const dateDir = path.join(tmpDir, '2026-03-01');
  expect(fs.existsSync(dateDir)).toBe(true);
});
```

**Step 2: Run tests to see the UTC test fail**

Run: `npx vitest run tests/isolated/application/fitness/strava-session-creation.test.mjs`
Expected: The sessionId test FAILS (currently generates `20260301020000` instead of `20260301100000`), and the HR enrichment tests fail (no `getActivityStreams` call yet).

**Step 3: Fix the UTC bug and add HR enrichment**

In `FitnessActivityEnrichmentService.mjs`:

3a. Add imports at the top (after line 25):

```js
import { buildStravaSessionTimeline } from '../../2_domains/fitness/services/StravaSessionBuilder.mjs';
import { encodeSingleSeries } from '../../2_domains/fitness/services/TimelineService.mjs';
```

3b. Fix line 424 — the UTC bug:

```js
// BEFORE (line 424):
const startLocal = moment(activity.start_date_local || activity.start_date).tz(tz);

// AFTER:
const startLocal = moment(activity.start_date).tz(tz);
```

3c. Pass `stravaClient` to `_createStravaOnlySession`. In `_attemptEnrichment` around line 173, change:

```js
// BEFORE:
const created = await this._createStravaOnlySession(currentActivity);

// AFTER:
const created = await this._createStravaOnlySession(currentActivity, this.#stravaClient);
```

3d. Update `_createStravaOnlySession` signature and add HR fetching (after the `endLocal` calculation, before `const sessionData`):

```js
async _createStravaOnlySession(activity, stravaClient = null) {
    const tz = this.#configService?.getTimezone?.() || 'America/Los_Angeles';
    const username = this.#configService.getHeadOfHousehold?.() || 'kckern';
    const startLocal = moment(activity.start_date).tz(tz);
    const sessionId = startLocal.format('YYYYMMDDHHmmss');
    const date = startLocal.format('YYYY-MM-DD');
    const durationSeconds = activity.elapsed_time || activity.moving_time || 0;
    const endLocal = startLocal.clone().add(durationSeconds, 'seconds');

    // Build map data if GPS exists
    let mapData = null;
    if (activity.map?.summary_polyline) {
      mapData = {
        polyline: activity.map.summary_polyline,
        startLatLng: activity.start_latlng || [],
        endLatLng: activity.end_latlng || [],
      };
    }

    // --- NEW: Fetch HR data and build timeline ---
    let timelineData = null;
    const hrPerSecond = await this._fetchHRData(activity, stravaClient);
    if (hrPerSecond) {
      timelineData = buildStravaSessionTimeline(hrPerSecond);
    }

    const timelineSeries = {};
    let totalCoins = 0;
    let buckets = { blue: 0, green: 0, yellow: 0, orange: 0, red: 0 };
    let participantSummary = {};

    if (timelineData) {
      timelineSeries[`${username}:hr`] = encodeSingleSeries(timelineData.hrSamples);
      timelineSeries[`${username}:zone`] = encodeSingleSeries(timelineData.zoneSeries);
      timelineSeries[`${username}:coins`] = encodeSingleSeries(timelineData.coinsSeries);
      timelineSeries['global:coins'] = encodeSingleSeries(timelineData.coinsSeries);
      totalCoins = timelineData.totalCoins;
      buckets = timelineData.buckets;
      participantSummary = {
        coins: timelineData.totalCoins,
        hr_avg: timelineData.hrStats.hrAvg,
        hr_max: timelineData.hrStats.hrMax,
        hr_min: timelineData.hrStats.hrMin,
        zone_minutes: timelineData.zoneMinutes,
      };
    }
    // --- END NEW ---

    const sessionData = {
      version: 3,
      sessionId,
      session: {
        id: sessionId,
        date,
        start: startLocal.format('YYYY-MM-DD HH:mm:ss'),
        end: endLocal.format('YYYY-MM-DD HH:mm:ss'),
        duration_seconds: durationSeconds,
        source: 'strava',
      },
      timezone: tz,
      participants: {
        [username]: {
          display_name: userService.resolveDisplayName(username),
          is_primary: true,
          strava: {
            activityId: activity.id,
            type: activity.type || activity.sport_type || null,
            sufferScore: activity.suffer_score || null,
            deviceName: activity.device_name || null,
            calories: activity.calories || null,
            avgHeartrate: activity.average_heartrate || null,
            maxHeartrate: activity.max_heartrate || null,
          },
        },
      },
      strava: {
        activityId: activity.id,
        name: activity.name || null,
        type: activity.type || null,
        sportType: activity.sport_type || null,
        movingTime: activity.moving_time || 0,
        distance: activity.distance || 0,
        totalElevationGain: activity.total_elevation_gain || 0,
        trainer: activity.trainer ?? true,
        avgHeartrate: activity.average_heartrate || null,
        maxHeartrate: activity.max_heartrate || null,
        ...(mapData ? { map: mapData } : {}),
      },
      timeline: {
        series: timelineSeries,
        events: [],
        interval_seconds: 5,
        tick_count: timelineData ? timelineData.hrSamples.length : Math.ceil(durationSeconds / 5),
        encoding: 'rle',
      },
      treasureBox: { coinTimeUnitMs: 5000, totalCoins, buckets },
      summary: {
        participants: participantSummary.coins != null ? { [username]: participantSummary } : {},
        media: [],
        coins: { total: totalCoins, buckets },
        challenges: { total: 0, succeeded: 0, failed: 0 },
        voiceMemos: [],
      },
    };

    // Write to fitness history
    const sessionDir = path.join(this.#fitnessHistoryDir, date);
    if (!dirExists(sessionDir)) {
      const { mkdirSync } = await import('fs');
      mkdirSync(sessionDir, { recursive: true });
    }
    const filePath = path.join(sessionDir, `${sessionId}.yml`);
    saveYaml(filePath.replace(/\.yml$/, ''), sessionData);

    this.#logger.info?.('strava.enrichment.strava_session_created', {
      sessionId,
      activityId: activity.id,
      name: activity.name,
      type: activity.type,
      totalCoins,
      hasTimeline: !!timelineData,
      filePath,
    });

    return { sessionId, filePath };
  }
```

3e. Add the `_fetchHRData` private method (after `_createStravaOnlySession`):

```js
  /**
   * @private
   * Fetch per-second HR data from Strava streams API.
   * The lifelog archive won't exist yet at webhook time (harvester is daily),
   * so go straight to the API. Auth is already ensured by _attemptEnrichment.
   * @param {Object} activity - Strava activity with id
   * @param {Object|null} stravaClient - StravaClientAdapter
   * @returns {number[]|null} Per-second HR array or null
   */
  async _fetchHRData(activity, stravaClient) {
    if (!stravaClient || !activity.has_heartrate) return null;

    try {
      const streams = await stravaClient.getActivityStreams(activity.id, ['heartrate']);
      if (streams?.heartrate?.data?.length > 1) {
        this.#logger.info?.('strava.enrichment.hr_from_api', {
          activityId: activity.id,
          samples: streams.heartrate.data.length,
        });
        return streams.heartrate.data;
      }
    } catch (err) {
      this.#logger.warn?.('strava.enrichment.hr_fetch_failed', {
        activityId: activity.id,
        error: err?.message,
      });
    }

    return null;
  }
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/isolated/application/fitness/strava-session-creation.test.mjs`
Expected: All PASS (including old tests — check the existing `populates empty timeline` test, which now needs an update since the mock doesn't provide `getActivityStreams`, so the fallback should still produce empty timeline)

**Step 5: Commit**

```bash
git add backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs \
        tests/isolated/application/fitness/strava-session-creation.test.mjs
git commit -m "fix(fitness): fix UTC bug in Strava session creation, enrich with HR/coins from streams"
```

---

### Task 3: Refactor CLI backfill script to use shared builder

**Files:**
- Modify: `cli/reconstruct-fitness-sessions.mjs:42` (add import), `:65-191` (delete duplicated functions), `:374-388` (use builder)

**Step 1: Replace duplicated functions with import**

At the top of `cli/reconstruct-fitness-sessions.mjs`, after line 42, add:

```js
const {
  resampleHR,
  deriveZones,
  deriveCoins,
  computeZoneMinutes,
  computeBuckets,
  computeHRStats,
  buildStravaSessionTimeline,
} = await import('#domains/fitness/services/StravaSessionBuilder.mjs');
```

Delete lines 63-191 (the `ZONES` constant, `INTERVAL_SECONDS`, `COIN_TIME_UNIT_MS`, and all the helper functions: `getZone`, `resampleHR`, `deriveZones`, `deriveCoins`, `computeZoneMinutes`, `computeBuckets`).

Keep `INTERVAL_SECONDS = 5` and `COIN_TIME_UNIT_MS = 5000` as local constants since they're used later in the session file structure.

**Step 2: Replace the inline reconstruction block (lines ~374-388) with the builder**

```js
// BEFORE (lines 374-388):
const hrSamples = resampleHR(hrData);
const tickCount = hrSamples.length;
const zoneSeries = deriveZones(hrSamples);
const coinsSeries = deriveCoins(hrSamples);
const totalCoins = coinsSeries.length > 0 ? coinsSeries[coinsSeries.length - 1] : 0;
const validHR = hrSamples.filter(h => h != null && h > 0);
const hrAvg = validHR.length > 0 ? Math.round(validHR.reduce((s, h) => s + h, 0) / validHR.length) : 0;
const hrMax = validHR.length > 0 ? Math.max(...validHR) : 0;
const hrMin = validHR.length > 0 ? Math.min(...validHR) : 0;
const zoneMinutes = computeZoneMinutes(zoneSeries);
const buckets = computeBuckets(zoneSeries);

// AFTER:
const timeline = buildStravaSessionTimeline(hrData);
if (!timeline) {
  console.log(`[SKIP]  ${date} ${entry.type} (${entry.title}) -- HR data too short`);
  skipped++;
  continue;
}
const { hrSamples, zoneSeries, coinsSeries, totalCoins, zoneMinutes, buckets, hrStats } = timeline;
const { hrAvg, hrMax, hrMin } = hrStats;
const tickCount = hrSamples.length;
```

**Step 3: Verify CLI still works**

Run: `node cli/reconstruct-fitness-sessions.mjs 7`
Expected: Dry-run output, same behavior as before (no `--write`).

**Step 4: Commit**

```bash
git add cli/reconstruct-fitness-sessions.mjs
git commit -m "refactor(cli): use shared StravaSessionBuilder in backfill script"
```

---

### Task 4: Backfill the bad session `20260307010118`

**Step 1: Verify the bad session exists and check the correct time**

```bash
sudo docker exec daylight-station sh -c 'cat data/household/history/fitness/2026-03-07/20260307010118.yml | head -20'
```

Expected: Shows `start: 2026-03-07 01:01:18` (the wrong time — should be 09:01:18).

**Step 2: Delete the bad session file**

```bash
sudo docker exec daylight-station sh -c 'rm data/household/history/fitness/2026-03-07/20260307010118.yml'
```

**Step 3: Run the CLI backfill for March 7**

```bash
node cli/reconstruct-fitness-sessions.mjs 3
```

Expected: Dry-run shows the Workout activity matched with correct sessionId `20260307090118`, with HR data and coins.

**Step 4: Write the corrected session**

```bash
node cli/reconstruct-fitness-sessions.mjs --write 3
```

Expected: `[WRITE]` output showing the session was created with coins and HR data.

**Step 5: Verify**

```bash
sudo docker exec daylight-station sh -c 'cat data/household/history/fitness/2026-03-07/20260307090118.yml | head -20'
```

Expected: `start: 2026-03-07 09:01:18`, correct sessionId, with timeline data.

---

### Task 5: Update webhook job to point to corrected session

**Step 1: Update the webhook job file**

```bash
sudo docker exec daylight-station sh -c "cat > data/household/common/strava/strava-webhooks/17639612068.yml << 'YAML'
activityId: 17639612068
ownerId: 14872916
eventTime: 1772906951
receivedAt: '2026-03-07T18:09:12.250Z'
status: completed
attempts: 3
lastAttemptAt: '2026-03-07T18:19:13.318Z'
matchedSessionId: '20260307090118'
completedAt: '2026-03-09T00:00:00.000Z'
note: backfill-corrected-utc
YAML"
```

**Step 2: Commit code changes (if not already committed in Tasks 1-3)**

Verify all code is committed:

```bash
git status
```
