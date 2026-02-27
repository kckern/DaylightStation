# Webhook Time-Based Session Matching Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the webhook enrichment pipeline so it matches Strava activities to home fitness sessions by time overlap (instead of requiring a pre-existing `strava.activityId`), writes the Strava block to the session YAML, then enriches the Strava activity with voice memos and episode descriptions.

**Architecture:** The existing `StravaHarvester.#findMatches()` already implements time-overlap matching with a 5-minute buffer. The `StravaEnrichmentService._findMatchingSession()` currently only searches for `participant.strava.activityId` — which is a chicken-and-egg bug since that field only exists after matching. The fix replaces the activityId-based scan with the same time-overlap approach the harvester uses, then writes the Strava block before enriching. Additionally, episode descriptions must be persisted to session YAML at save time so the enrichment service can include them in the Strava description without a separate API call.

**Tech Stack:** Node.js ESM, moment-timezone, js-yaml (via FileIO.mjs utilities), React (frontend)

---

### Task 1: Save episode description to session YAML at persist time

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx:~1019` (add description to media_start event)
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js:~452` (carry description through consolidation)
- Modify: `frontend/src/hooks/fitness/buildSessionSummary.js:~66` (include description in summary.media)

**Context:** The Strava enrichment description is built from **voice memos + episode description**. Voice memos are already persisted in session YAML. Episode descriptions are NOT — even though the data is available at media_start time via `media.summary` (from Plex metadata). Three small additions carry it through the persistence pipeline.

**Step 1: Add description to media_start event in FitnessPlayer.jsx**

In `FitnessPlayer.jsx` around line 1019, inside the `logEvent('media_start', {...})` call, add `description` after the existing `type` field:

```javascript
const logged = session.logEvent('media_start', {
  source: 'video_player',
  contentId: currentMediaIdentity,
  title: media.title || media.label || null,
  grandparentTitle: media.grandparentTitle || null,
  parentTitle: media.parentTitle || null,
  grandparentId: media.grandparentId || null,
  parentId: media.parentId || null,
  plexId: media.plex || media.id || null,
  mediaKey: media.assetId || null,
  durationSeconds,
  resumeSeconds: Number.isFinite(media.seconds) ? Math.round(media.seconds) : null,
  autoplay: autoplayEnabled,
  governed: governanceState?.isGoverned ?? Boolean(governanceState?.videoLocked),
  labels: Array.isArray(media.labels) ? media.labels : [],
  type: media.type || media.mediaType || 'video',
  description: media.summary || media.episodeDescription || null,
  queueSize
});
```

The only change is adding the `description` line. The field comes from `media.summary` (set by `toListItem()` in the backend content API) which is already on the `enhancedCurrentItem` object.

**Step 2: Carry description through event consolidation in PersistenceManager.js**

In `PersistenceManager.js` around line 452, inside the consolidated media event builder (`_consolidateEvents`), add `description` to the data object:

```javascript
mediaEvents.push({
  timestamp: Number(startEvt?.timestamp || endEvt?.timestamp) || 0,
  type: 'media',
  data: {
    contentId: id,
    title: s.title || e.title || null,
    grandparentTitle: s.grandparentTitle || null,
    parentTitle: s.parentTitle || null,
    grandparentId: s.grandparentId || null,
    parentId: s.parentId || null,
    labels: s.labels || [],
    contentType: s.type || null,
    governed: s.governed ?? null,
    description: s.description || e.description || null,
    durationSeconds: s.durationSeconds ?? e.durationSeconds ?? null,
    start: Number(startEvt?.timestamp) || null,
    end: Number(endEvt?.timestamp) || null,
    ...(pauses.length > 0 ? { pauses } : {})
  }
});
```

The only change is adding the `description` line.

**Step 3: Include description in session summary media**

In `buildSessionSummary.js` around line 66, inside the media summary mapping, add `description`:

```javascript
const media = mediaEvents.map(e => {
  const d = e.data || {};
  const durationMs = (d.end != null && d.start != null) ? d.end - d.start : 0;
  return {
    contentId: d.contentId || d.mediaId,
    title: d.title,
    showTitle: d.grandparentTitle,
    seasonTitle: d.parentTitle,
    grandparentId: d.grandparentId,
    parentId: d.parentId,
    durationMs,
    ...(d.description ? { description: d.description } : {}),
  };
});
```

Use spread to only include `description` when present (avoids `description: null` clutter in existing non-fitness-show sessions like music-only workouts).

**Step 4: Verify no test breakage**

Run: `npx playwright test tests/live/flow/fitness/ --reporter=line` (if fitness tests exist)
Expected: No regressions — new field is additive

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayer.jsx frontend/src/hooks/fitness/PersistenceManager.js frontend/src/hooks/fitness/buildSessionSummary.js
git commit -m "feat(fitness): persist episode description in session YAML for enrichment"
```

---

### Task 2: Replace activityId scan with time-based matching in `_findMatchingSession`

**Files:**
- Modify: `backend/src/3_applications/strava/StravaEnrichmentService.mjs:22-24` (imports)
- Modify: `backend/src/3_applications/strava/StravaEnrichmentService.mjs:123-151` (`_attemptEnrichment` — pass activity data to matcher)
- Modify: `backend/src/3_applications/strava/StravaEnrichmentService.mjs:217-265` (`_findMatchingSession` — rewrite)

**Context:** The harvester's `#findMatches()` (lines 670-722 of `StravaHarvester.mjs`) already does time-overlap matching with a 5-minute buffer and best-overlap selection. We replicate that pattern but adapted for the webhook case where we have a single Strava activity (fetched via API) instead of a batch.

**Step 1: Add moment-timezone import**

In `StravaEnrichmentService.mjs`, add after the existing imports (line 24):

```javascript
import moment from 'moment-timezone';
```

**Step 2: Rewrite `_findMatchingSession` to use time-based matching**

Replace the current `_findMatchingSession(activityId, eventTime)` method (lines 217-265) with:

```javascript
/**
 * @private
 * Find a home fitness session matching a Strava activity by time overlap.
 *
 * Two-pass approach:
 *  1. Fast path: check if any session already has this strava.activityId
 *  2. Time match: overlap the activity window against session windows (5-min buffer)
 *
 * @param {Object} activity - Strava activity object (from API: start_date, moving_time, elapsed_time, id)
 * @returns {{ data: Object, filePath: string }|null}
 */
_findMatchingSession(activity) {
  const activityId = String(activity.id);

  if (!this.#fitnessHistoryDir || !dirExists(this.#fitnessHistoryDir)) {
    this.#logger.warn?.('strava.enrichment.session_scan.no_history_dir', {
      activityId,
      dir: this.#fitnessHistoryDir,
    });
    return null;
  }

  const BUFFER_MS = 5 * 60 * 1000;
  const MIN_SESSION_SECONDS = 120; // skip sessions shorter than 2 minutes

  // Determine timezone from config or default
  const tz = this.#configService?.getTimezone?.() || 'America/Los_Angeles';

  // Strava activity window
  const actStart = moment(activity.start_date).tz(tz);
  const actEnd = actStart.clone().add(activity.elapsed_time || activity.moving_time || 0, 'seconds');
  const actStartBuffered = actStart.clone().subtract(BUFFER_MS, 'ms');
  const actEndBuffered = actEnd.clone().add(BUFFER_MS, 'ms');

  // Dates to scan
  const dates = this._resolveScanDates(actStart.unix());
  this.#logger.info?.('strava.enrichment.session_scan.start', {
    activityId,
    dates,
    activityStart: actStart.format(),
    activityEnd: actEnd.format(),
  });

  let filesScanned = 0;
  let bestMatch = null;
  let bestOverlap = 0;

  for (const date of dates) {
    const dateDir = path.join(this.#fitnessHistoryDir, date);
    if (!dirExists(dateDir)) continue;

    const files = listYamlFiles(dateDir);
    filesScanned += files.length;

    for (const filename of files) {
      const filePath = path.join(dateDir, `${filename}.yml`);
      const data = loadYamlSafe(filePath);
      if (!data?.session?.start || !data?.participants) continue;

      // Duration guardrail: skip junk/short sessions
      const durationSec = data.session.duration_seconds || 0;
      if (durationSec < MIN_SESSION_SECONDS) continue;

      // Fast path: already has this activityId
      for (const participant of Object.values(data.participants)) {
        if (String(participant?.strava?.activityId) === activityId) {
          this.#logger.info?.('strava.enrichment.session_scan.matched', {
            activityId, date, file: filename, matchType: 'activityId',
          });
          return { data, filePath };
        }
      }

      // Time-based matching
      const sessionTz = data.timezone || tz;
      const sessStart = moment.tz(data.session.start, sessionTz);
      const sessEnd = data.session.end
        ? moment.tz(data.session.end, sessionTz)
        : sessStart.clone().add(durationSec, 'seconds');

      const overlapStart = moment.max(actStartBuffered, sessStart);
      const overlapEnd = moment.min(actEndBuffered, sessEnd);
      const overlapMs = overlapEnd.diff(overlapStart);

      if (overlapMs > 0 && overlapMs > bestOverlap) {
        bestOverlap = overlapMs;
        bestMatch = { data, filePath, date, filename };
      }
    }
  }

  if (bestMatch) {
    this.#logger.info?.('strava.enrichment.session_scan.matched', {
      activityId,
      date: bestMatch.date,
      file: bestMatch.filename,
      matchType: 'time-overlap',
      overlapMs: bestOverlap,
    });
    return { data: bestMatch.data, filePath: bestMatch.filePath };
  }

  this.#logger.info?.('strava.enrichment.session_scan.miss', {
    activityId,
    dates,
    filesScanned,
  });
  return null;
}
```

**Step 3: Update `_attemptEnrichment` to fetch activity first, then match**

Currently `_attemptEnrichment` calls `_findMatchingSession(activityId, eventTime)` and only fetches the Strava activity later. We need to flip the order: fetch the activity first (we need `start_date` and `moving_time` for time matching), then match.

In `_attemptEnrichment`, replace lines 139-157 (from `try {` through the `_ensureAuth` and `getActivity` calls) with:

```javascript
try {
  // Ensure we have a fresh access token (needed for getActivity)
  await this._ensureAuth();

  // Fetch activity from Strava (need start_date + duration for time matching)
  const currentActivity = await this.#stravaClient.getActivity(activityId);
  if (!currentActivity?.start_date) {
    this.#logger.warn?.('strava.enrichment.activity_fetch_failed', { activityId });
    if (attempt < MAX_RETRIES) {
      setTimeout(() => this._attemptEnrichment(activityId), RETRY_INTERVAL_MS);
    } else {
      this.#jobStore.update(activityId, { status: 'unmatched' });
    }
    return;
  }

  // Find matching home session (time-based)
  const match = this._findMatchingSession(currentActivity);
  if (!match) {
    this.#logger.info?.('strava.enrichment.no_match', { activityId, attempt });
    if (attempt < MAX_RETRIES) {
      setTimeout(() => this._attemptEnrichment(activityId), RETRY_INTERVAL_MS);
    } else {
      this.#jobStore.update(activityId, { status: 'unmatched' });
      this.#logger.warn?.('strava.enrichment.unmatched', { activityId, attempts: attempt });
    }
    return;
  }

  const session = match.data;

  // Build enrichment payload
  const enrichment = buildStravaDescription(session, currentActivity);
```

Then the rest of the method continues with `enrichment` and `session` as before, but also add the write-back step (Task 3) between matching and enriching.

**Step 4: Run dev server and verify no startup errors**

Run: `node backend/index.js` (or use running dev server)
Expected: `strava.enrichment.initialized` in logs, no import errors

**Step 5: Commit**

```bash
git add backend/src/3_applications/strava/StravaEnrichmentService.mjs
git commit -m "feat(strava): replace activityId scan with time-based session matching"
```

---

### Task 3: Write Strava block to session YAML after matching

**Files:**
- Modify: `backend/src/3_applications/strava/StravaEnrichmentService.mjs:22-24` (add saveYaml import)
- Modify: `backend/src/3_applications/strava/StravaEnrichmentService.mjs` (add write-back in `_attemptEnrichment`)

**Context:** After time-matching but before enriching Strava, write the `strava:` block to the session file. This mirrors exactly what `StravaHarvester.#applyEnrichment()` does at lines 775-791. The format:

```yaml
participants:
  kckern:
    strava:
      activityId: 17541823520
      type: WeightTraining
      sufferScore: 8
      deviceName: Garmin Forerunner 245 Music
```

**Step 1: Add saveYaml import**

Update the import line (line 23) from:

```javascript
import { loadYamlSafe, listYamlFiles, dirExists } from '#system/utils/FileIO.mjs';
```

to:

```javascript
import { loadYamlSafe, listYamlFiles, dirExists, saveYaml } from '#system/utils/FileIO.mjs';
```

**Step 2: Add write-back logic in `_attemptEnrichment`**

After the `_findMatchingSession` call succeeds and before `buildStravaDescription`, add:

```javascript
// Write Strava data back to session YAML
const username = this.#configService.getHeadOfHousehold?.() || 'kckern';
if (session.participants?.[username] && !session.participants[username]?.strava?.activityId) {
  session.participants[username].strava = {
    activityId: currentActivity.id,
    type: currentActivity.type || currentActivity.sport_type || null,
    sufferScore: currentActivity.suffer_score || null,
    deviceName: currentActivity.device_name || null,
  };

  const savePath = match.filePath.replace(/\.yml$/, '');
  saveYaml(savePath, session);

  this.#logger.info?.('strava.enrichment.session_writeback', {
    activityId,
    sessionId: session.sessionId || session.session?.id,
    filePath: match.filePath,
  });
}
```

**Step 3: Verify the write format matches existing sessions**

Run (after dev server restart):
```bash
# Check an existing session with strava data
cat /path/to/data/household/history/fitness/2026-02-26/20260226185825.yml | head -20
```

Expected: `strava:` block under participant with `activityId`, `type`, `sufferScore`, `deviceName`

**Step 4: Commit**

```bash
git add backend/src/3_applications/strava/StravaEnrichmentService.mjs
git commit -m "feat(strava): write strava block to session YAML after time-match"
```

---

### Task 4: End-to-end test with simulated webhook

**Files:**
- No code changes — this is a verification task

**Context:** Simulate the exact webhook that Strava would send for activity 17541823520 and verify the full pipeline: receive → identify → time-match → write-back → enrich Strava.

**Step 1: Deploy to prod**

User deploys the changes (or test locally if dev server has access to fitness history).

**Step 2: Clear the existing job file**

The previous simulation created a job file that may block re-processing. Check and clear:

```bash
# On prod, check the job file
ssh homeserver.local 'cat /data/household/common/strava/strava-webhooks/17541823520.yml'
```

If status is `unmatched`, delete it so we can re-test:

```bash
ssh homeserver.local 'rm /data/household/common/strava/strava-webhooks/17541823520.yml'
```

**Step 3: Send simulated webhook**

```bash
curl -s -X POST "https://daylightstation.kckern.net/api/v1/fitness/provider/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "object_type": "activity",
    "object_id": 17541823520,
    "aspect_type": "create",
    "owner_id": 14872916,
    "event_time": 1740663961,
    "subscription_id": 332543
  }'
```

Expected: `{"ok":true}`

**Step 4: Check prod logs for full pipeline**

```bash
ssh homeserver.local 'docker logs daylight-station --since 2m 2>&1 | grep -E "strava|enrichment"'
```

Expected log sequence:
1. `strava.enrichment.event_accepted` — event queued
2. `strava.enrichment.attempt_start` — attempt 1
3. `strava.enrichment.auth.refreshing` / `auth.refreshed` — token refresh
4. `strava.client.getActivity` / `getActivity.done` — fetched activity from Strava API
5. `strava.enrichment.session_scan.start` — scanning dates
6. `strava.enrichment.session_scan.matched` — matched with `matchType: 'time-overlap'`
7. `strava.enrichment.session_writeback` — wrote strava block to session YAML
8. `strava.client.updateActivity` — pushed title/description to Strava
9. `strava.enrichment.success` — done

**Step 5: Verify session YAML was updated**

```bash
ssh homeserver.local 'head -20 /data/household/history/fitness/2026-02-27/20260227054558.yml'
```

Expected: `strava:` block under `participants.kckern` with `activityId: 17541823520`

**Step 6: Verify Strava activity was enriched**

```bash
curl -s -H "Authorization: Bearer <access_token>" \
  "https://www.strava.com/api/v3/activities/17541823520" | python3 -c "
import sys, json
a = json.load(sys.stdin)
print(f'Name: {a[\"name\"]}')
print(f'Description: {a.get(\"description\", \"(none)\")}')
"
```

Expected:
- Name: `Fitness—Total Body Tempo` (the primary media show—episode)
- Description: voice memo transcript about curls, presses, wood chops (episode description will only appear in sessions recorded AFTER Task 1 is deployed)

**Step 7: Commit verification notes (optional)**

No code commit needed — this is verification only.

---

### Task 5: Update webhook enrichment documentation

**Files:**
- Modify: `docs/reference/fitness/webhook-enrichment.md`

**Step 1: Update the Session Matching section**

Replace the current "Session Matching" section (around line 139-146) with:

```markdown
## Session Matching

The enrichment service matches Strava activities to home fitness sessions using a two-pass approach:

### Pass 1: ActivityId lookup (fast path)
If a session already has `participants.{user}.strava.activityId` matching the webhook's activity ID, it's returned immediately. This handles re-processing and cases where the harvester has already linked the session.

### Pass 2: Time-overlap matching
When no activityId match exists, the service fetches the Strava activity from the API (needs `start_date` and `elapsed_time`) and compares its time window against session start/end times with a **5-minute buffer** on each side. The session with the greatest overlap wins.

**Guardrails:**
- Sessions shorter than 2 minutes are skipped (avoids matching accidental starts)
- The 5-minute buffer accounts for clock drift between the Garmin watch and the home system

### Write-back
After a successful time-match, the service writes the Strava block to the session YAML:

```yaml
participants:
  kckern:
    strava:
      activityId: 17541823520
      type: WeightTraining
      sufferScore: 8
      deviceName: Garmin Forerunner 245 Music
```

This ensures future lookups (and the harvester's own matching) find the link via the fast path.

Dates scanned: today, yesterday, and the event date (from webhook timestamp or activity start_date).
```

**Step 2: Update the Enrichment Payload section**

Replace the current "Enrichment Payload" section with:

```markdown
## Enrichment Payload

For Strava, `buildStravaDescription(session, currentActivity)` produces:

- **Title**: Primary media → `Show—Episode` (skipped if activity already has an em-dash title)
- **Description**: Voice memo transcripts first, then episode description (skipped if activity already has a description)

The episode description is persisted to the session YAML at save time (via `media.summary` from Plex metadata in the `media_start` event). Voice memos are always persisted.

Returns `null` if nothing to enrich (no media, no memos).
```

**Step 3: Commit**

```bash
git add docs/reference/fitness/webhook-enrichment.md
git commit -m "docs: update webhook enrichment with time-matching and description details"
```
