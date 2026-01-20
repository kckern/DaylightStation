# Backend DDD Migration Archives (2026-01)

This folder contains the planning documents used during the backend migration from `_legacy/` to DDD architecture.

**Migration Period:** 2026-01-10 to 2026-01-12
**Status:** Migration 95% complete

---

## Consolidated Documentation

The key information from these documents has been consolidated into:

- `docs/reference/core/backend-architecture.md` - Architecture overview
- `docs/reference/core/ddd-file-map.md` - Complete file mapping
- `docs/reference/core/migration-summary.md` - Migration summary

---

## Archived Documents

### Architecture & Design
- `2026-01-10-backend-ddd-architecture.md` - Initial DDD architecture design
- `2026-01-10-api-consumer-inventory.md` - API endpoint inventory

### Content Domain Migration (7 phases)
- `2026-01-10-content-domain-phase1.md` - Phase 1 planning
- `2026-01-10-content-domain-phase1d.md` - Phase 1d details
- `2026-01-10-content-domain-phase2.md` - Phase 2 planning
- `2026-01-10-content-domain-phase3-4.md` - Phases 3-4 planning
- `2026-01-10-content-domain-phase5.md` - Phase 5 planning
- `2026-01-10-content-domain-phase6.md` - Phase 6 planning
- `2026-01-10-content-domain-phase7.md` - Phase 7 planning

### Full Backend Migration
- `2026-01-11-full-backend-migration.md` - Full migration plan
- `2026-01-11-legacy-backend-migration-plan.md` - Legacy migration plan
- `2026-01-11-migration-workplan.md` - Detailed workplan with tasks
- `2026-01-11-migration-status.md` - Progress tracking

### Domain-Specific
- `2026-01-11-finance-migration-design.md` - Finance domain design
- `2026-01-12-external-api-adapters-design.md` - Harvester design
- `2026-01-12-lifelog-entropy-domains.md` - Lifelog/entropy design

### Testing
- `2026-01-11-backend-api-integration-tests.md` - Integration test plan
- `2026-01-11-content-migration-e2e-tests.md` - E2E test plan

### Routing
- `2026-01-11-routing-toggle-design.md` - Toggle system design
- `2026-01-12-routing-toggle-implementation.md` - Toggle implementation

---

## Key Outcomes

- 313 files migrated to DDD architecture
- 14 domains implemented
- 16 external API harvesters
- 4 applications (Nutribot, Journalist, Finance, Fitness)
- 20 API routers
- 1175 tests passing

---

## Still Active

The finish-line workplan remains in `docs/_wip/plans/`:
- `2026-01-12-finish-line-workplan.md` - Remaining cleanup tasks
