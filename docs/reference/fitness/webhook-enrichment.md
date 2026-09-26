# Fitness Provider Webhook Enrichment

Automatically enriches fitness provider activities with DaylightStation session data (media titles, voice memos, episode descriptions) when a workout ends.

The system is vendor-agnostic — the router dispatches to provider-specific adapters based on payload shape. **Strava** is the first (and currently only) provider implementation.

---

## Overview

When a fitness provider reports a new activity (e.g., workout ends, watch syncs), it sends a webhook event to DaylightStation. The enrichment pipeline matches the activity to a home fitness session and pushes a title + description back to the provider.

### Flow

```
Provider (activity created)
  │
  │ POST /api/v1/fitness/provider/webhook
  ▼
┌─────────────────────────────────────────┐
│ Fitness Router (vendor-agnostic)        │
│  1. Loop adapters → identify(req)       │
│  2. parseEvent(body) → normalized event │
│  3. shouldEnrich(event) check           │
│  4. enrichmentService.handleEvent()     │
│  Returns 200 immediately                │
└──────────────────┬──────────────────────┘
                   │ async
                   ▼
┌─────────────────────────────────────────┐
│ Enrichment Service                      │
│  1. Circuit breaker (cooldown, dups)    │
│  2. Write durable job (YAML)            │
│  3. Scan fitness history for match      │
│  4. Build enrichment payload            │
│  5. PUT to provider API                 │
│  6. Retry up to 3× at 5min intervals   │
└─────────────────────────────────────────┘
```

### Vendor-Agnostic Design

The router holds a map of `providerWebhookAdapters` (e.g., `{ strava: StravaWebhookAdapter }`). On each incoming request, it loops over all adapters and calls `identify(req)`. The first adapter that recognizes the payload handles it. To add a new provider:

1. Create an adapter in `1_adapters/{provider}/` implementing `identify()`, `handleChallenge()`, `parseEvent()`, `shouldEnrich()`
2. Create a client adapter for the provider's API
3. Register it in `app.mjs` bootstrap alongside the existing Strava setup
4. Add it to the `providerWebhookAdapters` map

The router, enrichment service interface, and webhook routes remain unchanged.

---

## Components

### Layer Map

| Layer | Component | File | Purpose |
|-------|-----------|------|---------|
| API | Fitness router | `4_api/v1/routers/fitness.mjs` | `GET/POST /provider/webhook` — vendor-agnostic dispatch |
| Bootstrap | `createFitnessApiRouter` | `5_composition/bootstrap.mjs` | Passes `providerWebhookAdapters` + `enrichmentService` through to router |
| Bootstrap | `app.mjs` | `app.mjs` | Constructs all provider dependencies, calls `recoverPendingJobs()` on startup |

#### Strava Implementation

| Layer | Component | File | Purpose |
|-------|-----------|------|---------|
| Adapter | `StravaWebhookAdapter` | `1_adapters/strava/StravaWebhookAdapter.mjs` | Strava webhook protocol: challenge validation, event parsing, verify token |
| Adapter | `StravaClientAdapter` | `1_adapters/fitness/StravaClientAdapter.mjs` | HTTP client for Strava API (getActivity, updateActivity, refreshToken) |
| Adapter | `StravaWebhookJobStore` | `1_adapters/strava/StravaWebhookJobStore.mjs` | Durable YAML-backed job queue for crash recovery |
| Application | `FitnessActivityEnrichmentService` | `3_applications/fitness/FitnessActivityEnrichmentService.mjs` | Orchestration: matching, enrichment, retries, circuit breakers |
| Adapter | `buildStravaDescription` | `1_adapters/fitness/buildStravaDescription.mjs` | Pure function: session data → Strava title + description |

### Webhook Routes

- **`GET /api/v1/fitness/provider/webhook`** — Subscription validation. Provider sends a challenge; we echo it back.
- **`POST /api/v1/fitness/provider/webhook`** — Event receiver. Returns 200 immediately; enrichment is async.

---

## Configuration

### Provider Auth

Each provider needs a system auth file and per-user OAuth tokens.

#### Strava Example

System credentials in `data/system/auth/strava.yml`:
```yaml
client_id: <strava_app_client_id>
client_secret: <strava_app_client_secret>
verify_token: <random_string_for_webhook_validation>
```

If this file is missing or `client_id` is falsy, the webhook system skips initialization and logs `strava.enrichment.skipped`.

User tokens in `data/users/{username}/auth/strava.yml`:
```yaml
refresh: <oauth_refresh_token>
access_token: <current_access_token>
expires_at: <unix_timestamp>
```

The enrichment service refreshes the access token automatically using the refresh token.

### Cloudflare Access

The webhook endpoint must be publicly reachable. A Cloudflare Access bypass policy is required for the path `/api/v1/fitness/provider/webhook` — without it, providers get a 403 from Cloudflare Access and webhooks silently fail.

### Provider Subscription

Each provider has its own subscription mechanism. Example for Strava:

```bash
# Create subscription
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -d client_id=<client_id> \
  -d client_secret=<client_secret> \
  -d callback_url=https://<public_host>/api/v1/fitness/provider/webhook \
  -d verify_token=<verify_token>

# Check existing subscriptions
curl "https://www.strava.com/api/v3/push_subscriptions?client_id=<client_id>&client_secret=<client_secret>"
```

---

## Circuit Breakers

Three layers prevent duplicate enrichment:

1. **`shouldEnrich()`** — Adapter-level filter. For Strava: only `activity` + `create` events proceed. Updates, deletes, and athlete events are skipped.
2. **In-memory cooldown** — Recently-enriched activity IDs are held in a Map with 1-hour TTL.
3. **Job store** — Completed jobs are checked before re-processing. Jobs persist across restarts.

---

## Session Matching

Two-pass approach to find the DaylightStation fitness session that corresponds to a provider activity:

### Pass 1: Fast path (activityId lookup)

If a session already has a `strava.activityId` field under a participant (from a previous enrichment), it's returned immediately. This avoids redundant time-matching on retries or re-deployments.

### Pass 2: Time-overlap matching

The enrichment service fetches the activity from the provider API (needs `start_date` + `elapsed_time`) and scans `data/household/history/fitness/` for YAML session files whose time windows overlap.

- **Buffer**: 5 minutes added to each end of the activity window
- **Minimum session duration**: 2 minutes (skips junk/short sessions)
- **Best-overlap wins**: If multiple sessions overlap, the one with the greatest overlap is selected
- **Dates scanned**: today, yesterday, and the activity start date (from provider API)
- **Timezone-aware**: Uses `moment-timezone` with session-specific timezone or household default

### Write-back

After a successful time-match, the enrichment service writes the provider's activity data back to the session YAML. For Strava, this creates a `strava:` block under the participant:

```yaml
participants:
  username:
    strava:
      activityId: 17541823520
      type: WeightTraining
      sufferScore: 8
      deviceName: Garmin Forerunner 245 Music
```

This creates the two-way link: the session now references the provider activity (for future fast-path lookups), and the provider activity gets enriched with session data.

### Retries

If no match is found, the service retries up to 3 times at 5-minute intervals (the home session may not have been saved yet when the webhook arrives). After 3 failures, the job is marked `unmatched`. On container restart, `recoverPendingJobs()` retries all pending/unmatched jobs.

### Strava-only sessions (no home match)

After the retries run out, `_createStravaOnlySession` writes a session built from the activity itself (`session.source: strava`). Its HR timeline comes from `StravaSessionBuilder.buildStravaSessionTimeline(heartrate, time)`.

**The `time` stream is required.** Strava's `heartrate` stream is not one sample per second: Garmin smart recording writes a point every 1–10s. Each sample is placed at its `time` offset. The previous value is held across gaps of up to 60s. Longer gaps stay null (no HR, no rings). Before 2026-09-22 the raw array was treated as per-second, so a session came out about 5x too short. For example, activity 20245291061 had 1039 samples over 4920s and was written as 208 ticks (17 min) for an 82-minute run. The harvester now archives the offsets alongside `heartRateOverTime` as `heartRateTimes`, and `fitness reconstruct` uses them.

### Title and notes pulled back from Strava

A rename on Strava arrives as an `activity/update` webhook carrying `updates.title`. `FitnessWebhookService` routes it to `handleTitleUpdate`, which calls `ActivityReconciliationService.applyTitle` to write the new title into the linked session right away. (Before 2026-09-22 every update event was dropped as "not enrichable".) Our own title pushes echo back the same way; applying them is harmless.

`ActivityReconciliationService` also runs an hourly sweep (`fitness:strava-reconcile`) plus one after each webhook, over a 10-day lookback. It refreshes Strava auth before each sweep (`ensureAccess`). Before that fix, the scheduled sweep only worked in the ~6 hours after a webhook happened to refresh the token: it logged "No access token available" until then and 401s after. The sweep keeps two things current in the session:

- `strava_notes` — text a person typed into the Strava description. It is pulled once and never overwritten. Only the typed text is kept (see below).
- `strava.name` — the Strava title. It is set when the session is created (often the auto-name "Morning Run") and refreshed whenever the title on Strava changes. Only a name the session already has is refreshed; home sessions carry a `strava` block without a name and are left alone. Emits `strava.reconciliation.title_synced`.

The harvester also lets fresh list fields (title, description) win over the archived copy, so `lifelog/strava.yml` picks up renames too.

**`strava_notes` never holds our own description.** Every description we push is a set of blocks separated by blank lines:

- `🎙️ "…"` holds a voice memo.
- `📝 "…"` holds typed notes.
- `🖥️ …` names an episode.
- `🎵 …` names a track.

A quoted block runs until its closing quote, so a memo or note can contain paragraphs. `extractUserNotes` (in `buildActivityDescription.mjs`) works block by block:

- Memo and media blocks are removed.
- A 📝 block is unwrapped, not removed. It can be the only surviving copy of a typed note, for example after a merge or `drop-participant`. An echo of our own description unwraps to nothing.
- Everything else is kept as typed text.

One trade-off is deliberate: typed text that starts with `🎵 ` or `🖥️ ` looks the same as a media line, so it is dropped.

The function is applied in three places:

- The pull, so only typed text is stored.
- The description builder, so old polluted notes are ignored.
- `recapDescription`, which builds the recap video's memo plus typed notes.

Within one sweep, notes are pulled (pass 2) **before** the push (pass 1). The push is then built from notes that are already settled. When stored notes turn out to be only an echo, the sweep drops them. It logs `strava.reconciliation.echo_notes_dropped` with a text preview, and reports `echoesDropped` in `strava.reconciliation.complete`.

Until 2026-09-25 the pull stored the whole description, including the one we had just pushed. The next push then put that text inside a 📝 block, so the voice memo and media list appeared twice on Strava. A 90-day audit found 91 echoed notes and 38 doubled activities. Only 3 notes had actually been typed on Strava.

The sweep repairs its own 10-day window. `fitness strava repair-notes` repairs further back, and is a dry run by default. It does two things:

- It drops echoed notes.
- It fetches an activity only when we recorded pushing a doubled description, or when the notes were an echo and nothing records what we pushed. It rewrites the description only when the text on Strava is still ours: equal to `strava.pushed.description`, or made only of our own blocks.

Titles are never touched. A session is saved only if its Strava step succeeds, so a failed call changes nothing and the next run picks the session up again. A 429 waits 15 minutes and retries once. `--show` prints the dropped notes, and each Strava description before and after.

### Integrity checks and repair

Every session save runs `checkSessionIntegrity` (`2_domains/fitness/services/sessionIntegrity.mjs`), in both `YamlFitnessHistoryRepository.save()` (Strava pipeline) and `YamlSessionDatastore.save()` (home sessions):

| Check | Applies to | Fails when |
|---|---|---|
| `coverage` | `source: strava` | `tick_count × interval` is more than 10% off `duration_seconds` |
| `series-length` | sessions with a `tick_count` | a series decodes to a different length |
| `rings` | when two or more totals exist | `summary.rings.total`, `treasureBox.totalRings` and the last `global:rings` disagree |

A failing session is **still saved**, with `integrity: {ok: false, checkedAt, violations}` added. A clean save removes the stamp. The Strava repository logs `fitness.session.integrity_violation` at warn. The home datastore logs it at debug, because it autosaves during a workout.

Measured on 2026-09-22 across 2965 sessions: 1 coverage hit, 2 series-length hits, 57 ring mismatches. The ring mismatches are all home sessions (the newest from 2026-09-07). They get stamped but never alert, because Pass 4 only repairs Strava-only sessions.

**Pass 4 of the reconciliation sweep** rebuilds a flagged Strava-only session from `heartrate` + `time` through `applyStravaTimeline`, the same builder the webhook uses. It is **grow-only**: it writes only when the rebuild has more ticks than the stored file, after `snapshot()` copies that file to `fitness/log-backups/{date}/{id}.{timestamp}.timeline-rebuild.yml`. A rebuild that would shrink is recorded as unresolved and not written. At most 10 stream fetches per sweep.

### Sync health

`StravaSyncHealth` (`3_applications/fitness/StravaSyncHealth.mjs`) records the last success of each stage in `household/fitness/sync-health.yml`. The `fitness:strava-sync-health` task (every 15 min, no Strava calls) evaluates them:

| Stage | Reported by | Stale when |
|---|---|---|
| `harvest` | `HarvesterService.onResult` for `strava` | no successful harvest in 3h |
| `sweep` | `ActivityReconciliationService.reconcile()` (fails if auth fails or more than half its sessions error) | 3 failed sweeps in a row, or no success in 3h |
| `webhook` | harvested activities (started within 48h) checked against the webhook job store | an activity has been visible for 1h with no webhook job |
| `integrity` | the sweep's flagged list | a Strava-only session stays flagged for 24h |

A healthy→stale transition sends one push to the head of household on **Household alerts**, tagged `strava-sync-{stage}`. The recovery push replaces that card with `alert_once`. The text comes from `composeStravaSyncPush` (`2_domains/fitness/notifications/stravaSyncPush.mjs`), which turns raw errors into plain reasons ("Strava sign-in expired"). Webhook event types nobody handles are counted in `dropped`.

`GET /api/v1/fitness/strava/health` returns the stage records, stale verdicts, missing webhooks, flagged sessions and dropped counts.

---

## Enrichment Payload

For Strava, `buildStravaDescription(session, currentActivity)` produces:

- **Title**: Primary media → `Show—Episode` (skipped if activity already has an em-dash title)
- **Description**: Voice memo transcripts first, then watched episode descriptions, then music playlist (skipped if activity already has a description)

Returns `null` if nothing to enrich (no media, no memos, no music).

### Primary Media Selection

The primary episode (used for the title) is selected by longest `durationSeconds`. The fallback chain:

1. Longest episode from `watchedEpisodes` (watched >= 2 min)
2. Longest episode from all `episodeEvents` (any duration)
3. First non-audio entry from `summary.media`
4. `null`

### Episode Watch-Time Filtering

Episodes watched less than 2 minutes (`MIN_WATCH_MS`) are filtered from the description (but may still appear in the title via the fallback chain). Watch time is estimated using:

1. Direct event window (`end - start`) if >= 2 min
2. Gap to next episode's start time (for legacy sessions with brief detection windows)
3. Remaining session time for the last episode

### Unit Tests

`tests/unit/suite/fitness/buildStravaDescription.test.mjs` — 48 tests covering null inputs, title generation, skip logic, description formatting, episode filtering, music-only sessions, and combined skip scenarios.

### Episode Descriptions

Episode descriptions (e.g., Plex metadata summaries) are persisted to the session YAML at save time by the frontend. The flow:

1. `FitnessPlayer.jsx` captures `media.summary` (from Plex metadata) at `media_start` event time and includes it as `description` in the event data
2. `PersistenceManager.js` carries the description through event consolidation (media_start + media_end pairing)
3. `buildSessionSummary.js` includes `description` in the summary media entries (only when present)
4. The enrichment service reads the description directly from the session YAML — no provider API call needed

---

## Logging

All log events are `info` level — visible in production.

### Webhook Arrival (vendor-agnostic)

| Event | Data | When |
|-------|------|------|
| `fitness.provider.webhook.challenge_request` | query params, adapter count | GET challenge received |
| `fitness.provider.webhook.received` | objectType, aspectType, objectId | POST event received |
| `fitness.provider.webhook.identified` | provider, event details | Adapter matched |
| `fitness.provider.webhook.skip_enrich` | reason | Event not enrichable |
| `fitness.provider.webhook.no_enrichment_service` | provider, objectId | Service missing (warn) |

### Strava-Specific

| Event | Data | When |
|-------|------|------|
| `strava.webhook.challenge.validated` | challenge value | Challenge passed |
| `strava.webhook.challenge.token_mismatch` | first 6 chars of token | Wrong verify token |
| `strava.webhook.challenge.missing_challenge` | — | No challenge param |
| `strava.enrichment.event_accepted` | activityId, ownerId, eventTime | Event queued |
| `strava.enrichment.event_rejected` | objectType, aspectType, reason | Not activity/create |
| `strava.enrichment.cooldown_skip` | activityId | Recently enriched |
| `strava.enrichment.already_completed` | activityId | Job already done |
| `strava.job.created` | activityId | Durable job written |
| `strava.enrichment.attempt_start` | activityId, attempt | Enrichment attempt begins |
| `strava.enrichment.session_scan.start` | activityId, dates | Scanning history |
| `strava.enrichment.session_scan.matched` | activityId, date, file | Session found |
| `strava.enrichment.session_scan.miss` | activityId, dates, filesScanned | No match |
| `strava.enrichment.session_scan.no_history_dir` | activityId, dir | History dir missing (warn) |
| `strava.enrichment.session_writeback` | activityId, sessionId, filePath | Strava block written to session YAML |
| `strava.enrichment.activity_fetch_failed` | activityId | Could not fetch activity from provider (warn) |
| `strava.enrichment.no_match` | activityId, attempt | No session match on this attempt |
| `strava.enrichment.auth.refreshing` | username | Token refresh starting |
| `strava.enrichment.auth.refreshed` | username | Token refresh done |
| `strava.enrichment.auth.no_refresh_token` | username | No token (error) |
| `strava.client.getActivity` | activityId | Fetching current state |
| `strava.client.getActivity.done` | activityId, name, hasDescription | Current state received |
| `strava.enrichment.nothing_to_enrich` | activityId | No media/memos in session |
| `strava.client.updateActivity` | activityId, fields | Pushing to provider |
| `strava.enrichment.success` | activityId, sessionId, fields | Done |
| `strava.enrichment.error` | activityId, attempt, error | Failed |
| `strava.enrichment.unmatched` | activityId, attempts | Max retries exhausted |
| `strava.enrichment.hr_from_api` | activityId, samples, spanSeconds | HR + time streams fetched for a Strava-only session |
| `strava.enrichment.hr_time_stream_missing` | activityId | No usable time stream; falls back to per-second (warn) |
| `strava.reconciliation.title_synced` | activityId, sessionId, from, to | Session title refreshed from Strava |
| `strava.enrichment.title_update_received` | activityId, title | Rename webhook received |
| `strava.reconciliation.auth_failed` | error | Could not refresh auth; sweep skipped (warn) |
| `strava.reconciliation.timeline_rebuilt` | activityId, sessionId, fromTicks, toTicks, fromRings, toRings, backup | Pass 4 repaired a Strava-only timeline |
| `strava.reconciliation.timeline_not_rebuilt` | activityId, sessionId, storedTicks, rebuiltTicks | Rebuild would shrink; left as is |
| `fitness.session.integrity_violation` | sessionId, source, violations | Save-time check failed (warn for Strava, debug for home) |
| `strava.sync_health.transition` | stage, from, to | A stage went stale or recovered (push sent) |
| `strava.sync_health.push_failed` | stage, error | Push could not be delivered (warn) |
| `strava.sync_health.no_push_target` | recipient | Head of household has no HA notify service (warn) |

### Bootstrap

| Event | Level | Data | When |
|-------|-------|------|------|
| `strava.enrichment.initialized` | info | adapters | System ready |
| `strava.enrichment.skipped` | info | reason | No credentials |
| `strava.enrichment.init_failed` | **error** | error, stack | Bootstrap error — enrichment subsystem is dead |
| `strava.enrichment.health_check_failed` | **error** | reason | Strava creds configured but no adapters registered (post-init safety net) |

---

## Troubleshooting

### "I ended a workout and nothing happened"

Check prod logs in order:

0. **`init_failed` or `health_check_failed` in startup logs?** → The enrichment subsystem never initialized. Check the error/stack for the root cause (syntax error, missing module, bad import). All webhooks will be silently discarded until this is fixed and redeployed.
1. **No `webhook.received`?** → Provider didn't send it, or Cloudflare blocked it. Check subscription exists and Cloudflare bypass is active.
2. **`webhook.received` but no `webhook.identified`?** → Payload shape doesn't match any adapter. If `providerWebhookAdapters` is empty (check step 0), all events land here.
3. **`webhook.identified` + `skip_enrich`?** → Event was `update` or `delete`, not `create`. This is normal.
4. **`event_accepted` but no `attempt_start`?** → Cooldown or already-completed circuit breaker.
5. **`session_scan.miss`?** → No matching session yet. Will retry up to 3× at 5-min intervals.
6. **`auth.no_refresh_token`?** → OAuth token missing from user auth file.
7. **`nothing_to_enrich`?** → Session had no media events or voice memos.
8. **`enrichment.error`?** → Provider API call failed. Check error message.
9. **`enrichment.success`?** → It worked. Check provider app for updated title/description.

### Testing the Challenge Endpoint

```bash
curl "https://<public_host>/api/v1/fitness/provider/webhook?hub.mode=subscribe&hub.verify_token=<verify_token>&hub.challenge=test"
```

Expected: `{"hub.challenge":"test"}`

### Job Files

Durable jobs stored per provider, e.g. `media/archives/strava-webhooks/{activityId}.yml`. Check `status` field: `pending`, `completed`, or `unmatched`.
