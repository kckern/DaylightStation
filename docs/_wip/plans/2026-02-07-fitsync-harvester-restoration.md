# FitnessSyncer Harvester Restoration Plan

**Date:** 2026-02-07  
**Status:** Draft  
**Priority:** High — fitness entropy is 14+ days stale because no harvester exists

---

## Problem Statement

During the DDD refactor (commit `4191bfee`), the legacy `harvestActivities()` function from `backend/_legacy/lib/fitsync.mjs` was deleted. The `FitnessSyncerAdapter` was created to encapsulate API interactions (OAuth, circuit breaker, activity fetching), but **no IHarvester wrapper was created** to plug it into the harvester framework.

As a result:
- `/api/v1/harvest/fitsync` returns a 404 or error
- The entropy dashboard shows fitness data as 14+ days stale
- FitnessSyncer activities are not being harvested on any schedule

---

## Architecture Context

### Current Harvester Pipeline

```
bootstrap.mjs → registerHarvester('serviceId', factory)
                     ↓
              HarvesterService.harvest(serviceId, username, options)
                     ↓
              IHarvester.harvest(username, options)
                     ↓
              lifelogStore.save(username, service, data)
```

### What Exists Today

| Component | File | Status |
|-----------|------|--------|
| **FitnessSyncerAdapter** | `backend/src/1_adapters/harvester/fitness/FitnessSyncerAdapter.mjs` | ✅ 571 lines, working |
| **IHarvester interface** | `backend/src/1_adapters/harvester/ports/IHarvester.mjs` | ✅ 101 lines, stable |
| **WithingsHarvester** (pattern reference) | `backend/src/1_adapters/harvester/fitness/WithingsHarvester.mjs` | ✅ Working pattern |
| **Bootstrap registration** | `backend/src/0_system/bootstrap.mjs` lines 2808-2830 | ⚠️ Only strava + withings |
| **FitnessSyncerHarvester** | Does not exist | ❌ **Missing** |

### What the Adapter Already Does

`FitnessSyncerAdapter.mjs` already handles:
- OAuth token refresh with `getAccessToken(username)`
- Circuit breaker pattern (`isInCooldown()`, `recordSuccess()`, `recordFailure()`)
- Source ID lookup (`getSourceId(sourceKey)`)
- Paginated activity fetching (`getActivities({daysBack, sourceKey})`)
- Raw activity transformation in its own `harvest({jobId, daysBack})`

### What's Missing

1. An `IHarvester`-compliant class that wraps the adapter
2. Registration in `bootstrap.mjs`
3. The legacy **summary transformation** that produces the `fitness.yml` format (steps aggregation, activity normalization)

---

## Implementation Plan

### Task 1: Create `FitnessSyncerHarvester.mjs`

**File:** `backend/src/1_adapters/harvester/fitness/FitnessSyncerHarvester.mjs`

**Pattern:** Follow `WithingsHarvester.mjs` structure exactly.

#### Constructor Dependencies

```javascript
constructor({ httpClient, lifelogStore, authStore, configService, timezone, logger }) {
    super();
    this._adapter = new FitnessSyncerAdapter({ httpClient, authStore, configService, logger });
    this._lifelogStore = lifelogStore;
    this._configService = configService;
    this._timezone = timezone || 'America/New_York';
    this._logger = logger;
}
```

#### IHarvester Interface Implementation

```javascript
get serviceId() { return 'fitsync'; }
get category() { return HarvesterCategory.FITNESS; }

async harvest(username, options = {}) {
    // 1. Check circuit breaker
    // 2. Fetch raw activities via adapter
    // 3. Transform to legacy fitness.yml format (steps + activities)
    // 4. Merge with existing lifelog data
    // 5. Save via lifelogStore.save(username, 'fitness', data)
    // 6. Save raw archive via lifelogStore.save(username, 'archives/fitness_long', archive)
}

async getStatus() {
    return { available: !this._adapter.isInCooldown() };
}

getParams() {
    return { daysBack: { type: 'number', default: 7, description: 'Days of history to fetch' } };
}
```

#### Legacy Summary Transformation Logic

This is the critical piece that was lost. The legacy code transformed raw FitnessSyncer items into a date-keyed summary:

```javascript
// For each activity from the API:
const date = moment(activity.date).tz(timezone).format('YYYY-MM-DD');

if (activity.activity === 'Steps') {
    // Aggregate into steps summary
    onFile[date].steps = {
        steps_count: accumulated_steps,
        bmr: accumulated_bmr,
        duration: parseFloat((accumulated_minutes).toFixed(2)),     // converted from seconds
        calories: parseFloat((accumulated_calories).toFixed(2)),
        maxHeartRate: Math.max(existing, activity.maxHeartrate || 0),
        avgHeartRate: parseFloat((accumulated_avg).toFixed(2))
    };
} else {
    // Push to activities array
    onFile[date].activities.push({
        title: activity.title || activity.type || '',
        calories: parseFloat((activity.calories || 0).toFixed(2)),
        distance: parseFloat((activity.distance || 0).toFixed(2)),
        minutes: parseFloat((activity.duration / 60 || 0).toFixed(2)),
        startTime: moment(activity.date).tz(timezone).format('hh:mm a'),
        endTime: activity.endDate ? moment(activity.endDate).tz(timezone).format('hh:mm a') : '',
        avgHeartrate: parseFloat((activity.avgHeartrate || 0).toFixed(2)),
        steps: activity.steps || 0,
    });
}
```

#### Raw Archive Format

The legacy code also maintained `archives/fitness_long`:

```javascript
// For each raw API item:
const id = md5(item.itemId);
const date = moment(item.date).tz(timezone).format('YYYY-MM-DD');
archive[date][id] = {
    src: 'garmin',
    id,
    date,
    type: item.activity,
    data: item  // raw item minus GPS data
};
```

**Note:** The `delete item.gps` call removes GPS tracks before archiving (saves space).

#### Incremental Merge Strategy

The legacy code used an anchor-date strategy:
1. Load existing `archives/fitness_long`
2. Find the latest date on file
3. Set anchor = latest - 7 days (overlap for safety)
4. Fetch only items after anchor
5. Merge new items into existing, deduplicating by `md5(itemId)`

The new harvester should do the same with `lifelogStore.load()` / `lifelogStore.save()`.

---

### Task 2: Register in Bootstrap

**File:** `backend/src/0_system/bootstrap.mjs`  
**Location:** Lines ~2808-2830 (Fitness Harvesters section)

Add after the existing strava/withings registrations:

```javascript
// --- FitnessSyncer ---
registerHarvester('fitsync', () => {
    const { default: FitnessSyncerHarvester } = await import(
        '../../1_adapters/harvester/fitness/FitnessSyncerHarvester.mjs'
    );
    return new FitnessSyncerHarvester({
        httpClient,
        lifelogStore,
        authStore,
        configService,
        timezone: configService.get('timezone') || 'America/New_York',
        logger
    });
});
```

**Note:** Check how other harvesters in the same section handle `timezone`. The existing `WithingsHarvester` receives it as a constructor param wired from `configService`.

---

### Task 3: Verify Entropy Configuration

**File:** `data/household/config/entropy.yml` (and/or `data/system/config/entropy.yml`)

Confirm the `fitness` source entry exists and points to `lifelog/fitness`:

```yaml
fitness:
  source: lifelog/fitness
  category: health
  max_age_days: 3
```

This is already configured. No changes needed.

---

### Task 4: Testing

#### 4a: Unit Test

Create `backend/tests/unit/adapters/harvester/fitness/FitnessSyncerHarvester.test.mjs`:

- Mock `FitnessSyncerAdapter` to return canned activity data
- Verify the summary transformation produces correct `steps` and `activities` format
- Verify deduplication by `md5(itemId)`
- Verify date formatting in configured timezone
- Verify circuit breaker check

#### 4b: Integration Test

Create a script (like the weight processor test) to run the full pipeline:

```bash
DAYLIGHT_DATA_PATH=~/Library/CloudStorage/Dropbox/Apps/DaylightStation/data \
  node scripts/_wip/2026-02-07-test-fitsync-harvester.mjs
```

The test script should:
1. Instantiate FitnessSyncerHarvester with real adapter
2. Call `harvest(username)` 
3. Print summary: dates harvested, total activities, total step-days
4. Verify the output matches the legacy format by spot-checking a known date

#### 4c: API Endpoint Test

After server restart:
```bash
curl http://localhost:3111/api/v1/harvest/fitsync
```

Expected: Returns harvested data summary, entropy freshness updates.

---

## Key Decisions

### Q1: Should FitnessSyncerHarvester delegate to FitnessSyncerAdapter.harvest() or call getActivities() directly?

**Recommendation:** Call `getActivities()` directly. The adapter's `harvest()` method has its own save logic that doesn't use `lifelogStore`. The harvester needs to control the save path.

Specifically:
- Use `adapter.getAccessToken(username)` for auth
- Use `adapter.getSourceId('GarminWellness')` for source lookup  
- Use `adapter.getActivities({daysBack, sourceKey})` for data fetch
- Handle transformation and saving in the harvester itself

### Q2: Should we keep the adapter's harvest() method?

**Recommendation:** Yes, leave it for now. It may be used by other code paths (CLI, direct API calls). Mark it with a deprecation comment noting that `FitnessSyncerHarvester.harvest()` is the canonical path.

### Q3: What about the `archives/fitness_long` save?

**Recommendation:** Keep it. The raw archive is valuable for:
- Debugging transformation issues
- Replaying history if the summary format changes
- Accessing GPS and other fields stripped from the summary

Save it as a second `lifelogStore.save(username, 'archives/fitness_long', archive)` call.

### Q4: md5 dependency?

The legacy code used `md5(itemId)` for deterministic activity IDs. Check if `md5` is already a project dependency, or use Node's built-in `crypto.createHash('md5').update(str).digest('hex')`.

---

## File Inventory

| Action | File | Lines (est.) |
|--------|------|-------------|
| **Create** | `backend/src/1_adapters/harvester/fitness/FitnessSyncerHarvester.mjs` | ~200 |
| **Modify** | `backend/src/0_system/bootstrap.mjs` (add registration) | +10 |
| **Create** | `backend/tests/unit/adapters/harvester/fitness/FitnessSyncerHarvester.test.mjs` | ~150 |
| **Create** | `scripts/_wip/2026-02-07-test-fitsync-harvester.mjs` | ~50 |

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| OAuth token expired during first test | High | Run `getAccessToken()` manually first, check auth.yml |
| Rate limiting from FitnessSyncer API | Medium | Circuit breaker already in adapter; start with small `daysBack` |
| Data format mismatch with existing fitness.yml | Low | Load existing file, compare keys before overwriting |
| Missing `md5` dependency | Low | Use Node.js built-in `crypto` module |

---

## Execution Order

1. **Create FitnessSyncerHarvester.mjs** — the core deliverable
2. **Register in bootstrap.mjs** — wire it into the framework
3. **Create test script** — validate against live API
4. **Test with small daysBack** — `{ daysBack: 3 }` first
5. **Verify entropy** — restart server, check `/api/v1/home/entropy`
6. **Full backfill** — run with `{ daysBack: 30 }` or more
7. **Create unit tests** — formalize the transformation logic tests

---

## Reference Code

### Legacy file (deleted at commit 4191bfee)
```
git show 4191bfee~1:backend/_legacy/lib/fitsync.mjs
```

### IHarvester interface
```
backend/src/1_adapters/harvester/ports/IHarvester.mjs
```

### WithingsHarvester (pattern reference)
```
backend/src/1_adapters/harvester/fitness/WithingsHarvester.mjs
```

### FitnessSyncerAdapter (existing adapter to wrap)
```
backend/src/1_adapters/harvester/fitness/FitnessSyncerAdapter.mjs
```

### Bootstrap harvester registration
```
backend/src/0_system/bootstrap.mjs  (lines 2590-2830)
```
