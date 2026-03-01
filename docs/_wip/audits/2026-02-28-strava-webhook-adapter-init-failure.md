> **Resolved:** 2026-02-28. Syntax error removed (line 42 deleted), init_failed promoted to error, startup health check added. See commits f96056b3, a3c8c536, 74952208.

# Strava Webhook Adapter Init Failure — Syntax Error Causing Silent Data Loss

**Date:** 2026-02-28
**Severity:** Critical — real-time enrichment fully broken since deploy
**Status:** Open

---

## Summary

A syntax error in `buildStravaDescription.mjs` (line 42) prevents the entire Strava webhook subsystem from initializing. The `StravaWebhookAdapter` is never registered, so every incoming Strava webhook is logged as `fitness.provider.webhook.unknown` and silently discarded. Real-time activity enrichment (pushing titles, descriptions, and episode info back to Strava) is completely dead.

The polling harvester continues to work, so session–activity matching eventually happens, but **Strava activities are never enriched with DaylightStation session data** (titles, descriptions, voice memos, media playlists). This enrichment is the entire point of the webhook integration.

---

## Timeline

| Time (UTC) | Event |
|------------|-------|
| 2026-02-27 19:19 | Commit `bda01963` ("DDD cleanup + multi-episode Strava enrichment") introduces syntax error in new `buildStravaDescription.mjs` |
| 2026-02-28 15:45 | Docker container restarted (deploy), loads the broken code |
| 2026-02-28 07:46:02 | `strava.enrichment.init_failed` logged: `Unexpected token '&&'` |
| 2026-02-28 19:40:47 | First webhook arrives from Strava (activity `17559742019`, `create`). Logged as `webhook.unknown`, discarded |
| 2026-02-28 20:05 | Harvester polling picks up the activity ~25 min later, but does NOT push enrichment back to Strava |

---

## Root Cause

### The Syntax Error

**File:** `backend/src/1_adapters/fitness/buildStravaDescription.mjs:42`

```javascript
// Lines 40-44
const primaryMedia = _selectPrimaryEpisode(watchedEpisodes)
  ?? _selectPrimaryEpisode(episodeEvents)
  ?? summary?.media?.find(m => m?.mediaType !== 'audio' && m?.primary)?.title && null   // ← LINE 42
  ?? summary?.media?.find(m => m?.mediaType !== 'audio')
  ?? null;
```

**Problem:** Line 42 mixes `??` (nullish coalescing) and `&&` (logical AND) without parentheses. ECMAScript spec **forbids** this — `??` cannot be directly combined with `&&` or `||` without explicit grouping. Node.js v20.11.0 throws `SyntaxError: Unexpected token '&&'` at parse time.

The `&& null` on line 42 also appears to be a logic bug — the intent was probably to use only the `.title` property as a fallback, but `&& null` would always evaluate to `null` regardless of the left side.

### The Failure Cascade

1. `buildStravaDescription.mjs` fails to parse → module cannot be imported
2. `FitnessActivityEnrichmentService.mjs` imports `buildStravaDescription` → also fails to import
3. `app.mjs` line 1266 `await import('./3_applications/fitness/FitnessActivityEnrichmentService.mjs')` throws
4. Caught by `catch (err)` at line 1303 → logs `strava.enrichment.init_failed`
5. `providerWebhookAdapters` remains `{}` (empty)
6. Webhook route at `fitness.mjs:729` loops over empty adapters → no match → logs `webhook.unknown`
7. Returns `200 OK` to Strava (so Strava doesn't retry)

### Why It Wasn't Caught

- The file was created in commit `bda01963` but the syntax error only surfaces when the module is dynamically imported at runtime
- The error is caught by a try/catch and logged as a `warn`, not an `error` — no crash, no alert
- The harvester continues to work normally (it doesn't import `buildStravaDescription`), masking the broken webhook path
- The `200 OK` response to Strava prevents retry/backoff alerts on the Strava side

---

## Impact Assessment

### What's Lost

| Capability | Status |
|------------|--------|
| Strava webhook receive | Received but discarded |
| `StravaWebhookAdapter.identify()` | Never called (not registered) |
| `StravaWebhookAdapter.parseEvent()` | Never called |
| `FitnessActivityEnrichmentService.handleEvent()` | Never called |
| Strava activity title enrichment (push back) | **Dead** |
| Strava activity description enrichment (push back) | **Dead** |
| Voice memo transcripts → Strava | **Dead** |
| Media playlist → Strava | **Dead** |
| Durable job queue (crash recovery) | **Dead** |
| Real-time session matching | **Dead** — falls back to hourly polling |

### What Still Works

| Capability | Status |
|------------|--------|
| Harvester polling (hourly) | Working — `strava.harvest.complete` every hour |
| Session–activity time matching | Working via harvester (delayed) |
| Local session YAML enrichment | Working via harvester |
| Strava subscription (webhook delivery) | Working — Strava still sends events |

### Data Loss Scope

- **Container started:** 2026-02-28 15:45 UTC
- **Webhooks received and discarded:** 1 confirmed (`17559742019`)
- **Activities created since deploy:** At least 1 (today's workout `20260228191442`)
- **Enrichment permanently lost:** All activity titles/descriptions that would have been pushed to Strava since deploy. The harvester backfills local data but **never pushes back to Strava**.

---

## Affected Files

| File | Role | Status |
|------|------|--------|
| `backend/src/1_adapters/fitness/buildStravaDescription.mjs:42` | Syntax error source | **BROKEN** |
| `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs` | Imports broken module | Fails to load |
| `backend/src/app.mjs:1258-1305` | Adapter registration | Skipped (caught error) |
| `backend/src/4_api/v1/routers/fitness.mjs:721-767` | Webhook route | Receives events but has no adapters |
| `backend/src/1_adapters/strava/StravaWebhookAdapter.mjs` | Webhook protocol | Never instantiated |
| `backend/src/1_adapters/strava/StravaWebhookJobStore.mjs` | Durable job queue | Never instantiated |

---

## Fix

### Immediate: Fix the Syntax Error

Line 42 needs parentheses to disambiguate `??` vs `&&`, and the `&& null` logic needs correction.

**Current (broken):**
```javascript
const primaryMedia = _selectPrimaryEpisode(watchedEpisodes)
  ?? _selectPrimaryEpisode(episodeEvents)
  ?? summary?.media?.find(m => m?.mediaType !== 'audio' && m?.primary)?.title && null
  ?? summary?.media?.find(m => m?.mediaType !== 'audio')
  ?? null;
```

**Probable intent:** Line 42 was trying to fall back to the `.title` of the primary media summary item, but `&& null` makes it always null. The whole line is logically dead code. Options:

1. **Remove line 42 entirely** — it can never produce a useful value due to `&& null`
2. **Fix to extract title:** `?? (summary?.media?.find(m => m?.mediaType !== 'audio' && m?.primary)?.title || null)` — but this returns a string, not an episode object like the other fallbacks expect

The correct fix depends on whether the intent was to return an episode-like object or just a title string. Given that `primaryMedia` is later accessed for `.grandparentTitle`, `.title`, etc., returning just a `.title` string would break downstream. **Line 42 should be removed.**

### Follow-Up: Prevent Recurrence

1. **Promote `strava.enrichment.init_failed` from `warn` to `error`** — this is a critical subsystem failure, not a warning
2. **Add a startup health check** that verifies `providerWebhookAdapters` is non-empty when Strava credentials are configured
3. **Add a CI lint/parse step** for all `.mjs` files (`node --check backend/src/**/*.mjs`)
4. **Backfill:** After fix + deploy, manually trigger enrichment for activities created during the outage window

### Backfill Strategy

Once the fix is deployed:
1. Query Strava API for activities created since 2026-02-28T15:45Z
2. For each, run `FitnessActivityEnrichmentService.handleEvent()` to push titles/descriptions
3. Or trigger a manual harvest with enrichment enabled

---

## Prod Verification Commands

```bash
# Confirm the error
ssh {env.prod_host} 'docker logs {env.docker_container} 2>&1 | grep "strava.enrichment.init_failed"'

# After fix + deploy, confirm initialization succeeds
ssh {env.prod_host} 'docker logs {env.docker_container} 2>&1 | grep "strava.enrichment.initialized"'

# Confirm webhook adapter is registered (trigger a test webhook)
ssh {env.prod_host} 'docker logs {env.docker_container} 2>&1 | grep "strava.webhook"'
```

---

## Lessons

1. **Caught errors that silently disable subsystems are worse than crashes.** The try/catch in app.mjs turned a fatal error into a silent degradation. The system appeared healthy while real-time enrichment was completely dead.
2. **Polling masks webhook failures.** The harvester continuing to work hid the fact that the webhook path was broken. There was no alert or degradation signal.
3. **`200 OK` to webhook senders prevents retry-based detection.** The route returns 200 even when it can't process the event, so Strava has no signal that anything is wrong.
4. **Dynamic imports need parse-time validation.** Static imports would have crashed the server at startup, making the error immediately visible. The lazy `await import()` deferred the error into a catch block.
