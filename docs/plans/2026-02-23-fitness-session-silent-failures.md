# Fitness Session Silent Failures — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix four silent failures in the fitness session pipeline: voice memo data loss, broken watchTime accumulation, governance log spam, and playCount inflation.

**Architecture:** Backend-first fixes where possible (watchTime, playCount, governance logging). The voice memo fix is a one-line removal in the frontend consolidation pipeline. All fixes are independent and can be done in any order.

**Tech Stack:** React hooks (frontend), Express/Node (backend), structured logger with `sampled()` API.

**Audit:** `docs/_wip/audits/2026-02-23-fitness-session-silent-failures-audit.md`

---

## Task 1: Fix Governance Log Spam (46K+ warn lines)

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:1337, 1347, 1360`

**Step 1: Apply rate-limiting to `media_not_governed` warning**

Change line 1347 from a raw `getLogger().warn()` to a `sampled()` call:

```javascript
// GovernanceEngine.js — line 1347
// BEFORE:
getLogger().warn('governance.evaluate.media_not_governed', {
  mediaId: this.media?.id
});

// AFTER:
getLogger().sampled('governance.evaluate.media_not_governed', {
  mediaId: this.media?.id
}, { maxPerMinute: 2, aggregate: true });
```

**Step 2: Apply same fix to `no_media_or_rules` warning**

Change line 1337:

```javascript
// GovernanceEngine.js — line 1337
// BEFORE:
getLogger().warn('governance.evaluate.no_media_or_rules', {
  hasMedia: !!(this.media && this.media.id),
  hasGovernanceRules
});

// AFTER:
getLogger().sampled('governance.evaluate.no_media_or_rules', {
  hasMedia: !!(this.media && this.media.id),
  hasGovernanceRules
}, { maxPerMinute: 2, aggregate: true });
```

**Step 3: Apply same fix to `no_participants` warning**

Change line 1360:

```javascript
// GovernanceEngine.js — line 1360
// BEFORE:
getLogger().warn('governance.evaluate.no_participants');

// AFTER:
getLogger().sampled('governance.evaluate.no_participants', {}, { maxPerMinute: 2, aggregate: true });
```

**Step 4: Verify in browser**

Run the dev server and open the fitness app with no participants / ungoverned media. Check browser console — the warnings should appear at most 2x/minute instead of every tick.

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "fix: rate-limit governance evaluate warnings to 2/min

governance.evaluate.media_not_governed, no_media_or_rules, and
no_participants were firing on every 5s tick with no rate limit,
producing 46K+ warn lines in prod logs. Use logger.sampled() like
other governance warnings."
```

---

## Task 2: Fix Voice Memo Persistence (Critical Data Loss)

**Files:**
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js:310`

**Context:** `VoiceMemoManager.addMemo()` logs a `voice_memo_start` event to the timeline (line 55). The consolidation pipeline in `_consolidateEvents()` explicitly drops these events at line 310 with `if (type === 'voice_memo_start') continue;`. The comment claims a consolidated `voice_memo` event replaces it — but nothing ever creates that event. The orphan-merge fallback (lines 773–795) tries to recover from `sessionData.voiceMemos`, but the array is deleted at line 827 before persistence and may not be populated in the data passed to the persistence layer. The serializer at `SessionSerializerV3.js:147` already handles both `voice_memo_start` and `voice_memo` event types.

**Step 1: Remove the line that drops `voice_memo_start` events**

```javascript
// PersistenceManager.js — line 310
// REMOVE this line entirely:
if (type === 'voice_memo_start') continue;
```

This allows `voice_memo_start` events to flow through to `otherEvents` and reach the final timeline. The serializer already handles this event type at `SessionSerializerV3.js:147`:
```javascript
} else if (type === 'voice_memo_start' || type === 'voice_memo') {
```

**Step 2: Verify in browser**

1. Start a fitness session
2. Record a voice memo
3. End the session
4. Check the persisted session YAML — `timeline.events` should contain a `voice_memo_start` entry with `memoId`, `durationSeconds`, and `transcriptPreview`

**Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/PersistenceManager.js
git commit -m "fix: stop dropping voice_memo_start events in consolidation

_consolidateEvents() was unconditionally dropping voice_memo_start
events, claiming a consolidated voice_memo event would replace them.
No such consolidation existed, causing 100% voice memo data loss.
The SessionSerializerV3 already handles voice_memo_start, so simply
letting them pass through restores persistence."
```

---

## Task 3: Fix watchTime Always Zero (Backend)

**Files:**
- Modify: `backend/src/4_api/v1/routers/play.mjs:96`

**Context:** The play router requires an explicit `watched_duration` param in the request body (line 52, 96). The frontend `FitnessPlayer.jsx` posts to `/api/v1/play/log` (line 817) but never includes `watched_duration`. Since `Number.isFinite(undefined)` is `false`, `sessionWatchTime` defaults to 0 and watchTime never accumulates. The content router at `content.mjs:175` has a working auto-calculation formula: `Math.max(0, seconds - (existing?.playhead || 0))`. We use that same formula as a fallback when `watched_duration` is missing.

**Step 1: Add auto-calculation fallback for missing `watched_duration`**

```javascript
// play.mjs — line 96
// BEFORE:
const sessionWatchTime = Number.isFinite(watched_duration) ? parseFloat(watched_duration) : 0;

// AFTER:
const sessionWatchTime = Number.isFinite(watched_duration)
  ? parseFloat(watched_duration)
  : Math.max(0, normalizedSeconds - (existingState?.playhead || 0));
```

This mirrors the content router's proven formula at `content.mjs:175`. When the frontend sends `watched_duration`, it's used directly. When missing (all current fitness player calls), the delta from the last known playhead is used instead.

**Step 2: Verify with curl**

```bash
# First call — establishes playhead at 100s
curl -X POST http://localhost:3112/api/v1/play/log \
  -H 'Content-Type: application/json' \
  -d '{"type":"plex","assetId":"plex:99999","seconds":100,"percent":10,"title":"test"}'

# Second call — playhead moves to 200s, watchTime should be 100
curl -X POST http://localhost:3112/api/v1/play/log \
  -H 'Content-Type: application/json' \
  -d '{"type":"plex","assetId":"plex:99999","seconds":200,"percent":20,"title":"test"}'
```

Check the response or the media progress YAML — `watchTime` should now be `100`, not `0`.

**Step 3: Commit**

```bash
git add backend/src/4_api/v1/routers/play.mjs
git commit -m "fix: auto-calculate watchTime when watched_duration missing

The play router required an explicit watched_duration param that the
frontend never sends, causing watchTime=0 for all fitness sessions
since ~Jan 29. Fall back to the same playhead-delta formula used by
the content router when the param is absent."
```

---

## Task 4: Fix playCount Inflation (Backend)

**Files:**
- Modify: `backend/src/4_api/v1/routers/play.mjs:111`

**Context:** The play router increments `playCount` on every progress update call (line 111): `playCount: (existingState?.playCount ?? 0) + 1`. A 739s video with 10s update intervals produces ~74 progress calls and a playCount of 75 for a single viewing. This should increment only when a new playback session starts (first call for this asset, or playhead resets to an earlier position).

**Step 1: Only increment playCount on new playback sessions**

```javascript
// play.mjs — line 111
// BEFORE:
playCount: (existingState?.playCount ?? 0) + 1,

// AFTER:
playCount: (existingState?.playCount ?? 0) + (!existingState || normalizedSeconds < (existingState.playhead || 0) ? 1 : 0),
```

Logic: increment when there's no prior state (first play) or when playhead jumps backward (restart/new session). During normal forward progress updates, playCount stays the same.

**Step 2: Verify with curl**

```bash
# First call — new asset, playCount should be 1
curl -X POST http://localhost:3112/api/v1/play/log \
  -H 'Content-Type: application/json' \
  -d '{"type":"plex","assetId":"plex:88888","seconds":100,"percent":10,"title":"test"}'

# Second call — forward progress, playCount should still be 1
curl -X POST http://localhost:3112/api/v1/play/log \
  -H 'Content-Type: application/json' \
  -d '{"type":"plex","assetId":"plex:88888","seconds":200,"percent":20,"title":"test"}'
```

**Step 3: Commit**

```bash
git add backend/src/4_api/v1/routers/play.mjs
git commit -m "fix: only increment playCount on new playback sessions

playCount was incrementing on every progress update call (~74x per
video instead of 1). Now only increments on first play or when
playhead resets backward (indicating a new viewing session)."
```

---

## Task 5: Backfill watchTime for Affected Entries (Optional)

**Files:**
- Create: `cli/scripts/backfill-watchtime.mjs` (one-time script, delete after use)

**Context:** 55 entries in media progress files have `watchTime: 0` despite having valid `playhead` and `percent` data (Jan 29 – Feb 23). For entries at 100% completion, `watchTime` can be set to `duration`. For partial plays, `watchTime = playhead` is a reasonable lower bound.

**Step 1: Write the backfill script**

```javascript
// cli/scripts/backfill-watchtime.mjs
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';

const FITNESS_MEDIA_PATH = process.argv[2];
if (!FITNESS_MEDIA_PATH) {
  console.error('Usage: node backfill-watchtime.mjs <path-to-fitness-media-yml>');
  process.exit(1);
}

const content = fs.readFileSync(FITNESS_MEDIA_PATH, 'utf8');
const data = yaml.load(content) || {};

let fixed = 0;
for (const [key, entry] of Object.entries(data)) {
  if (entry.watchTime === 0 && entry.playhead > 0) {
    // Use playhead as lower-bound estimate of actual watch time
    entry.watchTime = entry.playhead;
    fixed++;
    console.log(`  Fixed ${key}: watchTime = ${entry.playhead}s (was 0)`);
  }
}

if (fixed > 0) {
  fs.writeFileSync(FITNESS_MEDIA_PATH, yaml.dump(data, { lineWidth: -1 }));
  console.log(`\nBackfilled ${fixed} entries.`);
} else {
  console.log('No entries needed backfill.');
}
```

**Step 2: Dry run — inspect which entries would be fixed**

Before running, review the target file to confirm entries match the pattern:
```bash
grep -c "watchTime: 0" <path-to-plex/14_fitness.yml>
```

**Step 3: Run the backfill**

```bash
node cli/scripts/backfill-watchtime.mjs <path-to-plex/14_fitness.yml>
```

**Step 4: Verify results**

```bash
grep "watchTime: 0" <path-to-plex/14_fitness.yml>
# Should return no results (or only entries with playhead: 0)
```

**Step 5: Clean up**

Delete the one-time script after successful backfill. Do not commit it.

---

## Summary

| Task | Severity | Fix Location | Complexity |
|------|----------|-------------|------------|
| 1. Governance log spam | Medium | Frontend (GovernanceEngine.js) | Trivial (3 line changes) |
| 2. Voice memo persistence | Critical | Frontend (PersistenceManager.js) | Trivial (1 line removal) |
| 3. watchTime always zero | High | Backend (play.mjs) | Trivial (1 line change) |
| 4. playCount inflation | Low | Backend (play.mjs) | Trivial (1 line change) |
| 5. Backfill watchTime | — | One-time CLI script | Low |

**Not addressed (per audit):** Issue 3 (media event timestamp from Plex `lastPlayed`) — severity is low and `offsetMs` is correct. Needs deeper investigation into whether `media_start` is being logged at the right time vs reconstructed from Plex data. Deferred.
