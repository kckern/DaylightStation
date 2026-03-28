# Nutribot Coaching Data Audit

> Full audit of nutribot coaching data paths, persistence, and legacy cruft

**Date:** 2026-03-27
**Scope:** HealthCoachAgent coaching data persistence, legacy NutriCoach system, goal propagation, field consistency
**Key files:**
- `backend/src/1_adapters/persistence/yaml/YamlHealthDatastore.mjs`
- `backend/src/3_applications/nutribot/NutribotContainer.mjs`
- `backend/src/0_system/bootstrap.mjs`
- `data/system/config/nutribot.yml`

---

## Executive Summary

The nutribot coaching subsystem had **four distinct bugs** that conspired to make health coaching data effectively non-functional: a path mismatch that silently discarded all but the most recent coaching message, a stale NutriCoach system that was still wired into bootstrap, goals that never reached the coach, and a field name mismatch in coaching history retrieval. All four have been fixed. Three legacy files remain as dead code and should be deleted.

---

## Bugs Found and Fixed

### 1. Path Mismatch in YamlHealthDatastore (Critical)

**File:** `backend/src/1_adapters/persistence/yaml/YamlHealthDatastore.mjs`

| Method | Path Before Fix | Path After Fix |
|--------|----------------|----------------|
| `loadCoachingData()` | `lifelog/health_coaching` | `health_coaching` |
| `saveCoachingData()` | `health_coaching` | `health_coaching` (unchanged) |

**Impact:** Every `loadCoachingData()` call returned `{}` because it read from a non-existent subdirectory. The save path was correct, so data was written to `data/users/kckern/health_coaching.yml`, but the next save would start from an empty object and overwrite everything. Only the most recent coaching message survived.

**Fix:** Changed `loadCoachingData` to read from `health_coaching` (matching the save path).

### 2. Goals Not Reaching Health Coach (High)

**Symptom:** The health coach's `get_user_goals` tool only read from `data/users/{userId}/agents/health-coach/goals.yml`, which had no calorie information. The user's actual calorie targets (`calories_min: 1200, calories_max: 1600`) lived in `data/users/{userId}/profile.yml` under `apps.nutribot.goals`.

**Impact:** The coach gave dietary advice based on missing/wrong calorie targets.

**Fix:**
- Updated `goals.yml` to include calorie targets
- Enhanced `get_user_goals` tool in `DashboardToolFactory` to also pull nutrition goals from user profile via `ConfigService` as a fallback

### 3. Coaching History Field Mismatch (Medium)

**File:** `DashboardToolFactory` (`get_coaching_history` tool)

| Operation | Field Used | Actual Field in Data |
|-----------|-----------|---------------------|
| `log_coaching_note` (write) | `text` | `{ type, text, timestamp }` |
| `get_coaching_history` (read) | `message` | Should be `text` |

**Impact:** Coach could write notes but could never read them back. History always appeared empty.

**Fix:** Updated `get_coaching_history` to read `entry.text || entry.message` for backward compatibility. Also expanded the note type enum to accept assignment IDs (e.g., `end-of-day-report`) in addition to the original `observation/milestone/recommendation` values.

### 4. Coaching Message Logging (Low)

**Symptom:** No structured logging when coaching messages were delivered or persisted.

**Fix:** Added structured log events to `HealthCoachAgent`:
- `coaching.delivered` -- message sent to user
- `coaching.persisted` -- message saved to datastore
- `coaching.message` -- full text of coaching message
- `coaching.suppressed` -- message generation skipped

---

## Legacy NutriCoach System (Retired)

The original NutriCoach system predates the current HealthCoachAgent. It used a separate datastore, port interface, and config path. The system was partially decommissioned but left wiring artifacts in bootstrap and config.

### Cleanup Already Applied

| Change | File |
|--------|------|
| Removed `YamlNutriCoachDatastore` import + instantiation | `backend/src/0_system/bootstrap.mjs` |
| Removed `nutriCoachStore` dependency injection | `NutribotContainer` wiring |
| Marked `getNutricoachPath()` as deprecated | `NutriBotConfig` |
| Removed `nutricoach` from `data_paths` | `data/system/config/nutribot.yml` |

### Files Still Needing Deletion

These are dead code with zero imports or references:

| File | What It Was | Why Delete |
|------|-------------|------------|
| `backend/src/1_adapters/persistence/yaml/YamlNutriCoachDatastore.mjs` | Adapter that wrote to `household[-{id}]/apps/nutrition/nutricoach.yml` | No longer imported anywhere; target directory never existed |
| `backend/src/3_applications/nutribot/ports/INutriCoachDatastore.mjs` | Port interface for the above adapter | Dead interface, no implementors |
| `data/users/kckern/lifelog/nutrition/nutricoach.yml` | Stale coaching data, last entry 2026-01-22 | Superseded by `health_coaching.yml` |

### Export Cleanup

| File | Action |
|------|--------|
| `backend/src/3_applications/nutribot/ports/index.mjs` | Remove `INutriCoachDatastore` re-export |

---

## Current Data Path Map

| What | Path | Status |
|------|------|--------|
| Coaching data (HealthCoachAgent) | `data/users/{userId}/health_coaching.yml` | **ACTIVE** -- path mismatch fixed |
| Agent goals | `data/users/{userId}/agents/health-coach/goals.yml` | **ACTIVE** -- now includes calorie targets |
| User profile goals (SSOT) | `data/users/{userId}/profile.yml` -> `apps.nutribot.goals` | **ACTIVE** -- source of truth for nutrition goals |
| Old coaching data (NutriCoach) | `data/users/{userId}/lifelog/nutrition/nutricoach.yml` | **STALE** -- last entry 2026-01-22, safe to delete |
| Old coaching data (household) | `data/household/apps/nutrition/nutricoach.yml` | **NEVER EXISTED** -- config pointed here but directory was never created |

---

## Goal Duplication

Nutrition goals currently live in two places:

1. **`profile.yml`** (`apps.nutribot.goals`) -- the SSOT, used by `NutriBotConfig.getUserGoals()` for running total display
2. **`agents/health-coach/goals.yml`** -- read by the `get_user_goals` tool, now also includes calorie targets

The `get_user_goals` tool now falls back to `profile.yml` via `ConfigService`, so the goals in `goals.yml` are supplementary rather than critical. However, having calorie targets in two files creates a drift risk.

---

## Recommendations

### Immediate (Cleanup)

1. **Delete dead files:** Remove the three files listed in "Files Still Needing Deletion" above
2. **Clean exports:** Remove `INutriCoachDatastore` re-export from `ports/index.mjs`
3. **Remove deprecated method:** Delete `NutriBotConfig.getNutricoachPath()` (marked deprecated, no callers)

### Short-Term

4. **Consolidate goals:** Make `profile.yml` the single source of truth for ALL nutrition goals. Remove calorie targets from `agents/health-coach/goals.yml` and update `get_user_goals` to read exclusively from `ConfigService`/profile
5. **Verify coaching data recovery:** Check whether any valuable coaching history was lost during the path mismatch period. If `health_coaching.yml` only has the last message, consider whether the old `nutricoach.yml` data (through 2026-01-22) is worth migrating for historical continuity

### Long-Term

6. **Add integration test:** A round-trip test that writes coaching data via `log_coaching_note` and reads it back via `get_coaching_history`, confirming field names and paths match
7. **Path consistency audit:** The pattern of `loadX` and `saveX` using different subpaths is a systemic risk in `YamlHealthDatastore`. Audit all load/save pairs in that file for similar mismatches
