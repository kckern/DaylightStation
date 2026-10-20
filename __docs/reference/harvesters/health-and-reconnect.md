# Harvester health and reconnect

What happens when a harvester (Withings, FitnessSyncer, Todoist, ...) stops
working, how the household finds out, and how to reconnect Withings without a
shell.

## A failed harvest is a failure everywhere

A harvester returns a result object. A result with `status: 'error'` (for example
`reason: 'auth_failed'`) counts as a failure in every caller:

| Caller | What it does with an error result |
|---|---|
| Scheduler (`HarvesterJobExecutor`) | Throws, so the run is recorded as `failed` with the reason in `data/system/scheduling/cron-runtime.yml` |
| `POST` / `GET /api/v1/harvest/:serviceId` | Answers `502 {ok: false, harvester, message, data, requestId}`. Bearer tokens, `token=` and `key=` values are redacted from `message` and `data` |
| Harvester health monitor | Counts it toward the failure threshold (below) |

A `skipped` result (cooldown, open circuit breaker, dev mode, token refresh
disabled) is neither a success nor a failure.

The scheduler stamps the end time when the work finishes, so `duration_ms` in
`cron-runtime.yml` is the real run time, in whole seconds. The Admin scheduler
page reads that same file (see `__docs/reference/admin/scheduler.md`).

## Health monitor

`HarvesterHealthMonitor` (`__backend/src/3_applications/harvester/`) listens to
every harvest result through `HarvesterService.onResult` and keeps one record per
service in `data/household/harvester-health.yml` (`status`, `failures`,
`lastSuccessAt`, `lastError`, `latestDate`, `updatedAt`).

| Transition | When | Push |
|---|---|---|
| `failing` | 3 failures in a row | `⚠️ <Name> stopped syncing`, with a plain reason (sign-in expired, service could not be reached, rate limit reached). For Withings sign-in failures it adds "Reconnect it in Admin, Integrations, Withings." |
| `stale` | A harvest succeeds but the newest entry is older than the service's limit, counted in household-local days. Withings: 7 days | `⚠️ No new <Name> data`, naming the day of the newest entry |
| `recovered` | A success after `failing` or `stale` | `✅ <Name> syncing again` (low importance, alert once) |

- Pushes go through Home Assistant `notify` to the head of household's
  `identities.homeassistant.notify_service`, on the **Household alerts** channel,
  tagged `harvester-health-<serviceId>` so each new state replaces the last card.
  With no Home Assistant adapter or no notify service, the push is skipped and
  `harvester.health.no_push_target` is logged.
- Strava is skipped: `StravaSyncHealth` already watches it
  (`__docs/reference/fitness/webhook-enrichment.md`).
- The threshold (3) must stay at or below the harvesters' circuit-breaker
  `maxFailures`. Once the breaker opens, harvests return `skipped`, which the
  monitor ignores.
- `GET /api/v1/harvest` returns the monitor's state under `health`, with
  `lastError` redacted.

To clear a stuck state by hand, delete the service's entry from
`harvester-health.yml`; the next harvest starts it fresh.

## Rotating refresh tokens

Withings, Strava and FitnessSyncer issue a new refresh token on every refresh and
invalidate the old one. If two processes refresh the same account, the one whose
token is not saved breaks the other. So:

- Only a process that is allowed to rotate tokens **and** has a writable auth
  store refreshes. "Allowed" means it runs in the container (`/.dockerenv`
  exists) or sets `DAYLIGHT_TOKEN_WRITER=true`.
- Anywhere else (a dev checkout, a CLI on a laptop) these harvests return
  `skipped` with `reason: 'token_refresh_disabled'`.
- The fitness app's Strava activity-access gateway saves the rotated token too,
  so on-demand activity fetches no longer strand the stored one.
- Live harvester tests for these providers are skipped outside the container
  (`__docs/ai-context/testing.md`).

Set `DAYLIGHT_TOKEN_WRITER=true` only when no other copy (the server) is
refreshing the same account.

## Reconnect Withings

When the Withings refresh token is dead (revoked, expired, or invalidated by
another process), reconnect from the browser:

1. Admin → Integrations → Withings → **Reconnect Withings**.
2. Sign in at Withings and allow access.
3. Withings returns to the callback, the server exchanges the code at once
   (Withings codes expire in about 30 seconds), saves the tokens for the head of
   household and starts a harvest. The page reads "Withings connected".

Routes (admin-only, under `/api/v1/admin/oauth`):

| Route | Does |
|---|---|
| `GET /withings/connect[?user=<username>]` | Creates a one-time state (10 min) and redirects to Withings. `user` defaults to the head of household and must be a household member |
| `GET /withings/callback` | Checks the state, exchanges the code, saves the grant, resets the harvester's auth, starts a harvest |

Setup:

- The callback URL, `https://<public host>/api/v1/admin/oauth/withings/callback`,
  must be registered as a redirect URI in the Withings developer app.
- By default the server builds the callback from the request's host and
  `X-Forwarded-Proto`. When the browser-facing host differs from what the server
  sees (a proxy that rewrites `Host`), set it explicitly in the system auth
  `withings.yml`:

  ```yaml
  connect_redirect_uri: https://{env.domain}/api/v1/admin/oauth/withings/callback
  ```

- The routes are only mounted when the Withings `client_id` and `client_secret`
  are configured; otherwise the log shows `oauth.withings.disabled`.

## Log events

- `harvester.health.pushed` (info), `harvester.health.push_failed`,
  `harvester.health.store_failed`, `harvester.health.record_failed`,
  `harvester.health.no_push_target` (warn)
- `harvest.failed` (warn): an API-triggered harvest answered 502
- `oauth.withings.connected` (info), `oauth.withings.exchange_failed`,
  `oauth.withings.save_failed` (error), `oauth.withings.first_harvest_failed` (warn)
