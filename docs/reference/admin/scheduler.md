# Scheduler Admin Reference

> Admin panel section for viewing and managing the system's cron job definitions.

---

## Overview

The Scheduler admin section lists the cron jobs the system knows about, groups them
by how often they run, and lets an operator create, edit, delete, and trigger them.
It is a thin management surface over two YAML files:

- **Job definitions** — `data/system/config/jobs.yml` (a YAML array of jobs)
- **Runtime state** — `data/system/state/cron-runtime.yml` (a map keyed by job id)

The admin API reads both, merges the runtime state onto each job under a `runtime`
key, and serves the result. Writes go to `jobs.yml` only; runtime state is owned by
the scheduler that actually executes jobs.

### File Locations

| Piece | Path |
|-------|------|
| List view | `frontend/src/modules/Admin/Scheduler/SchedulerIndex.jsx` |
| Detail view | `frontend/src/modules/Admin/Scheduler/JobDetail.jsx` |
| Data hook | `frontend/src/hooks/admin/useAdminScheduler.js` |
| API router | `backend/src/4_api/v1/routers/admin/scheduler.mjs` |
| Job definitions | `data/system/config/jobs.yml` |
| Runtime state | `data/system/state/cron-runtime.yml` |

---

## Routes

| Route | View |
|-------|------|
| `/admin/system/scheduler` | Job list, grouped by frequency |
| `/admin/system/scheduler/:jobId` | Single job detail |

---

## Job Shape

A job definition carries these fields (only `id`, `name`, and `schedule` are required):

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier; no spaces; immutable once created |
| `name` | string | Human-friendly display name |
| `schedule` | string | Standard 5-field cron expression |
| `module` | string | Optional path to the module the job runs |
| `dependencies` | string[] | Optional list of job ids this job depends on |
| `window` | number | Optional execution window, in minutes |

When fetched through the API, each job also carries a `runtime` object (or `null` if
the job has never run) holding `status`, `last_run`, `nextRun`, `duration_ms`, and
`error`.

---

## List View

The list view fetches all jobs on mount and renders them in frequency bands, each as
its own table:

| Band | Matches when |
|------|--------------|
| **Frequent (sub-hourly)** | The cron string contains `*/` |
| **Hourly** | The hour field is `*` |
| **Daily** | The day-of-month field is `*` |
| **Other** | Anything else |

Each row shows the job name, a humanized schedule (e.g. `*/10 * * * *` → "Every 10
min"), the relative last-run time, a status badge (green success / red failed / gray
never-run), and the last duration. Clicking a row opens the detail view; the inline
**Run** button triggers the job without navigating.

The **Create Job** button opens a modal with client-side validation — `id`, `name`,
and `schedule` are required before submit.

---

## Detail View

The detail view loads a single job and presents two panels:

- **Job Info** — id, module, schedule (humanized plus raw cron), dependencies as
  badges, and window.
- **Runtime Status** — status badge, last run, next run, duration, and an error block
  when the last run failed.

Available actions: **Run Now** (triggers, then re-reads runtime state shortly after),
**Edit** (modal — dependencies are entered as a comma-separated string and stored as an
array), and **Delete** (confirmation modal, then returns to the list).

---

## API

All endpoints live under `/api/v1/admin/scheduler`.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/jobs` | List all jobs, each merged with its runtime state |
| POST | `/jobs` | Create a job (validates required fields, rejects duplicate ids) |
| GET | `/jobs/:id` | Read one job with its runtime state |
| PUT | `/jobs/:id` | Update job fields; `id` cannot change |
| DELETE | `/jobs/:id` | Remove a job |
| POST | `/jobs/:id/run` | Request an immediate run |

The data hook (`useAdminScheduler`) wraps the list and mutation calls with structured
logging and shared `loading`/`error` state. The detail view calls the same endpoints
directly.

### Run trigger

`POST /jobs/:id/run` currently acknowledges the request with HTTP `202 Accepted`
("Job queued for execution") and logs it, but does not itself execute the job —
wiring it to the live scheduler is a known gap. Actual
cron execution is owned by the system scheduler (`backend/src/0_system/scheduling/`
and `backend/src/3_applications/scheduling/`), which also writes `cron-runtime.yml`.

---

## Related

- `docs/reference/admin-components.md` — shared admin primitives (`ConfigFormWrapper`,
  `CrudTable`, `ConfirmModal`, etc.)
- `frontend/src/modules/Admin/Scheduler/` — the components described here.
