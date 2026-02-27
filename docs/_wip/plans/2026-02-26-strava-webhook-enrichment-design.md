# Strava Webhook Enrichment Design

**Date:** 2026-02-26
**Status:** Design complete, pending implementation

## Goal

Enrich Strava activities with DaylightStation fitness session data — media titles as activity names, voice memo transcripts and episode descriptions as activity descriptions. Event-driven via Strava webhooks (not polling).

## Route

`GET /api/v1/fitness/provider/webhook` — Provider subscription challenge validation
`POST /api/v1/fitness/provider/webhook` — Receives activity create/update/delete events

Vendor-agnostic endpoint nested under the fitness router. The API layer has NO vendor knowledge — it receives the webhook and dispatches to the correct adapter based on payload shape. Only adapters know about Strava.

## Cloudflare Configuration

### WAF Rule: Allow Strava Webhooks (POST)

**Security → WAF → Custom Rules**

- **Rule name:** Allow Strava Webhooks
- **Expression:**
  ```
  (http.request.uri.path eq "/api/v1/fitness/provider/webhook") and (
    ip.src in {
      52.1.196.92 52.4.243.43 52.70.212.225 54.209.86.30
      3.209.55.129 44.194.7.173 54.157.3.203 54.160.181.190
      18.206.20.56 3.208.213.46 34.194.140.119 34.203.235.59
    }
  )
  ```
- **Action:** Skip (bypass remaining rules)

### WAF Rule: Allow Strava Webhook Validation (GET)

- **Rule name:** Allow Strava Webhook Validation
- **Expression:** `(http.request.uri.path eq "/api/v1/fitness/provider/webhook") and (http.request.method eq "GET")`
- **Action:** Skip

**Note:** Strava IPs are community-sourced (https://communityhub.strava.com/developers-api-7/whitelist-ip-address-webhook-1840) and may change. If webhooks stop arriving, check that forum thread for updated IPs.

## Webhook Endpoint

### GET (Challenge Validation)

Strava sends: `?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<challenge>`

Response: `{ "hub.challenge": "<challenge>" }` with 200, after verifying `hub.verify_token` matches our configured token.

### POST (Event Receiver)

Payload: `{ object_type, object_id, aspect_type, owner_id, event_time, subscription_id }`

- Filter: only process `object_type: "activity"` + `aspect_type: "create"`
- Write durable job file, return 200 immediately (Strava requires response within 2 seconds)

## Durable Job Queue

Job files persist webhook events to survive crashes/restarts.

**Location:** `data/household/common/strava/strava-webhooks/{activityId}.yml`

**Schema:**
```yaml
activityId: 17530197542
ownerId: 14872916
eventTime: 1772136300
receivedAt: "2026-02-26T14:05:00.000Z"
status: pending          # pending | completed | unmatched
attempts: 0
lastAttemptAt: null
matchedSessionId: null
```

**Lifecycle:**
1. Created on webhook POST → `status: pending`
2. Enrichment succeeds → `status: completed`, `matchedSessionId` populated
3. All retries exhausted → `status: unmatched` (stays on disk for manual review)
4. Completed jobs cleaned up after 7 days

**Startup recovery:** On server boot, scan job dir for `pending`/`unmatched` jobs and re-queue.

## Enrichment Flow

1. Webhook arrives → write job file → return 200
2. Attempt enrichment immediately
3. Scan `data/household/history/fitness/{date}/` for session with matching `participants.*.strava.activityId`
4. Fallback: time-overlap matching (Strava `start_date` ± 5 min buffer)
5. If match found → build enrichment payload → PUT to Strava API
6. If no match → retry up to 3 times at 5-minute intervals

## Enrichment Content

### Title

Only updated if primary media exists in the session:
```
{grandparentTitle} — {title}
```
Example: `Insanity — Pure Cardio`

If no media, leave Strava's default title unchanged (e.g., "Morning Workout").

### Description

Built in priority order, concatenated:

1. **Voice memos** (if any, appear first):
   ```
   🎙️ "No weights today, but tried to keep up. Had to do some modifying..."
   ```
   Multiple memos separated by blank lines, each quoted.

2. **Separator** — `\n\n---\n` (only if both memos and media description)

3. **Episode description** (if available):
   ```
   📺 Fitness — Saturday Special
   Full-body workout focusing on compound movements...
   ```

### Skip Logic

- No media AND no voice memos → don't update the activity at all
- Title already contains `—` → don't update title (already enriched)
- Description already non-empty → don't overwrite (respect manual edits)

## Session File Changes

Media events in `timeline.events` need to also capture the episode `description` from Plex metadata at session save time (frontend change in PersistenceManager).

```yaml
events:
  - type: media
    data:
      mediaId: '600161'
      title: Saturday Special
      grandparentTitle: Fitness
      parentTitle: Workout
      description: "Full-body workout focusing on compound movements..."  # NEW
```

Older sessions without `description` gracefully degrade — voice memos still work, title still works, just no episode synopsis in the Strava description.

## DDD Layer Separation

**Only adapters know about vendors.** The API layer and application layer are vendor-agnostic.

| Layer | Knows about Strava? | Responsibility |
|-------|---------------------|----------------|
| `4_api` (fitness router) | NO | Generic `/provider/webhook` endpoint, dispatches by payload shape |
| `3_applications` | NO | Orchestrates enrichment using abstract interfaces |
| `1_adapters/strava/` | YES | Strava protocol (challenge, event parsing, API calls) |

**Dispatch logic:** The route handler passes the request to a provider registry. The registry matches based on payload shape (Strava sends `subscription_id` + `object_type`; challenge GET has `hub.*` params). Future providers (Garmin Connect, Wahoo) get their own adapter — same endpoint.

## Files to Create

| File | Layer | Purpose |
|------|-------|---------|
| `backend/src/1_adapters/strava/StravaWebhookAdapter.mjs` | Adapter | Strava protocol: challenge validation, event parsing, verify_token |
| `backend/src/1_adapters/strava/StravaWebhookJobStore.mjs` | Adapter | Read/write/scan job YAML files |
| `backend/src/3_applications/strava/StravaEnrichmentService.mjs` | Application | Orchestrator: match, build, push, retry |
| `backend/src/3_applications/strava/buildStravaDescription.mjs` | Application | Pure function: session → `{ name, description }` |
| `docs/runbooks/strava-webhook-setup.md` | Docs | Cloudflare IPs, subscription registration |

## Files to Modify

| File | Change |
|------|--------|
| `backend/src/4_api/v1/routers/fitness.mjs` | Add GET + POST `/provider/webhook` (vendor-agnostic) |
| `backend/src/1_adapters/fitness/StravaClientAdapter.mjs` | Add `updateActivity(activityId, { name, description })` |
| `backend/src/app.mjs` | Wire StravaEnrichmentService, add devProxy line |
| `frontend/src/hooks/fitness/PersistenceManager.js` | Capture media `description` field in events |

## One-Time Setup

1. Add `verify_token` to `data/system/auth/strava.yml`
2. Create Cloudflare WAF rules (see above)
3. Register subscription:
   ```bash
   curl -X POST https://www.strava.com/api/v3/push_subscriptions \
     -d client_id=91629 \
     -d client_secret=<secret> \
     -d callback_url=https://<domain>/api/v1/fitness/provider/webhook \
     -d verify_token=<token>
   ```

## Config Reference

- OAuth credentials: `data/system/auth/strava.yml` (`client_id`, `client_secret`, `verify_token`)
- User tokens: `data/users/{username}/auth/strava.yml` (`refresh`, `access_token`, `expires_at`)
- Job queue: `data/household/common/strava/strava-webhooks/`
- Fitness sessions: `data/household/history/fitness/{YYYY-MM-DD}/{YYYYMMDDHHmmss}.yml`
