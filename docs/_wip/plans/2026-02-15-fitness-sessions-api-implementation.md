# Fitness Sessions API Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a pre-computed `summary` block to fitness session YAML files (at save time + backfill), then update the API list endpoint and frontend to consume the richer data — per-participant HR/coins, multi-media with primary flag, challenge counts, voice memos.

**Architecture:** A new pure function `buildSessionSummary()` computes the summary from raw session data. PersistenceManager calls it before encoding series. A backfill CLI script adds summaries to existing sessions. YamlSessionDatastore reads from the summary block for list endpoints. The frontend hook adapts the new API shape so the component needs only a 1-line change.

**Tech Stack:** Node.js (ES modules), YAML (js-yaml), React (Mantine UI), Vitest (tests)

**Design doc:** `docs/_wip/plans/2026-02-15-fitness-sessions-api-redesign.md`

---

### Task 1: Create `buildSessionSummary.js` — Tests

**Files:**
- Create: `tests/isolated/domain/fitness/build-session-summary.unit.test.mjs`

**Context:** `SessionSerializerV3.js` already has `computeHrStats()`, `computeZoneTime()`, `getLastValue()` — we reuse those static methods. The new `buildSessionSummary()` orchestrates them into a summary block.

Series key formats differ between PersistenceManager (pre-encoding: `user:alan:heart_rate`) and YAML storage (compact: `alan:hr`). The function handles both via a helper `getParticipantSeries()`.

**Step 1: Write the test file**

```js
// tests/isolated/domain/fitness/build-session-summary.unit.test.mjs
import { describe, it, expect } from 'vitest';
import { buildSessionSummary } from '../../../../frontend/src/hooks/fitness/buildSessionSummary.js';

describe('buildSessionSummary', () => {
  const INTERVAL_SECONDS = 5;

  // Sample data: 2 participants, 10 ticks each, 1 media event, 1 challenge, 1 voice memo
  const baseSeries = {
    // Compact key format (from YAML storage)
    'alan:hr': [120, 130, 140, 150, 160, 155, 145, 135, 125, 115],
    'alan:zone': ['c', 'a', 'a', 'w', 'h', 'h', 'w', 'a', 'c', 'c'],
    'alan:coins': [0, 0, 1, 2, 3, 5, 7, 9, 11, 13],
    'milo:hr': [100, 110, 115, 120, 125, 120, 115, 110, 105, 100],
    'milo:zone': ['c', 'c', 'a', 'a', 'w', 'w', 'a', 'c', 'c', 'c'],
    'milo:coins': [0, 0, 0, 1, 2, 3, 4, 5, 6, 7],
  };

  const baseParticipants = {
    alan: { display_name: 'Alan', hr_device: '28676', is_primary: true },
    milo: { display_name: 'Milo', hr_device: '28688', is_primary: true },
  };

  const baseEvents = [
    {
      timestamp: 1000000,
      type: 'media',
      data: {
        mediaId: '606442',
        title: 'Mario Kart 8',
        grandparentTitle: 'Game Cycling',
        parentTitle: 'Mario Kart',
        grandparentId: 603407,
        parentId: 603408,
        start: 1000000,
        end: 1050000,
      },
    },
    {
      timestamp: 1020000,
      type: 'challenge',
      data: { result: 'success', metUsers: ['alan', 'milo'] },
    },
    {
      timestamp: 1040000,
      type: 'voice_memo',
      data: {
        memoId: 'memo_1',
        duration_seconds: 10,
        transcript: 'Great workout!',
      },
    },
  ];

  const baseTreasureBox = {
    totalCoins: 20,
    buckets: { blue: 2, green: 5, yellow: 6, orange: 4, red: 3 },
  };

  it('computes per-participant HR stats', () => {
    const summary = buildSessionSummary({
      participants: baseParticipants,
      series: baseSeries,
      events: [],
      treasureBox: baseTreasureBox,
      intervalSeconds: INTERVAL_SECONDS,
    });

    expect(summary.participants.alan.hr_avg).toBe(138); // Math.round(mean of alan:hr)
    expect(summary.participants.alan.hr_max).toBe(160);
    expect(summary.participants.alan.hr_min).toBe(115);
    expect(summary.participants.milo.hr_avg).toBe(112);
    expect(summary.participants.milo.hr_max).toBe(125);
    expect(summary.participants.milo.hr_min).toBe(100);
  });

  it('computes per-participant coins from final cumulative value', () => {
    const summary = buildSessionSummary({
      participants: baseParticipants,
      series: baseSeries,
      events: [],
      treasureBox: baseTreasureBox,
      intervalSeconds: INTERVAL_SECONDS,
    });

    expect(summary.participants.alan.coins).toBe(13);
    expect(summary.participants.milo.coins).toBe(7);
  });

  it('computes zone_minutes per participant', () => {
    const summary = buildSessionSummary({
      participants: baseParticipants,
      series: baseSeries,
      events: [],
      treasureBox: baseTreasureBox,
      intervalSeconds: INTERVAL_SECONDS,
    });

    // alan zones: c,a,a,w,h,h,w,a,c,c = cool:3*5=15s, active:3*5=15s, warm:2*5=10s, hot:2*5=10s
    const alanZone = summary.participants.alan.zone_minutes;
    expect(alanZone.cool).toBeCloseTo(0.25, 1);  // 15s / 60
    expect(alanZone.active).toBeCloseTo(0.25, 1);
    expect(alanZone.warm).toBeCloseTo(0.17, 1);   // 10s / 60
    expect(alanZone.hot).toBeCloseTo(0.17, 1);
  });

  it('extracts media events with primary flag on longest', () => {
    const twoMediaEvents = [
      {
        timestamp: 1000000,
        type: 'media',
        data: {
          mediaId: '606442', title: 'Mario Kart 8',
          grandparentTitle: 'Game Cycling', parentTitle: 'Mario Kart',
          grandparentId: 603407, parentId: 603408,
          start: 1000000, end: 1030000,
        },
      },
      {
        timestamp: 1030000,
        type: 'media',
        data: {
          mediaId: '606443', title: 'Sonic Racing',
          grandparentTitle: 'Game Cycling', parentTitle: 'Sonic',
          grandparentId: 603407, parentId: 603409,
          start: 1030000, end: 1050000,
        },
      },
    ];

    const summary = buildSessionSummary({
      participants: baseParticipants,
      series: baseSeries,
      events: twoMediaEvents,
      treasureBox: baseTreasureBox,
      intervalSeconds: INTERVAL_SECONDS,
    });

    expect(summary.media).toHaveLength(2);
    // Mario Kart 8: 30000ms, Sonic Racing: 20000ms — MK8 is primary
    const primary = summary.media.find(m => m.primary);
    expect(primary.title).toBe('Mario Kart 8');
    expect(primary.mediaId).toBe('606442');
    expect(primary.grandparentId).toBe(603407);
    // Secondary has no primary flag
    const secondary = summary.media.find(m => !m.primary);
    expect(secondary.title).toBe('Sonic Racing');
    expect(secondary.grandparentId).toBe(603407);
  });

  it('includes coins total and buckets from treasureBox', () => {
    const summary = buildSessionSummary({
      participants: baseParticipants,
      series: baseSeries,
      events: [],
      treasureBox: baseTreasureBox,
      intervalSeconds: INTERVAL_SECONDS,
    });

    expect(summary.coins.total).toBe(20);
    expect(summary.coins.buckets).toEqual({ blue: 2, green: 5, yellow: 6, orange: 4, red: 3 });
  });

  it('counts challenges by result', () => {
    const events = [
      { timestamp: 1000, type: 'challenge', data: { result: 'success' } },
      { timestamp: 2000, type: 'challenge', data: { result: 'success' } },
      { timestamp: 3000, type: 'challenge', data: { result: 'failed' } },
    ];

    const summary = buildSessionSummary({
      participants: baseParticipants,
      series: baseSeries,
      events,
      treasureBox: baseTreasureBox,
      intervalSeconds: INTERVAL_SECONDS,
    });

    expect(summary.challenges.total).toBe(3);
    expect(summary.challenges.succeeded).toBe(2);
    expect(summary.challenges.failed).toBe(1);
  });

  it('extracts voice memos with transcript', () => {
    const summary = buildSessionSummary({
      participants: baseParticipants,
      series: baseSeries,
      events: baseEvents,
      treasureBox: baseTreasureBox,
      intervalSeconds: INTERVAL_SECONDS,
    });

    expect(summary.voiceMemos).toHaveLength(1);
    expect(summary.voiceMemos[0].transcript).toBe('Great workout!');
    expect(summary.voiceMemos[0].durationSeconds).toBe(10);
    expect(summary.voiceMemos[0].timestamp).toBe(1040000);
  });

  it('handles user:slug:metric key format (PersistenceManager input)', () => {
    const v2Series = {
      'user:alan:heart_rate': [120, 130, 140],
      'user:alan:zone_id': ['c', 'a', 'w'],
      'user:alan:coins_total': [0, 5, 10],
    };

    const summary = buildSessionSummary({
      participants: { alan: { display_name: 'Alan' } },
      series: v2Series,
      events: [],
      treasureBox: { totalCoins: 10, buckets: {} },
      intervalSeconds: INTERVAL_SECONDS,
    });

    expect(summary.participants.alan.hr_avg).toBe(130);
    expect(summary.participants.alan.hr_max).toBe(140);
    expect(summary.participants.alan.coins).toBe(10);
  });

  it('returns empty summary for missing data', () => {
    const summary = buildSessionSummary({
      participants: {},
      series: {},
      events: [],
      treasureBox: null,
      intervalSeconds: 5,
    });

    expect(summary.participants).toEqual({});
    expect(summary.media).toEqual([]);
    expect(summary.coins.total).toBe(0);
    expect(summary.challenges.total).toBe(0);
    expect(summary.voiceMemos).toEqual([]);
  });
});
```

**Step 2: Run to verify test fails**

Run: `npx vitest run tests/isolated/domain/fitness/build-session-summary.unit.test.mjs`
Expected: FAIL — `Cannot find module 'buildSessionSummary.js'`

---

### Task 2: Create `buildSessionSummary.js` — Implementation

**Files:**
- Create: `frontend/src/hooks/fitness/buildSessionSummary.js`

**Context:** This file is a pure function with no React/browser dependencies. It reuses `SessionSerializerV3.computeHrStats()`, `computeZoneTime()`, and `getLastValue()` static methods to avoid duplicating logic.

**Step 1: Write the implementation**

```js
// frontend/src/hooks/fitness/buildSessionSummary.js

import { SessionSerializerV3 } from './SessionSerializerV3.js';

/**
 * Metric key aliases: maps compact YAML keys to v2 PersistenceManager keys.
 * Both formats are supported transparently.
 */
const METRIC_ALIASES = {
  hr: ['hr', 'heart_rate', 'heart-rate'],
  zone: ['zone', 'zone_id', 'zone-id'],
  coins: ['coins', 'coins_total', 'coins-total'],
  beats: ['beats', 'heart_beats', 'heart-beats'],
};

/**
 * Find a participant's series by trying multiple key formats.
 * Supports compact (alan:hr) and v2 (user:alan:heart_rate) key formats.
 *
 * @param {Object} series - All series keyed by name
 * @param {string} slug - Participant slug (e.g., 'alan')
 * @param {string} metric - Desired metric (e.g., 'hr')
 * @returns {Array|null}
 */
function getParticipantSeries(series, slug, metric) {
  const aliases = METRIC_ALIASES[metric] || [metric];
  for (const alias of aliases) {
    // Compact format: slug:metric
    const compact = `${slug}:${alias}`;
    if (series[compact]) return series[compact];
    // v2 format: user:slug:metric
    const v2 = `user:${slug}:${alias}`;
    if (series[v2]) return series[v2];
  }
  return null;
}

/**
 * Build a pre-computed summary block from raw session data.
 *
 * @param {Object} params
 * @param {Object} params.participants - Keyed participant object { alan: { display_name, ... } }
 * @param {Object} params.series - Raw decoded series arrays (not RLE-encoded strings)
 * @param {Array} params.events - Consolidated events array
 * @param {Object|null} params.treasureBox - { totalCoins, buckets }
 * @param {number} params.intervalSeconds - Timeline sampling interval (typically 5)
 * @returns {Object} Summary block matching the design spec
 */
export function buildSessionSummary({ participants, series, events, treasureBox, intervalSeconds }) {
  const safeParticipants = participants || {};
  const safeSeries = series || {};
  const safeEvents = Array.isArray(events) ? events : [];
  const safeInterval = intervalSeconds || 5;

  // ── Per-participant stats ──
  const participantSummary = {};
  for (const [slug, info] of Object.entries(safeParticipants)) {
    const hrSeries = getParticipantSeries(safeSeries, slug, 'hr');
    const zoneSeries = getParticipantSeries(safeSeries, slug, 'zone');
    const coinsSeries = getParticipantSeries(safeSeries, slug, 'coins');

    const hrStats = SessionSerializerV3.computeHrStats(hrSeries);
    const zoneTimeSeconds = SessionSerializerV3.computeZoneTime(zoneSeries, safeInterval);
    const coins = SessionSerializerV3.getLastValue(coinsSeries);

    // Convert zone seconds to minutes
    const zoneMinutes = {};
    for (const [zone, seconds] of Object.entries(zoneTimeSeconds)) {
      zoneMinutes[zone] = Math.round((seconds / 60) * 100) / 100;
    }

    participantSummary[slug] = {
      coins: typeof coins === 'number' ? coins : 0,
      hr_avg: hrStats.avg,
      hr_max: hrStats.max,
      hr_min: hrStats.min,
      zone_minutes: zoneMinutes,
    };
  }

  // ── Media events with primary flag ──
  const mediaEvents = safeEvents.filter(e => e.type === 'media' && e.data);
  const mediaSummary = mediaEvents.map(evt => {
    const d = evt.data;
    const start = d.start || evt.timestamp || 0;
    const end = d.end || 0;
    const durationMs = end > start ? end - start : 0;
    return {
      mediaId: String(d.mediaId || ''),
      title: d.title || null,
      showTitle: d.grandparentTitle || null,
      seasonTitle: d.parentTitle || null,
      grandparentId: d.grandparentId || null,
      parentId: d.parentId || null,
      durationMs,
    };
  });

  // Mark longest media as primary
  if (mediaSummary.length > 0) {
    let longestIdx = 0;
    for (let i = 1; i < mediaSummary.length; i++) {
      if (mediaSummary[i].durationMs > mediaSummary[longestIdx].durationMs) {
        longestIdx = i;
      }
    }
    mediaSummary[longestIdx].primary = true;
  }

  // ── Coins ──
  const coinsSummary = {
    total: treasureBox?.totalCoins || 0,
    buckets: treasureBox?.buckets || {},
  };

  // ── Challenges ──
  const challengeEvents = safeEvents.filter(e => e.type === 'challenge');
  const succeeded = challengeEvents.filter(e => e.data?.result === 'success').length;
  const challengesSummary = {
    total: challengeEvents.length,
    succeeded,
    failed: challengeEvents.length - succeeded,
  };

  // ── Voice memos ──
  const voiceMemoEvents = safeEvents.filter(e => e.type === 'voice_memo' && e.data);
  const voiceMemosSummary = voiceMemoEvents.map(evt => ({
    transcript: evt.data.transcript || evt.data.transcriptPreview || null,
    durationSeconds: evt.data.duration_seconds || evt.data.durationSeconds || null,
    timestamp: evt.timestamp || null,
  }));

  return {
    participants: participantSummary,
    media: mediaSummary,
    coins: coinsSummary,
    challenges: challengesSummary,
    voiceMemos: voiceMemosSummary,
  };
}

export default buildSessionSummary;
```

**Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/isolated/domain/fitness/build-session-summary.unit.test.mjs`
Expected: All 8 tests PASS

**Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/buildSessionSummary.js tests/isolated/domain/fitness/build-session-summary.unit.test.mjs
git commit -m "feat(fitness): add buildSessionSummary computation function with tests"
```

---

### Task 3: Integrate `buildSessionSummary` into PersistenceManager

**Files:**
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js:19-22` (imports), `695-822` (persistSession)

**Context:** `persistSession()` builds the payload, validates it, restructures the timeline, then encodes series. We insert the summary computation AFTER the timeline is restructured (events are consolidated, participants built) but BEFORE series encoding (line 822). At this point, `persistSessionData.timeline.series` still has raw arrays.

However, the series keys at this point are the ORIGINAL format (`user:alan:heart_rate`), not compact yet. `buildSessionSummary()` handles both formats via `getParticipantSeries()`.

The `persistSessionData.participants` object is already built (line 730-745) with `display_name`, `hr_device`, etc.

**Step 1: Add import**

At `PersistenceManager.js:22`, after the `SessionSerializerV3` import, add:

```js
import { buildSessionSummary } from './buildSessionSummary.js';
```

**Step 2: Add summary computation before series encoding**

Insert at `PersistenceManager.js:820` (just before the `// Encode series` comment at line 821):

```js
    // Compute summary block from raw series (before RLE encoding)
    const intervalSeconds = persistSessionData.timeline?.interval_seconds || 5;
    persistSessionData.summary = buildSessionSummary({
      participants: persistSessionData.participants,
      series: persistSessionData.timeline?.series || {},
      events: persistSessionData.timeline?.events || [],
      treasureBox: sessionData.treasureBox || null,
      intervalSeconds,
    });
```

**Step 3: Run existing PersistenceManager tests to verify no regression**

Run: `npx vitest run tests/isolated/domain/fitness/legacy/persistence-manager-v3.unit.test.mjs`
Expected: All existing tests PASS

**Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/PersistenceManager.js
git commit -m "feat(fitness): compute summary block at session save time"
```

---

### Task 4: Create backfill script

**Files:**
- Create: `cli/scripts/backfill-session-summaries.mjs`

**Context:** Follows the pattern from `cli/scripts/backfill-session-media.mjs`. Scans all session YAML files, decodes RLE series using backend `TimelineService.decodeSeries()`, calls `buildSessionSummary()`, and writes the summary block back. Dry-run by default.

The `buildSessionSummary()` function lives in the frontend directory but has no browser dependencies — it imports `SessionSerializerV3` which uses `moment-timezone` (available in Node).

**Step 1: Write the backfill script**

```js
#!/usr/bin/env node
/**
 * Backfill fitness session YAML files with pre-computed summary blocks.
 *
 * Reads each session, decodes RLE timeline series, computes a summary
 * (per-participant HR/coins/zones, media with primary flag, challenges,
 * voice memos), and writes the summary block back to the YAML.
 *
 * Usage:
 *   node cli/scripts/backfill-session-summaries.mjs [options]
 *
 * Options:
 *   --write                Actually write changes (default: dry-run)
 *   --force                Overwrite existing summary blocks
 *   --data-path /path      Override default data path
 *   --help, -h             Show this help message
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');

// Import RLE decoder from backend
const { decodeSeries } = await import(
  path.join(PROJECT_ROOT, 'backend/src/2_domains/fitness/services/TimelineService.mjs')
);

// Import summary builder from frontend (pure JS, no browser deps)
const { buildSessionSummary } = await import(
  path.join(PROJECT_ROOT, 'frontend/src/hooks/fitness/buildSessionSummary.js')
);

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_DATA_PATH = process.env.DAYLIGHT_DATA_PATH
  || '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const FORCE = args.includes('--force');
const HELP = args.includes('--help') || args.includes('-h');

const dataPathIdx = args.indexOf('--data-path');
const DATA_PATH = dataPathIdx !== -1 && args[dataPathIdx + 1]
  ? args[dataPathIdx + 1]
  : DEFAULT_DATA_PATH;

if (HELP) {
  console.log(`
Usage: node cli/scripts/backfill-session-summaries.mjs [options]

Options:
  --write                Actually write changes (default: dry-run)
  --force                Overwrite existing summary blocks
  --data-path /path      Override default data path
  --help, -h             Show this help message
`);
  process.exit(0);
}

// =============================================================================
// Session File Helpers
// =============================================================================

const FITNESS_DIR = path.join(DATA_PATH, 'household', 'history', 'fitness');

function listDateDirs() {
  if (!fs.existsSync(FITNESS_DIR)) return [];
  return fs.readdirSync(FITNESS_DIR)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
}

function listSessionFiles(dateDir) {
  const dir = path.join(FITNESS_DIR, dateDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.yml'))
    .map(f => path.join(dir, f));
}

function readSession(filePath) {
  try {
    return yaml.load(fs.readFileSync(filePath, 'utf8'));
  } catch { return null; }
}

function writeSession(filePath, data) {
  const content = yaml.dump(data, {
    lineWidth: -1,
    noRefs: true,
    quotingType: "'",
    forceQuotes: false,
  });
  fs.writeFileSync(filePath, content, 'utf8');
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log(`Session Summary Backfill`);
  console.log(`  Data path: ${DATA_PATH}`);
  console.log(`  Mode: ${WRITE ? 'WRITE' : 'DRY-RUN'}`);
  console.log(`  Force: ${FORCE}`);
  console.log();

  const dateDirs = listDateDirs();
  console.log(`Found ${dateDirs.length} date directories\n`);

  let totalSessions = 0;
  let addedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const dateDir of dateDirs) {
    const files = listSessionFiles(dateDir);

    for (const filePath of files) {
      totalSessions++;
      const data = readSession(filePath);
      if (!data) {
        console.warn(`  ✗ Failed to read: ${filePath}`);
        errorCount++;
        continue;
      }

      const sessionId = data.sessionId || path.basename(filePath, '.yml');

      // Skip if already has summary (unless --force)
      if (data.summary && !FORCE) {
        skippedCount++;
        continue;
      }

      try {
        // Decode RLE series to raw arrays
        const decodedSeries = decodeSeries(data.timeline?.series || {});

        const intervalSeconds = data.timeline?.interval_seconds || 5;

        const summary = buildSessionSummary({
          participants: data.participants || {},
          series: decodedSeries,
          events: data.timeline?.events || data.events || [],
          treasureBox: data.treasureBox || null,
          intervalSeconds,
        });

        if (WRITE) {
          data.summary = summary;
          writeSession(filePath, data);
          console.log(`  ✏ Added summary: ${sessionId}`);
        } else {
          const mediaCount = summary.media.length;
          const participantCount = Object.keys(summary.participants).length;
          console.log(`  ✏ [dry-run] Would add summary: ${sessionId} (${participantCount} participants, ${mediaCount} media, ${summary.coins.total} coins)`);
        }
        addedCount++;
      } catch (err) {
        console.warn(`  ✗ Error processing ${sessionId}: ${err.message}`);
        errorCount++;
      }
    }
  }

  console.log(`
Summary:
  Total sessions scanned: ${totalSessions}
  Summaries added:        ${addedCount}
  Already had summary:    ${skippedCount}
  Errors:                 ${errorCount}
`);

  if (!WRITE && addedCount > 0) {
    console.log('  Run with --write to persist changes.\n');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

**Step 2: Test in dry-run mode**

Run: `node cli/scripts/backfill-session-summaries.mjs --dry-run`
Expected: Lists all sessions with "Would add summary" messages, reports counts

**Step 3: Run with --write on dev data**

Run: `node cli/scripts/backfill-session-summaries.mjs --write`
Expected: Writes summary blocks to all session YAML files

**Step 4: Verify a session file was updated correctly**

Read any session YAML file and check that it has a `summary:` block with participants, media, coins, challenges, voiceMemos.

**Step 5: Commit**

```bash
git add cli/scripts/backfill-session-summaries.mjs
git commit -m "feat(fitness): add backfill script for session summary blocks"
```

---

### Task 5: Update YamlSessionDatastore to read from summary block

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs:206-276`
- Test: Manual API verification

**Context:** `findByDate()` (line 206) currently constructs its own session summary by cherry-picking fields from the YAML. We replace this with reading from the `summary` block. Fall back to current behavior if `summary` is missing (pre-backfill compat).

The new API response shape changes:
- `participants`: object keyed by ID (was array)
- `media`: `{ primary, others }` (was single nullable object)
- Adds `challengeCount`, `voiceMemoCount`
- Removes `stats`, `rosterCount`, `endTime`

**Step 1: Replace the findByDate session-building loop**

Replace `YamlSessionDatastore.mjs` lines 235-271 (the section that extracts media, participants, coins, stats and builds the session object) with:

```js
      // ── Build session summary from pre-computed summary block ──
      const summary = data.summary;

      let participants, media, totalCoins, challengeCount, voiceMemoCount;

      if (summary) {
        // New path: read from pre-computed summary block
        participants = {};
        for (const [id, info] of Object.entries(data.participants || {})) {
          const stats = summary.participants?.[id] || {};
          participants[id] = {
            displayName: info.display_name || id,
            coins: stats.coins || 0,
            hrAvg: stats.hr_avg || 0,
            hrMax: stats.hr_max || 0,
          };
        }

        const primaryMedia = summary.media?.find(m => m.primary) || summary.media?.[0] || null;
        const otherMedia = (summary.media || []).filter(m => !m.primary);
        media = {
          primary: primaryMedia ? {
            mediaId: primaryMedia.mediaId,
            title: primaryMedia.title,
            showTitle: primaryMedia.showTitle,
            seasonTitle: primaryMedia.seasonTitle,
            grandparentId: primaryMedia.grandparentId || null,
            parentId: primaryMedia.parentId || null,
          } : null,
          others: otherMedia.map(m => ({
            mediaId: m.mediaId,
            title: m.title,
            showTitle: m.showTitle,
            grandparentId: m.grandparentId || null,
            parentId: m.parentId || null,
          })),
        };

        totalCoins = summary.coins?.total || 0;
        challengeCount = summary.challenges?.total || 0;
        voiceMemoCount = summary.voiceMemos?.length || 0;
      } else {
        // Fallback: legacy path for sessions without summary block
        const events = data.timeline?.events || [];
        const mediaEvent = events.find(e => e.type === 'media');
        const legacyMedia = mediaEvent ? {
          mediaId: mediaEvent.data?.mediaId,
          title: mediaEvent.data?.title,
          showTitle: mediaEvent.data?.grandparentTitle,
          seasonTitle: mediaEvent.data?.parentTitle,
          grandparentId: mediaEvent.data?.grandparentId || null,
          parentId: mediaEvent.data?.parentId || null,
        } : null;

        participants = {};
        for (const [id, info] of Object.entries(data.participants || {})) {
          participants[id] = {
            displayName: info.display_name || id,
            coins: 0,
            hrAvg: 0,
            hrMax: 0,
          };
        }

        media = {
          primary: legacyMedia,
          others: [],
        };

        totalCoins = data.treasureBox?.totalCoins || 0;
        challengeCount = 0;
        voiceMemoCount = 0;
      }

      sessions.push({
        sessionId: data.sessionId || baseName,
        startTime: startTime || null,
        durationMs,
        timezone: data.timezone,
        media,
        participants,
        totalCoins,
        challengeCount,
        voiceMemoCount,
        date,
      });
```

Note: `date` param is passed into `findByDate` and needs to be added to each session. Currently `findInRange` adds `date` via its map (line 293), but `findByDate` doesn't. We add it here for consistency — the caller (`findInRange`) already passes it as a function argument. For `findByDate`, use the `date` parameter that's already the function argument at line 206.

**Step 2: Verify the API returns the new shape**

Run: `curl -s "http://localhost:3111/api/v1/fitness/sessions?since=2026-01-16&limit=3" | python3 -m json.tool`

Expected: Sessions have `participants` as keyed object with `hrAvg`, `hrMax`, `coins`; `media` as `{ primary, others }`; `challengeCount` and `voiceMemoCount` present.

**Step 3: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs
git commit -m "feat(fitness): read session summary from pre-computed block in list endpoint"
```

---

### Task 6: Update `useDashboardData.js` to adapt to new API shape

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/useDashboardData.js:120-148`

**Context:** The hook's `fetchRecentSessions()` function is the data boundary between the API and the component. It reshapes the API response so `WorkoutsCard` doesn't need to change much.

Changes needed:
1. Filter check: `s.media` → `s.media?.primary` (media is now `{ primary, others }`)
2. `participants`: convert from keyed object to array (component uses `.map()`)
3. `media`: flatten `s.media.primary` into `s.media` for backward compat, keep `others` available
4. Drop `s.stats` (removed from API)

**Step 1: Replace `fetchRecentSessions` function**

Replace lines 120-148 with:

```js
async function fetchRecentSessions(limit = 10) {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceStr = since.toISOString().split('T')[0];

  const response = await DaylightAPI(`/api/v1/fitness/sessions?since=${sinceStr}&limit=${limit * 2}`);
  const sessionSummaries = response?.sessions || [];

  const sessions = [];
  for (const s of sessionSummaries) {
    if (sessions.length >= limit) break;
    if (!s.media?.primary) continue; // Skip sessions without media

    // Convert participants from keyed object to array
    const participants = Object.entries(s.participants || {}).map(([id, p]) => ({
      id,
      displayName: p.displayName,
      coins: p.coins || 0,
      hrAvg: p.hrAvg || 0,
      hrMax: p.hrMax || 0,
    }));

    // Flatten primary media for backward compat, keep others
    const media = {
      ...s.media.primary,
      others: s.media.others || [],
    };

    sessions.push({
      sessionId: s.sessionId,
      date: s.date || (s.startTime ? new Date(s.startTime).toISOString().split('T')[0] : null),
      startTime: s.startTime,
      durationMs: s.durationMs,
      participants,
      totalCoins: s.totalCoins || 0,
      media,
    });
  }
  return sessions;
}
```

**Step 2: Verify the dashboard loads without errors**

Open the fitness home dashboard in the browser. The "Recent Sessions" card should render with the same layout as before — thumbnails, titles, durations, coins, avatars.

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/useDashboardData.js
git commit -m "feat(fitness): adapt useDashboardData to new sessions API shape"
```

---

### Task 7: Update `DashboardWidgets.jsx` — fix avgHr field access

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/DashboardWidgets.jsx:204`

**Context:** The hook now provides `p.hrAvg` directly on each participant object (was `p.stats?.avgHr`). This is the only breaking change in the component.

**Step 1: Update the HR display line**

At line 204, change:

```jsx
                            {p.stats?.avgHr > 0 && (
```

to:

```jsx
                            {p.hrAvg > 0 && (
```

At line 206, change:

```jsx
                                <span style={{ color: '#fa5252' }}>❤️</span> {Math.round(p.stats.avgHr)}
```

to:

```jsx
                                <span style={{ color: '#fa5252' }}>❤️</span> {Math.round(p.hrAvg)}
```

**Step 2: Verify in browser**

Open the fitness home dashboard. Participant avatars should show heart rate numbers (previously they were always empty because `stats` was `{}`). Now with the summary block data, actual HR averages should display.

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/DashboardWidgets.jsx
git commit -m "fix(fitness): update HR field access to use new summary data"
```

---

### Task 8: Run backfill on prod data

**Context:** After all code changes are committed and tested locally, run the backfill script on production data via SSH.

**Step 1: Verify local backfill worked**

Run: `curl -s "http://localhost:3111/api/v1/fitness/sessions?since=2026-01-16&limit=3" | python3 -m json.tool`

Verify sessions have `participants` with `hrAvg > 0`, `media.primary` populated, `challengeCount` and `voiceMemoCount` fields.

**Step 2: Deploy code to prod**

Follow standard deployment procedure (user runs manually per CLAUDE.md rules).

**Step 3: Run backfill on prod**

```bash
ssh homeserver.local 'docker exec daylight-station node cli/scripts/backfill-session-summaries.mjs --write'
```

**Step 4: Verify prod API**

```bash
curl -s "http://homeserver.local:3111/api/v1/fitness/sessions?since=2026-01-16&limit=3" | python3 -m json.tool
```

**Step 5: Final commit — mark design doc complete**

No code changes. Update the design doc status if desired.
