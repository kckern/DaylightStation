# Fitness Session Resume & Merge

## Problem

When a workout is interrupted (doorbell, app crash, Shield reboot), a new session is created on restart. This produces duplicate sessions for what was logically one workout. There's no way to merge them or prevent the split.

## Requirements

1. **Auto-resume** — If a session ended passively (timeout, no explicit End) and the same media starts within 30 minutes, silently resume the old session.
2. **Prompted resume** — If a session was explicitly ended and the same media starts within 30 minutes, prompt "Resume previous session?" The user can accept or start fresh.
3. **Explicit end** — The existing End Session button finalizes the session. No other UI changes needed.
4. **Gap handling** — Interruption gaps are represented as null entries in the timeline. Duration reflects wall-clock time (original start to final end).
5. **Manual merge** — API endpoint to merge two existing sessions after the fact (for the current broken pair and future edge cases).

## Design

### 1. Data Model — `finalized` Flag

New field in session YAML:

```yaml
session:
  finalized: true  # Set only when user explicitly hits "End Session"
```

- **End via timeout / empty roster / app crash:** `finalized` is `false` (or absent). Session is eligible for silent auto-resume.
- **End via End Session button:** `finalized: true`. Session requires user prompt before resume.

No other schema changes. Null values in RLE-encoded timeline series already work.

### 2. Backend — Resumable Session Endpoint

**Endpoint:** `GET /api/v1/fitness/resumable`

**Query params:**
- `contentId` — media content ID (e.g., `plex:674227`)
- `householdId` — household scope

**Logic:**
1. List sessions for today's date from `YamlSessionDatastore`
2. Filter: same `contentId` in `media.primary.contentId`
3. Filter: ended less than 30 minutes ago (`endTime + 30min > now`)
4. If multiple matches, take the most recent
5. Return full session data plus `finalized` flag

**Response:**
- Match found: `{ resumable: true, session: { ...fullSessionData }, finalized: false }`
- No match: `{ resumable: false }`

### 3. Frontend — Resume Flow in SessionLifecycle

**On `SessionLifecycle.start()`:**

1. Before generating a new session ID, call `GET /api/v1/fitness/resumable?contentId={contentId}&householdId={hid}`
2. If `resumable: false` → proceed normally (new session)
3. If `resumable: true` and `finalized: false` → auto-resume silently
4. If `resumable: true` and `finalized: true` → show prompt "Resume previous session?"
   - Yes → resume
   - No → new session

**On resume:**
1. Use the returned session's ID (don't generate a new one)
2. Restore: `startTime`, `participants`, `treasureBox`, `events`
3. Calculate gap ticks: `Math.floor((now - oldEndTime) / 5000)`
4. Pad all existing timeline series with that many null entries
5. Resume normal tick recording from there
6. Autosave writes back to the same YAML file (same session ID = same path)

**On explicit "End Session" button:**
- Set `finalized: true` in the session payload before final save
- Everything else unchanged

### 4. Backend — Manual Merge Endpoint

**Endpoint:** `POST /api/v1/fitness/sessions/merge`

**Body:** `{ sourceSessionId: "...", targetSessionId: "..." }`

**Logic:**
1. Load both session YAMLs
2. Target keeps its session ID, takes the earlier `startTime` from source
3. Source timeline is prepended to target's, with null-filled gap between
4. Events from both sessions combined, sorted by timestamp
5. Coins summed
6. Participants unioned (source participants not in target are added)
7. Voice memos, strava data, screenshots merged (target wins on conflicts)
8. Source YAML deleted
9. Merged result saved under target's session ID

**Immediate use:** Merge `20260401142645` (source) into `20260401145623` (target) to fix the existing duplicate pair.

## Detection Criteria

A session is resumable when ALL of these are true:
- Same `media.primary.contentId` as the new session's intended media
- Ended less than 30 minutes ago
- Same date (today)
- Same household

The `finalized` flag determines whether resume is silent or prompted — it does NOT affect whether the session is resumable.

## Files to Modify

| Layer | File | Change |
|-------|------|--------|
| API | `backend/src/4_api/v1/routers/fitness.mjs` | Add `/resumable` and `/sessions/merge` endpoints |
| Application | `backend/src/3_applications/fitness/services/SessionService.mjs` | `findResumable()` and `mergeSessions()` methods |
| Domain | `backend/src/2_domains/fitness/Session.mjs` | Add `finalized` field to entity |
| Persistence | `backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs` | Read/write `finalized`, delete session file (for merge) |
| Domain | `backend/src/2_domains/fitness/services/TimelineService.mjs` | `prependWithGap()` for merge timeline stitching |
| Frontend | `frontend/src/hooks/fitness/SessionLifecycle.js` | Check resumable on start, hydration logic |
| Frontend | `frontend/src/hooks/fitness/FitnessSession.js` | Pass `finalized: true` on explicit end |
| Frontend | `frontend/src/hooks/fitness/FitnessTimeline.js` | Gap-fill (pad nulls) on resume |
| Frontend | `frontend/src/hooks/fitness/PersistenceManager.js` | Include `finalized` in save payload |
