# Document: Cron System Audit & Modernization Proposal

**Date:** January 10, 2026  
**Status:** PROPOSED  
**Author:** Antigravity (AI Assistant)

---

## 1. Executive Summary

The current DaylightStation cron system is a custom Express-based scheduler that manages periodic data harvesting. While functional and resilient to restarts, it suffers from "coarse-grained execution" where dozens of resource-intensive tasks are fired simultaneously. This leads to unpredictable performance spikes and makes troubleshooting individual failures difficult. This document evaluates the current state and proposes a more robust, configuration-driven architecture aligned with the new Three-Tier data model.

---

## 2. AS-IS Analysis (Current State)

### 2.1 Current Architecture
The system resides in `backend/routers/cron.mjs` and operates on a hybrid configuration model:
- **Hardcoded Registry**: The list of module paths to execute is hardcoded in `cron.mjs` into buckets (`cron10Mins`, `cronHourly`, `cronDaily`).
- **External Schedule**: The cron-tab strings (e.g., `0 0 * * *`) are loaded from `system/cron-jobs`.
- **Interval Check**: A 5-second `setInterval` loop checks if any bucket is due for execution.
- **Parallel Execution**: Within a bucket, all modules are imported dynamically and executed via `Promise.all`.

### 2.2 Strengths
- **Manual Triggering**: Each bucket is exposed as an HTTP GET endpoint (`/cron/cronDaily`), allowing for easy debugging and manual overrides.
- **Persistence**: Job state (`nextRun`, `last_run`) is saved to YAML, allowing the scheduler to respect intervals even after a process restart.
- **Production Safety**: Logic prevents the scheduler from running in dev environments unless explicitly enabled (`ENABLE_CRON=true`), avoiding redundant API hits and Dropbox sync conflicts.
- **Deterministic Jitter**: Uses an MD5-based "window offset" to prevent multiple instances from firing at the exact same second.

### 2.3 Weaknesses (The "Pain Points")
- **Resource Spikes**: `cronDaily` triggers ~15 harvesters at once. This can saturate the network and spike memory usage, especially for tasks like `mediaMemoryValidator` or `youtube` downloads.
- **Lack of Dependency Management**: There is no way to ensure `health.mjs` runs *only after* `strava.mjs` and `garmin.mjs` have finished. 
- **Opaque Errors**: While individual harvester errors are logged, there is no aggregate view of system health. If one harvester fails every day for a week, it is easily missed in the high-volume logs.
- **Configuration Friction**: Adding a new harvester requires a code change to `cron.mjs` to register the file path in the correct bucket.
- **Primitive Concurrency**: A single boolean `cronRunning` prevents the *entire scheduler* from overlapping itself, but it doesn't limit concurrency *within* a run.

---

## 3. TO-BE Proposal (Modernization)

### 3.1 Unified Job Registry (Configuration-Driven)
Move to a fully configuration-driven model in `data/system/jobs.yml`. This eliminates the need to edit `cron.mjs` when adding new features.

```yaml
# data/system/jobs.yml
- id: strava-harvester
  name: Strava Activity Fetcher
  module: ../lib/strava.mjs
  schedule: "15 * * * *"  # Run at 15 past every hour
  timeout: 60000          # 1 min timeout
  tags: [fitness, cloud]

- id: health-aggregator
  name: Daily Health Summary
  module: ../lib/health.mjs
  schedule: "30 2 * * *"  # Run at 2:30 AM
  dependencies: [strava-harvester, garmin-harvester]
```

### 3.2 Sequential / Limited Concurrency Worker
Implement a "Task Runner" that processes jobs in a controlled manner:
- **Queueing**: Instead of `Promise.all`, use a simple sequential processor or a worker pool with `maxConcurrency: 2`.
- **Dependency Awareness**: The runner should check the status of `dependencies` before starting a dependent task.

### 3.3 Granular State Tracking
Update `system/state/cron-runtime.mjs` to track the health of *individual* tasks rather than job buckets.

```yaml
# system/state/cron-runtime.yml
strava-harvester:
  last_run: "2026-01-10T11:00:00.123Z"
  status: "success"
  duration_ms: 1450
  next_run: "2026-01-10T12:15:00.000Z"
health-aggregator:
  last_run: "2026-01-09T02:30:15.000Z"
  status: "failed"
  error: "Socket hang up connecting to garmin.com"
```

### 3.4 Management Dashboard
Expose a `/api/cron/status` endpoint that provides a unified health summary. This can eventually be surfaced in the "Office" or "Home" frontend apps.
- **Features**: List all jobs, their status, last run duration, and a "Run Now" button for individual tasks.

---

## 4. Implementation Path

### Phase 1: Configuration Refactor
- [ ] Create `backend/lib/cron/TaskRegistry.mjs` to load jobs from YAML.
- [ ] Migrate the hardcoded lists from `cron.mjs` into the new YAML format.

### Phase 2: Execution Engine Update
- [ ] Replace `Promise.all` in `cron.mjs` with a sequential iterator.
- [ ] Implement basic "dependency check" logic (skip if dependency failed in last 24h).

### Phase 3: Reporting & Monitoring
- [ ] Add the `/cron/status` API endpoint.
- [ ] Update `cronLogger` to use structured events for better Loggly dashboarding.

---

## 5. Recommendation
The current system is "good enough" for a single-user prototype but will become a major bottleneck as the number of users and services grows. Transitioning to a **Configuration-Driven Sequential Worker** is the highest priority to ensure system stability and developer productivity.
