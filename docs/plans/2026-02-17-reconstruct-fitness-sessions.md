# Reconstruct Fitness Sessions from Strava + Plex Data

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a CLI script that finds Strava workouts without matching home fitness sessions, matches them with Plex fitness media plays by timestamp, and reconstructs v3 session files with HR data, zones, coins, and media events.

**Architecture:** Standalone CLI script (`cli/reconstruct-fitness-sessions.mjs`) that bootstraps ConfigService, reads strava summary + archives for HR data, reads `14_fitness.yml` for media play timestamps, and writes v3 session YAML files to `history/fitness/`. Uses existing `encodeToRLE` from TimelineService and existing FileIO utilities. Dry-run by default, `--write` to persist.

**Tech Stack:** Node.js ESM, moment-timezone, existing DaylightStation YAML utilities (loadYamlSafe, saveYaml, ensureDir), TimelineService (encodeToRLE)

---

### Task 1: Bootstrap and Data Loading

**Files:**
- Create: `cli/reconstruct-fitness-sessions.mjs`

**Step 1: Write the script scaffold with bootstrap**

```js
#!/usr/bin/env node

/**
 * Reconstruct Fitness Sessions from Strava + Plex Data
 *
 * Finds Strava workouts without a home fitness session match,
 * matches them with Plex fitness media plays by lastPlayed timestamp,
 * and reconstructs v3 session files.
 *
 * Usage:
 *   node cli/reconstruct-fitness-sessions.mjs              # dry run
 *   node cli/reconstruct-fitness-sessions.mjs --write       # persist files
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { existsSync } from 'fs';
import moment from 'moment-timezone';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

dotenv.config({ path: path.join(projectRoot, '.env') });

const isDocker = existsSync('/.dockerenv');
const baseDir = isDocker ? '/usr/src/app' : process.env.DAYLIGHT_BASE_PATH;
const dataDir = path.join(baseDir, 'data');
const configDir = path.join(dataDir, 'system', 'config');

// Bootstrap config
const { hydrateProcessEnvFromConfigs } = await import('#system/logging/config.mjs');
const { initConfigService, configService } = await import('#system/config/index.mjs');
const { loadYamlSafe, saveYaml, ensureDir, listYamlFiles } = await import('#system/utils/FileIO.mjs');
const { encodeToRLE, encodeSingleSeries } = await import(
  '#domains/fitness/services/TimelineService.mjs'
);

hydrateProcessEnvFromConfigs(configDir);
initConfigService(dataDir);

const WRITE_MODE = process.argv.includes('--write');
const USERNAME = process.argv.find(a => !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1]) || 'kckern';
const TIMEZONE = 'America/Los_Angeles';

// --- Zone config from fitness.yml ---
const ZONES = [
  { id: 'cool',   min: 0,   color: 'blue',   coins: 0 },
  { id: 'active', min: 100, color: 'green',  coins: 1 },
  { id: 'warm',   min: 120, color: 'yellow', coins: 2 },
  { id: 'hot',    min: 140, color: 'orange', coins: 3 },
  { id: 'fire',   min: 160, color: 'red',    coins: 5 },
];

const COIN_TIME_UNIT_MS = 5000;
const INTERVAL_SECONDS = COIN_TIME_UNIT_MS / 1000; // 5
const BUFFER_MINUTES = 5;

console.log(`Reconstruct fitness sessions for ${USERNAME}`);
console.log(`Mode: ${WRITE_MODE ? 'WRITE' : 'DRY RUN'}`);
console.log('');
```

**Step 2: Add data loading functions**

Append to the same file:

```js
// --- Data Loading ---

function loadStravaSummary() {
  const { default: userDataService } = await import('#system/config/UserDataService.mjs');
  // Can't use top-level await in function — we'll restructure as async main
  return null; // placeholder
}
```

Actually, restructure the whole script as an async `main()`. Append:

```js
async function main() {
  // 1. Load strava summary
  const { default: userDataService } = await import('#system/config/UserDataService.mjs');
  const stravaSummary = userDataService.getLifelogData(USERNAME, 'strava') || {};

  // 2. Load media memory
  const mediaMemoryPath = configService.getHouseholdPath('history/media_memory/plex/14_fitness.yml');
  const mediaMemory = loadYamlSafe(mediaMemoryPath) || {};

  // 3. Paths
  const fitnessHistoryDir = configService.getHouseholdPath('history/fitness');
  const stravaDir = path.join(configService.getUserDir(USERNAME), 'lifelog', 'strava');
  const mediaArchiveDir = path.join(configService.getMediaDir(), 'archives', 'strava');

  // 4. Find unmatched strava entries
  const unmatched = [];
  for (const [date, entries] of Object.entries(stravaSummary)) {
    for (const entry of entries) {
      if (entry.homeSessionId) continue; // already matched

      // Check if a session already exists for this time
      const startMoment = moment.tz(
        `${date} ${entry.startTime}`,
        'YYYY-MM-DD hh:mm a',
        TIMEZONE
      );
      if (!startMoment.isValid()) continue;

      const sessionId = startMoment.format('YYYYMMDDHHmmss');
      const sessionDir = path.join(fitnessHistoryDir, date);
      const sessionPath = path.join(sessionDir, `${sessionId}.yml`);

      // Skip if session file already exists
      if (existsSync(sessionPath)) {
        console.log(`[SKIP]  ${date} ${entry.type} — session file already exists: ${sessionId}`);
        continue;
      }

      // Find archive file with HR data
      const typeRaw = entry.type || 'activity';
      const archiveName = `${date}_${typeRaw}_${entry.id}`;
      let archive = loadYamlSafe(path.join(stravaDir, `${archiveName}.yml`));
      if (!archive) {
        archive = loadYamlSafe(path.join(mediaArchiveDir, `${archiveName}.yml`));
      }

      const hrData = archive?.data?.heartRateOverTime;
      if (!hrData || !Array.isArray(hrData) || hrData.length < 2) {
        console.log(`[SKIP]  ${date} ${entry.type} (${entry.title || entry.id}) — no HR data`);
        continue;
      }

      unmatched.push({
        date,
        entry,
        archive: archive.data,
        hrData,
        startMoment,
        sessionId,
        durationSeconds: (entry.minutes || 0) * 60,
      });
    }
  }

  console.log(`Found ${unmatched.length} unmatched Strava entries with HR data\n`);

  // 5. Process each unmatched entry
  for (const item of unmatched) {
    processEntry(item, mediaMemory, fitnessHistoryDir, stravaSummary, stravaDir, mediaArchiveDir);
  }

  // 6. Save enriched strava summary if writing
  if (WRITE_MODE && unmatched.length > 0) {
    userDataService.saveLifelogData(USERNAME, 'strava', stravaSummary);
    console.log('\nStrava summary updated.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

**Step 3: Run to verify bootstrap works**

```bash
node cli/reconstruct-fitness-sessions.mjs
```

Expected: Prints count of unmatched entries, no errors.

---

### Task 2: Zone, Coin, and Timeline Reconstruction

**Files:**
- Modify: `cli/reconstruct-fitness-sessions.mjs`

**Step 1: Add pure helper functions**

Add these before `main()`:

```js
// --- Pure Helpers ---

/**
 * Resolve HR value to zone (descending threshold check)
 */
function resolveZone(hr) {
  if (!hr || hr <= 0) return ZONES[0]; // cool
  for (let i = ZONES.length - 1; i >= 0; i--) {
    if (hr >= ZONES[i].min) return ZONES[i];
  }
  return ZONES[0];
}

/**
 * Resample per-second HR array to 5-second intervals (point sampling)
 */
function resampleHR(hrPerSecond) {
  const resampled = [];
  for (let i = 0; i < hrPerSecond.length; i += INTERVAL_SECONDS) {
    resampled.push(hrPerSecond[i]);
  }
  return resampled;
}

/**
 * Build all timeline series from resampled HR data
 * Returns { series, treasureBox, summary }
 */
function buildTimeline(hrResampled) {
  const zones = [];
  const coins = [];
  const buckets = { blue: 0, green: 0, yellow: 0, orange: 0, red: 0 };
  let totalCoins = 0;

  // Zone shortcodes for session format: cool→c, active→a, warm→w, hot→h, fire→fire
  const zoneShortCode = { cool: 'c', active: 'a', warm: 'w', hot: 'h', fire: 'fire' };

  // Track zone minutes
  const zoneSeconds = { cool: 0, active: 0, warm: 0, hot: 0, fire: 0 };

  for (const hr of hrResampled) {
    const zone = resolveZone(hr);
    zones.push(zoneShortCode[zone.id] || zone.id);
    totalCoins += zone.coins;
    coins.push(totalCoins);
    buckets[zone.color] += zone.coins;
    zoneSeconds[zone.id] += INTERVAL_SECONDS;
  }

  // Build summary zone_minutes (only include non-zero)
  const zoneMinutes = {};
  for (const [zoneId, secs] of Object.entries(zoneSeconds)) {
    if (secs > 0) {
      zoneMinutes[zoneId] = parseFloat((secs / 60).toFixed(2));
    }
  }

  // HR stats
  const validHR = hrResampled.filter(h => h > 0);
  const hrAvg = validHR.length > 0 ? Math.round(validHR.reduce((a, b) => a + b, 0) / validHR.length) : 0;
  const hrMax = validHR.length > 0 ? Math.max(...validHR) : 0;
  const hrMin = validHR.length > 0 ? Math.min(...validHR) : 0;

  return {
    series: {
      [`${USERNAME}:hr`]: encodeSingleSeries(hrResampled),
      [`${USERNAME}:zone`]: encodeSingleSeries(zones),
      [`${USERNAME}:coins`]: encodeSingleSeries(coins),
      'global:coins': encodeSingleSeries(coins),
    },
    treasureBox: {
      coinTimeUnitMs: COIN_TIME_UNIT_MS,
      totalCoins,
      buckets,
    },
    summary: {
      hrAvg,
      hrMax,
      hrMin,
      zoneMinutes,
      totalCoins,
      buckets,
    },
    tickCount: hrResampled.length,
  };
}
```

**Step 2: Verify helpers by logging a test case**

Add a temporary log in `main()` after loading data, before the processing loop, to test with the first unmatched entry's HR data. Remove after verifying.

---

### Task 3: Media Matching

**Files:**
- Modify: `cli/reconstruct-fitness-sessions.mjs`

**Step 1: Add media matching function**

```js
/**
 * Find media entries from 14_fitness.yml whose lastPlayed falls within
 * the Strava workout time window (with buffer)
 */
function findMatchingMedia(startMoment, durationSeconds, mediaMemory) {
  const windowStart = startMoment.clone().subtract(BUFFER_MINUTES, 'minutes');
  const windowEnd = startMoment.clone().add(durationSeconds, 'seconds').add(BUFFER_MINUTES, 'minutes');

  const matches = [];

  for (const [key, entry] of Object.entries(mediaMemory)) {
    if (!entry.lastPlayed) continue;

    const lastPlayed = moment.tz(entry.lastPlayed, 'YYYY-MM-DD HH:mm:ss', TIMEZONE);
    if (!lastPlayed.isValid()) continue;

    if (lastPlayed.isBetween(windowStart, windowEnd, null, '[]')) {
      // Extract mediaId from key (format: "plex:12345")
      const mediaId = key.replace('plex:', '');
      matches.push({
        mediaId,
        plexId: mediaId,
        durationSeconds: entry.duration || 0,
        lastPlayed: entry.lastPlayed,
      });
    }
  }

  return matches;
}
```

---

### Task 4: Session File Assembly and Output

**Files:**
- Modify: `cli/reconstruct-fitness-sessions.mjs`

**Step 1: Add the processEntry function**

```js
function processEntry(item, mediaMemory, fitnessHistoryDir, stravaSummary, stravaDir, mediaArchiveDir) {
  const { date, entry, archive, hrData, startMoment, sessionId, durationSeconds } = item;

  // 1. Resample HR and build timeline
  const hrResampled = resampleHR(hrData);
  const timeline = buildTimeline(hrResampled);

  // 2. Find matching media
  const mediaMatches = findMatchingMedia(startMoment, durationSeconds, mediaMemory);

  // 3. Build media events (spread evenly if multiple)
  const mediaEvents = mediaMatches.map((media, i) => {
    const offsetMs = mediaMatches.length > 1
      ? Math.round((durationSeconds * 1000 * i) / mediaMatches.length)
      : 0;
    return {
      timestamp: startMoment.clone().add(offsetMs, 'ms').valueOf(),
      offsetMs,
      type: 'media_start',
      data: {
        source: 'plex',
        mediaId: media.mediaId,
        plexId: media.plexId,
        durationSeconds: media.durationSeconds,
      },
    };
  });

  // 4. Build session end time
  const endMoment = startMoment.clone().add(durationSeconds, 'seconds');

  // 5. Assemble v3 session object
  const session = {
    version: 3,
    sessionId,
    session: {
      id: sessionId,
      date,
      start: startMoment.format('YYYY-MM-DD HH:mm:ss.000'),
      end: endMoment.format('YYYY-MM-DD HH:mm:ss.000'),
      duration_seconds: Math.round(durationSeconds),
    },
    timezone: TIMEZONE,
    participants: {
      [USERNAME]: {
        display_name: 'KC Kern',
        hr_device: '40475',
        is_primary: true,
        base_user: 'KC Kern',
        strava: {
          activityId: entry.id,
          type: archive.type || archive.sport_type || entry.type,
          sufferScore: entry.suffer_score || archive.suffer_score || null,
          deviceName: entry.device_name || archive.device_name || null,
        },
      },
    },
    timeline: {
      series: timeline.series,
      events: mediaEvents,
      interval_seconds: INTERVAL_SECONDS,
      tick_count: timeline.tickCount,
      encoding: 'rle',
    },
    treasureBox: timeline.treasureBox,
    summary: {
      participants: {
        [USERNAME]: {
          coins: timeline.summary.totalCoins,
          hr_avg: timeline.summary.hrAvg,
          hr_max: timeline.summary.hrMax,
          hr_min: timeline.summary.hrMin,
          zone_minutes: timeline.summary.zoneMinutes,
        },
      },
      media: mediaMatches.map(m => m.mediaId),
      coins: {
        total: timeline.summary.totalCoins,
        buckets: timeline.summary.buckets,
      },
      challenges: { total: 0, succeeded: 0, failed: 0 },
      voiceMemos: [],
    },
  };

  // 6. Output
  const mediaLabel = mediaMatches.length > 0
    ? `${mediaMatches.length} media`
    : 'no media';
  const coinLabel = `${timeline.treasureBox.totalCoins} coins`;

  if (WRITE_MODE) {
    const sessionDir = path.join(fitnessHistoryDir, date);
    ensureDir(sessionDir);
    const sessionPath = path.join(sessionDir, sessionId);
    saveYaml(sessionPath, session);

    // Enrich strava summary entry
    entry.homeSessionId = sessionId;
    entry.homeCoins = timeline.treasureBox.totalCoins;
    if (mediaMatches.length > 0) {
      entry.homeMedia = mediaMatches.map(m => `plex:${m.mediaId}`).join(', ');
    }

    // Enrich strava archive
    const typeRaw = entry.type || 'activity';
    const archiveName = `${date}_${typeRaw}_${entry.id}`;
    let archiveFile = loadYamlSafe(path.join(stravaDir, `${archiveName}.yml`));
    if (!archiveFile) {
      archiveFile = loadYamlSafe(path.join(mediaArchiveDir, `${archiveName}.yml`));
    }
    if (archiveFile?.data) {
      archiveFile.data.homeSessionId = sessionId;
      archiveFile.data.homeCoins = timeline.treasureBox.totalCoins;
      if (mediaMatches.length > 0) {
        archiveFile.data.homeMedia = mediaMatches.map(m => `plex:${m.mediaId}`).join(', ');
      }
      // Save back to wherever it was found
      const archivePath = existsSync(path.join(stravaDir, `${archiveName}.yml`))
        ? path.join(stravaDir, archiveName)
        : path.join(mediaArchiveDir, archiveName);
      saveYaml(archivePath, archiveFile);
    }

    console.log(`[WRITE] ${date} ${entry.type} (${entry.title || ''}) → ${sessionId} | ${mediaLabel} | ${coinLabel}`);
  } else {
    console.log(`[MATCH] ${date} ${entry.type} (${entry.title || ''}) → ${sessionId} | ${mediaLabel} | ${coinLabel}`);
  }
}
```

**Step 2: Run dry-run and verify output**

```bash
node cli/reconstruct-fitness-sessions.mjs
```

Expected: Lines like:
```
[MATCH] 2026-02-16 WeightTraining (Morning Weight Training) → 20260216090933 | 0 media | 150 coins
[SKIP]  2026-02-13 Workout — no HR data
```

**Step 3: Run with --write and verify files created**

```bash
node cli/reconstruct-fitness-sessions.mjs --write
```

Then verify a created file:
```bash
cat data/household/history/fitness/2026-02-16/20260216090933.yml | head -20
```

**Step 4: Commit**

```bash
git add cli/reconstruct-fitness-sessions.mjs
git commit -m "feat(fitness): add CLI to reconstruct sessions from Strava + Plex data"
```
