# Fitness Session Media Data Backfill Plan

**Date:** 2026-02-28
**Scope:** Correct media duration and end-timestamp data in affected fitness session YAML files
**Prerequisites:** Code fixes for Bug A (`normalizeDuration`) and Bug B (`_closeOpenMedia`) must be deployed first

---

## Overview

Three categories of session data need backfilling. Each has different data sources, affected session counts, and risk levels.

| Category | Affected Sessions | Data Source | Risk |
|----------|------------------|-------------|------|
| Bug A: stale `durationSeconds` | 3 workout + 5 gaming | Plex API metadata | Low |
| Bug B: missing `end` timestamp | 7 sessions | Computed from session end time | Low |
| Bug C: legacy missing `durationMs` | ~450 sessions (2021–2022) | Plex API or `duration_seconds` | Low (historical) |

---

## Bug A Backfill: Correct `durationSeconds` in Timeline Events

### What to fix

Timeline events with `type: media` have `durationSeconds` set to Plex metadata placeholders (e.g., `2`, `10`, `15`, `17`) instead of real media durations.

### Affected sessions (confirmed from prod YAML)

| Session | ContentId | Current `durationSeconds` | Expected Source |
|---------|-----------|--------------------------|-----------------|
| `20260224124137` | `plex:10551` (Sculpt A) | `2` | Plex `/api/v1/info/plex/10551` |
| `20260225053400` | `plex:600161` (Saturday Special) | `2` | Plex `/api/v1/info/plex/600161` |
| `20260227054558` | `plex:664558` (Total Body Tempo) | `2` | Plex `/api/v1/info/plex/664558` |
| `20260223185457` | `plex:606442` (Mario Kart 8) | `10` | Session duration or keep as-is |
| `20260224190930` | `plex:606442` (Mario Kart 8) | `10` | Session duration or keep as-is |
| `20260225181217` | `plex:606442` (Mario Kart 8) | `10` | Session duration or keep as-is |
| `20260225181217` | `plex:649319` (Mario Kart 8 Deluxe) | `15` | Session duration or keep as-is |
| `20260226185825` | `plex:649319` (Mario Kart 8 Deluxe) | `17` | Session duration or keep as-is |

**Note:** Gaming sessions (Mario Kart) don't have a fixed duration — they run for the whole session. For these, `durationSeconds` should be set to `session.duration_seconds` or left as the `end - start` of the media event. The `2`, `10`, `15`, `17` values are all Plex season/episode placeholders.

### Data sources

1. **Plex API** — `GET /api/v1/info/plex/{id}` returns `metadata.duration` (in ms)
2. **Session YAML** — `session.duration_seconds` gives the full session length
3. **Timeline event timestamps** — `end - start` gives actual playback time (when `end` exists)

### Backfill strategy

```
For each affected session:
  1. Read the session YAML from prod
  2. For workout videos (P90, 630): fetch duration from Plex API, convert ms→sec
  3. For gaming (Mario Kart): compute from session.duration_seconds
  4. Update the timeline event's durationSeconds field
  5. Update the summary media durationMs field (if durationMs is 0)
  6. Write the corrected YAML back
```

### Summary `durationMs` also needs fixing

Most affected sessions have `durationMs: 0` in the summary media block. This should be:
- For workout videos: the Plex metadata duration (ms)
- For gaming: `(end - start)` from timeline event, or `session.duration_seconds * 1000`

---

## Bug B Backfill: Compute Missing `end` Timestamps

### What to fix

Timeline media events with `end: null` — the last-playing media never received a `media_end` event.

### Affected sessions (confirmed from prod YAML)

| Session | ContentId | `start` | `end` | Fix |
|---------|-----------|---------|-------|-----|
| `20260223185457` | `plex:606442` | `1771901831826` | `null` | Set to session end time |
| `20260224124137` | `plex:10551` | `1771966240844` | `null` | Set to session end time |
| `20260224190930` | `plex:606442` | `1771989003716` | `null` | Set to session end time |
| `20260225053400` | `plex:600161` | `1772026442559` | `null` | Set to session end time |
| `20260225181217` | `plex:606442` | `1772072095953` | `null` | Set to session end time |
| `20260225181217` | `plex:649319` | `1772072133867` | `null` | Set to session end time |
| `20260227054558` | `plex:140612` | `1772201827479` | `1772201827479` (start==end) | Set to session end time |

### Computation

Session end time (unix ms) can be computed from the session YAML:

```
session_end_ms = parseTimestamp(session.start) + (session.duration_seconds * 1000)
```

Or from the `session.end` field directly (it's a human-readable timestamp + timezone).

### Special case: `20260226185825`

This session has `start: 1772161407554, end: 1772161407568` — only 14ms apart. This looks like the `media_end` fired immediately on the same tick, not a missing end. Set to session end time.

---

## Bug C Backfill: Legacy Missing `durationMs` (2021–2022)

### What to fix

~450 sessions from 2021–2022 have `summary.media[]` entries without `durationMs`. These predate the current schema.

### Approach

1. **Scan** all sessions in the `2021-*` and `2022-*` date directories
2. For each session with `summary.media[].durationMs` missing:
   - Look up `contentId` via Plex API for real duration
   - If Plex API unavailable (content deleted), use `session.duration_seconds * 1000`
3. Add `durationMs` to the summary media entry

### Risk assessment

- **Low priority** — these sessions are historical and not actively displayed
- **Plex content may no longer exist** — some 2021 content IDs may have been removed from the Plex server
- **Safe to defer** — these don't affect current functionality

---

## Implementation: Backfill Script

### Location

`cli/backfill-media-durations.mjs` (new file)

### Script outline

```javascript
#!/usr/bin/env node
// Usage: node cli/backfill-media-durations.mjs [--dry-run] [--scope=a|b|c|all]

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const DATA_ROOT = process.env.DATA_PATH || 'data/household/history/fitness';

// Bug A: sessions with known bad durationSeconds
const BUG_A_SESSIONS = {
  '20260224124137': { 'plex:10551': { source: 'plex' } },
  '20260225053400': { 'plex:600161': { source: 'plex' } },
  '20260227054558': { 'plex:664558': { source: 'plex' } },
  // Gaming sessions: use session duration
  '20260223185457': { 'plex:606442': { source: 'session' } },
  '20260224190930': { 'plex:606442': { source: 'session' } },
  '20260225181217': { 'plex:606442': { source: 'session' }, 'plex:649319': { source: 'session' } },
  '20260226185825': { 'plex:649319': { source: 'session' } },
};

// Bug B: sessions with null or start==end in media events
const BUG_B_SESSIONS = [
  '20260223185457', '20260224124137', '20260224190930',
  '20260225053400', '20260225181217', '20260226185825', '20260227054558'
];

async function fetchPlexDuration(plexId) {
  // Strip 'plex:' prefix
  const id = plexId.replace('plex:', '');
  const res = await fetch(`http://localhost:3111/api/v1/info/plex/${id}`);
  const data = await res.json();
  return data?.metadata?.duration; // ms
}

async function backfillBugA(dryRun) {
  for (const [sessionId, contentMap] of Object.entries(BUG_A_SESSIONS)) {
    const dateDir = `${sessionId.slice(0,4)}-${sessionId.slice(4,6)}-${sessionId.slice(6,8)}`;
    const filePath = path.join(DATA_ROOT, dateDir, `${sessionId}.yml`);
    const content = yaml.load(fs.readFileSync(filePath, 'utf8'));

    let changed = false;

    for (const event of content.timeline?.events || []) {
      const cid = event.data?.contentId;
      if (!cid || !contentMap[cid]) continue;

      const spec = contentMap[cid];
      let correctDuration;

      if (spec.source === 'plex') {
        const plexMs = await fetchPlexDuration(cid);
        correctDuration = Math.round(plexMs / 1000);
      } else {
        correctDuration = content.session?.duration_seconds;
      }

      if (correctDuration && event.data.durationSeconds !== correctDuration) {
        console.log(`[Bug A] ${sessionId} ${cid}: ${event.data.durationSeconds} → ${correctDuration}`);
        if (!dryRun) event.data.durationSeconds = correctDuration;
        changed = true;
      }
    }

    // Also fix summary.media[].durationMs
    for (const media of content.summary?.media || []) {
      if (!contentMap[media.contentId]) continue;
      if (!media.durationMs || media.durationMs === 0) {
        // Compute from corrected timeline event
        const evt = (content.timeline?.events || []).find(e => e.data?.contentId === media.contentId);
        if (evt?.data?.durationSeconds) {
          const newMs = evt.data.durationSeconds * 1000;
          console.log(`[Bug A summary] ${sessionId} ${media.contentId}: durationMs ${media.durationMs} → ${newMs}`);
          if (!dryRun) media.durationMs = newMs;
          changed = true;
        }
      }
    }

    if (changed && !dryRun) {
      fs.writeFileSync(filePath, yaml.dump(content, { lineWidth: -1 }));
    }
  }
}

async function backfillBugB(dryRun) {
  for (const sessionId of BUG_B_SESSIONS) {
    const dateDir = `${sessionId.slice(0,4)}-${sessionId.slice(4,6)}-${sessionId.slice(6,8)}`;
    const filePath = path.join(DATA_ROOT, dateDir, `${sessionId}.yml`);
    const content = yaml.load(fs.readFileSync(filePath, 'utf8'));

    // Compute session end time (ms)
    const startStr = content.session?.start;
    const durationSec = content.session?.duration_seconds;
    // Parse the start timestamp and add duration
    const sessionEndMs = new Date(startStr).getTime() + (durationSec * 1000);

    let changed = false;

    for (const event of content.timeline?.events || []) {
      if (event.type !== 'media') continue;
      const end = event.data?.end;
      const start = event.data?.start;

      if (end === null || end === undefined || (end === start && end !== null)) {
        console.log(`[Bug B] ${sessionId} ${event.data?.contentId}: end ${end} → ${sessionEndMs}`);
        if (!dryRun) event.data.end = sessionEndMs;
        changed = true;
      }
    }

    if (changed && !dryRun) {
      fs.writeFileSync(filePath, yaml.dump(content, { lineWidth: -1 }));
    }
  }
}
```

### Execution plan

1. **Deploy code fixes** first (Bug A + Bug B) so new sessions are clean
2. **Run backfill with `--dry-run`** to preview changes
3. **Review dry-run output** — verify each correction makes sense
4. **Run backfill for real** against the prod data directory
5. **Verify** — spot-check corrected YAML files

### Running on prod

Since the data lives at `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/household/history/fitness/` on `{env.prod_host}`, the script must either:
- Run inside the Docker container (preferred — has the data mounted)
- Run on the host directly against the Dropbox path
- Copy files locally, fix, and copy back via SSH

**Recommended:** Run on the host via SSH, targeting the Dropbox path directly.

```bash
ssh {env.prod_host} 'cd /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation && node cli/backfill-media-durations.mjs --dry-run'
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| YAML write corrupts file formatting | Use `js-yaml` dump with `lineWidth: -1`; backup files before write |
| Plex content deleted, API returns 404 | Fallback to `session.duration_seconds`; log and skip |
| Dropbox not syncing | Verify Dropbox is running before and after backfill |
| Wrong session end time computation | Cross-check with actual `session.end` timestamp string |
| Script modifies clean sessions | Explicit allowlists (BUG_A_SESSIONS, BUG_B_SESSIONS) — no bulk scanning |

---

## Verification

After backfill, verify:

```bash
# Check Bug A fixes
for sid in 20260224124137 20260225053400 20260227054558; do
  echo "=== $sid ==="
  grep -A2 'durationSeconds' $DATA_ROOT/.../$sid.yml
done

# Check Bug B fixes
for sid in 20260223185457 20260224124137 20260224190930 20260225053400 20260225181217 20260226185825 20260227054558; do
  echo "=== $sid ==="
  grep 'end:' $DATA_ROOT/.../$sid.yml
done
```

Also re-query the API to verify dashboard displays correctly:
```bash
curl http://localhost:3111/api/v1/fitness/sessions?since=2026-02-23&limit=20 | jq '.[] | {id: .sessionId, media: .media.primary.title, duration: .media.primary.durationMs}'
```
