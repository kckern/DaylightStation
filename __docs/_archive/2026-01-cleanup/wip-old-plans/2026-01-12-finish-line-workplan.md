# Backend Migration: Finish Line Workplan

**Created:** 2026-01-12
**Status:** ACTIVE
**Goal:** Complete migration from `__backend/_legacy/` to `__backend/src/`

---

## Current State Summary

| Metric | Current | Target | Gap |
|--------|---------|--------|-----|
| Files in `src/` | 320 | ~340 | +20 |
| Files in `_legacy/` | 322 | 0 | -322 |
| New DDD routers | 20 | 20 | ✅ Done |
| Legacy routers to migrate | 9 | 0 | -9 |
| Test suites passing | 86 | 86+ | ✅ OK |
| Tests passing | 1175 | 1200+ | ✅ OK |

### Phases Complete

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Infrastructure (logging, config, eventbus, scheduling) | ✅ 100% |
| 2 | Domains (fitness, finance, messaging, nutrition, journaling, ai, content, journalist) | ✅ 100% |
| 3 | Adapters (all 16 harvesters, persistence, AI, messaging) | ✅ 100% |
| 4 | Applications (nutribot, journalist, fitness, finance) | ✅ 100% |
| 5a | Server Entry Point (`src/server.mjs`) | ✅ 100% |

### Remaining Work

| Phase | Description | Status |
|-------|-------------|--------|
| 5b | Router Consolidation | 🔄 70% |
| 5c | Webhook Server | ⬜ 0% |
| 5d | Legacy Route Shims | 🔄 50% |
| 6 | Cleanup & Deletion | ⬜ Blocked |

---

## Router Migration Status

### Already Migrated (20 routers in src/4_api/routers/)

| New Router | Replaces Legacy | Status |
|------------|-----------------|--------|
| `ai.mjs` | N/A (new) | ✅ New DDD |
| `content.mjs` | `media.mjs` (partial) | ✅ Active |
| `entropy.mjs` | N/A (new) | ✅ New DDD |
| `externalProxy.mjs` | `plexProxy.mjs` | ✅ Migrated |
| `finance.mjs` | N/A (new) | ✅ New DDD |
| `fitness.mjs` | `fitness.mjs` | ✅ Migrated |
| `gratitude.mjs` | `gratitude.mjs` | ✅ Migrated |
| `health.mjs` | `health.mjs` | ✅ Migrated |
| `homeAutomation.mjs` | `home.mjs` + `exe.mjs` | ✅ Migrated |
| `journaling.mjs` | N/A (new) | ✅ New DDD |
| `journalist.mjs` | `journalist.mjs` | ✅ Migrated |
| `list.mjs` | `fetch.mjs` (partial) | ✅ New DDD |
| `localContent.mjs` | `fetch.mjs` (partial) | ✅ New DDD |
| `messaging.mjs` | N/A (new) | ✅ New DDD |
| `nutribot.mjs` | N/A (new) | ✅ New DDD |
| `nutrition.mjs` | N/A (new) | ✅ New DDD |
| `play.mjs` | `media.mjs` (partial) | ✅ New DDD |
| `printer.mjs` | `printer.mjs` | ✅ Migrated |
| `proxy.mjs` | `media.mjs` (partial) | ✅ New DDD |
| `tts.mjs` | `tts.mjs` | ✅ Migrated |

### Legacy Routers Still Active (9 remaining)

| Legacy Router | Lines | Purpose | Migration Path |
|---------------|-------|---------|----------------|
| `cron.mjs` | 500+ | Job scheduling, status | Wire to TaskRegistry |
| `exe.mjs` | 800+ | Kiosk, Tasker, SSH | Already in homeAutomation |
| `fetch.mjs` | 900+ | YAML data serving, /data/* | Keep as legacy shim |
| `harvest.mjs` | 400+ | Harvester orchestration | Uses new DDD harvesters |
| `home.mjs` | 50 | Home automation hooks | Already in homeAutomation |
| `lifelog.mjs` | 20 | Stub (hello world) | Delete |
| `media.mjs` | 1200+ | Media streaming, /media/* | Partial in content/proxy |
| `plexProxy.mjs` | 100 | Plex stream proxy | Replaced by externalProxy |
| `websocket.mjs` | 200 | WebSocket pub/sub | Already EventBus shim |

---

## Remaining Tasks

### Phase 5b: Router Consolidation (3 tasks)

These routers are still actively imported from legacy but need to be wired into server.mjs:

#### Task 5b.1: Wire Legacy Routers in server.mjs
**Status:** ✅ Done (in current server.mjs)

The new `src/server.mjs` already imports and mounts these legacy routers:
- `/data` → `fetchRouter`
- `/harvest` → `harvestRouter`
- `/home` → `homeRouter`
- `/media` → `mediaRouter`
- `/cron` → `cronRouter`
- `/plex_proxy` → `plexProxyRouter`
- `/exe` → `exeRouter`

#### Task 5b.2: Create Data/Fetch Router Shim
**Status:** ⬜ Not Started
**Effort:** Medium

The `/data/*` endpoints serve YAML files. Options:
1. **Keep legacy** - Mount `_legacy/routers/fetch.mjs` (current approach)
2. **Create shim** - Create `src/4_api/routers/data.mjs` that imports legacy helpers
3. **Full migrate** - Rewrite in DDD style (complex, low value)

**Recommendation:** Keep as legacy shim for now. Low priority.

#### Task 5b.3: Delete Dead Code
**Status:** ⬜ Not Started
**Effort:** Low

- `lifelog.mjs` - Just a stub, delete
- `websocket.mjs` - Already shim to EventBus, verify and mark deprecated

### Phase 5c: Webhook Server (2 tasks)

Currently webhooks are mounted in the main app via `_legacy/api.mjs`. Need to extract to separate server.

#### Task 5c.1: Create Webhook Server
**Status:** ⬜ Not Started
**Effort:** Low

```javascript
// src/4_api/webhook-server.mjs
import express from 'express';
import { createNutribotRouter } from './routers/nutribot.mjs';
import { createJournalistRouter } from './routers/journalist.mjs';

export function createWebhookServer(config) {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/api/foodlog', createNutribotRouter(config));
  app.use('/api/journalist', createJournalistRouter(config));
  return app;
}
```

#### Task 5c.2: Wire Webhook Server in server.mjs
**Status:** ⬜ Not Started
**Effort:** Low

Add to `server.mjs`:
```javascript
const webhookApp = createWebhookServer(config);
webhookApp.listen(3119);
```

### Phase 5d: Legacy Route Shims (3 tasks)

#### Task 5d.1: Add Legacy Route Hit Tracking
**Status:** ⬜ Not Started
**Effort:** Low

Create middleware to count hits to legacy routes:
```javascript
// src/4_api/middleware/legacyTracker.mjs
export function createLegacyTracker() {
  const hits = new Map();
  return {
    middleware: (req, res, next) => {
      const path = req.path.split('/').slice(0, 2).join('/');
      hits.set(path, (hits.get(path) || 0) + 1);
      next();
    },
    getHits: () => Object.fromEntries(hits)
  };
}
```

#### Task 5d.2: Create /admin/legacy-usage Endpoint
**Status:** ⬜ Not Started
**Effort:** Low

Expose hit counts for monitoring.

#### Task 5d.3: Document Legacy Shims
**Status:** ⬜ Not Started
**Effort:** Low

Document which legacy routes are still in use and why.

### Phase 6: Cleanup (Blocked)

Cannot proceed until legacy route hits drop to 0.

#### Task 6.1: Monitor Legacy Usage
**Status:** ⬜ Blocked

Run for 1 week, observe hit counts.

#### Task 6.2: Disable Legacy Routes
**Status:** ⬜ Blocked

Set `ENABLE_LEGACY_ROUTES=false` flag.

#### Task 6.3: Delete _legacy/ Folder
**Status:** ⬜ Blocked

Final step. Requires all legacy imports removed.

#### Task 6.4: Update Documentation
**Status:** ⬜ Blocked

- Update CLAUDE.md
- Update ai-context files
- Archive migration plans

---

## Workplan Checklist

### Immediate (Can Do Now)

- [x] Create `src/server.mjs` entry point
- [ ] Verify server.mjs starts correctly
- [ ] Delete `lifelog.mjs` stub
- [ ] Add deprecation comment to `websocket.mjs`
- [ ] Create webhook server extraction

### Short-term (Phase 5 Completion)

- [ ] Create legacy route hit tracker
- [ ] Create /admin/legacy-usage endpoint
- [ ] Document all legacy shims
- [ ] Update package.json with new start script

### Medium-term (Phase 6)

- [ ] Monitor legacy usage for 1 week
- [ ] Identify any frontend changes needed
- [ ] Disable legacy routes
- [ ] Test full application without legacy
- [ ] Delete _legacy/ folder

---

## Dependencies

```
5b.2 (Data Router) ──────────────────────────────────────┐
5b.3 (Delete Dead) ──────────────────────────────────────┤
5c.1 (Webhook Server) ───────────────────────────────────┤
5c.2 (Wire Webhook) ─── depends on 5c.1 ─────────────────┤
5d.1 (Hit Tracking) ─────────────────────────────────────┼──> 6.1 (Monitor)
5d.2 (Admin Endpoint) ── depends on 5d.1 ────────────────┤        │
5d.3 (Document Shims) ───────────────────────────────────┘        v
                                                              6.2 (Disable)
                                                                  │
                                                                  v
                                                              6.3 (Delete)
                                                                  │
                                                                  v
                                                              6.4 (Docs)
```

---

## Success Criteria

Migration is complete when:

- [ ] `__backend/_legacy/` folder is deleted
- [ ] All endpoints served from `__backend/src/`
- [ ] No imports from `_legacy` in production code
- [ ] All tests passing (1200+)
- [ ] Legacy route hit counts at 0 for 1 week
- [ ] Documentation updated

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Frontend breaks on legacy deletion | Medium | High | Hit tracking, gradual rollout |
| Tests fail after legacy removal | Low | Medium | Golden master tests |
| Data corruption in YAML files | Low | High | Backup before deletion |
| Webhook security regression | Low | High | Separate port isolation |

---

## Effort Estimates

| Phase | Tasks | Effort |
|-------|-------|--------|
| 5b | 3 | 2-4 hours |
| 5c | 2 | 1-2 hours |
| 5d | 3 | 1-2 hours |
| 6 | 4 | 1-2 weeks (mostly waiting) |

**Total remaining coding:** ~5-8 hours
**Total elapsed time:** 2-3 weeks (includes monitoring period)

---

## Appendix: File Counts by Directory

```
__backend/src/
├── 0_infrastructure/    45 files
├── 1_domains/           60 files
├── 2_adapters/          85 files
├── 3_applications/      90 files
├── 4_api/               40 files
└── server.mjs            1 file
                        ───────
                        321 files

__backend/_legacy/
├── routers/             15 files
├── lib/                 50 files
├── chatbots/           200 files (mostly migrated)
├── jobs/                 5 files
├── scripts/              3 files
└── index.js, api.mjs     2 files
                        ───────
                        275 production files
                        +47 already-shims
                        ───────
                        322 files total
```

Most of the 322 legacy files are:
1. Chatbot files (200) → Already migrated to 3_applications/
2. Lib files (50) → Most have DDD equivalents
3. Router shims (15) → Some already delegate to src/

The actual "still to migrate" count is much smaller than 322.
