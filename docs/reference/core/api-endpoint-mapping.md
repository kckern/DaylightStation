# API Endpoint Mapping: Legacy → DDD

This document maps legacy API endpoints to their DDD (Domain-Driven Design) equivalents.

## Routing Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    backend/index.js                         │
│                    (Request Router)                         │
└─────────────────────────────────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            │                               │
            ▼                               ▼
   /api/v1/* requests              All other requests
            │                               │
            ▼                               ▼
┌───────────────────────┐       ┌───────────────────────┐
│   backend/src/app.mjs │       │ backend/_legacy/app.mjs│
│      (DDD Backend)    │       │   (Legacy Backend)    │
└───────────────────────┘       └───────────────────────┘
```

**Key Rules:**
- `/api/v1/*` → DDD backend (new architecture)
- Everything else → Legacy backend (to be migrated)

---

## Endpoint Mappings by Domain

### Fitness

| Method | Legacy | DDD | Status |
|--------|--------|-----|--------|
| GET | `/api/fitness` | `/api/v1/fitness` | ✅ Parity |
| GET | `/api/fitness/sessions/dates` | `/api/v1/fitness/sessions/dates` | ✅ Parity |
| GET | `/api/fitness/sessions` | `/api/v1/fitness/sessions` | ✅ Parity |
| GET | `/api/fitness/sessions/:id` | `/api/v1/fitness/sessions/:id` | ✅ Parity |
| POST | `/api/fitness/save_session` | `/api/v1/fitness/save_session` | ✅ Parity |
| POST | `/api/fitness/save_screenshot` | `/api/v1/fitness/save_screenshot` | ✅ Parity |
| POST | `/api/fitness/voice_memo` | `/api/v1/fitness/voice_memo` | ✅ Parity |
| POST | `/api/fitness/zone_led` | `/api/v1/fitness/zone_led` | ✅ Parity |
| GET | `/api/fitness/zone_led/status` | `/api/v1/fitness/zone_led/status` | ✅ Parity |
| GET | `/api/fitness/zone_led/metrics` | `/api/v1/fitness/zone_led/metrics` | ✅ Parity |
| POST | `/api/fitness/zone_led/reset` | `/api/v1/fitness/zone_led/reset` | ✅ Parity |
| POST | `/api/fitness/simulate` | `/api/v1/fitness/simulate` | ✅ Parity |
| DELETE | `/api/fitness/simulate` | `/api/v1/fitness/simulate` | ✅ Parity |
| GET | `/api/fitness/simulate/status` | `/api/v1/fitness/simulate/status` | ✅ Parity |

### Finance

| Method | Legacy | DDD | Status |
|--------|--------|-----|--------|
| GET | `/data/budget` | `/api/v1/finance/data` | ✅ Redirect |
| GET | `/data/budget/daytoday` | `/api/v1/finance/data/daytoday` | ✅ Redirect |
| POST | `/harvest/budget` | `/api/v1/finance/refresh` | ✅ Redirect |
| GET | `/api/finance/accounts` | `/api/v1/finance/accounts` | ✅ Parity |
| GET | `/api/finance/transactions` | `/api/v1/finance/transactions` | ✅ Parity |
| POST | `/api/finance/transactions/:id` | `/api/v1/finance/transactions/:id` | ✅ Parity |
| GET | `/api/finance/budgets` | `/api/v1/finance/budgets` | ✅ Parity |
| GET | `/api/finance/budgets/:id` | `/api/v1/finance/budgets/:id` | ✅ Parity |
| GET | `/api/finance/mortgage` | `/api/v1/finance/mortgage` | ✅ Parity |
| POST | `/api/finance/categorize` | `/api/v1/finance/categorize` | ✅ Parity |
| GET | `/api/finance/memos` | `/api/v1/finance/memos` | ✅ Parity |
| POST | `/api/finance/memos/:id` | `/api/v1/finance/memos/:id` | ✅ Parity |
| GET | `/api/finance/metrics` | `/api/v1/finance/metrics` | ✅ Parity |

### Gratitude

| Method | Legacy | DDD | Status |
|--------|--------|-----|--------|
| GET | `/api/gratitude` | `/api/v1/gratitude/bootstrap` | ✅ Parity |
| GET | `/api/gratitude/options` | `/api/v1/gratitude/options` | ✅ Parity |
| GET | `/api/gratitude/options/:cat` | `/api/v1/gratitude/options/:cat` | ✅ Parity |
| POST | `/api/gratitude/options/:cat` | `/api/v1/gratitude/options/:cat` | ✅ Parity |
| GET | `/api/gratitude/selections/:cat` | `/api/v1/gratitude/selections/:cat` | ✅ Parity |
| POST | `/api/gratitude/selections/:cat` | `/api/v1/gratitude/selections/:cat` | ✅ Parity |
| DELETE | `/api/gratitude/selections/:cat/:id` | `/api/v1/gratitude/selections/:cat/:id` | ✅ Parity |
| GET | `/api/gratitude/discarded/:cat` | `/api/v1/gratitude/discarded/:cat` | ✅ Parity |
| POST | `/api/gratitude/discarded/:cat` | `/api/v1/gratitude/discarded/:cat` | ✅ Parity |
| POST | `/api/gratitude/snapshot/save` | `/api/v1/gratitude/snapshot/save` | ✅ Parity |
| GET | `/api/gratitude/snapshot/list` | `/api/v1/gratitude/snapshot/list` | ✅ Parity |
| POST | `/api/gratitude/snapshot/restore` | `/api/v1/gratitude/snapshot/restore` | ✅ Parity |
| GET | `/api/gratitude/users` | `/api/v1/gratitude/users` | ✅ Parity |
| GET | `/api/gratitude/card` | `/api/v1/gratitude/card` | ✅ Parity |
| GET | `/api/gratitude/card/print` | `/api/v1/gratitude/card/print` | ✅ Parity |
| GET | `/api/gratitude/print` | `/api/v1/gratitude/print` | ✅ Parity |
| POST | `/api/gratitude/print/mark` | `/api/v1/gratitude/print/mark` | ✅ Parity |

### Health

| Method | Legacy | DDD | Status |
|--------|--------|-----|--------|
| GET | `/api/health/daily` | `/api/v1/health/daily` | ✅ Parity |
| GET | `/api/health/date/:date` | `/api/v1/health/date/:date` | ✅ Parity |
| GET | `/api/health/range` | `/api/v1/health/range` | ✅ Parity |
| GET | `/api/health/weight` | `/api/v1/health/weight` | ✅ Parity |
| GET | `/api/health/workouts` | `/api/v1/health/workouts` | ✅ Parity |
| GET | `/api/health/fitness` | `/api/v1/health/fitness` | ✅ Parity |
| GET | `/api/health/nutrition` | `/api/v1/health/nutrition` | ✅ Parity |
| GET | `/api/health/coaching` | `/api/v1/health/coaching` | ✅ Parity |
| GET | `/api/health/status` | `/api/v1/health/status` | ✅ Parity |
| GET | `/api/health/nutrilist` | `/api/v1/health/nutrilist` | ✅ Parity |
| GET | `/api/health/nutrilist/item/:uuid` | `/api/v1/health/nutrilist/item/:uuid` | ✅ Parity |

### Content (Plex)

| Method | Legacy | DDD | Status |
|--------|--------|-----|--------|
| GET | `/media/plex/info/:id` | `/api/v1/content/plex/info/:id` | ✅ Parity |
| GET | `/media/plex/image/:id` | `/api/v1/content/plex/image/:id` | ✅ Parity |
| GET | `/media/plex/list/:id` | `/api/v1/content/list/plex/:id` | ⚠️ Partial |
| GET | `/media/plex/url/:id` | `/api/v1/play/plex/mpd/:id` | ✅ Parity |
| POST | `/media/log` | `/api/v1/play/log` | ✅ Parity |

### Content (Local)

| Method | Legacy | DDD | Status |
|--------|--------|-----|--------|
| GET | `/data/scripture/:path` | `/api/v1/local-content/scripture/:path` | ✅ Parity |
| GET | `/data/hymn/:num` | `/api/v1/local-content/hymn/:num` | ✅ Parity |
| GET | `/data/primary/:num` | `/api/v1/local-content/primary/:num` | ✅ Parity |
| GET | `/data/talk/:path` | `/api/v1/local-content/talk/:path` | ✅ Parity |
| GET | `/data/poetry/:path` | `/api/v1/local-content/poem/:path` | ✅ Parity |
| GET | `/media/local/:path` | `/api/v1/local-content/media/:path` | ✅ Parity |

### Lists

| Method | Legacy | DDD | Status |
|--------|--------|-----|--------|
| GET | `/data/list/:key` | `/api/v1/list/folder/:key` | ✅ Parity |
| GET | `/data/queue/:key` | `/api/v1/list/folder/:key` | ✅ Parity |

### Journalist

| Method | Legacy | DDD | Status |
|--------|--------|-----|--------|
| POST | `/api/journalist/webhook` | `/api/v1/journalist/webhook` | ✅ Parity |
| POST | `/api/journalist/trigger` | `/api/v1/journalist/trigger` | ✅ Parity |
| GET | `/api/journalist/morning-debrief` | `/api/v1/journalist/morning-debrief` | ✅ Parity |

### Home Automation

| Method | Legacy | DDD | Status |
|--------|--------|-----|--------|
| GET | `/home` | `/api/v1/home` | ✅ Parity |
| GET | `/home/state` | `/api/v1/home/state` | ✅ Parity |
| POST | `/home/scene/:id` | `/api/v1/home/scene/:id` | ✅ Parity |

### Utility

| Method | Legacy | DDD | Status |
|--------|--------|-----|--------|
| GET | `/api/ping` | `/api/v1/ping` | ✅ Parity |
| GET | `/api/status` | `/api/v1/status` | ✅ Parity |
| GET | `/cron/status` | `/api/v1/scheduling/status` | ✅ Parity |

---

## DDD-Only Endpoints (New)

These endpoints exist only in the DDD backend:

### Messaging
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/messaging` | Get messaging config |
| GET | `/api/v1/messaging/conversations` | List conversations |
| GET | `/api/v1/messaging/conversations/:id` | Get conversation detail |
| POST | `/api/v1/messaging/conversations` | Create conversation |
| POST | `/api/v1/messaging/conversations/:id/messages` | Add message |
| GET | `/api/v1/messaging/notifications` | Get notifications |
| POST | `/api/v1/messaging/notifications` | Send notification |

### Nutrition
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/nutrition` | Get nutrition module overview |
| GET | `/api/v1/nutrition/logs/dates` | List dates with food logs |
| POST | `/api/v1/nutribot/chat` | Chat with nutrition bot |

### Scheduling
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/scheduling` | Get scheduling config |
| GET | `/api/v1/scheduling/status` | Get scheduler status |
| GET | `/api/v1/scheduling/jobs` | List scheduled jobs |
| POST | `/api/v1/scheduling/jobs` | Create job |

### AI Services
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/ai/` | AI services overview |
| POST | `/api/v1/ai/transcribe` | Speech transcription |

---

## Legacy-Only Endpoints (Not Migrated)

These endpoints remain in legacy and are not planned for DDD migration:

| Method | Endpoint | Description | Reason |
|--------|----------|-------------|--------|
| GET | `/api/status/nas` | NAS status check | Infrastructure-specific |
| * | `/print/*` | Printer control | Hardware-specific |
| * | `/plex_proxy/*` | Plex proxy passthrough | Direct proxy, no logic |

---

## Status Legend

| Status | Meaning |
|--------|---------|
| ✅ Parity | Both endpoints return equivalent responses |
| ✅ Redirect | Legacy redirects to DDD |
| ⚠️ Partial | Some functionality differs |
| ❌ Missing | Not yet implemented in DDD |

---

## File Locations

**Legacy routers:** `backend/_legacy/routers/`
**DDD routers:** `backend/src/4_api/routers/`

**Entry points:**
- Legacy: `backend/_legacy/app.mjs`
- DDD: `backend/src/app.mjs`
- Router: `backend/index.js`

---

## Related Documentation

- [Parity Test Results](../../_wip/audits/2026-01-21-parity-audit-results.md)
- [Endpoint Migration Tracker](../../_wip/audits/2026-01-21-endpoint-migration-tracker.md)
- Testing: `tests/integration/api/fitness-parity.test.mjs`
- Testing: `tests/integration/api/finance-parity.test.mjs`
- Testing: `tests/integration/api/fitness-plex-parity.test.mjs`
