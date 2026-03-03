# UTC & Timezone System Audit

**Date:** 2026-03-02
**Scope:** Full-stack — infrastructure, backend, frontend, data layer, logging, tests

---

## Executive Summary

The system is configured for `America/Los_Angeles` at all infrastructure layers (host, Docker container, app config). However, there are **5 critical inconsistencies** and several secondary issues in how timestamps are generated, stored, and interpreted across the stack.

| Severity | Count | Description |
|----------|-------|-------------|
| Critical | 2 | ConfigService default mismatch; LastfmExtractor hardcoded TZ |
| High | 3 | Logging TZ hack; media memory ambiguity; `.split('T')[0]` on UTC |
| Medium | 4 | Test mock defaults; calendar fixture ambiguity; inconsistent frontend patterns; fitness UTC fallback |
| Low | 3 | Duration display hack; CLI date extraction; Strava webhook comment |

---

## 1. Infrastructure Layer

### Host (homeserver.local)

| Setting | Value |
|---------|-------|
| `/etc/timezone` | `America/Los_Angeles` |
| `timedatectl` | `America/Los_Angeles (PST, -0800)` |
| `$TZ` env var | *(not set — relies on /etc/timezone)* |
| NTP | active, synchronized |
| `date` output | `Mon Mar 2 08:24:07 PM PST 2026` |

### Docker Container (daylight-station)

| Setting | Value |
|---------|-------|
| `$TZ` env var | `America/Los_Angeles` |
| `/etc/timezone` | *(not present)* |
| `/etc/localtime` | *(not present)* |
| `date` output | `Mon Mar 2 20:24:08 PST 2026` |
| Dockerfile default | `ARG TZ=America/Los_Angeles` |
| entrypoint.sh | Reads `system.yml` timezone, overrides `$TZ` |

**Assessment:** Infrastructure is consistent. Container relies solely on `$TZ` env var (no `/etc/timezone` or `/etc/localtime`), which is fine for Node.js but could cause issues for any native tools that check those files.

---

## 2. Application Configuration

### Timezone Configuration Hierarchy

```
Docker ARG TZ=America/Los_Angeles
  └─ entrypoint.sh reads system.yml → export TZ=
     └─ ConfigService.getTimezone() → system.timezone ?? 'America/Los_Angeles'
        └─ ConfigService.getHouseholdTimezone(hid) → household.timezone ?? system.timezone ?? 'UTC'
```

### CRITICAL: ConfigService Default Mismatch

**File:** `backend/src/0_system/config/ConfigService.mjs`

| Method | Line | Default | Used By |
|--------|------|---------|---------|
| `getTimezone()` | 519 | `'America/Los_Angeles'` | System-wide operations |
| `getHouseholdTimezone(hid)` | 93 | `'UTC'` | Per-household operations |

When no household timezone is configured AND no system timezone is configured, these two methods return **different values**. Any code choosing between them will get inconsistent results.

**Impact:** `GratitudeHouseholdService` (line 51-53) checks `if (timezone !== 'UTC')` — if household defaults to UTC, this silently skips timezone conversion for households that actually are in Los_Angeles.

### CRITICAL: LastfmExtractor Hardcoded Timezone

**File:** `backend/src/2_domains/lifelog/extractors/LastfmExtractor.mjs:17`
```javascript
const USER_TIMEZONE = 'America/Denver';
```

This is hardcoded instead of reading from ConfigService. All other extractors use configured timezones.

---

## 3. Backend Timestamp Patterns

### 3a. Time Utility Libraries

Two parallel implementations exist:

| Layer | File | Purity | Default TZ |
|-------|------|--------|------------|
| System | `backend/src/0_system/utils/time.mjs` | Imperative (`new Date()` defaults) | `America/Los_Angeles` |
| Domain | `backend/src/2_domains/core/utils/time.mjs` | Pure (requires explicit date param) | `America/Los_Angeles` |

Both use `Intl.DateTimeFormat` with explicit `timeZone` parameter — this is correct.

### 3b. Logging Timestamps

**HIGH: Logging uses `getTimezoneOffset()` hack**

**Files:** `backend/src/0_system/logging/dispatcher.mjs:12-18`, `logger.mjs:17-22`
```javascript
const offset = now.getTimezoneOffset() * 60000;
const localTime = new Date(now - offset);
return localTime.toISOString().slice(0, -1);  // removes Z
```

This creates a "fake local" ISO string by offsetting the UTC date. Problems:
- Uses machine-local offset, NOT the configured system timezone
- DST transitions can cause the offset to be wrong during the transition hour
- The resulting string has no timezone indicator (ambiguous)

Falls back to `Intl.DateTimeFormat` with `timeZone: globalTimezone` if configured (line 23-38), but the initial code path runs first.

### 3c. Correct UTC Usage

These intentionally use UTC and are correct:

| File | Purpose |
|------|---------|
| `2_domains/cost/value-objects/BudgetPeriod.mjs` | Financial period calculations (timezone-independent) |
| `2_domains/finance/services/MortgageCalculator.mjs` | Rate calculations with explicit UTC comment |
| `1_adapters/content/query/QueryAdapter.mjs` | Date range boundaries for content search |
| `1_adapters/feed/RssHeadlineHarvester.mjs` | Normalizing RSS timezone offsets to UTC |

### 3d. Correct Timezone-Aware Usage

These read timezone from config and handle it properly:

| File | Method |
|------|--------|
| `1_adapters/persistence/yaml/YamlSessionDatastore.mjs` | Reads `data.timezone` per session |
| `3_applications/fitness/services/SessionService.mjs` | Falls back chain: `options.timezone → session.timezone → 'UTC'` |
| `1_adapters/harvester/productivity/TodoistHarvester.mjs` | `moment.tz(this.#timezone)` |
| `1_adapters/harvester/communication/GCalHarvester.mjs` | Reads from ConfigService |

### 3e. `.split('T')[0]` Pattern (30+ occurrences)

**HIGH: Extracting date from UTC ISO string without timezone conversion**

```javascript
new Date().toISOString().split('T')[0]  // YYYY-MM-DD in UTC
```

Found in 30+ locations across backend and CLI. This extracts the **UTC date**, which differs from the local date between midnight and the UTC offset (e.g., 4-8 PM PST = next day in UTC).

**Affected files include:**
- `GmailAdapter.mjs:204,254`
- `ReviewJournalEntries.mjs:107,118`
- `NutriLog.mjs:62,68`
- `FoodLogService.mjs:200`
- `HealthAggregationService.mjs:30`
- `FitnessActivityEnrichmentService.mjs:373`
- `DailyDashboard.mjs:86,170`
- `cli/audit/baseline.mjs:45,118,135`
- `cli/audit/report.mjs:16,219`

**Impact:** After 4 PM PST (midnight UTC), these return tomorrow's date. For daily aggregations, this means events near midnight could be assigned to the wrong day.

### 3f. Other Backend Issues

| File | Issue | Severity |
|------|-------|----------|
| `backend/index.js:15,20` | Crash logs use `toISOString()` (UTC) with no context | Low |
| `1_adapters/strava/StravaWebhookJobStore.mjs:40` | `receivedAt: new Date().toISOString()` — UTC, undocumented | Low |
| `4_api/v1/routers/admin/config.mjs:94,213` | File `mtime.toISOString()` — OS-dependent interpretation | Low |
| `1_rendering/fitness/FitnessReceiptRenderer.mjs:98` | Falls back to `'UTC'` when no session timezone | Medium |

---

## 4. Frontend Timestamp Patterns

### 4a. Logging Framework — UTC

**Files:** `frontend/src/lib/logging/Logger.js:84`, `index.js:200`
```javascript
ts: new Date().toISOString()  // Always UTC with Z suffix
```

Log file names also use UTC: `2026-03-01T21-08-13.jsonl`

**Assessment:** Correct for log aggregation. UTC is the right choice for structured logs.

### 4b. Fitness Session Persistence — Timezone-Aware

**File:** `frontend/src/hooks/fitness/PersistenceManager.js:66-89`

Uses `Intl.DateTimeFormat.formatToParts()` with explicit timezone. Resolves timezone via:
```
Intl.DateTimeFormat().resolvedOptions().timeZone → 'UTC' fallback
```

**File:** `frontend/src/hooks/fitness/FitnessSession.js:51-64`

Uses `moment-timezone` with:
```
Intl → moment.tz.guess() → 'UTC' fallback
```

**File:** `frontend/src/hooks/fitness/SessionSerializerV3.js:14-17`
```javascript
static formatTimestamp(unixMs, timezone) {
  const tz = timezone || 'UTC';
  return moment(unixMs).tz(tz).format('YYYY-MM-DD H:mm:ss');
}
```

**Assessment:** Good — timezone is resolved at persist-time and stored in session metadata.

### 4c. Display Components — Mixed Patterns

**Timezone-aware (correct):**
- `ClockDisplay.jsx` — Accepts `timezone` prop, uses `Intl.DateTimeFormat`
- `FitnessSessionDetailWidget.jsx` — Conditional `timeZone` in `toLocaleTimeString()`

**Local-only (no explicit timezone):**
- `Time.jsx` — Uses `getHours()`, `getMinutes()`, `getSeconds()` (browser local)
- `FitnessSessionsWidget.jsx` — Uses `getFullYear()`, `getMonth()`, `getDate()`

**Assessment:** Display components that show the current time using browser-local are fine (the browser IS the local timezone). Session-related displays correctly use stored timezone.

### 4d. Duration Display Hack

**File:** `frontend/src/modules/Fitness/widgets/ComponentShowcase/components/QuickToolsDrawer.jsx:73`
```javascript
new Date(elapsedStopwatch).toISOString().substr(11, 8)
```

Uses `toISOString()` on a duration (not a date) to extract `HH:MM:SS`. Works because durations < 24h map to UTC time-of-day. Fragile but functionally correct.

**File:** `frontend/src/modules/Player/lib/helpers.js:23`
```javascript
moment.utc(seconds * 1000).format(...)
```

Same pattern — `moment.utc()` for duration formatting, not date conversion.

---

## 5. Data Layer Timestamp Formats

### Stored Data Inventory

| Data Type | Location | Format | UTC? | Timezone Info |
|-----------|----------|--------|------|---------------|
| Menu memory | `history/menu_memory.yml` | Unix seconds | Yes (epoch) | Implicit |
| Media memory | `history/media_memory/**/*.yml` | `YYYY-MM-DD HH:MM:SS` | **No** (local) | **None stored** |
| Fitness sessions | `history/fitness/**/*.yml` | `YYYY-MM-DD HH:mm:ss.SSS` | **No** (local) | `timezone:` field |
| Fitness events | `history/fitness/**/*.yml` | Unix milliseconds | Yes (epoch) | Implicit |
| App logs | `media/logs/**/*.jsonl` | ISO 8601 with `Z` | Yes | Explicit (`Z` suffix) |
| Vibration logs | `media/logs/vibration/*.jsonl` | Unix milliseconds | Yes (epoch) | Implicit |

### HIGH: Media Memory — Ambiguous Timestamps

**File:** `history/media_memory/scriptures.yml` (and similar)
```yaml
lastPlayed: '2026-02-22 07:47:10'
```

No timezone indicator. These are local time (`America/Los_Angeles`) but nothing in the data says so. If the system timezone ever changed, these timestamps would be silently reinterpreted in the new timezone.

### Fitness Sessions — Good Pattern

```yaml
start: '2026-01-19 12:39:57.025'
end: '2026-01-19 13:15:47.025'
timezone: America/Los_Angeles
```

Timestamps are local time with explicit `timezone` field. Event-level timestamps within sessions use Unix milliseconds (epoch-based, inherently UTC).

---

## 6. Test & CI Patterns

### Mock Config Defaults

**File:** `tests/_fixtures/config/mockConfigs.mjs`
- Default mock config: `timezone: 'UTC'`
- Multi-user mock config: `timezone: 'America/Los_Angeles'`

**Issue:** Default test timezone (`UTC`) doesn't match production default (`America/Los_Angeles`). Tests may pass with UTC but fail with real timezone due to date boundary differences.

### Calendar Test Fixture Ambiguity

**File:** `tests/_infrastructure/generators/calendar.generator.mjs:138-139`
```javascript
dateTime: formatCalendarDateTime(startDate),  // → .toISOString() (UTC)
timeZone: 'America/Los_Angeles',              // Contradicts UTC dateTime
```

The `dateTime` is UTC but `timeZone` says Los_Angeles. Google Calendar API interprets this as "the dateTime is in the specified timeZone", so the actual time would be wrong.

### Test Date Extraction

Tests widely use `new Date().toISOString().split('T')[0]` for date extraction — same UTC date-shift issue as production code, but less impactful since tests run deterministically.

---

## 7. Known Historical Issues (Resolved)

### Fitness Session UTC Bug (FIXED)

**Doc:** `docs/_wip/plans/2026-02-15-fitness-session-timezone-fix.md`

Phase 2 sessions (Jan 6+) had `session.start`/`session.end` stored as UTC instead of local time (8-hour offset). Fixed via:
1. `PersistenceManager.toReadable()` now uses `Intl.DateTimeFormat` with timezone
2. Backfill script corrected existing data

### compactItem Drops Date Objects (OPEN)

**Doc:** `docs/_wip/bugs/2026-03-02-compactitem-drops-date-objects.md`

`js-yaml` parses unquoted timestamps as `Date` objects. `compactItem()` drops them because `Object.keys(new Date())` returns `[]`. Workaround: quote timestamps in YAML. Fix needed: add `instanceof Date` check.

---

## 8. Findings Summary

### Critical (Fix Required)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| C1 | `getHouseholdTimezone()` defaults to `'UTC'` while `getTimezone()` defaults to `'America/Los_Angeles'` | `ConfigService.mjs:93 vs :519` | Silent wrong-timezone for all household operations when no explicit TZ configured |
| C2 | LastfmExtractor hardcodes `'America/Denver'` | `LastfmExtractor.mjs:17` | Last.fm scrobbles assigned to wrong day near midnight |

### High (Should Fix)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| H1 | Logging uses `getTimezoneOffset()` hack instead of configured TZ | `dispatcher.mjs:12-18`, `logger.mjs:17-22` | Log timestamps don't match system timezone during DST transitions |
| H2 | Media memory stores local time with no timezone indicator | `history/media_memory/**/*.yml` | Timestamps become ambiguous if system TZ ever changes |
| H3 | `.toISOString().split('T')[0]` extracts UTC date (30+ occurrences) | Multiple backend + CLI files | Wrong date returned after 4 PM PST (midnight UTC) |

### Medium (Should Review)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| M1 | Test mock config defaults to `'UTC'` instead of `'America/Los_Angeles'` | `mockConfigs.mjs:14` | Tests may not catch timezone-related bugs |
| M2 | Calendar fixture has UTC dateTime with LA timezone field | `calendar.generator.mjs:138-139` | Test data may not reflect real Google Calendar behavior |
| M3 | Frontend time display uses `getHours()` (browser local) inconsistently with `Intl.DateTimeFormat` | Various display components | Not a bug (browser IS local) but inconsistent pattern |
| M4 | Fitness fallback to `'UTC'` when no timezone set | `SessionService.mjs`, `FitnessReceiptRenderer.mjs` | Historical sessions without timezone field render in UTC |

### Low (Cosmetic / Documentation)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| L1 | Duration display via `toISOString().substr(11,8)` | `QuickToolsDrawer.jsx:73` | Works but fragile for durations > 24h |
| L2 | CLI date extraction via `.toISOString().split('T')[0]` | `cli/audit/*.mjs` | Audit dates could be off by 1 day after 4 PM PST |
| L3 | Strava webhook `receivedAt` undocumented as UTC | `StravaWebhookJobStore.mjs:40` | No practical impact but unclear |

---

## 9. Recommendations

### Immediate (C1, C2)

1. **Align ConfigService defaults** — Change `getHouseholdTimezone()` fallback from `'UTC'` to `this.getTimezone()` so it inherits the system default
2. **Remove LastfmExtractor hardcoded timezone** — Read from ConfigService like all other extractors

### Short-Term (H1, H3)

3. **Fix logging timestamp** — Replace `getTimezoneOffset()` hack with `Intl.DateTimeFormat` using `ConfigService.getTimezone()`
4. **Create `getLocalDateString()` utility** — Replace all `.toISOString().split('T')[0]` with a timezone-aware date extraction function from `core/utils/time.mjs`

### Medium-Term (H2, M1)

5. **Add timezone field to media memory** — Or document that these are always system-local
6. **Align test mock timezone** — Default to `'America/Los_Angeles'` to match production

### Documentation

7. **Document timestamp conventions** — Add a section to `coding-standards.md` specifying:
   - Logs: UTC (toISOString)
   - Persisted user-facing timestamps: local time + timezone field
   - Epoch timestamps: Unix ms for events, Unix seconds for menu memory
   - Never extract date from UTC ISO string without timezone conversion
