# Voice Memo → Strava Description Backfill

**Date:** 2026-04-08
**Status:** Draft

## Problem

When a voice memo is recorded after the Strava webhook has already enriched the activity, the description is built without the memo text. No trigger exists to re-push the description with the newly available voice memo.

The reconciliation service would eventually catch this, but it only runs after new webhook events — meaning the gap could last days.

## Solution

After a voice memo is transcribed and saved to a session, check if that session has a Strava `activityId`. If so, rebuild the description and push it to Strava. Fire-and-forget: errors are logged, not surfaced to the user.

## Architecture

### New Method: `FitnessActivityEnrichmentService.reEnrichDescription(session)`

- Extracts `activityId` from session participants or root-level `strava` block
- Skips silently if no activityId (webhook hasn't fired yet — it will include the memo when it does)
- Reads warmup config from `ConfigService` (same as existing enrichment)
- Calls `buildStravaDescription(session, {}, warmupConfig)` to rebuild fresh
- Fetches current activity from Strava via `getActivity(activityId)` to compare
- Skips if the rebuilt description matches what's already on Strava
- Pushes only `{ description }` via `StravaClientAdapter.updateActivity()` — title is never touched
- Logs outcome at `info` (updated) or `debug` (skipped/no-op)

### Call Site: Fitness API Router (`fitness.mjs`)

After the voice memo is transcribed and saved to the session YAML, call:

```javascript
enrichmentService.reEnrichDescription(session).catch(err =>
  logger.warn('strava.voice_memo_backfill.failed', { sessionId, error: err?.message })
);
```

Non-blocking, fire-and-forget. The voice memo response returns immediately regardless.

## Data Flow

```
Frontend records memo
  → POST /api/fitness/voice_memo
  → VoiceMemoTranscriptionService (Whisper + GPT cleanup)
  → Save memo event to session YAML
  → [NEW] FitnessActivityEnrichmentService.reEnrichDescription(session)
       → buildStravaDescription(session) → fresh description with memo
       → getActivity(activityId) → current Strava state
       → Compare descriptions, skip if unchanged
       → updateActivity(activityId, { description })
       → Log result, swallow errors
```

## Files Changed

| File | Change |
|------|--------|
| `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs` | Add `reEnrichDescription(session)` method |
| `backend/src/4_api/v1/routers/fitness.mjs` | Call `reEnrichDescription()` after voice memo save |

## Files NOT Changed

- `buildStravaDescription.mjs` — already handles voice memos correctly
- `StravaClientAdapter.mjs` — `updateActivity()` already supports partial updates
- `StravaReconciliationService.mjs` — continues to work as a safety net
- Frontend — no changes needed

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No Strava activityId yet (webhook hasn't fired) | Skip silently; webhook will include memo when it runs |
| Strava token expired | StravaClientAdapter handles refresh; if refresh fails, error is logged and swallowed |
| Description unchanged (memo already included) | Compare before pushing, skip if identical |
| Multiple memos in one session | Each save triggers re-push; description is rebuilt from all memos, so final state is correct |
| Session has no timeline events at all | `buildStravaDescription` returns null, skip |
