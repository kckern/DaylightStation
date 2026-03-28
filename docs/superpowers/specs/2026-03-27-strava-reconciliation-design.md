# Strava Reconciliation Service

**Date:** 2026-03-27
**Status:** Approved

## Problem

The current Strava enrichment flow is one-shot: a webhook fires, the enrichment service matches a session, pushes title+description to Strava, and moves on. This leaves gaps:

- **Missed enrichments:** If the session wasn't saved yet when the webhook fired, the match fails and the activity stays un-enriched forever (retries expire after 3 attempts).
- **Stale enrichments:** If session data changes after enrichment (e.g., voice memo transcribed late, media metadata enriched after save), the Strava description stays stale.
- **Manual Strava notes lost:** Users sometimes type notes directly into Strava descriptions (e.g., "Literally got dunked on."). These are never pulled back into the session YAML, so they're invisible to the DaylightStation UI.

## Design

### Overview

A reconciliation service that scans the last N days of fitness sessions on each Strava webhook. Two passes per session:

1. **Session → Strava:** Re-enrich Strava activities that were missed or have stale descriptions
2. **Strava → Session:** Pull manually-entered Strava descriptions back into session YAMLs as `strava_notes`

### Trigger

Runs as a **non-blocking background task** after each Strava webhook enrichment attempt in `FitnessActivityEnrichmentService._attemptEnrichment()`. Does not delay the webhook response.

### Config

New key in `data/household/config/fitness.yml` under `plex:`:

```yaml
plex:
  reconciliation_lookback_days: 10
```

Default: `10` if not configured.

### 1. `StravaReconciliationService`

**File:** `backend/src/3_applications/fitness/StravaReconciliationService.mjs`

Pure application-layer service. Constructor receives:
- `stravaClient` — shared StravaClientAdapter instance (already authenticated)
- `configService` — for reading fitness config + timezone
- `fitnessHistoryDir` — path to fitness history directory
- `logger`

#### Method: `reconcile()`

Scans all sessions in the lookback window (today minus `reconciliation_lookback_days`). For each date directory, loads each session YAML that has a `strava.activityId` or `participants.*.strava.activityId`.

For each matched session:
1. Fetch the Strava activity (one API call, reused for both passes)
2. Run Pass 1 (session → Strava)
3. Run Pass 2 (Strava → session)
4. Small delay between sessions to respect Strava rate limits (~200ms)

#### Pass 1 — Session → Strava (re-enrichment)

Decision logic based on current Strava state:

| Strava title has em-dash (`—`)? | Strava description empty? | Action |
|---|---|---|
| No | Yes | Fill name + description (new enrichment) |
| No | No | Only fill name if name is empty (manual desc — don't touch) |
| Yes | Yes | Fill description (we set title but desc was missing) |
| Yes | No | Re-run `buildStravaDescription`, update if output differs |

Steps:
1. Run `buildStravaDescription(session, currentActivity, warmupConfig)` to generate the enrichment payload
2. If payload is null, skip
3. Compare generated name/description against current Strava values
4. If identical, skip (no unnecessary API writes)
5. Apply decision logic from table above
6. PUT to Strava API only if there's something new to write

#### Pass 2 — Strava → Session (pull notes)

1. If Strava `description` is non-empty AND session YAML has no `strava_notes` field → write it back
2. Never overwrite existing `strava_notes`
3. Save the session YAML with the new field

#### `strava_notes` shape

New optional field at root level of session YAML (sibling to `summary`):

```yaml
strava_notes:
  text: "Literally got dunked on."
  pulled_at: "2026-03-27T19:30:00Z"
  source: strava_description
```

#### Rate limiting

Strava API: 100 requests per 15 min, 1000 per day. A 10-day window with ~2-3 sessions/day = ~20-30 API calls per reconciliation run. Add ~200ms delay between sessions. Log a warning and abort if approaching rate limits.

#### Staleness tracking

To avoid redundant API calls on subsequent webhook triggers, track a `last_reconciled_at` timestamp per session. Store in the session YAML under `strava.last_reconciled_at`. Skip sessions reconciled within the last hour.

### 2. Integration: `FitnessActivityEnrichmentService`

**File:** `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs`

After a successful enrichment in `_attemptEnrichment()` (after the job is marked complete), fire off reconciliation:

```javascript
// Non-blocking background reconciliation
this.#reconciliationService?.reconcile().catch(err => {
  this.#logger.warn?.('strava.reconciliation.error', { error: err?.message });
});
```

The `StravaReconciliationService` instance is passed into the enrichment service constructor.

### 3. Integration: `app.mjs`

Create and wire the `StravaReconciliationService` alongside the existing enrichment service setup (~line 1300-1335). Pass it into `FitnessActivityEnrichmentService` constructor.

### 4. API/UI: Expose `strava_notes`

**`YamlSessionDatastore`** (`backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs`):
- In the session list builder (`findByDate`), include `strava_notes.text` in the response alongside `voiceMemos`

**Sessions list API response** — add `strava_notes` to the session object:
```json
{
  "sessionId": "20260321091101",
  "voiceMemos": [],
  "stravaNotes": "Literally got dunked on."
}
```

**Frontend `FitnessSessionDetailWidget`** — when displaying memos, merge `voiceMemos` and `stravaNotes` for display. `stravaNotes` shown with a different icon or label (e.g., `📝` instead of `🎙️`).

**`buildStravaDescription`** — when building the description, include `strava_notes.text` alongside voice memos if present. Use `📝` prefix instead of `🎙️`.

### 5. Safety rules

- **NEVER overwrite existing `strava_notes`** in session YAMLs
- **NEVER overwrite manually-entered Strava data** (no em-dash in title = user-set)
- **NEVER re-enrich if generated output is identical** to current Strava state
- **Skip sessions reconciled within the last hour** (staleness check)
- **Abort if approaching Strava rate limits**

## Files Changed

| File | Change |
|------|--------|
| `backend/src/3_applications/fitness/StravaReconciliationService.mjs` | **New** — reconciliation service |
| `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs` | Accept + trigger reconciliation service |
| `backend/src/app.mjs` | Create and wire StravaReconciliationService |
| `backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs` | Include `strava_notes` in list responses |
| `backend/src/1_adapters/fitness/buildStravaDescription.mjs` | Include `strava_notes` in description output |
| `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx` | Display `stravaNotes` alongside voice memos |
| `data/household/config/fitness.yml` | Add `reconciliation_lookback_days` under `plex:` |

## Out of Scope

- Retroactive reconciliation of sessions older than the lookback window
- Two-way sync of voice memos (only Strava descriptions → session, not session memos → Strava notes)
- UI for editing strava_notes
- Reconciliation of non-Strava providers
