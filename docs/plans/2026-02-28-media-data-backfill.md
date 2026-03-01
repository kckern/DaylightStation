# Media Data Backfill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Correct stale `durationSeconds` and missing `end` timestamps in 8 affected fitness session YAML files on prod.

**Architecture:** One-off CLI backfill script following `enrich-sessions-with-plex.mjs` patterns — bootstrap config, use FileIO utilities, dry-run by default. Pure functions handle computation so they're testable with `node:test`. Plex API provides workout video durations; session data provides gaming durations.

**Tech Stack:** Node.js, `js-yaml` via `#system/utils/FileIO.mjs`, Plex REST API, `node:test` for tests.

**Prereqs:** Code fixes for Bug A (`normalizeDuration` two-pass) and Bug B (`_closeOpenMedia`) already applied — see `docs/_wip/audits/2026-02-28-fitness-session-media-data-quality-audit.md`.

**Reference:** `docs/_wip/plans/2026-02-28-media-data-backfill-plan.md` (analysis), `docs/_wip/audits/2026-02-28-fitness-session-media-data-quality-audit.md` (root causes)

---

## Affected Sessions Summary

8 sessions, all from Feb 2026. Every session has at least one bug; many have both:

| Session | Bug A (stale duration) | Bug B (missing end) | Content |
|---------|:-----:|:-----:|---------|
| `20260223185457` | `plex:606442` dur=10 | `plex:606442` end=null | Mario Kart 8 (gaming) |
| `20260224124137` | `plex:10551` dur=2 | `plex:10551` end=null | Sculpt A (workout) |
| `20260224190930` | `plex:606442` dur=10 | `plex:606442` end=null | Mario Kart 8 (gaming) |
| `20260225053400` | `plex:600161` dur=2 | `plex:600161` end=null | Saturday Special (workout) |
| `20260225181217` | `plex:606442` dur=10, `plex:649319` dur=15 | both end=null | Mario Kart 8 + Deluxe (gaming) |
| `20260226185825` | `plex:649319` dur=17 | `plex:649319` end≈start (14ms gap) | Mario Kart 8 Deluxe (gaming) |
| `20260227054558` | `plex:664558` dur=2 | `plex:140612` start==end | Total Body Tempo + music |
| `20260227054558` | — | `plex:140612` start==end | Hit Me With Your Best Shot (music) |

---

## Task 1: Create Backfill Script Skeleton

**Files:**
- Create: `cli/backfill-media-durations.mjs`

**Step 1: Write the script skeleton**

```javascript
#!/usr/bin/env node

/**
 * Backfill Media Durations & End Timestamps
 *
 * Fixes two bugs in affected Feb 2026 fitness sessions:
 *   Bug A: stale durationSeconds (Plex metadata placeholders like 2, 10, 15, 17)
 *   Bug B: missing end timestamps (null or start==end in media events)
 *
 * Dry-run by default. Pass --write to persist changes.
 *
 * Usage:
 *   node cli/backfill-media-durations.mjs                    # dry-run
 *   node cli/backfill-media-durations.mjs --write             # write mode
 *   node cli/backfill-media-durations.mjs --scope=b           # only Bug B
 *   node cli/backfill-media-durations.mjs --scope=a --write   # only Bug A, write mode
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { existsSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

dotenv.config({ path: path.join(projectRoot, '.env') });

const isDocker = existsSync('/.dockerenv');
const baseDir = isDocker ? '/usr/src/app' : process.env.DAYLIGHT_BASE_PATH;
const dataDir = path.join(baseDir, 'data');
const configDir = path.join(dataDir, 'system', 'config');

// Bootstrap config
const { hydrateProcessEnvFromConfigs } = await import('#system/logging/config.mjs');
const { initConfigService } = await import('#system/config/index.mjs');
const { loadYamlSafe, saveYaml } = await import('#system/utils/FileIO.mjs');

hydrateProcessEnvFromConfigs(configDir);
initConfigService(dataDir);

// ------------------------------------------------------------------
// Parse CLI args
// ------------------------------------------------------------------
const args = process.argv.slice(2);
const writeMode = args.includes('--write');
const scopeArg = args.find(a => a.startsWith('--scope='));
const scope = scopeArg ? scopeArg.split('=')[1] : 'all'; // 'a', 'b', or 'all'

console.log(`Backfill media durations & end timestamps`);
console.log(`Mode: ${writeMode ? 'WRITE' : 'DRY-RUN'}`);
console.log(`Scope: ${scope === 'all' ? 'Bug A + Bug B' : `Bug ${scope.toUpperCase()} only`}\n`);

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------
const fitnessHistoryDir = path.join(dataDir, 'household', 'history', 'fitness');

// Plex auth (for workout video duration lookups)
const plexAuthPath = path.join(dataDir, 'household', 'auth', 'plex');
const plexAuth = loadYamlSafe(plexAuthPath);
const PLEX_URL = 'https://plex.kckern.net';
const PLEX_TOKEN = plexAuth?.token;

// ------------------------------------------------------------------
// Session helpers
// ------------------------------------------------------------------

/**
 * Load a session YAML by sessionId.
 * SessionId format: YYYYMMDDHHmmss → directory: YYYY-MM-DD
 */
function sessionPath(sessionId) {
  const dateDir = `${sessionId.slice(0, 4)}-${sessionId.slice(4, 6)}-${sessionId.slice(6, 8)}`;
  return path.join(fitnessHistoryDir, dateDir, sessionId);
}

function loadSession(sessionId) {
  const p = sessionPath(sessionId);
  const data = loadYamlSafe(p);
  if (!data) {
    console.error(`  SKIP: Could not load ${p}.yml`);
    return null;
  }
  return data;
}

function saveSession(sessionId, data) {
  const p = sessionPath(sessionId);
  saveYaml(p, data);
}

// ------------------------------------------------------------------
// Plex API
// ------------------------------------------------------------------

async function fetchPlexDurationMs(ratingKey) {
  if (!PLEX_TOKEN) {
    console.error('  WARN: No Plex token — cannot fetch duration');
    return null;
  }
  const id = ratingKey.replace('plex:', '');
  const url = `${PLEX_URL}/library/metadata/${id}?X-Plex-Token=${PLEX_TOKEN}`;
  try {
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) {
      console.error(`  WARN: Plex API ${resp.status} for ${ratingKey}`);
      return null;
    }
    const json = await resp.json();
    const duration = json?.MediaContainer?.Metadata?.[0]?.duration;
    return duration || null; // ms
  } catch (err) {
    console.error(`  WARN: Plex API error for ${ratingKey}: ${err.message}`);
    return null;
  }
}

// ------------------------------------------------------------------
// Placeholder exports for Task 2 and Task 3
// ------------------------------------------------------------------

// Bug B and Bug A implementations go here (Tasks 2-3)

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------
async function main() {
  console.log(`Fitness history dir: ${fitnessHistoryDir}`);
  console.log(`Plex token: ${PLEX_TOKEN ? 'found' : 'MISSING'}\n`);

  // Bug B first (fixes end timestamps, which Bug A may use for summary.durationMs)
  if (scope === 'all' || scope === 'b') {
    console.log('=== Bug B: Fix missing end timestamps ===\n');
    // backfillBugB(writeMode);  // Uncomment in Task 2
  }

  if (scope === 'all' || scope === 'a') {
    console.log('=== Bug A: Fix stale durationSeconds ===\n');
    // await backfillBugA(writeMode);  // Uncomment in Task 3
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
```

**Step 2: Verify script starts**

Run: `node cli/backfill-media-durations.mjs`

Expected: Prints header, mode=DRY-RUN, scope=Bug A + Bug B, fitness history dir path, Plex token status, then "Done."

**Step 3: Commit**

```bash
git add cli/backfill-media-durations.mjs
git commit -m "feat(cli): scaffold media duration backfill script"
```

---

## Task 2: Implement Bug B — Fix Missing End Timestamps

Bug B: timeline media events with `end: null` or `end ≈ start`. Fix by setting `end` to the session's end time.

**Files:**
- Create: `cli/backfill-media-durations.test.mjs`
- Modify: `cli/backfill-media-durations.mjs`

**Step 1: Write failing test for `computeSessionEndMs`**

Create `cli/backfill-media-durations.test.mjs`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeSessionEndMs, findBrokenEndEvents } from './backfill-media-durations.lib.mjs';

describe('computeSessionEndMs', () => {
  it('computes end from start + duration_seconds', () => {
    const session = {
      start: '2026-02-24 12:41:37.000',
      duration_seconds: 1800,
    };
    const result = computeSessionEndMs(session);
    const expected = new Date('2026-02-24T12:41:37.000').getTime() + 1800000;
    assert.equal(result, expected);
  });

  it('returns null for missing data', () => {
    assert.equal(computeSessionEndMs({}), null);
    assert.equal(computeSessionEndMs({ start: '2026-01-01' }), null);
    assert.equal(computeSessionEndMs({ duration_seconds: 100 }), null);
  });
});

describe('findBrokenEndEvents', () => {
  it('finds events with null end', () => {
    const events = [
      { type: 'media', data: { contentId: 'plex:100', start: 1000, end: null } },
      { type: 'media', data: { contentId: 'plex:200', start: 2000, end: 5000 } },
    ];
    const broken = findBrokenEndEvents(events);
    assert.equal(broken.length, 1);
    assert.equal(broken[0].data.contentId, 'plex:100');
  });

  it('finds events where end == start', () => {
    const events = [
      { type: 'media', data: { contentId: 'plex:100', start: 1000, end: 1000 } },
    ];
    const broken = findBrokenEndEvents(events);
    assert.equal(broken.length, 1);
  });

  it('finds events where end ≈ start (within 1s)', () => {
    const events = [
      { type: 'media', data: { contentId: 'plex:100', start: 1000, end: 1014 } },
    ];
    const broken = findBrokenEndEvents(events);
    assert.equal(broken.length, 1);
  });

  it('skips non-media events', () => {
    const events = [
      { type: 'challenge_start', data: { start: 1000, end: null } },
    ];
    const broken = findBrokenEndEvents(events);
    assert.equal(broken.length, 0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node --test cli/backfill-media-durations.test.mjs`

Expected: FAIL — `Cannot find module './backfill-media-durations.lib.mjs'`

**Step 3: Create the lib file with pure functions**

Create `cli/backfill-media-durations.lib.mjs`:

```javascript
/**
 * Pure computation functions for media data backfill.
 * No I/O, no side effects — all testable.
 */

/**
 * Compute session end time in unix milliseconds.
 * @param {Object} session - session block from YAML (has `start`, `duration_seconds`)
 * @returns {number|null} end time in ms, or null if data is missing
 */
export function computeSessionEndMs(session) {
  if (!session?.start || !session?.duration_seconds) return null;
  const startMs = new Date(session.start).getTime();
  if (isNaN(startMs)) return null;
  return startMs + (session.duration_seconds * 1000);
}

/**
 * Find timeline media events with broken end timestamps.
 * "Broken" means: null, undefined, or within 1 second of start (≈ same tick).
 *
 * @param {Array} events - timeline.events array from session YAML
 * @returns {Array} events that need end timestamp fixing
 */
export function findBrokenEndEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.filter(evt => {
    if (evt.type !== 'media') return false;
    const { start, end } = evt.data || {};
    if (end === null || end === undefined) return true;
    if (typeof start === 'number' && typeof end === 'number' && Math.abs(end - start) < 1000) return true;
    return false;
  });
}
```

**Step 4: Run test to verify it passes**

Run: `node --test cli/backfill-media-durations.test.mjs`

Expected: All 6 tests PASS

**Step 5: Wire Bug B into main script**

Add to `cli/backfill-media-durations.mjs` — replace the Bug B placeholder with:

```javascript
import { computeSessionEndMs, findBrokenEndEvents } from './backfill-media-durations.lib.mjs';

// Bug B: sessions with null or start==end in media events
const BUG_B_SESSIONS = [
  '20260223185457', '20260224124137', '20260224190930',
  '20260225053400', '20260225181217', '20260226185825', '20260227054558',
];

function backfillBugB(write) {
  let totalFixed = 0;

  for (const sessionId of BUG_B_SESSIONS) {
    console.log(`  Session ${sessionId}:`);
    const data = loadSession(sessionId);
    if (!data) continue;

    const sessionEndMs = computeSessionEndMs(data.session);
    if (!sessionEndMs) {
      console.log(`    SKIP: Cannot compute session end time`);
      continue;
    }

    const broken = findBrokenEndEvents(data.timeline?.events || []);
    if (broken.length === 0) {
      console.log(`    OK: No broken end timestamps`);
      continue;
    }

    for (const evt of broken) {
      const cid = evt.data?.contentId || '?';
      const oldEnd = evt.data?.end;
      console.log(`    FIX: ${cid} end: ${oldEnd} → ${sessionEndMs}`);
      if (write) evt.data.end = sessionEndMs;
      totalFixed++;
    }

    if (write) saveSession(sessionId, data);
  }

  console.log(`  Bug B total: ${totalFixed} events fixed\n`);
}
```

Also uncomment the `backfillBugB(writeMode)` call in `main()`.

**Step 6: Run dry-run to verify output**

Run: `node cli/backfill-media-durations.mjs --scope=b`

Expected output (8 FIX lines across 7 sessions):
```
=== Bug B: Fix missing end timestamps ===

  Session 20260223185457:
    FIX: plex:606442 end: null → <computed_ms>
  Session 20260224124137:
    FIX: plex:10551 end: null → <computed_ms>
  ...
  Bug B total: 8 events fixed
```

**Step 7: Commit**

```bash
git add cli/backfill-media-durations.lib.mjs cli/backfill-media-durations.test.mjs cli/backfill-media-durations.mjs
git commit -m "feat(cli): implement Bug B backfill — fix missing end timestamps"
```

---

## Task 3: Implement Bug A — Fix Stale durationSeconds and Summary durationMs

Bug A: timeline media events with Plex placeholder values (2, 10, 15, 17) as `durationSeconds`. Also fixes `summary.media[].durationMs` where it's 0.

**Files:**
- Modify: `cli/backfill-media-durations.lib.mjs` (add `findStaleDurationEvents`)
- Modify: `cli/backfill-media-durations.test.mjs` (add tests)
- Modify: `cli/backfill-media-durations.mjs` (add Bug A backfill)

**Step 1: Write failing test for `findStaleDurationEvents`**

Add to `cli/backfill-media-durations.test.mjs`:

```javascript
import { findStaleDurationEvents } from './backfill-media-durations.lib.mjs';

describe('findStaleDurationEvents', () => {
  it('finds events whose contentId is in the fix map', () => {
    const events = [
      { type: 'media', data: { contentId: 'plex:10551', durationSeconds: 2 } },
      { type: 'media', data: { contentId: 'plex:99999', durationSeconds: 2 } },
    ];
    const fixMap = { 'plex:10551': { source: 'plex' } };
    const stale = findStaleDurationEvents(events, fixMap);
    assert.equal(stale.length, 1);
    assert.equal(stale[0].data.contentId, 'plex:10551');
  });

  it('returns empty for events not in fix map', () => {
    const events = [
      { type: 'media', data: { contentId: 'plex:99999', durationSeconds: 2 } },
    ];
    const stale = findStaleDurationEvents(events, {});
    assert.equal(stale.length, 0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node --test cli/backfill-media-durations.test.mjs`

Expected: FAIL — `findStaleDurationEvents is not a function`

**Step 3: Implement `findStaleDurationEvents`**

Add to `cli/backfill-media-durations.lib.mjs`:

```javascript
/**
 * Find timeline media events that have stale durationSeconds values.
 *
 * @param {Array} events - timeline.events array
 * @param {Object} fixMap - { contentId: { source: 'plex'|'session' } }
 * @returns {Array} events with contentId in the fixMap
 */
export function findStaleDurationEvents(events, fixMap) {
  if (!Array.isArray(events) || !fixMap) return [];
  return events.filter(evt => {
    if (evt.type !== 'media') return false;
    const cid = evt.data?.contentId;
    return cid && fixMap[cid];
  });
}
```

**Step 4: Run test to verify it passes**

Run: `node --test cli/backfill-media-durations.test.mjs`

Expected: All tests PASS

**Step 5: Wire Bug A into main script**

Add to `cli/backfill-media-durations.mjs`:

```javascript
// Bug A: sessions with known bad durationSeconds
// source: 'plex' → fetch real duration from Plex API (workout videos)
// source: 'session' → use session.duration_seconds (gaming, runs for full session)
const BUG_A_SESSIONS = {
  '20260224124137': { 'plex:10551': { source: 'plex' } },
  '20260225053400': { 'plex:600161': { source: 'plex' } },
  '20260227054558': { 'plex:664558': { source: 'plex' } },
  '20260223185457': { 'plex:606442': { source: 'session' } },
  '20260224190930': { 'plex:606442': { source: 'session' } },
  '20260225181217': { 'plex:606442': { source: 'session' }, 'plex:649319': { source: 'session' } },
  '20260226185825': { 'plex:649319': { source: 'session' } },
};

// Cache Plex durations so we don't fetch the same ID twice
const plexDurationCache = new Map();

async function getCorrectDurationSec(contentId, spec, sessionDurationSec) {
  if (spec.source === 'session') {
    return sessionDurationSec;
  }

  // source === 'plex'
  if (plexDurationCache.has(contentId)) {
    return plexDurationCache.get(contentId);
  }

  const durationMs = await fetchPlexDurationMs(contentId);
  if (durationMs) {
    const durationSec = Math.round(durationMs / 1000);
    plexDurationCache.set(contentId, durationSec);
    return durationSec;
  }

  // Fallback: use session duration
  console.log(`    WARN: Plex lookup failed for ${contentId}, falling back to session duration`);
  return sessionDurationSec;
}

async function backfillBugA(write) {
  let totalFixed = 0;

  for (const [sessionId, contentMap] of Object.entries(BUG_A_SESSIONS)) {
    console.log(`  Session ${sessionId}:`);
    const data = loadSession(sessionId);
    if (!data) continue;

    const sessionDurSec = data.session?.duration_seconds;
    let changed = false;

    // Fix timeline event durationSeconds
    const stale = findStaleDurationEvents(data.timeline?.events || [], contentMap);
    for (const evt of stale) {
      const cid = evt.data.contentId;
      const correctSec = await getCorrectDurationSec(cid, contentMap[cid], sessionDurSec);
      if (correctSec && evt.data.durationSeconds !== correctSec) {
        console.log(`    FIX timeline: ${cid} durationSeconds: ${evt.data.durationSeconds} → ${correctSec}`);
        if (write) evt.data.durationSeconds = correctSec;
        changed = true;
        totalFixed++;
      }
    }

    // Fix summary.media[].durationMs
    for (const media of data.summary?.media || []) {
      if (!contentMap[media.contentId]) continue;
      if (media.durationMs && media.durationMs > 0) {
        console.log(`    OK summary: ${media.contentId} durationMs=${media.durationMs} (already set)`);
        continue;
      }

      // Compute durationMs from the (now-corrected) timeline event
      const evt = (data.timeline?.events || []).find(e => e.data?.contentId === media.contentId);
      let newDurationMs;

      // Prefer end-start if both exist and end was fixed by Bug B
      if (evt?.data?.start && evt?.data?.end && evt.data.end > evt.data.start) {
        newDurationMs = evt.data.end - evt.data.start;
      } else {
        // Fall back to corrected durationSeconds
        const correctSec = await getCorrectDurationSec(media.contentId, contentMap[media.contentId], sessionDurSec);
        newDurationMs = correctSec ? correctSec * 1000 : null;
      }

      if (newDurationMs) {
        console.log(`    FIX summary: ${media.contentId} durationMs: ${media.durationMs || 0} → ${newDurationMs}`);
        if (write) media.durationMs = newDurationMs;
        changed = true;
        totalFixed++;
      }
    }

    if (changed && write) saveSession(sessionId, data);
  }

  console.log(`  Bug A total: ${totalFixed} fields fixed\n`);
}
```

Also uncomment the `await backfillBugA(writeMode)` call in `main()`.

**Step 6: Run dry-run to verify output**

Run: `node cli/backfill-media-durations.mjs --scope=a`

Expected output (workout videos show Plex durations, gaming shows session duration):
```
=== Bug A: Fix stale durationSeconds ===

  Session 20260224124137:
    FIX timeline: plex:10551 durationSeconds: 2 → 1888
    FIX summary: plex:10551 durationMs: 0 → <computed>
  Session 20260225053400:
    FIX timeline: plex:600161 durationSeconds: 2 → <plex_duration>
    FIX summary: plex:600161 durationMs: 0 → <computed>
  ...
  Bug A total: N fields fixed
```

**Step 7: Run all tests**

Run: `node --test cli/backfill-media-durations.test.mjs`

Expected: All tests PASS

**Step 8: Commit**

```bash
git add cli/backfill-media-durations.mjs cli/backfill-media-durations.lib.mjs cli/backfill-media-durations.test.mjs
git commit -m "feat(cli): implement Bug A backfill — fix stale durationSeconds and summary durationMs"
```

---

## Task 4: Full Dry-Run Verification Against Prod Data

**Files:** None (verification only)

**Step 1: Run full dry-run locally (if dev server running)**

Run: `node cli/backfill-media-durations.mjs`

Verify: Output lists all expected fixes for both Bug A and Bug B. No errors, no SKIPs.

**Step 2: Run full dry-run on prod via SSH**

Run:
```bash
ssh {env.prod_host} 'cd /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation && node cli/backfill-media-durations.mjs'
```

Verify: Same fixes listed. Plex API calls succeed (workout video durations resolve to real values like 1888, not fallbacks).

**Step 3: Spot-check one affected session YAML before write**

Run:
```bash
ssh {env.prod_host} 'cat /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/household/history/fitness/2026-02-24/20260224124137.yml' | grep -A3 'durationSeconds\|durationMs\|end:'
```

Verify: Shows the bad values (durationSeconds: 2, durationMs: 0, end: null).

---

## Task 5: Execute Backfill on Prod

**Files:** Session YAML files on prod (write via SSH)

**Step 1: Run Bug B first (end timestamps)**

Run:
```bash
ssh {env.prod_host} 'cd /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation && node cli/backfill-media-durations.mjs --scope=b --write'
```

Verify: Output shows FIX lines followed by file writes.

**Step 2: Run Bug A (durations)**

Run:
```bash
ssh {env.prod_host} 'cd /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation && node cli/backfill-media-durations.mjs --scope=a --write'
```

Verify: Output shows FIX lines. Summary durationMs values computed from corrected end-start (since Bug B was fixed first).

**Step 3: Verify corrected files**

Run:
```bash
for sid in 20260224124137 20260225053400 20260227054558; do
  echo "=== $sid ==="
  ssh {env.prod_host} "grep -E 'durationSeconds|durationMs|end:' /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/household/history/fitness/${sid:0:4}-${sid:4:2}-${sid:6:2}/${sid}.yml"
done
```

Expected: `durationSeconds` shows real values (>10), `durationMs` is non-zero, `end` is non-null.

**Step 4: Verify via API**

Run:
```bash
curl 'http://{env.prod_host}:3111/api/v1/fitness/sessions?since=2026-02-23&limit=20' | python3 -m json.tool | grep -B2 -A2 'durationMs'
```

Verify: All affected sessions show correct media durations in the API response.

**Step 5: Commit the backfill script to main**

```bash
git add cli/backfill-media-durations.mjs cli/backfill-media-durations.lib.mjs cli/backfill-media-durations.test.mjs
git commit -m "feat(cli): media duration backfill script — fixes Bug A + Bug B in 8 sessions"
```

---

## Out of Scope (Bug C)

~450 legacy sessions from 2021–2022 missing `durationMs` in summary.media. Deferred because:
- Historical sessions, not actively displayed
- Plex content may no longer exist (404s likely)
- No impact on current functionality

If needed later, extend this script with `--scope=c` and a bulk scanner for date directories matching `202[12]-*`.
