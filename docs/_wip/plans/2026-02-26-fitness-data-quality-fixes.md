# Fitness Data Quality Fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix zone display lag on cards/LEDs, namespace media IDs for multi-source support, fix grandparentId for collection content, and eliminate stale/phantom HR at session start.

**Architecture:** Three independent fix groups — (A) raw zone for real-time UI, (B) media identity namespacing, (C) HR data quality. Each group can be implemented and tested independently.

**Tech Stack:** React hooks, Plex adapter, YAML session files, Express API

---

## Group A: Raw Zone for Real-Time UI

**Problem:** ParticipantRoster blanket-overrides raw zone with hysteresis-committed zone for ALL consumers. Cards and LEDs show stale zone color while the displayed HR and progress ring already reflect the new zone. 186 `exit_margin_suppressed` events in a single 22-minute session.

**Design decision:** Committed zone is for governance decisions and persistence only. Everything user-facing and real-time uses raw zone.

| Consumer | Zone source | Why |
|----------|------------|-----|
| GovernanceEngine | Committed | Prevent governance state thrashing |
| Timeline/MetricsRecorder | Committed | Stable historical record |
| HR Cards | **Raw** | Must match displayed HR |
| LEDs | **Raw** | Real-time physical feedback |
| TreasureBox coins | Raw | Already does this |

### Task 1: Expose raw zone on ParticipantRoster entries

**Files:**
- Modify: `frontend/src/hooks/fitness/ParticipantRoster.js:309-340, 447-448`
- Reference: `frontend/src/hooks/fitness/ZoneProfileStore.js:124-143`

**Context:** `_buildZoneLookup()` (lines 309-340) builds a zone map from TreasureBox baseline, then overrides with committed zones from ZoneProfileStore. The roster entry (line 447-448) only exposes a single `zoneId`/`zoneColor`.

**Step 1: Store both zones in the lookup**

In `_buildZoneLookup()`, after the ZoneProfileStore override loop (lines 326-337), preserve the raw zone alongside the committed zone:

```javascript
// Lines 326-337 currently:
for (const tid of trackedIds) {
  const committed = this.zoneProfileStore?.getZoneState(tid);
  if (committed?.zoneId) {
    const normalizedZone = String(committed.zoneId).toLowerCase();
    const zoneConfig = zoneConfigMap[normalizedZone];
    if (zoneConfig) {
      lookup[tid] = {
        ...lookup[tid],
        zoneId: normalizedZone,        // committed (overrides raw)
        color: zoneConfig.color || lookup[tid]?.color || null,
      };
    }
  }
}

// Change to:
for (const tid of trackedIds) {
  const committed = this.zoneProfileStore?.getZoneState(tid);
  if (committed?.zoneId) {
    const normalizedZone = String(committed.zoneId).toLowerCase();
    const zoneConfig = zoneConfigMap[normalizedZone];
    // Preserve the raw zone from baseline before overriding with committed
    const rawZoneId = lookup[tid]?.zoneId || null;
    const rawZoneColor = lookup[tid]?.color || null;
    if (zoneConfig) {
      lookup[tid] = {
        ...lookup[tid],
        zoneId: normalizedZone,           // committed (governance, timeline)
        color: zoneConfig.color || rawZoneColor || null,
        rawZoneId: rawZoneId,             // raw (cards, LEDs)
        rawZoneColor: rawZoneColor,       // raw color
      };
    }
  }
}
```

**Step 2: Expose raw fields on roster entry**

In `_buildRosterEntry()`, add `rawZoneId` and `rawZoneColor` to the returned object (around line 447):

```javascript
// After existing zoneId/zoneColor lines:
zoneId: zoneInfo?.zoneId || fallbackZoneId || null,
zoneColor: zoneInfo?.color || fallbackZoneColor || null,
rawZoneId: zoneInfo?.rawZoneId || zoneInfo?.zoneId || fallbackZoneId || null,
rawZoneColor: zoneInfo?.rawZoneColor || zoneInfo?.color || fallbackZoneColor || null,
```

**Step 3: Verify**

Run dev server, start a fitness session. In browser console:
```javascript
window.__fitnessSession?.roster?.map(p => ({ name: p.name, zoneId: p.zoneId, rawZoneId: p.rawZoneId }))
```
Confirm both fields are populated and `rawZoneId` updates immediately when HR crosses a boundary, while `zoneId` is delayed by hysteresis.

**Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/ParticipantRoster.js
git commit -m "feat(fitness): expose rawZoneId on roster entries alongside committed zone"
```

---

### Task 2: HR cards use raw zone for color

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx:916`
- Reference: `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/PersonCard.jsx:50,67`

**Context:** `FitnessUsers.jsx` line 916 resolves `zoneBadgeColor` from `participantEntry?.zoneColor` (committed). PersonCard renders this as the card's zone badge color.

**Step 1: Switch card zone color to raw**

In `FitnessUsers.jsx` around line 916, change zone color resolution to prefer raw:

```javascript
// Before:
const zoneBadgeColor = zoneIdForGrouping
  ? (userVitalsEntry?.zoneColor || participantEntry?.zoneColor || progressInfo?.zoneColor || zoneColorMap[zoneIdForGrouping] || null)
  : null;

// After:
const zoneBadgeColor = zoneIdForGrouping
  ? (userVitalsEntry?.zoneColor || participantEntry?.rawZoneColor || participantEntry?.zoneColor || progressInfo?.zoneColor || zoneColorMap[zoneIdForGrouping] || null)
  : null;
```

Also find where `zoneIdForGrouping` is resolved and ensure it uses raw zone for card grouping:

```javascript
// Find the zoneIdForGrouping assignment and add rawZoneId preference
const zoneIdForGrouping = participantEntry?.rawZoneId || participantEntry?.zoneId || ...;
```

**Step 2: Verify**

Start fitness session. When HR oscillates near a zone boundary, confirm:
- Card color changes immediately when HR crosses threshold
- Progress ring and card color are always in sync
- Governance lock screen still uses committed zone (no flicker)

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx
git commit -m "feat(fitness): cards use raw zone color to match displayed HR"
```

---

### Task 3: LEDs use raw zone

**Files:**
- Modify: `frontend/src/hooks/fitness/useZoneLedSync.js:30-31, 73-76`

**Context:** `buildZoneSignature()` (line 30-31) reads `p.zoneId` from roster entries. `sendZoneUpdate()` (lines 73-76) builds LED payload from the same field.

**Step 1: Switch LED zone source to raw**

```javascript
// Line 30-31, buildZoneSignature():
// Before:
const zoneId = p.zoneId || 'none';

// After:
const zoneId = p.rawZoneId || p.zoneId || 'none';
```

```javascript
// Lines 73-76, sendZoneUpdate():
// Before:
zones: roster.map(p => ({ zoneId: p.zoneId, isActive: p.isActive }))

// After:
zones: roster.map(p => ({ zoneId: p.rawZoneId || p.zoneId, isActive: p.isActive }))
```

**Step 2: Verify**

During fitness session, confirm LED color changes immediately when HR crosses zone boundary (no 3-8 second delay from hysteresis).

**Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/useZoneLedSync.js
git commit -m "feat(fitness): LEDs use raw zone for real-time color feedback"
```

---

## Group B: Media Identity Namespacing

**Problem:** Media IDs are bare numeric Plex IDs (`649319`). The pipeline hardcodes `plex:` prefix in the API layer and `plex/` in display URLs. If a second media source (e.g., Jellyfin) is added, IDs will collide and display URLs will break.

**Design decision:** Use `contentId` format (`plex:649319`) as the canonical media identifier throughout the pipeline. Backfill all historical sessions.

### Task 4: Fix grandparentId in enhancedCurrentItem

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx:455-496`

**Context:** `enhancedCurrentItem` memo (lines 455-496) spreads `currentItem` but does NOT set `grandparentId`. The computed `grandparentId` memo at line 498-499 has the right fallback chain but isn't used by `media_start` event (line 1023 reads `media.grandparentId || null` directly).

**Step 1: Set grandparentId in enhancedCurrentItem**

In the `enhancedCurrentItem` memo (around line 455-496), add `grandparentId` to the returned object using the same fallback chain as the standalone memo:

```javascript
// Inside enhancedCurrentItem useMemo, add to returned object:
grandparentId: currentItem?.grandparentId || currentItem?.grandparentRatingKey || currentItem?.seriesId || currentItem?.plex || null,
```

This way `media_start` at line 1023 (`media.grandparentId || null`) picks up the resolved value since `media` is `enhancedCurrentItem`.

**Step 2: Verify**

Play collection-sourced content (e.g., Fitness collection). Check browser console for `media_start` event — `grandparentId` should be the collection/series Plex ID, not `null`.

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayer.jsx
git commit -m "fix(fitness): set grandparentId in enhancedCurrentItem for collection content"
```

---

### Task 5: Namespace media IDs with source prefix

**Files:**
- Modify: `frontend/src/modules/Player/utils/mediaIdentity.js:1-12`
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx` (enhancedCurrentItem contentId)

**Context:** `resolveMediaIdentity()` returns bare IDs from metadata fields. The `contentId` (with `plex:` prefix) is computed in `enhancedCurrentItem` but not used as the canonical media ID.

**Step 1: Add source-prefixed identity resolver**

In `mediaIdentity.js`, add a new function that returns namespaced IDs:

```javascript
/**
 * Resolve media identity with source namespace prefix.
 * Returns format like "plex:649319" for source-aware identification.
 * Falls back to bare ID if source cannot be determined.
 */
export function resolveContentId(metadata) {
  const bareId = resolveMediaIdentity(metadata);
  if (!bareId) return null;

  // If already namespaced, return as-is
  if (typeof bareId === 'string' && bareId.includes(':')) return bareId;

  // Determine source from metadata
  const source = metadata?.source
    || (metadata?.plex != null ? 'plex' : null)
    || (metadata?.assetId != null ? 'plex' : null)
    || (metadata?.key != null ? 'plex' : null)
    || 'plex'; // Default to plex for existing data

  return `${source}:${bareId}`;
}
```

**Step 2: Use contentId as canonical mediaId in FitnessPlayer**

In `FitnessPlayer.jsx`, where `currentMediaIdentity` is computed, switch to `resolveContentId`:

```javascript
// Import:
import { resolveContentId } from '../Player/utils/mediaIdentity.js';

// Replace resolveMediaIdentity usage with resolveContentId
const currentMediaIdentity = resolveContentId(enhancedCurrentItem);
```

**Step 3: Verify**

Play media in fitness session. Check `media_start` event in logs — `mediaId` should be `plex:649319` format.

**Step 4: Commit**

```bash
git add frontend/src/modules/Player/utils/mediaIdentity.js
git add frontend/src/modules/Fitness/FitnessPlayer.jsx
git commit -m "feat(fitness): namespace media IDs with source prefix (plex:ID format)"
```

---

### Task 6: Fix hardcoded Plex URLs in display layer

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/DashboardWidgets.jsx:149, 225-241`
- Modify: `backend/src/4_api/v1/routers/fitness.mjs:207`

**Context:** Dashboard hardcodes `/api/v1/display/plex/` in image URLs. Backend hardcodes `plex:` prefix in show endpoint.

**Step 1: Create display URL resolver utility**

Create a small helper in the fitness module (or inline):

```javascript
/**
 * Build display URL from a media ID that may or may not be namespaced.
 * Handles both "plex:649319" (new) and "649319" (legacy) formats.
 */
function mediaDisplayUrl(mediaId) {
  if (!mediaId) return null;
  const str = String(mediaId);
  // Already namespaced: "plex:649319" → "/api/v1/display/plex/649319"
  if (str.includes(':')) {
    const [source, id] = str.split(':', 2);
    return `/api/v1/display/${source}/${id}`;
  }
  // Legacy bare ID: assume plex
  return `/api/v1/display/plex/${str}`;
}
```

**Step 2: Replace hardcoded URLs in DashboardWidgets**

```jsx
// Line 149 — thumbnail:
// Before:
src={`/api/v1/display/plex/${s.media.mediaId}`}
// After:
src={mediaDisplayUrl(s.media.mediaId)}

// Lines 225-231 — poster:
// Before:
src={`/api/v1/display/plex/${s.media.grandparentId}`}
// After:
src={mediaDisplayUrl(s.media.grandparentId)}

// Lines 239-241 — other thumbnails:
// Before:
src={`/api/v1/display/plex/${m.mediaId}`}
// After:
src={mediaDisplayUrl(m.mediaId)}
```

**Step 3: Fix backend show endpoint**

In `fitness.mjs` line 207:

```javascript
// Before:
const compoundId = `plex:${id}`;

// After — handle both formats:
const compoundId = id.includes(':') ? id : `plex:${id}`;
```

**Step 4: Verify**

Load dashboard at `http://localhost:3111`. Confirm session thumbnails and show posters load correctly for both old sessions (bare IDs) and new sessions (namespaced IDs).

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/DashboardWidgets.jsx
git add backend/src/4_api/v1/routers/fitness.mjs
git commit -m "feat(fitness): resolve display URLs from namespaced media IDs"
```

---

### Task 7: Backfill historical session media IDs

**Files:**
- Create: `cli/scripts/backfill-media-namespace.mjs`
- Reference: session files in `data/household/history/fitness/`

**Context:** All historical sessions use bare numeric IDs. Since all content is from Plex, prepend `plex:` to every bare `mediaId` in session YAML files. No lookups needed.

**Step 1: Write backfill script**

```javascript
#!/usr/bin/env node
/**
 * Backfill bare numeric mediaId values with plex: prefix in session YAML files.
 * Safe to run multiple times — skips already-namespaced IDs.
 *
 * Usage: node cli/scripts/backfill-media-namespace.mjs [--dry-run]
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const DATA_ROOT = process.env.DAYLIGHT_DATA || path.resolve('data');
const FITNESS_DIR = path.join(DATA_ROOT, 'household/history/fitness');
const DRY_RUN = process.argv.includes('--dry-run');

function prefixBareId(id) {
  if (id == null) return id;
  const str = String(id);
  if (str.includes(':')) return str; // Already namespaced
  if (!/^\d+$/.test(str)) return str; // Not a bare numeric ID
  return `plex:${str}`;
}

function processSession(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const doc = yaml.load(raw);
  let changed = false;

  // Fix events[].data.mediaId
  if (Array.isArray(doc?.events)) {
    for (const evt of doc.events) {
      if (evt?.data?.mediaId) {
        const prefixed = prefixBareId(evt.data.mediaId);
        if (prefixed !== evt.data.mediaId) {
          evt.data.mediaId = prefixed;
          changed = true;
        }
      }
    }
  }

  // Fix summary.media[].mediaId
  if (Array.isArray(doc?.summary?.media)) {
    for (const m of doc.summary.media) {
      if (m?.mediaId) {
        const prefixed = prefixBareId(m.mediaId);
        if (prefixed !== m.mediaId) {
          m.mediaId = prefixed;
          changed = true;
        }
      }
    }
  }

  // Fix timeline.events[].data.mediaId (media_start/media_end events)
  if (Array.isArray(doc?.timeline?.events)) {
    for (const evt of doc.timeline.events) {
      if (evt?.data?.mediaId) {
        const prefixed = prefixBareId(evt.data.mediaId);
        if (prefixed !== evt.data.mediaId) {
          evt.data.mediaId = prefixed;
          changed = true;
        }
      }
    }
  }

  if (changed && !DRY_RUN) {
    fs.writeFileSync(filePath, yaml.dump(doc, { lineWidth: -1, noRefs: true }));
  }

  return changed;
}

// Walk fitness directory
const dateDirs = fs.readdirSync(FITNESS_DIR).filter(d =>
  fs.statSync(path.join(FITNESS_DIR, d)).isDirectory()
);

let totalFiles = 0;
let totalChanged = 0;

for (const dateDir of dateDirs) {
  const dirPath = path.join(FITNESS_DIR, dateDir);
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.yml'));
  for (const file of files) {
    totalFiles++;
    const filePath = path.join(dirPath, file);
    try {
      if (processSession(filePath)) {
        totalChanged++;
        console.log(`${DRY_RUN ? '[DRY RUN] Would update' : 'Updated'}: ${filePath}`);
      }
    } catch (err) {
      console.error(`Error processing ${filePath}: ${err.message}`);
    }
  }
}

console.log(`\nProcessed ${totalFiles} files, ${totalChanged} ${DRY_RUN ? 'would be ' : ''}updated.`);
```

**Step 2: Run dry-run first**

```bash
node cli/scripts/backfill-media-namespace.mjs --dry-run
```

Verify output shows expected files and no errors.

**Step 3: Run for real**

```bash
node cli/scripts/backfill-media-namespace.mjs
```

**Step 4: Spot-check a session file**

```bash
grep 'mediaId' data/household/history/fitness/2026-02-26/20260226185825.yml
```

Confirm all mediaIds are now `plex:649319` format.

**Step 5: Commit**

```bash
git add cli/scripts/backfill-media-namespace.mjs
git commit -m "feat(fitness): add backfill script for media ID namespacing"
```

---

## Group C: HR Data Quality at Session Start

**Problem:** Two distinct bugs cause wrong HR data at the start of fitness sessions:

1. **Stale device HR:** BLE devices send a cached first reading from a previous session (e.g., Felix connects at 163 BPM, immediately drops to 88). Already partially mitigated by 3-reading startup discard (`FitnessSession.js:515-527`).

2. **Phantom user HR:** `MetricsRecorder._stageUserEntry()` (line 331) falls back to `user.currentData.heartRate` via `??` coalesce. If a user was previously assigned a device, their `currentData` retains the old HR, which leaks into the new session's time series before the new device sends data.

### Task 8: Clear stale user HR on device assignment

**Files:**
- Modify: `frontend/src/hooks/fitness/UserManager.js`

**Context:** When a device is assigned to a user, `user.currentData.heartRate` may still contain a value from a previous assignment. This stale value leaks into MetricsRecorder via the `??` coalesce at line 331.

**Step 1: Find device assignment handler**

In `UserManager.js`, locate where a device is mapped to a user (the method that handles device→user assignment, likely around `resolveUserForDevice` or similar).

**Step 2: Clear heartRate on assignment**

When a new device is assigned to a user, reset their HR state:

```javascript
// In the device assignment path:
if (user.currentData) {
  user.currentData.heartRate = 0;
}
```

This ensures MetricsRecorder's `??` coalesce at line 331 won't find a stale value.

**Step 3: Verify**

Start a fitness session. Connect devices one by one. Check the JSONL log for each user — their HR series should start with `null` or `0` until the device actually sends data, not carry over from a previous session.

**Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/UserManager.js
git commit -m "fix(fitness): clear stale user HR when device is assigned"
```

---

### Task 9: Fix phantom HR coalesce in MetricsRecorder

**Files:**
- Modify: `frontend/src/hooks/fitness/MetricsRecorder.js:331`

**Context:** Line 331 in `_stageUserEntry()`:
```javascript
heartRate: sanitizeHeartRate(snapshot?.heartRate ?? user.currentData?.heartRate),
```
The `?? user.currentData?.heartRate` fallback picks up stale HR from a previous device assignment. With Task 8 clearing the value, this is a belt-and-suspenders fix.

**Step 1: Remove stale HR fallback**

```javascript
// Before (line 331):
heartRate: sanitizeHeartRate(snapshot?.heartRate ?? user.currentData?.heartRate),

// After:
heartRate: sanitizeHeartRate(snapshot?.heartRate ?? 0),
```

The user's HR should only come from the device snapshot, never from cached user state. If the device hasn't sent HR yet, record `0` (which the time series encodes as null).

**Step 2: Verify**

Start a fitness session. Confirm no phantom HR spikes appear in the first few seconds of each user's time series. Check the session YAML after — user HR series should start clean.

**Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/MetricsRecorder.js
git commit -m "fix(fitness): remove stale HR fallback in MetricsRecorder staging"
```

---

## Verification Checklist

After all tasks are complete, verify end-to-end:

1. **Zone display sync:** Start fitness session, exercise near zone boundary. Card color and LED color should change immediately when HR crosses threshold. Governance lock screen should NOT flicker.

2. **Media IDs:** Play content in fitness session. Check `media_start` event in JSONL log — `mediaId` should be `plex:NNNNNN` format. Dashboard should display thumbnails correctly.

3. **grandparentId:** Play collection-sourced content (Fitness collection). Check session YAML — `grandparentId` should be populated, not null.

4. **HR startup:** Start session, connect devices one at a time. Check session YAML — no HR spikes at user connect time. First real HR readings should be physiologically plausible.

5. **Backfill:** Spot-check 3-5 historical session files — all mediaIds should be `plex:` prefixed.
