# Fitness Session Timezone & Media Duration Fix

## Problem

### Timezone Bug
`toReadable()` in `PersistenceManager.js:66-71` ignores its `timezone` parameter and uses `toISOString()`, which always outputs UTC. This means:

- **SessionId** (e.g., `20260213185600`) = local browser time (correct)
- **Folder date** (e.g., `2026-02-13/`) = derived from sessionId (correct)
- **`session.start`** (e.g., `"2026-02-14 02:56:00.274"`) = UTC (wrong — should be `"2026-02-13 18:56:00.274"`)

Two eras of data exist:
- **Phase 1 (Jan 1-3, 9 sessions):** Both sessionId and `session.start` use local time. Consistent.
- **Phase 2 (Jan 6+, 38 sessions):** `session.start`/`session.end` switched to UTC. 8-hour offset from sessionId time. Evening sessions cross midnight, producing wrong dates.

### Media Duration Gap
Media events record `start` timestamp but `end` is always `null`, so all `durationMs` values compute to 0. Duration can be inferred from gaps between consecutive media start times and the session end time.

## Design

### 1. Fix `toReadable()` (forward fix)

Replace the UTC-only implementation with one that honors the timezone parameter using `Intl.DateTimeFormat`:

```js
const toReadable = (unixMs, timezone) => {
  if (!Number.isFinite(unixMs)) return null;
  const tz = timezone || Intl?.DateTimeFormat?.()?.resolvedOptions?.()?.timeZone || 'UTC';
  const d = new Date(unixMs);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find(p => p.type === type)?.value;
  const ms = String(d.getTime() % 1000).padStart(3, '0');
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}.${ms}`;
};
```

No external dependencies (no moment-timezone). Uses built-in Intl API.

### 2. Backfill Script

**File:** `cli/scripts/backfill-session-timestamps.mjs`

Per session:

1. **Detect phase:** Compare hour from sessionId against hour in `session.start`. If they match, session is Phase 1 (skip timezone fix). If offset, session is Phase 2 (needs fix).

2. **Timezone fix (Phase 2 only):** Parse `session.start` as UTC, reformat in session's timezone. Same for `session.end`. Update `session.date` to match the corrected date.

3. **Media duration inference (all sessions):** Sort media events by `start` timestamp. For consecutive media events A, B: `A.end = B.start`. For the last media event: `end = session end timestamp`. Compute `durationMs = end - start` for each.

4. **Re-compute summary:** Call `buildSessionSummary()` with decoded series + corrected events to update the summary block (media durations affect primary flag selection).

Dry-run by default, `--write` to persist.

### 3. Frontend Impact

The `toLocaleTimeString` call in `DashboardWidgets.jsx` already passes `s.timezone` (added in the previous change). Once session.start values are corrected, the `parseToUnixMs` function in `YamlSessionDatastore.mjs` will parse them correctly in the session's timezone, producing correct epoch milliseconds for the API.

## Files Modified

| File | Change |
|------|--------|
| `frontend/src/hooks/fitness/PersistenceManager.js` | Fix `toReadable()` to use timezone via Intl API |
| `cli/scripts/backfill-session-timestamps.mjs` | **NEW** — backfill timezone + media durations + re-compute summaries |

## Implementation Order

1. Fix `toReadable()` in PersistenceManager.js
2. Create backfill script
3. Dry-run backfill, verify output
4. Run backfill with `--write`
5. Verify API response shows correct times
