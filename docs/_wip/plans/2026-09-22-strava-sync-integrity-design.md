# Strava sync integrity — design

**Status:** implemented on `fix/strava-hr-time-axis` (2026-09-22). Reference: `docs/reference/fitness/webhook-enrichment.md`.

## Why

A 2026-09-22 audit found three leaks that had run for months unnoticed:

1. **Nothing checked the output.** Strava-only sessions were written ~5x too
   short (Strava HR samples are not per-second). 38 of 304 were compressed.
2. **Copies were written once and never refreshed.** Session titles, harvester
   archives and the summary froze at their first value; the correct HR logic
   lived in a one-off script and never reached the pipeline.
3. **Failures reached no one.** The hourly reconcile sweep failed 1407 times in
   five days (no auth refresh) and every rename webhook was dropped as "not
   enrichable" — all logged, none read.

Scope: Strava + fitness only. The heartbeat shape is reusable, but no other
pipeline is wired now.

## 1. Save-time integrity check

`checkSessionIntegrity(session)` — pure, `2_domains/fitness/services/sessionIntegrity.mjs`.
Returns `{ ok, violations[] }`:

- **coverage** (Strava-sourced only): `tick_count × interval` within 10% of
  `duration_seconds`.
- **series-length**: every series decodes to exactly `tick_count` entries.
  Sessions with no `tick_count` (legacy) are skipped, not flagged.
- **rings**: `summary.rings.total`, `treasureBox.totalRings` and the last
  `global:rings` value agree, when all are present.

Measured on 2965 real sessions before shipping: 60 hits (1 coverage, 2
series-length, 57 ring mismatches, all home). Home-session violations are
stamped and logged but never alert.

Both save paths call it — `YamlFitnessHistoryRepository.save()` (Strava
pipeline) and `YamlSessionDatastore.save()` (home sessions). On failure the
session is **saved anyway**, stamped `integrity: {ok: false, checkedAt,
violations}`, and `fitness.session.integrity_violation` is logged (warn for
Strava, debug for home sessions, which autosave mid-workout). A
clean save removes the stamp, so a repaired session clears itself. The stamp is
recomputed on every save; nothing persists it separately.

## 2. Hourly repair — reconciliation Pass 4

One builder writes every Strava-derived timeline:
`applyStravaTimeline(session, timeline, username)` in `StravaSessionBuilder`.
The webhook's `_createStravaOnlySession` and Pass 4 both use it.

Pass 4 runs inside the existing hourly sweep, only for `source: strava`
sessions that fail coverage or carry `integrity.ok === false`. It fetches
`heartrate,time`, rebuilds, and applies the **grow-only rule**: write only if
the new timeline has more ticks; otherwise record unresolved drift. Before any
rewrite the repository snapshots the file (`snapshot(sessionId, reason)`) to
`fitness/log-backups/`.
At most 10 rebuilds per sweep. Out of scope: sessions older than the lookback.

## 3. Sync health monitor + push

`StravaSyncHealth` (`3_applications/fitness/StravaSyncHealth.mjs`) keeps a
record per stage and persists it through a store port
(`household/fitness/sync-health.yml`):

| Stage | Success | Stale |
|---|---|---|
| harvest | hourly harvest returns `success` | no success in 3h |
| sweep | sweep authenticates, ≤ half its sessions error | 3 failed sweeps in a row, or no success in 3h |
| webhook | every activity the harvester has seen (started within 48h) has a webhook job | one has been visible for 1h with none |
| integrity | — | a Strava-only session stays flagged > 24h |

Dropped webhook event types are counted and reported.

`evaluate()` runs every 15 min on its own scheduler task (no Strava calls). A
healthy→stale transition sends one push; stale→healthy sends one recovery push
that replaces the card (`tag: strava-sync-{stage}`, `alert_once`). Tags are
per-stage so two different problems don't hide each other. Copy is composed by
`composeStravaSyncPush` in `2_domains/fitness/notifications/`, tested through
`findPushTextDefects`, sent on the Household alerts channel to the head of
household's HA notify service.

`GET /api/v1/fitness/strava/health` returns the stage records and counts.
