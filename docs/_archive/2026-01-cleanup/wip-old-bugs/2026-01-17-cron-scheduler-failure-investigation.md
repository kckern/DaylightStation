# Bug Report: Cron Scheduler Failure - Jobs Not Executing Since Jan 10

**Date Identified:** January 17, 2026  
**Severity:** Critical  
**Component:** `backend/routers/cron.mjs`, `backend/lib/cron/TaskRegistry.mjs`  
**Status:** Open  

---

## Executive Summary

The DaylightStation cron scheduler has not executed any jobs since January 10, 2026. This has resulted in 7 days of stale data across all automated data harvesting processes including weather, calendar, health metrics, and media tracking. The root cause appears to be a state/configuration mismatch following an incomplete migration from bucket-based to individual job scheduling.

---

## Impact Assessment

### Affected Systems

| Domain | Jobs Affected | Data Staleness | User Impact |
|--------|---------------|----------------|-------------|
| **Core** | weather, gcal, todoist, gmail | 7 days | Calendar/task/email sync broken |
| **Health** | withings, strava, garmin, fitsync, health | 7 days | Fitness dashboard stale |
| **Finance** | budget (buxfer) | 7 days | Budget tracking unavailable |
| **Media** | youtube, letterboxd, goodreads | 7 days | Media tracking stale |
| **Social** | foursquare, lastfm, github, reddit | 7 days | Activity tracking stale |
| **System** | archive-rotation, media-memory-validator | 7 days | Archive integrity at risk |

### Business Impact

- **Fitness Dashboard:** Users see week-old workout data
- **Calendar Integration:** Events not syncing to lifestream
- **Budget Tracking:** Financial data out of date
- **Automated Archiving:** Potential data loss risk if archives not rotated

---

## Technical Analysis

### Symptoms Observed

1. **No cron events in production logs**
   - No `cron.scheduler.started` events after container restart
   - No `cron.job.started` or `cron.job.finished` events
   - No `cron.registry.loaded` events in recent logs

2. **Stale runtime state file**
   ```yaml
   # /usr/src/app/data/system/state/cron-runtime.yml
   cron10Mins:
     last_run: '2026-01-10 15:10:03'
     nextRun: '2026-01-10 15:20:00'   # Frozen at Jan 10
   cronHourly:
     last_run: '2026-01-10 14:15:00'
     nextRun: '2026-01-10 15:15:00'
   cronDaily:
     last_run: '2026-01-10 05:00:01'
     nextRun: '2026-01-11 05:00:00'
   cronWeekly:
     last_run: '2026-01-05 06:00:00'
     nextRun: '2026-01-12 06:00:00'
   ```

3. **Container status:** Running for 2 days (restarted ~Jan 15)

### Root Cause Analysis

#### Primary Cause: State/Configuration Schema Mismatch

The cron system was migrated from a **bucket-based model** to an **individual job model**, but the migration was incomplete:

**Legacy Model (cron-jobs.yml):**
```yaml
- name: cron10Mins
  cron_tab: "*/10 * * * *"
  window: 0.5
```
- Jobs grouped into buckets (cron10Mins, cronHourly, cronDaily, cronWeekly)
- Runtime state keyed by bucket name
- Single schedule per bucket

**Modern Model (jobs.yml):**
```yaml
- id: weather
  name: Weather Update
  module: "../lib/weather.mjs"
  schedule: "*/10 * * * *"
```
- Individual job definitions with unique IDs
- Each job has its own schedule
- Supports dependencies between jobs

**The Problem:**
1. `TaskRegistry.mjs` loads jobs from `jobs.yml` (modern format)
2. Runtime state file contains legacy bucket keys (`cron10Mins`, `cronHourly`)
3. `loadCronConfig()` in `cron.mjs` merges by `job.id || job.name`
4. No match found → jobs have `null` last_run and `null` nextRun
5. `computeNextRun()` may fail or produce invalid dates
6. Jobs marked as not needing to run

#### Contributing Factors

1. **Silent Failure:** No error logging when state keys don't match job IDs
2. **Missing Validation:** No schema validation on state file load
3. **Incomplete Migration:** Legacy `cron-jobs.yml` still present alongside `jobs.yml`
4. **No Health Check:** No monitoring to detect cron execution gaps

### Code Flow Analysis

```
┌─────────────────────────────────────────────────────────────────┐
│ Container Startup                                               │
├─────────────────────────────────────────────────────────────────┤
│ 1. TaskRegistry.load()                                          │
│    └── Loads jobs.yml → 21 jobs with IDs like "weather", "gcal" │
│                                                                 │
│ 2. cron.mjs imports TaskRegistry                                │
│    └── Maps jobs into legacy buckets for endpoints              │
│                                                                 │
│ 3. setInterval(cronContinuous, 5000)                            │
│    └── Should start scheduler loop                              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ cronContinuous() - Every 5 Seconds                              │
├─────────────────────────────────────────────────────────────────┤
│ 1. loadCronConfig()                                             │
│    ├── loadCronJobs() → Gets jobs from TaskRegistry             │
│    │   └── Returns: [{id: "weather", ...}, {id: "gcal", ...}]   │
│    │                                                            │
│    └── loadCronState() → Reads cron-runtime.yml                 │
│        └── Returns: {cron10Mins: {...}, cronHourly: {...}}      │
│                                                            ⚠️   │
│    ├── MISMATCH: job.id="weather" vs state key="cron10Mins"     │
│    └── Result: job.last_run = null, job.nextRun = null          │
│                                                                 │
│ 2. For each job without nextRun:                                │
│    └── computeNextRun(job, now) → Sets initial nextRun          │
│                                                                 │
│ 3. Check if job.needsToRun                                      │
│    └── If nextRun <= now → execute job                          │
└─────────────────────────────────────────────────────────────────┘
```

**Hypothesis:** The scheduler may be working but:
- State is never persisted correctly (keys mismatch on write)
- Or scheduler initialization is failing silently
- Or the 5-second interval is not starting

---

## Evidence Collection

### Files Examined

| File | Location | Status |
|------|----------|--------|
| `cron-jobs.yml` | `/usr/src/app/data/system/` | Legacy, should be removed |
| `jobs.yml` | `/usr/src/app/data/system/` | Active, 21 jobs defined |
| `cron-runtime.yml` | `/usr/src/app/data/system/state/` | Stale, legacy format |
| `cron-runtime_bak.yml` | `/usr/src/app/data/system/state/` | Stale backup |
| `cron.mjs` | `backend/routers/` | Scheduler logic |
| `TaskRegistry.mjs` | `backend/lib/cron/` | Job loading logic |

### Log Evidence

```bash
# No cron events found in last 24h
ssh homeserver.local 'docker logs --since 24h daylight-station 2>&1' | grep -E 'cron\.'
# Result: Empty

# Last known cron registry load (from Jan 15 restart)
{"ts":"2026-01-15T01:45:44.688Z","level":"info","event":"cron.registry.loaded","data":{"count":21,"format":"modern"}}
{"ts":"2026-01-15T01:45:44.689Z","level":"info","event":"cron.scheduler.started","data":{"isDocker":true,"interval":5000}}
```

**Note:** Scheduler claims to have started, but no subsequent job execution logs exist.

---

## Remediation Plan

### Phase 1: Immediate Recovery (Do Now)

**Objective:** Restore cron execution within 15 minutes

#### Step 1.1: Backup Current State
```bash
ssh homeserver.local -t 'docker exec daylight-station sh -c "cp /usr/src/app/data/system/state/cron-runtime.yml /usr/src/app/data/system/state/cron-runtime.yml.bak-$(date +%Y%m%d)"'
```

#### Step 1.2: Delete Stale State File
```bash
ssh homeserver.local -t 'docker exec daylight-station sh -c "rm /usr/src/app/data/system/state/cron-runtime.yml /usr/src/app/data/system/state/cron-runtime_bak.yml"'
```

#### Step 1.3: Restart Container
```bash
ssh homeserver.local 'docker restart daylight-station'
```

#### Step 1.4: Verify Recovery
```bash
# Wait 30 seconds, then check logs
ssh homeserver.local 'docker logs --tail 50 daylight-station 2>&1' | grep -E 'cron\.'

# Verify new state file created
ssh homeserver.local -t 'docker exec daylight-station sh -c "cat /usr/src/app/data/system/state/cron-runtime.yml"'
```

**Expected Outcome:**
- `cron.registry.loaded` with count=21
- `cron.scheduler.started` with interval=5000
- New state file with individual job IDs
- Within 10 minutes: `cron.job.started` for 10-min jobs

### Phase 2: Root Cause Fix (This Sprint)

**Objective:** Prevent recurrence through code improvements

#### Step 2.1: Add State Migration Logic

**File:** `backend/lib/cron/TaskRegistry.mjs`

Add automatic migration from legacy state format:

```javascript
/**
 * Migrate legacy bucket-based state to individual job state
 */
migrateState(legacyState, jobs) {
  const bucketMapping = {
    cron10Mins: ['weather', 'gcal', 'todoist', 'gmail'],
    cronHourly: ['withings', 'strava', 'lastfm', 'clickup', 'foursquare', 'budget'],
    cronDaily: ['youtube', 'garmin', 'fitsync', 'health', 'letterboxd', 'goodreads', 
                'github', 'reddit', 'shopping', 'archive-rotation', 'media-memory-validator'],
    cronWeekly: []
  };

  const newState = {};
  
  for (const job of jobs) {
    // Find which bucket this job belonged to
    const bucket = Object.entries(bucketMapping)
      .find(([_, ids]) => ids.includes(job.id))?.[0];
    
    if (bucket && legacyState[bucket]) {
      newState[job.id] = {
        last_run: legacyState[bucket].last_run,
        nextRun: null, // Force recalculation
        status: 'migrated'
      };
    }
  }
  
  return newState;
}
```

#### Step 2.2: Add State Validation

**File:** `backend/routers/cron.mjs`

```javascript
const loadCronState = () => {
  const state = loadFile("system/state/cron-runtime");
  const jobs = taskRegistry.getJobs();
  
  if (!state || typeof state !== 'object') {
    cronLogger.info('cron.state.initialized', { reason: 'missing' });
    return {};
  }
  
  // Check for legacy format
  const isLegacyFormat = Object.keys(state).some(k => 
    ['cron10Mins', 'cronHourly', 'cronDaily', 'cronWeekly'].includes(k)
  );
  
  if (isLegacyFormat) {
    cronLogger.warn('cron.state.legacy_detected', { keys: Object.keys(state) });
    const migrated = taskRegistry.migrateState(state, jobs);
    saveFile("system/state/cron-runtime", migrated);
    return migrated;
  }
  
  return state;
};
```

#### Step 2.3: Add Scheduler Health Logging

**File:** `backend/routers/cron.mjs`

Add periodic health check logs:

```javascript
let healthCheckCounter = 0;

if (cronEnabled) {
  setInterval(() => {
    healthCheckCounter++;
    
    // Log health every 5 minutes (60 iterations * 5 seconds)
    if (healthCheckCounter % 60 === 0) {
      const jobs = loadCronConfig();
      const nextJob = jobs.reduce((min, j) => 
        (j.secondsUntil < min.secondsUntil) ? j : min
      );
      cronLogger.info('cron.health', {
        jobCount: jobs.length,
        nextJobId: nextJob.id,
        nextJobIn: nextJob.secondsUntil,
        iteration: healthCheckCounter
      });
    }
    
    // ... existing cronContinuous logic
  }, 5000);
}
```

#### Step 2.4: Remove Legacy Configuration

```bash
# Archive the legacy file
mv /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/system/cron-jobs.yml \
   /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/system/_archive/2026-01-17-cron-jobs.yml
```

### Phase 3: Monitoring & Prevention (Next Sprint)

**Objective:** Detect future failures before they cause data gaps

#### Step 3.1: Add Cron Execution Monitoring

Create a simple health endpoint:

```javascript
// GET /cron/health (Note: cron routes are mounted at /cron, not /api/cron)
apiRouter.get('/health', (req, res) => {
  const jobs = loadCronConfig();
  const now = moment().tz(timeZone);
  
  const staleJobs = jobs.filter(j => {
    if (!j.last_run) return true;
    const lastRun = moment.tz(j.last_run, "YYYY-MM-DD HH:mm:ss", timeZone);
    const expectedInterval = parseScheduleInterval(j.schedule);
    return now.diff(lastRun, 'minutes') > expectedInterval * 2;
  });
  
  if (staleJobs.length > 0) {
    res.status(503).json({
      status: 'degraded',
      staleJobs: staleJobs.map(j => ({ id: j.id, last_run: j.last_run }))
    });
  } else {
    res.json({ status: 'healthy', jobCount: jobs.length });
  }
});
```

#### Step 3.2: Add External Monitoring

Add cron health check to Home Assistant or uptime monitoring:

```yaml
# Home Assistant sensor
sensor:
  - platform: rest
    name: DaylightStation Cron Health
    resource: http://daylight-station:3111/cron/health
    value_template: "{{ value_json.status }}"
    scan_interval: 300
```

#### Step 3.3: Add Startup Self-Test

On container startup, verify cron system is functional:

```javascript
// In cron.mjs initialization
const selfTest = async () => {
  const jobs = taskRegistry.getJobs();
  if (!jobs || jobs.length === 0) {
    cronLogger.error('cron.selftest.failed', { reason: 'no_jobs_loaded' });
    return false;
  }
  
  const state = loadCronState();
  const stateKeys = Object.keys(state);
  const jobIds = jobs.map(j => j.id);
  
  // Check for orphaned state keys
  const orphaned = stateKeys.filter(k => !jobIds.includes(k));
  if (orphaned.length > 0) {
    cronLogger.warn('cron.selftest.orphaned_state', { keys: orphaned });
  }
  
  cronLogger.info('cron.selftest.passed', { 
    jobCount: jobs.length, 
    stateEntries: stateKeys.length 
  });
  return true;
};
```

---

## Testing Plan

### Unit Tests

```javascript
// tests/unit/cron/TaskRegistry.test.js
describe('TaskRegistry', () => {
  describe('migrateState', () => {
    it('should migrate legacy bucket state to individual job state', () => {
      const legacyState = {
        cron10Mins: { last_run: '2026-01-10 15:10:03', nextRun: '2026-01-10 15:20:00' }
      };
      const jobs = [{ id: 'weather' }, { id: 'gcal' }];
      
      const result = taskRegistry.migrateState(legacyState, jobs);
      
      expect(result.weather.last_run).toBe('2026-01-10 15:10:03');
      expect(result.gcal.last_run).toBe('2026-01-10 15:10:03');
    });
  });
});
```

### Integration Tests

```javascript
// tests/integration/cron/scheduler.test.js
describe('Cron Scheduler', () => {
  it('should recover from missing state file', async () => {
    // Delete state file
    // Trigger cronContinuous
    // Verify jobs are scheduled
  });
  
  it('should migrate legacy state on load', async () => {
    // Write legacy state file
    // Load cron config
    // Verify modern format in state
  });
});
```

---

## Rollback Plan

If Phase 1 recovery fails:

1. Restore backup state file:
   ```bash
   ssh homeserver.local -t 'docker exec daylight-station sh -c "cp /usr/src/app/data/system/state/cron-runtime.yml.bak-YYYYMMDD /usr/src/app/data/system/state/cron-runtime.yml"'
   ```

2. Manually trigger critical jobs via API:
   ```bash
   curl -X POST http://daylight-station:3111/cron/run/weather
   curl -X POST http://daylight-station:3111/cron/run/gcal
   ```

3. Investigate further with debug logging enabled

---

## Related Code

- [backend/routers/cron.mjs](backend/routers/cron.mjs) - Main scheduler
- [backend/lib/cron/TaskRegistry.mjs](backend/lib/cron/TaskRegistry.mjs) - Job loading
- [data/system/jobs.yml](data/system/jobs.yml) - Modern job definitions
- [data/system/cron-jobs.yml](data/system/cron-jobs.yml) - Legacy (to be archived)

---

## Timeline

| Phase | Action | Owner | ETA |
|-------|--------|-------|-----|
| 1 | Immediate recovery | - | Today |
| 2.1-2.2 | State migration code | - | This week |
| 2.3 | Health logging | - | This week |
| 2.4 | Archive legacy config | - | Today |
| 3 | Monitoring | - | Next sprint |

---

## Appendix: Commands Reference

```bash
# Check cron status
ssh homeserver.local -t 'docker exec daylight-station sh -c "cat /usr/src/app/data/system/state/cron-runtime.yml"'

# View recent cron logs
ssh homeserver.local 'docker logs --tail 100 daylight-station 2>&1' | grep -E 'cron\.'

# Manually trigger a job (from inside container)
ssh homeserver.local 'docker exec -u root daylight-station curl -s -X POST http://localhost:3111/cron/run/weather'

# Check cron status endpoint
ssh homeserver.local 'docker exec -u root daylight-station curl -s http://localhost:3111/cron/status'

# Check job definitions
ssh homeserver.local -t 'docker exec daylight-station sh -c "cat /usr/src/app/data/system/jobs.yml"'

# Restart container
ssh homeserver.local 'docker restart daylight-station'
```
