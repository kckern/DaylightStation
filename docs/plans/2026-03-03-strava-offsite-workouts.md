# Strava Off-Site Workouts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Strava-only workouts (runs, basketball, cycling, etc.) first-class sessions with sport-type SVG placeholders, Strava activity names as titles, and GPS route maps when available.

**Architecture:** Extend the existing webhook enrichment pipeline so unmatched Strava activities create new session YAMLs instead of being marked "unmatched." Add session-level `strava` block with name/type/map data. Frontend uses this to display sport-specific SVG placeholders with sessionId-seeded colors, Strava activity names as titles, and decoded polyline maps when GPS data exists.

**Tech Stack:** Node.js/Express backend, React frontend (Mantine UI), YAML persistence, Google Encoded Polyline decoding.

---

## Task 1: Add Session-Level Strava Block to Data Model

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs:317-365`

**Context:** Currently, Strava data lives only under `participants[username].strava` with `activityId`, `type`, `sufferScore`, `deviceName`. We need a session-level `strava` block that carries the activity name, sport type, map data, and other display-relevant fields. The `findByDate()` method (line 317-365) needs to extract these for the session list API.

**Step 1: Write the failing test**

Create test that verifies `findByDate` extracts session-level strava fields.

```javascript
// tests/isolated/adapter/persistence/yaml/YamlSessionDatastore.strava.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { YamlSessionDatastore } from '#adapters/persistence/yaml/YamlSessionDatastore.mjs';
import { saveYaml, loadYamlSafe } from '#system/utils/FileIO.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('YamlSessionDatastore - Strava session-level fields', () => {
  let tmpDir, store, configService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-strava-'));
    configService = {
      getHouseholdPath: (subPath) => path.join(tmpDir, subPath),
    };
    store = new YamlSessionDatastore({ configService });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts strava.name and strava.type into session list summary', async () => {
    const date = '2026-01-15';
    const sessionDir = path.join(tmpDir, 'history/fitness', date);
    fs.mkdirSync(sessionDir, { recursive: true });

    const sessionData = {
      version: 3,
      sessionId: '20260115090000',
      session: {
        id: '20260115090000',
        date,
        start: '2026-01-15 09:00:00',
        end: '2026-01-15 09:30:00',
        duration_seconds: 1800,
      },
      timezone: 'America/Los_Angeles',
      participants: {
        kckern: {
          display_name: 'KC Kern',
          is_primary: true,
          strava: {
            activityId: 12345678,
            type: 'Run',
            sufferScore: 45,
            deviceName: 'Garmin Forerunner 245 Music',
          },
        },
      },
      strava: {
        activityId: 12345678,
        name: 'Morning Run at Green Lake',
        type: 'Run',
        sportType: 'Run',
        movingTime: 1620,
        distance: 5200,
        trainer: false,
        map: {
          polyline: 'abc123polyline',
          startLatLng: [47.68, -122.34],
          endLatLng: [47.68, -122.34],
        },
      },
      timeline: { series: {}, events: [], interval_seconds: 5, tick_count: 360, encoding: 'rle' },
      summary: { media: [], coins: { total: 0 }, voiceMemos: [] },
    };

    saveYaml(path.join(sessionDir, '20260115090000'), sessionData);

    const results = await store.findByDate(date, undefined);
    expect(results).toHaveLength(1);
    expect(results[0].strava).toEqual({
      name: 'Morning Run at Green Lake',
      type: 'Run',
      sportType: 'Run',
      distance: 5200,
      trainer: false,
      hasMap: true,
    });
  });

  it('returns strava: null when no session-level strava block exists', async () => {
    const date = '2026-01-16';
    const sessionDir = path.join(tmpDir, 'history/fitness', date);
    fs.mkdirSync(sessionDir, { recursive: true });

    const sessionData = {
      version: 3,
      sessionId: '20260116090000',
      session: { id: '20260116090000', date, start: '2026-01-16 09:00:00', end: '2026-01-16 09:30:00', duration_seconds: 1800 },
      timezone: 'America/Los_Angeles',
      participants: { kckern: { display_name: 'KC Kern', is_primary: true } },
      timeline: { series: {}, events: [], interval_seconds: 5, tick_count: 360, encoding: 'rle' },
      summary: { media: [], coins: { total: 0 }, voiceMemos: [] },
    };

    saveYaml(path.join(sessionDir, '20260116090000'), sessionData);

    const results = await store.findByDate(date, undefined);
    expect(results[0].strava).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/persistence/yaml/YamlSessionDatastore.strava.test.mjs`
Expected: FAIL — `strava` field not present in returned summary.

**Step 3: Implement — extract session-level strava in findByDate**

In `YamlSessionDatastore.mjs`, after the suffer score extraction (line 330) and before `totalCoins` (line 332), add:

```javascript
      // Extract session-level strava display data
      let strava = null;
      if (data.strava?.name || data.strava?.type) {
        strava = {
          name: data.strava.name || null,
          type: data.strava.type || null,
          sportType: data.strava.sportType || null,
          distance: data.strava.distance || 0,
          trainer: data.strava.trainer ?? true,
          hasMap: !!(data.strava.map?.polyline),
        };
      }
```

Then add `strava` to the returned object (after `stravaActivityId` on line 363):

```javascript
        strava,
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/adapter/persistence/yaml/YamlSessionDatastore.strava.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs tests/isolated/adapter/persistence/yaml/YamlSessionDatastore.strava.test.mjs
git commit -m "feat(fitness): extract session-level strava block in findByDate"
```

---

## Task 2: Create Strava-Only Sessions from Webhook

**Files:**
- Modify: `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs:156-167`
- Modify: `backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs` (new method)
- Reference: `cli/reconstruct-fitness-sessions.mjs` (for session YAML structure)

**Context:** When the enrichment service finds no matching session for a Strava activity, it currently retries then marks "unmatched." Instead, it should create a new Strava-only session. The session needs the same v3 structure but with `session.source: 'strava'`, no media, and a `strava` block populated from the API response.

**Step 1: Write the failing test**

```javascript
// tests/isolated/application/fitness/strava-session-creation.test.mjs
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FitnessActivityEnrichmentService } from '#applications/fitness/FitnessActivityEnrichmentService.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('FitnessActivityEnrichmentService - Strava-only session creation', () => {
  let tmpDir, service, mockStravaClient, mockJobStore, mockAuthStore, mockConfigService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-enrich-'));
    const historyDir = path.join(tmpDir, 'history/fitness');
    fs.mkdirSync(historyDir, { recursive: true });

    mockStravaClient = {
      hasAccessToken: () => true,
      getActivity: vi.fn(),
      updateActivity: vi.fn(),
    };
    mockJobStore = {
      findById: vi.fn().mockReturnValue({ status: 'pending', attempts: 0 }),
      create: vi.fn(),
      update: vi.fn(),
    };
    mockAuthStore = { loadUserAuth: vi.fn() };
    mockConfigService = {
      getHeadOfHousehold: () => 'kckern',
      getTimezone: () => 'America/Los_Angeles',
      getHouseholdPath: (sub) => path.join(tmpDir, sub),
      resolveAthleteUser: () => 'kckern',
    };

    service = new FitnessActivityEnrichmentService({
      stravaClient: mockStravaClient,
      jobStore: mockJobStore,
      authStore: mockAuthStore,
      configService: mockConfigService,
      fitnessHistoryDir: historyDir,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a Strava-only session when no matching home session exists', async () => {
    const stravaActivity = {
      id: 99999999,
      name: 'Morning Run',
      type: 'Run',
      sport_type: 'Run',
      start_date: '2026-01-20T09:00:00Z',
      start_date_local: '2026-01-20T01:00:00Z',
      moving_time: 1800,
      elapsed_time: 2000,
      distance: 5000,
      total_elevation_gain: 50,
      trainer: false,
      average_heartrate: 155,
      max_heartrate: 180,
      suffer_score: 67,
      device_name: 'Garmin Forerunner 245 Music',
      map: {
        summary_polyline: 'abc123polyline',
      },
      start_latlng: [47.68, -122.34],
      end_latlng: [47.68, -122.34],
    };

    mockStravaClient.getActivity.mockResolvedValue(stravaActivity);

    await service._attemptEnrichment('99999999');

    // Verify a session file was created
    const dateDir = path.join(tmpDir, 'history/fitness', '2026-01-19');
    // Session should exist (date is local date, which is Jan 19 PST for Jan 20 UTC 09:00 → actually Jan 20 01:00 local)
    // Let's check both dates
    const possibleDates = ['2026-01-19', '2026-01-20'];
    let sessionFile = null;
    for (const d of possibleDates) {
      const dir = path.join(tmpDir, 'history/fitness', d);
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.yml'));
        if (files.length > 0) {
          sessionFile = path.join(dir, files[0]);
          break;
        }
      }
    }

    expect(sessionFile).not.toBeNull();

    // Verify job was updated to 'completed' with created-session note
    expect(mockJobStore.update).toHaveBeenCalledWith('99999999', expect.objectContaining({
      status: 'completed',
      note: expect.stringContaining('created-strava-session'),
    }));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/application/fitness/strava-session-creation.test.mjs`
Expected: FAIL — currently marks 'unmatched' instead of creating a session.

**Step 3: Implement — create Strava-only session on no-match**

In `FitnessActivityEnrichmentService.mjs`, replace the no-match block (lines 158-167):

```javascript
      if (!match) {
        if (attempt < MAX_RETRIES) {
          this.#logger.info?.('strava.enrichment.no_match', { activityId, attempt });
          setTimeout(() => this._attemptEnrichment(activityId), RETRY_INTERVAL_MS);
          return;
        }

        // No matching home session after retries — create a Strava-only session
        this.#logger.info?.('strava.enrichment.creating_strava_session', {
          activityId,
          activityName: currentActivity.name,
          activityType: currentActivity.type,
        });

        const created = await this._createStravaOnlySession(currentActivity);
        this.#jobStore.update(activityId, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          matchedSessionId: created?.sessionId || null,
          note: 'created-strava-session',
        });
        this._addToCooldown(activityId);
        return;
      }
```

Then add the `_createStravaOnlySession` private method:

```javascript
  /**
   * @private
   * Create a new session YAML for a Strava activity that has no matching home session.
   * @param {Object} activity - Strava activity object from API
   * @returns {{ sessionId: string, filePath: string }}
   */
  async _createStravaOnlySession(activity) {
    const tz = this.#configService?.getTimezone?.() || 'America/Los_Angeles';
    const username = this.#configService.getHeadOfHousehold?.() || 'kckern';
    const startLocal = moment(activity.start_date_local || activity.start_date).tz(tz);
    const sessionId = startLocal.format('YYYYMMDDHHmmss');
    const date = startLocal.format('YYYY-MM-DD');
    const endLocal = startLocal.clone().add(activity.elapsed_time || activity.moving_time || 0, 'seconds');
    const durationSeconds = activity.elapsed_time || activity.moving_time || 0;

    // Build map data if GPS exists
    let mapData = null;
    if (activity.map?.summary_polyline) {
      mapData = {
        polyline: activity.map.summary_polyline,
        startLatLng: activity.start_latlng || [],
        endLatLng: activity.end_latlng || [],
      };
    }

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
          display_name: this.#configService.getUserDisplayName?.(username) || username,
          is_primary: true,
          strava: {
            activityId: activity.id,
            type: activity.type || activity.sport_type || null,
            sufferScore: activity.suffer_score || null,
            deviceName: activity.device_name || null,
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
        series: {},
        events: [],
        interval_seconds: 5,
        tick_count: Math.ceil(durationSeconds / 5),
        encoding: 'rle',
      },
      treasureBox: { coinTimeUnitMs: 5000, totalCoins: 0, buckets: { blue: 0, green: 0, yellow: 0, orange: 0, red: 0 } },
      summary: {
        participants: {},
        media: [],
        coins: { total: 0, buckets: { blue: 0, green: 0, yellow: 0, orange: 0, red: 0 } },
        challenges: { total: 0, succeeded: 0, failed: 0 },
        voiceMemos: [],
      },
    };

    // Write to fitness history
    const sessionDir = path.join(this.#fitnessHistoryDir, date);
    if (!dirExists(sessionDir)) {
      // Ensure dir exists
      const fs = await import('fs');
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    const filePath = path.join(sessionDir, `${sessionId}.yml`);
    saveYaml(filePath.replace(/\.yml$/, ''), sessionData);

    this.#logger.info?.('strava.enrichment.strava_session_created', {
      sessionId,
      activityId: activity.id,
      name: activity.name,
      type: activity.type,
      filePath,
    });

    return { sessionId, filePath };
  }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/application/fitness/strava-session-creation.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs tests/isolated/application/fitness/strava-session-creation.test.mjs
git commit -m "feat(fitness): create Strava-only sessions from webhook when no home session matches"
```

---

## Task 3: Add Strava Identity to User Profile

**Files:**
- Modify: `data/users/kckern/profile.yml` (via SSH if needed for prod, direct for dev)

**Context:** The enrichment service needs to map Strava athlete IDs to household users. The profile already has an `identities` block with Telegram. Add Strava with athlete_id `14872916`.

**Step 1: Add strava identity**

In `data/users/kckern/profile.yml`, under `identities`:

```yaml
identities:
  telegram:
    user_id: "575596036"
    default_bot: nutribot
  strava:
    athlete_id: 14872916
```

**Step 2: Verify the YAML parses correctly**

Run: `node -e "import('#system/utils/FileIO.mjs').then(m => console.log(JSON.stringify(m.loadYamlSafe('data/users/kckern/profile').identities, null, 2)))"`

Expected: Both telegram and strava identities present.

**Step 3: Commit**

```bash
git add data/users/kckern/profile.yml
git commit -m "feat(fitness): add Strava athlete identity to user profile"
```

---

## Task 4: Retroactive Enrichment CLI Script

**Files:**
- Create: `cli/scripts/backfill-strava-enrichment.mjs`
- Reference: `cli/reconstruct-fitness-sessions.mjs` (for bootstrap pattern)
- Reference: Strava YAML archives in `data/users/kckern/lifelog/strava/`
- Reference: Session YAMLs in `data/household/history/fitness/{date}/{sessionId}.yml`

**Context:** Existing sessions already have `participants[username].strava.activityId` linking them to Strava activities. The Strava archives have the full activity data. This script reads each session, finds its matching Strava archive by activityId, and writes the session-level `strava` block. For Strava archives with no matching session (pure off-site workouts), it creates new session YAMLs.

**Step 1: Write the script**

```javascript
#!/usr/bin/env node
/**
 * Backfill session-level Strava data from archived Strava YAML files.
 *
 * For each session with participants[*].strava.activityId:
 *   - Finds the matching Strava archive YAML
 *   - Writes session-level strava block (name, type, sportType, distance, map, etc.)
 *
 * For Strava archives with no matching session:
 *   - Creates a new Strava-only session YAML (same as webhook would)
 *
 * Dry-run by default. Pass --write to persist.
 *
 * Usage:
 *   node cli/scripts/backfill-strava-enrichment.mjs [--write] [daysBack]
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync, mkdirSync } from 'fs';
import dotenv from 'dotenv';
import moment from 'moment-timezone';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '../..');

dotenv.config({ path: path.join(projectRoot, '.env') });

const isDocker = existsSync('/.dockerenv');
const baseDir = isDocker ? '/usr/src/app' : process.env.DAYLIGHT_BASE_PATH;
const dataDir = path.join(baseDir, 'data');
const configDir = path.join(dataDir, 'system', 'config');

const { hydrateProcessEnvFromConfigs } = await import('#system/logging/config.mjs');
const { initConfigService, configService } = await import('#system/config/index.mjs');
const { loadYamlSafe, saveYaml, listYamlFiles } = await import('#system/utils/FileIO.mjs');

hydrateProcessEnvFromConfigs(configDir);
initConfigService(dataDir);

const args = process.argv.slice(2);
const writeMode = args.includes('--write');
const numericArg = args.find(a => /^\d+$/.test(a));
const defaultDays = Math.ceil(moment().diff(moment('2024-01-01'), 'days'));
const daysBack = parseInt(numericArg || String(defaultDays), 10);
const username = 'kckern';
const TIMEZONE = 'America/Los_Angeles';

console.log(`Backfill Strava enrichment for ${username}, ${daysBack} days back`);
console.log(`Mode: ${writeMode ? 'WRITE' : 'DRY-RUN'}\n`);

// --- Load all Strava archives into a map by activityId ---
const stravaDir = configService.getUserPath(`lifelog/strava`, username);
const stravaByActivityId = new Map();
if (existsSync(stravaDir)) {
  for (const basename of listYamlFiles(stravaDir)) {
    const data = loadYamlSafe(path.join(stravaDir, basename));
    if (data?.id) {
      stravaByActivityId.set(String(data.id), { data, basename });
    }
  }
}
console.log(`Loaded ${stravaByActivityId.size} Strava archives\n`);

// --- Scan sessions and enrich ---
const fitnessHistoryDir = configService.getHouseholdPath('history/fitness');
const cutoff = moment().subtract(daysBack, 'days').format('YYYY-MM-DD');
const matchedActivityIds = new Set();

let enriched = 0;
let skipped = 0;
let created = 0;

const dateDirs = readdirSync(fitnessHistoryDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= cutoff).sort();

for (const date of dateDirs) {
  const dateDir = path.join(fitnessHistoryDir, date);
  const sessionFiles = listYamlFiles(dateDir);

  for (const baseName of sessionFiles) {
    const filePath = path.join(dateDir, baseName);
    const session = loadYamlSafe(filePath);
    if (!session) continue;

    // Find strava activityId from any participant
    let activityId = null;
    for (const p of Object.values(session.participants || {})) {
      if (p.strava?.activityId) {
        activityId = String(p.strava.activityId);
        break;
      }
    }

    if (!activityId) { skipped++; continue; }
    matchedActivityIds.add(activityId);

    // Already has session-level strava block?
    if (session.strava?.name) { skipped++; continue; }

    const archive = stravaByActivityId.get(activityId);
    if (!archive) { skipped++; continue; }

    const ad = archive.data.data || archive.data;

    // Build session-level strava block
    let mapData = null;
    if (ad.map?.summary_polyline) {
      mapData = {
        polyline: ad.map.summary_polyline,
        startLatLng: ad.start_latlng || [],
        endLatLng: ad.end_latlng || [],
      };
    }

    session.strava = {
      activityId: Number(activityId),
      name: ad.name || null,
      type: ad.type || null,
      sportType: ad.sport_type || null,
      movingTime: ad.moving_time || 0,
      distance: ad.distance || 0,
      totalElevationGain: ad.total_elevation_gain || 0,
      trainer: ad.trainer ?? true,
      avgHeartrate: ad.average_heartrate || null,
      maxHeartrate: ad.max_heartrate || null,
      ...(mapData ? { map: mapData } : {}),
    };

    enriched++;
    console.log(`  ENRICH ${session.sessionId || baseName}: ${ad.name || ad.type} (${activityId})`);

    if (writeMode) {
      saveYaml(filePath.replace(/\.yml$/, ''), session);
    }
  }
}

// --- Create sessions for unmatched Strava archives ---
for (const [activityId, { data: archive, basename }] of stravaByActivityId) {
  if (matchedActivityIds.has(activityId)) continue;

  const ad = archive.data || archive;
  const startDate = ad.start_date_local || ad.start_date || archive.date;
  if (!startDate) continue;

  const startLocal = moment.tz(startDate, TIMEZONE);
  if (startLocal.format('YYYY-MM-DD') < cutoff) continue;

  // Check if duration is meaningful (>= 2 min)
  const durationSeconds = ad.elapsed_time || ad.moving_time || 0;
  if (durationSeconds < 120) continue;

  const sessionId = startLocal.format('YYYYMMDDHHmmss');
  const date = startLocal.format('YYYY-MM-DD');
  const sessionDir = path.join(fitnessHistoryDir, date);
  const sessionPath = path.join(sessionDir, `${sessionId}.yml`);

  // Skip if file already exists
  if (existsSync(sessionPath)) continue;

  let mapData = null;
  if (ad.map?.summary_polyline) {
    mapData = {
      polyline: ad.map.summary_polyline,
      startLatLng: ad.start_latlng || [],
      endLatLng: ad.end_latlng || [],
    };
  }

  const sessionData = {
    version: 3,
    sessionId,
    session: {
      id: sessionId,
      date,
      start: startLocal.format('YYYY-MM-DD HH:mm:ss'),
      end: startLocal.clone().add(durationSeconds, 'seconds').format('YYYY-MM-DD HH:mm:ss'),
      duration_seconds: durationSeconds,
      source: 'strava',
    },
    timezone: TIMEZONE,
    participants: {
      [username]: {
        display_name: 'KC Kern',
        is_primary: true,
        strava: {
          activityId: Number(activityId),
          type: ad.type || ad.sport_type || null,
          sufferScore: ad.suffer_score || null,
          deviceName: ad.device_name || null,
        },
      },
    },
    strava: {
      activityId: Number(activityId),
      name: ad.name || null,
      type: ad.type || null,
      sportType: ad.sport_type || null,
      movingTime: ad.moving_time || 0,
      distance: ad.distance || 0,
      totalElevationGain: ad.total_elevation_gain || 0,
      trainer: ad.trainer ?? true,
      avgHeartrate: ad.average_heartrate || null,
      maxHeartrate: ad.max_heartrate || null,
      ...(mapData ? { map: mapData } : {}),
    },
    timeline: {
      series: {},
      events: [],
      interval_seconds: 5,
      tick_count: Math.ceil(durationSeconds / 5),
      encoding: 'rle',
    },
    treasureBox: { coinTimeUnitMs: 5000, totalCoins: 0, buckets: { blue: 0, green: 0, yellow: 0, orange: 0, red: 0 } },
    summary: {
      participants: {},
      media: [],
      coins: { total: 0, buckets: { blue: 0, green: 0, yellow: 0, orange: 0, red: 0 } },
      challenges: { total: 0, succeeded: 0, failed: 0 },
      voiceMemos: [],
    },
  };

  created++;
  console.log(`  CREATE ${sessionId}: ${ad.name || ad.type} (${activityId})`);

  if (writeMode) {
    if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
    saveYaml(sessionPath.replace(/\.yml$/, ''), sessionData);
  }
}

console.log(`\nDone: ${enriched} enriched, ${created} created, ${skipped} skipped`);
if (!writeMode) console.log('(dry-run — pass --write to persist)');
```

**Step 2: Run dry-run to verify**

Run: `node cli/scripts/backfill-strava-enrichment.mjs`
Expected: Lists sessions to enrich and Strava-only sessions to create, without writing.

**Step 3: Run with --write**

Run: `node cli/scripts/backfill-strava-enrichment.mjs --write`
Expected: Files written. Verify a sample with `cat data/household/history/fitness/2025-12-20/20251220090306.yml | grep -A5 'strava:'`.

**Step 4: Commit**

```bash
git add cli/scripts/backfill-strava-enrichment.mjs
git commit -m "feat(fitness): add CLI script to backfill session-level Strava enrichment data"
```

---

## Task 5: Sport-Type SVG Placeholders

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/_shared/SportIcon.jsx`
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx:23-33,92-122,126-145`
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx:243-257,260-264`

**Context:** Replace the generic barbell `WorkoutPlaceholder` with sport-specific SVG icons. Each gets a background color seeded from the sessionId for consistency. The existing `WorkoutPlaceholder` component (lines 23-33 in FitnessSessionsWidget) becomes the fallback.

**Step 1: Create SportIcon component**

```jsx
// frontend/src/modules/Fitness/widgets/_shared/SportIcon.jsx
import React from 'react';

/**
 * Generate a deterministic hue from a string (sessionId).
 * Returns a hue 0-360 for use in HSL colors.
 */
function seededHue(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

/**
 * SVG path data for each Strava activity type.
 * viewBox is 48x48 for all icons.
 */
const SPORT_ICONS = {
  Run: (
    <path d="M26 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm6.5 14.5-4-2.5-5.5 1 3 7-4.5 5.5L16 42h4l3.5-8 4 4V42h4V35l-4.5-6 1.5-4 3.5 3h5v-4h-3l-2-3.5z" fill="currentColor" />
  ),
  Ride: (
    <path d="M34 14l-2.5 2.5L35 20h-5l-4.5-4.5-7.5 7.5 4.5 4.5V34h3v-8l-3.5-3.5 5-5L30 16l2 3h4v-3l-2-2zM14 23a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 3a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm20-3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 3a6 6 0 1 1 0 12 6 6 0 0 1 0-12zM28 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8z" fill="currentColor" />
  ),
  WeightTraining: (
    <path d="M6 20h6v8H6zm30 0h6v8h-6zM2 21h4v6H2zm38 0h6v6h-6zM12 22h24v4H12z" fill="currentColor" opacity="0.85" />
  ),
  Yoga: (
    <path d="M24 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm-8 32l6-14 2 6h-4v2h5l1 6h3l-1-6h5v-2h-4l2-6 6 14h3L31 18h-2l-5 2-5-2h-2L9 36h3z" fill="currentColor" />
  ),
  Walk: (
    <path d="M24 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm2 10h-4l-5 10 3.5 1.5L23 20v8l-5 14h4l3.5-10L29 42h4l-5-14v-8l2.5 5.5L34 24l-5-10h-3z" fill="currentColor" />
  ),
  Hike: (
    <path d="M24 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm2 10h-4l-5 10 3.5 1.5L23 20v8l-5 14h4l3.5-10L29 42h4l-5-14v-8l2.5 5.5L34 24l-5-10h-3zM38 18l-4 8h8l-4-8z" fill="currentColor" />
  ),
  Swim: (
    <path d="M8 30c2 0 3-1.5 4-3s2-3 4-3 3 1.5 4 3 2 3 4 3 3-1.5 4-3 2-3 4-3 3 1.5 4 3 2 3 4 3v3c-3 0-5-1.5-6-3s-2-3-2-3-1 1.5-2 3-3 3-6 3-5-1.5-6-3-2-3-2-3-1 1.5-2 3-3 3-6 3v-3zm0 8c2 0 3-1.5 4-3s2-3 4-3 3 1.5 4 3 2 3 4 3 3-1.5 4-3 2-3 4-3 3 1.5 4 3 2 3 4 3v3c-3 0-5-1.5-6-3s-2-3-2-3-1 1.5-2 3-3 3-6 3-5-1.5-6-3-2-3-2-3-1 1.5-2 3-3 3-6 3v-3zM36 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-2 1l-14 5 2 3 8-3-3 7H12v3h18l4-12z" fill="currentColor" />
  ),
  Workout: (
    <>
      <rect x="6" y="20" width="6" height="8" rx="1.5" fill="currentColor" opacity="0.5" />
      <rect x="36" y="20" width="6" height="8" rx="1.5" fill="currentColor" opacity="0.5" />
      <rect x="2" y="21" width="4" height="6" rx="1" fill="currentColor" opacity="0.35" />
      <rect x="42" y="21" width="4" height="6" rx="1" fill="currentColor" opacity="0.35" />
      <rect x="12" y="22" width="24" height="4" rx="1" fill="currentColor" opacity="0.4" />
    </>
  ),
};

/**
 * Maps a Strava activity type to one of our known icon keys.
 * Falls back to 'Workout' for unknown types.
 */
function resolveIconType(stravaType) {
  if (!stravaType) return 'Workout';
  // Direct match
  if (SPORT_ICONS[stravaType]) return stravaType;
  // Common aliases
  const aliases = {
    MountainBikeRide: 'Ride',
    VirtualRide: 'Ride',
    EBikeRide: 'Ride',
    GravelRide: 'Ride',
    TrailRun: 'Run',
    VirtualRun: 'Run',
  };
  return aliases[stravaType] || 'Workout';
}

/**
 * Sport-type SVG icon with a sessionId-seeded background color.
 *
 * @param {Object} props
 * @param {string} props.type - Strava activity type (Run, Ride, WeightTraining, etc.)
 * @param {string} props.sessionId - Used to seed the background color
 * @param {string} [props.className] - Additional CSS class
 * @param {'poster'|'detail'} [props.variant='poster'] - Size variant
 */
export default function SportIcon({ type, sessionId, className = '', variant = 'poster' }) {
  const iconKey = resolveIconType(type);
  const hue = seededHue(sessionId || 'default');
  const bgColor = `hsl(${hue}, 35%, 25%)`;
  const iconColor = `hsl(${hue}, 40%, 70%)`;

  const iconContent = SPORT_ICONS[iconKey] || SPORT_ICONS.Workout;

  return (
    <div
      className={`sport-icon sport-icon--${variant} ${className}`}
      style={{
        backgroundColor: bgColor,
        color: iconColor,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: variant === 'poster' ? '4px' : '8px',
        aspectRatio: variant === 'poster' ? '2/3' : undefined,
        width: '100%',
        height: '100%',
      }}
    >
      <svg
        viewBox="0 0 48 48"
        fill="none"
        style={{
          width: variant === 'poster' ? '60%' : '40%',
          height: 'auto',
        }}
      >
        {iconContent}
      </svg>
    </div>
  );
}

export { seededHue, resolveIconType, SPORT_ICONS };
```

**Step 2: Update FitnessSessionsWidget to use SportIcon**

In `FitnessSessionsWidget.jsx`, replace the poster/title rendering logic.

Import SportIcon at the top:
```javascript
import SportIcon from './_shared/SportIcon.jsx';
```

Replace the poster section (lines 106-122) — where it currently renders `<img>` or `<WorkoutPlaceholder />`:

```jsx
                    {pm?.grandparentId ? (
                      <img
                        src={mediaDisplayUrl(pm.grandparentId)}
                        alt=""
                        className="session-poster"
                        onError={(e) => { e.target.replaceWith(Object.assign(document.createElement('div'), { className: 'session-poster session-poster--placeholder session-poster--fallback' })); }}
                      />
                    ) : pm?.contentId ? (
                      <img
                        src={mediaDisplayUrl(pm.contentId)}
                        alt=""
                        className="session-poster"
                        onError={(e) => { e.target.replaceWith(Object.assign(document.createElement('div'), { className: 'session-poster session-poster--placeholder session-poster--fallback' })); }}
                      />
                    ) : (
                      <div className="session-poster">
                        <SportIcon
                          type={s.strava?.type}
                          sessionId={s.sessionId}
                          variant="poster"
                        />
                      </div>
                    )}
```

Replace the title fallback (line 143) — use Strava name when available:

```jsx
                        <Text size="md" fw={700} truncate="end" title={pm?.title || s.strava?.name || 'Workout'}>
                          {pm?.title || s.strava?.name || 'Workout'}
                        </Text>
```

**Step 3: Update FitnessSessionDetailWidget for sport icons**

In `FitnessSessionDetailWidget.jsx`:

Import SportIcon:
```javascript
import SportIcon from './_shared/SportIcon.jsx';
```

In the `header` useMemo (line 169-208), add strava fields from the full session data:

```javascript
    // After existing header fields, add:
    const stravaBlock = sessionData.strava || null;

    return {
      // ...existing fields...
      stravaName: stravaBlock?.name || null,
      stravaType: stravaBlock?.type || null,
      stravaHasMap: !!(stravaBlock?.map?.polyline),
    };
```

Update the title (line 194) to use strava name:
```javascript
      title: pm?.title || stravaBlock?.name || 'Workout',
      showTitle: pm?.showTitle || pm?.grandparentTitle || null,
```

Replace the empty poster placeholder (line 256):
```jsx
        ) : (
          <div ref={posterRef} className="session-detail__poster session-detail__poster--placeholder">
            <SportIcon
              type={header?.stravaType}
              sessionId={sessionId}
              variant="detail"
            />
          </div>
        )}
```

**Step 4: Verify visually**

Run dev server if not running. Open fitness dashboard. Sessions without media should now show colored sport icons and Strava activity names.

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/_shared/SportIcon.jsx frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx
git commit -m "feat(fitness): sport-type SVG placeholders with sessionId-seeded colors"
```

---

## Task 6: GPS Route Map in Session Detail

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/StravaRouteMap.jsx`
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx:343-350`

**Context:** When a session has `strava.map.polyline`, render an SVG route map in the chart area (middle zone). The polyline is Google Encoded Polyline format — decode it to lat/lng pairs, then project onto an SVG canvas. No map tiles needed — just the route shape on a dark background with start/end markers.

**Step 1: Create StravaRouteMap component**

```jsx
// frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/StravaRouteMap.jsx
import React, { useMemo } from 'react';
import { seededHue } from '../_shared/SportIcon.jsx';

/**
 * Decode a Google Encoded Polyline string to [lat, lng] pairs.
 * Reference: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
function decodePolyline(encoded) {
  const points = [];
  let index = 0, lat = 0, lng = 0;

  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0; result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/**
 * Project lat/lng points to SVG coordinates within a padded bounding box.
 */
function projectPoints(points, width, height, padding = 20) {
  if (points.length === 0) return [];

  const lats = points.map(p => p[0]);
  const lngs = points.map(p => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

  const latRange = maxLat - minLat || 0.001;
  const lngRange = maxLng - minLng || 0.001;
  const drawW = width - padding * 2;
  const drawH = height - padding * 2;
  const scale = Math.min(drawW / lngRange, drawH / latRange);

  const cx = (minLng + maxLng) / 2;
  const cy = (minLat + maxLat) / 2;

  return points.map(([lat, lng]) => [
    width / 2 + (lng - cx) * scale,
    height / 2 - (lat - cy) * scale, // flip Y
  ]);
}

/**
 * Renders a Strava route as an SVG polyline.
 * No map tiles — just the route shape on a dark background.
 */
export default function StravaRouteMap({ polyline, sessionId, distance, elevation }) {
  const { svgPoints, start, end } = useMemo(() => {
    if (!polyline) return { svgPoints: '', start: null, end: null };
    const decoded = decodePolyline(polyline);
    if (decoded.length < 2) return { svgPoints: '', start: null, end: null };

    const projected = projectPoints(decoded, 400, 300);
    const svgPoints = projected.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    return {
      svgPoints,
      start: projected[0],
      end: projected[projected.length - 1],
    };
  }, [polyline]);

  if (!svgPoints) return null;

  const hue = seededHue(sessionId || 'default');
  const routeColor = `hsl(${hue}, 60%, 55%)`;

  const distanceKm = distance ? (distance / 1000).toFixed(1) : null;
  const elevationM = elevation ? Math.round(elevation) : null;

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.3)',
      borderRadius: '8px',
    }}>
      <svg viewBox="0 0 400 300" style={{ width: '100%', maxHeight: '80%' }}>
        <polyline
          points={svgPoints}
          fill="none"
          stroke={routeColor}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.9"
        />
        {/* Glow effect */}
        <polyline
          points={svgPoints}
          fill="none"
          stroke={routeColor}
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.15"
        />
        {start && (
          <circle cx={start[0]} cy={start[1]} r="6" fill="#4ade80" stroke="#166534" strokeWidth="2" />
        )}
        {end && (
          <circle cx={end[0]} cy={end[1]} r="6" fill="#f87171" stroke="#991b1b" strokeWidth="2" />
        )}
      </svg>
      {(distanceKm || elevationM) && (
        <div style={{ display: 'flex', gap: '1rem', color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem', marginTop: '0.5rem' }}>
          {distanceKm && <span>{distanceKm} km</span>}
          {elevationM != null && elevationM > 0 && <span>{elevationM}m elev</span>}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Wire StravaRouteMap into session detail chart area**

In `FitnessSessionDetailWidget.jsx`, update the chart section (lines 343-350):

Import at top:
```javascript
import StravaRouteMap from './StravaRouteMap.jsx';
```

Replace the chart area:
```jsx
      {/* Chart (40%) */}
      <div className="session-detail__chart">
        {header?.stravaHasMap ? (
          <StravaRouteMap
            polyline={sessionData.strava?.map?.polyline}
            sessionId={sessionId}
            distance={sessionData.strava?.distance}
            elevation={sessionData.strava?.totalElevationGain}
          />
        ) : ChartComponent ? (
          <ChartComponent sessionData={sessionData} mode="standalone" />
        ) : (
          <Text c="dimmed" ta="center" py="xl">Chart not available</Text>
        )}
      </div>
```

**Step 3: Verify visually**

Find a session with GPS data (sessions from 2026-01-17 or 2026-02-09 after backfill). Open session detail — should show the SVG route map instead of the HR chart.

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/StravaRouteMap.jsx frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx
git commit -m "feat(fitness): SVG route map for sessions with Strava GPS data"
```

---

## Task 7: Session Detail — Strava Stats for No-Media Sessions

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx:307-340`

**Context:** For sessions with no media, the right-side thumbnail area is empty. For Strava-enriched sessions, fill this with key Strava stats (distance, moving time, avg/max HR, elevation) in a compact display.

**Step 1: Add Strava stats to the thumb placeholder**

In `FitnessSessionDetailWidget.jsx`, replace the empty thumb placeholder (lines 332-340):

```jsx
        ) : sessionData?.strava ? (
          <div className="session-detail__thumb session-detail__thumb--strava-stats">
            <button className="session-detail__close" onClick={() => restore('right-area')} title="Close">&times;</button>
            <div className="session-detail__strava-stats">
              {sessionData.strava.distance > 0 && (
                <div className="session-detail__stat">
                  <span className="session-detail__stat-value">{(sessionData.strava.distance / 1000).toFixed(1)}</span>
                  <span className="session-detail__stat-label">km</span>
                </div>
              )}
              {sessionData.strava.movingTime > 0 && (
                <div className="session-detail__stat">
                  <span className="session-detail__stat-value">{Math.round(sessionData.strava.movingTime / 60)}</span>
                  <span className="session-detail__stat-label">min</span>
                </div>
              )}
              {sessionData.strava.avgHeartrate && (
                <div className="session-detail__stat">
                  <span className="session-detail__stat-value">{Math.round(sessionData.strava.avgHeartrate)}</span>
                  <span className="session-detail__stat-label">avg HR</span>
                </div>
              )}
              {sessionData.strava.maxHeartrate && (
                <div className="session-detail__stat">
                  <span className="session-detail__stat-value">{Math.round(sessionData.strava.maxHeartrate)}</span>
                  <span className="session-detail__stat-label">max HR</span>
                </div>
              )}
              {sessionData.strava.totalElevationGain > 0 && (
                <div className="session-detail__stat">
                  <span className="session-detail__stat-value">{Math.round(sessionData.strava.totalElevationGain)}</span>
                  <span className="session-detail__stat-label">m elev</span>
                </div>
              )}
            </div>
            {sessionId && (
              <code className="session-detail__session-id" onClick={() => navigator.clipboard?.writeText(sessionId)} title="Click to copy session ID">{sessionId}</code>
            )}
          </div>
        ) : (
          <div className="session-detail__thumb session-detail__thumb--placeholder">
            <button className="session-detail__close" onClick={() => restore('right-area')} title="Close">&times;</button>
          </div>
        )}
```

**Step 2: Add CSS for Strava stats**

In `FitnessSessionDetailWidget.scss`, add:

```scss
.session-detail__thumb--strava-stats {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 1rem;
}

.session-detail__strava-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.session-detail__stat {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.session-detail__stat-value {
  font-size: 1.4rem;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
}

.session-detail__stat-label {
  font-size: 0.65rem;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.4);
  letter-spacing: 0.05em;
}
```

**Step 3: Verify visually**

Open a Strava-enriched session without media (e.g., basketball, weight training). The right panel should show key stats.

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.scss
git commit -m "feat(fitness): display Strava stats in session detail thumb area for no-media sessions"
```

---

## Task 8: Show Strava Activity Type in Session List

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx:126-145`

**Context:** For Strava-enriched sessions without media, the show-title line is empty. Use the Strava activity type as a subtitle (e.g., "Weight Training", "Run", "Ride") in the show-title position.

**Step 1: Add sport type formatting utility**

In the `SportIcon.jsx` file (or inline in FitnessSessionsWidget), add a function:

```javascript
/**
 * Format a Strava type into a human-readable label.
 */
function formatSportType(type) {
  if (!type) return null;
  const labels = {
    Run: 'Run',
    Ride: 'Ride',
    WeightTraining: 'Weight Training',
    Workout: 'Workout',
    Yoga: 'Yoga',
    Walk: 'Walk',
    Hike: 'Hike',
    Swim: 'Swim',
    MountainBikeRide: 'Mountain Bike',
    VirtualRide: 'Virtual Ride',
    TrailRun: 'Trail Run',
    VirtualRun: 'Virtual Run',
  };
  return labels[type] || type.replace(/([A-Z])/g, ' $1').trim();
}
```

Export from `SportIcon.jsx`.

**Step 2: Use in session list show-title line**

In the title area of FitnessSessionsWidget, after the existing `pm?.showTitle` check (line 126-137), add a fallback for Strava type:

```jsx
                        {pm?.showTitle && (
                          <div className="session-row__show-line">
                            {s.durationMs > 0 && (
                              <span className="session-row__duration-badge">
                                {Math.round(s.durationMs / 60000)}m
                              </span>
                            )}
                            <Text size="xs" c="dimmed" truncate="end" title={pm.showTitle}>
                              {pm.showTitle}
                            </Text>
                          </div>
                        )}
                        {!pm?.showTitle && s.strava?.type && (
                          <div className="session-row__show-line">
                            {s.durationMs > 0 && (
                              <span className="session-row__duration-badge">
                                {Math.round(s.durationMs / 60000)}m
                              </span>
                            )}
                            <Text size="xs" c="dimmed" truncate="end">
                              {formatSportType(s.strava.type)}
                            </Text>
                          </div>
                        )}
                        {!pm?.showTitle && !s.strava?.type && s.durationMs > 0 && (
                          <span className="session-row__duration-badge">
                            {Math.round(s.durationMs / 60000)}m
                          </span>
                        )}
```

**Step 3: Verify visually**

Check session list — Strava sessions should show sport type as subtitle.

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/_shared/SportIcon.jsx frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx
git commit -m "feat(fitness): show Strava sport type as subtitle in session list"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Session-level strava in findByDate API | YamlSessionDatastore + test |
| 2 | Create Strava-only sessions from webhook | FitnessActivityEnrichmentService + test |
| 3 | Strava identity in user profile | profile.yml |
| 4 | Retroactive enrichment CLI | New backfill script |
| 5 | Sport-type SVG placeholders | SportIcon.jsx + session widgets |
| 6 | GPS route map | StravaRouteMap.jsx + session detail |
| 7 | Strava stats in detail thumb | Session detail widget + SCSS |
| 8 | Sport type subtitle in list | Session list widget |

**Dependencies:** Task 1 before Tasks 5-8 (API must return strava fields). Task 3 before Task 2 (identity mapping needed). Task 4 before Tasks 5-8 (data must exist). Tasks 5-8 are independent of each other.
