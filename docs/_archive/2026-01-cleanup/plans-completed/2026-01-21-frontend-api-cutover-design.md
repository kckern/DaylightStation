# Frontend API Cutover Design

**Date:** 2026-01-21
**Status:** Approved
**Goal:** Migrate frontend from legacy endpoints to `/api/v1/*` DDD backend endpoints

---

## Summary

Migrate all frontend API calls from legacy routes (`/data/*`, `/media/*`, `/api/fitness/*`, etc.) to new DDD backend routes (`/api/v1/*`). Uses direct replacement at each call site - no feature flags or shimming.

## Architecture

```
Phase 1: Inventory & Audit
├── Map all frontend API calls to legacy endpoints
├── Map legacy endpoints to new backend equivalents
├── Identify parity gaps (missing/incomplete in new backend)
└── Produce endpoint migration matrix

Phase 2: Foundation Cutover (P0)
├── plex_proxy (used by TV, Fitness for thumbnails)
├── /data/* fetch endpoints (config, lists, menus)
├── /media/* endpoints (playback, images, logging)
└── Shared utilities (status, health checks)

Phase 3: App-Specific Cutover (P1/P2)
├── TV App endpoints
├── Fitness App endpoints
├── Office App endpoints
├── Finance App endpoints
└── Health/Lifelog endpoints

Phase 4: Legacy Decommission
├── Remove unused legacy routes
├── Delete _legacy/ directory
└── Simplify index.js routing
```

---

## Phase 1: Inventory & Audit

### Migration Matrix Columns

| Column | Purpose |
|--------|---------|
| Legacy Route | Current endpoint called by frontend |
| Frontend Callers | Which files/components call this endpoint |
| New Route | Equivalent `/api/v1/*` endpoint (if exists) |
| Parity Status | `ready`, `partial`, `missing`, `not-needed` |
| Priority | `P0` (foundational), `P1` (high-use), `P2` (low-use) |

### Legacy Routers to Map

```
_legacy/routers/
├── fetch.mjs      → /data/* endpoints
├── media.mjs      → /media/* endpoints
├── plexProxy.mjs  → /plex_proxy/* endpoints
├── fitness.mjs    → /api/fitness/* endpoints
├── health.mjs     → /api/health/* endpoints
├── lifelog.mjs    → /api/lifelog/* endpoints
├── gratitude.mjs  → /api/gratitude/* endpoints
├── harvest.mjs    → /harvest/* endpoints (finance)
├── home.mjs       → /home/* endpoints
└── journalist.mjs → /journalist/* webhooks
```

---

## Phase 2: Foundation Endpoints (P0)

### Plex Proxy

| Legacy Route | New Route | Used By |
|--------------|-----------|---------|
| `/plex_proxy/photo` | `/api/v1/proxy/plex/photo` | TV, Fitness (thumbnails) |
| `/plex_proxy/library/*` | `/api/v1/proxy/plex/library/*` | Menu, PlexMenuRouter |

### Data Fetch

| Legacy Route | New Route | Used By |
|--------------|-----------|---------|
| `/data/menu` | `/api/v1/content/menu` | Menu.jsx |
| `/data/list/{type}` | `/api/v1/list/{type}` | Various |
| `/data/config/{app}` | `/api/v1/content/config/{app}` | App configs |

### Media

| Legacy Route | New Route | Used By |
|--------------|-----------|---------|
| `/media/plex/{key}` | `/api/v1/play/plex/{key}` | Player |
| `/media/img/{key}` | `/api/v1/content/image/{key}` | Art, backgrounds |
| `/media/log` (POST) | `/api/v1/play/log` | Playback progress |
| `/media/local/{path}` | `/api/v1/play/local/{path}` | Local content |

---

## Phase 3: App-Specific Endpoints

### TV App

| Legacy Route | New Route | Purpose |
|--------------|-----------|---------|
| `/api/list/plex` | `/api/v1/list/plex` | Plex library listing |
| `/api/list/local` | `/api/v1/list/local` | Local content listing |
| `/data/menu_log` (POST) | `/api/v1/content/menu-log` | Menu navigation tracking |

### Fitness App

| Legacy Route | New Route | Purpose |
|--------------|-----------|---------|
| `/api/fitness/save_session` | `/api/v1/fitness/sessions` (POST) | Session persistence |
| `/api/fitness/sessions` | `/api/v1/fitness/sessions` (GET) | Session history |
| `/api/fitness/equipment` | `/api/v1/fitness/equipment` | Equipment config |
| `/api/fitness/governance` | `/api/v1/fitness/governance` | Zone governance |

### Office App

| Legacy Route | New Route | Purpose |
|--------------|-----------|---------|
| `/home/keyboard/*` | `/api/v1/home/keyboard/*` | Keyboard shortcuts |
| `/home/scene/*` | `/api/v1/home/scenes/*` | HA scene triggers |

### Finance App

| Legacy Route | New Route | Purpose |
|--------------|-----------|---------|
| `/harvest/budget` | `/api/v1/finance/budget` | Budget data |
| `/api/finance/*` | `/api/v1/finance/*` | Finance APIs |

### Health/Lifelog

| Legacy Route | New Route | Purpose |
|--------------|-----------|---------|
| `/api/health/*` | `/api/v1/health/*` | Health metrics |
| `/api/lifelog/*` | `/api/v1/lifelog/*` | Lifelog entries |
| `/api/gratitude/*` | `/api/v1/gratitude/*` | Gratitude journal |

---

## Per-Endpoint Cutover Checklist

```
┌─────────────────────────────────────────────────────────┐
│  ENDPOINT CUTOVER CHECKLIST                             │
├─────────────────────────────────────────────────────────┤
│  1. □ Verify new endpoint exists in backend/src/        │
│  2. □ Test parity: curl both endpoints, compare JSON    │
│  3. □ Update frontend call site(s)                      │
│  4. □ Test in dev (npm run dev)                         │
│  5. □ Deploy to prod                                    │
│  6. □ Monitor /admin/legacy-hits for traffic shift      │
│  7. □ Mark endpoint as migrated in tracking doc         │
└─────────────────────────────────────────────────────────┘
```

### Parity Testing

```bash
# Compare legacy vs new response
diff <(curl -s localhost:3112/data/menu | jq -S .) \
     <(curl -s localhost:3112/api/v1/content/menu | jq -S .)
```

### Rollback Strategy

1. Revert frontend change (single file, quick PR)
2. Legacy endpoint still works - no backend changes needed
3. Fix parity issue in new backend
4. Re-attempt cutover

---

## Execution Sequence

### Week 1: Inventory & Audit
- Task 1.1: Grep frontend for all API calls
- Task 1.2: Build endpoint migration matrix
- Task 1.3: Test parity for P0 endpoints
- Task 1.4: Document gaps requiring backend work

### Week 2: Foundation (P0)
- Task 2.1: plex_proxy endpoints (no deps)
- Task 2.2: /data/* fetch endpoints (no deps)
- Task 2.3: /media/img, /media/plex (no deps)
- Task 2.4: /media/log (CRITICAL - playback tracking)
  - Depends on: Parity test passing

### Week 3: TV App (P1)
- Task 3.1: /api/list/* endpoints
- Task 3.2: Menu.jsx migration
- Task 3.3: PlexMenuRouter.jsx migration
  - Depends on: plex_proxy migrated

### Week 4: Fitness App (P1)
- Task 4.1: /api/fitness/save_session
- Task 4.2: /api/fitness/* read endpoints
- Task 4.3: FitnessPlayer.jsx, PersistenceManager.js
  - Depends on: /media/log migrated

### Week 5: Remaining Apps (P2)
- Task 5.1: Office App (/home/*)
- Task 5.2: Finance App (/harvest/*, /api/finance/*)
- Task 5.3: Health/Lifelog/Gratitude

### Week 6: Cleanup
- Task 6.1: Verify /admin/legacy-hits shows zero traffic
- Task 6.2: Remove unused legacy routes
- Task 6.3: Update documentation

---

## Key Dependencies

- `plex_proxy` must work before TV App menu can migrate
- `/media/log` must work before Fitness playback can migrate
- All P0 should complete before P1 begins

---

## Related Documents

- `docs/plans/2026-01-20-concurrent-routing-design.md` - Current routing architecture
- `docs/plans/2026-01-21-legacy-cutover-safety.md` - Feature flags and tracking
- `docs/_wip/audits/2026-01-21-legacy-routing-cutover-audit.md` - Bug fixes and audit
- `docs/plans/2026-01-20-background-services-migration.md` - Infrastructure ownership

---

## Next Steps

1. Run Phase 1 inventory to produce the migration matrix
2. Create `docs/_wip/audits/2026-01-21-endpoint-migration-tracker.md` to track progress
3. Begin P0 foundation cutover once parity verified
