# Comprehensive Parity Audit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Execute a full function parity audit across all domains, adapters, and infrastructure, then create a schema parity audit.

**Architecture:** This plan creates two audit documents: (1) Function Parity Audit comparing legacy lib/router functions to DDD equivalents, (2) Schema Parity Audit comparing data structures. Each audit task reads specific files, compares exports/methods, and documents gaps.

**Tech Stack:** Node.js, ES Modules, YAML schemas, Express routers

---

## Phase 1: Function Parity Audit - Domains

### Task 1.1: Audit Content Domain Parity

**Files:**
- Read Legacy: `backend/lib/plex.mjs`, `backend/lib/mediaMemory.mjs`
- Read DDD: `backend/src/1_domains/content/`, `backend/src/2_adapters/content/`
- Output: `docs/_wip/audits/2026-01-13-function-parity-audit.md`

**Step 1: Create audit document with header**

Create the audit file with this structure:
```markdown
# Function Parity Audit - All Domains, Adapters & Infrastructure

**Date:** 2026-01-13
**Scope:** Compare legacy `backend/lib/` and `backend/routers/` to DDD `backend/src/`

---

## Executive Summary

| Component | Legacy Functions | DDD Functions | Parity % | Status |
|-----------|------------------|---------------|----------|--------|
| Content | TBD | TBD | TBD | Pending |
| Fitness | TBD | TBD | TBD | Pending |
| Health | TBD | TBD | TBD | Pending |
| Finance | TBD | TBD | TBD | Pending |
| Messaging | TBD | TBD | TBD | Pending |
| Scheduling | TBD | TBD | TBD | Pending |
| AI | TBD | TBD | TBD | Pending |
| Home Automation | TBD | TBD | TBD | Pending |
| Harvesters | TBD | TBD | TBD | Pending |
| Infrastructure | TBD | TBD | TBD | Pending |

---

## 1. Content Domain

### 1.1 Legacy Functions (backend/lib/plex.mjs)

| Function | Lines | Purpose | Used By |
|----------|-------|---------|---------|
| TBD | TBD | TBD | TBD |

### 1.2 DDD Equivalents

| Legacy Function | DDD Location | DDD Method | Parity Notes |
|-----------------|--------------|------------|--------------|
| TBD | TBD | TBD | TBD |

### 1.3 Gap Analysis

| Gap | Legacy | DDD | Priority |
|-----|--------|-----|----------|
| TBD | TBD | TBD | TBD |
```

**Step 2: Audit Content domain functions**

Read and document:
- All exports from `backend/lib/plex.mjs` (972 lines)
- All exports from `backend/lib/mediaMemory.mjs` (146 lines)
- All methods in `PlexAdapter`, `FilesystemAdapter`
- All methods in `ContentSourceRegistry`, `QueueService`

**Step 3: Fill in Content section of audit**

**Step 4: Commit**

```bash
git add docs/_wip/audits/2026-01-13-function-parity-audit.md
git commit -m "$(cat <<'EOF'
docs: start function parity audit with Content domain

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.2: Audit Fitness Domain Parity

**Files:**
- Read Legacy: `backend/lib/fitsync.mjs` (419 lines)
- Read Legacy Router: `backend/routers/fitness.mjs` (1008 lines)
- Read DDD: `backend/src/1_domains/fitness/`, `backend/src/2_adapters/fitness/`
- Modify: `docs/_wip/audits/2026-01-13-function-parity-audit.md`

**Step 1: Audit Fitness legacy functions**

Document all exports from:
- `backend/lib/fitsync.mjs`
- `backend/routers/fitness.mjs` (11 endpoints)

**Step 2: Audit Fitness DDD functions**

Document all methods in:
- `SessionService`
- `ZoneService`
- `TimelineService`
- `Session`, `Participant`, `Zone` entities
- `AmbientLedAdapter`

**Step 3: Update audit document with Fitness section**

**Step 4: Commit**

```bash
git add docs/_wip/audits/2026-01-13-function-parity-audit.md
git commit -m "$(cat <<'EOF'
docs: add Fitness domain to function parity audit

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.3: Audit Health Domain Parity

**Files:**
- Read Legacy: `backend/lib/health.mjs` (224 lines), `backend/lib/withings.mjs` (323 lines), `backend/lib/strava.mjs` (451 lines), `backend/lib/garmin.mjs` (304 lines)
- Read Legacy Router: `backend/routers/health.mjs` (409 lines)
- Read DDD: `backend/src/1_domains/health/`, `backend/src/2_adapters/harvester/fitness/`
- Modify: `docs/_wip/audits/2026-01-13-function-parity-audit.md`

**Step 1: Audit Health legacy functions**

**Step 2: Audit Health DDD functions**

**Step 3: Update audit document**

**Step 4: Commit**

```bash
git add docs/_wip/audits/2026-01-13-function-parity-audit.md
git commit -m "$(cat <<'EOF'
docs: add Health domain to function parity audit

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.4: Audit Finance Domain Parity

**Files:**
- Read Legacy: `backend/lib/buxfer.mjs` (238 lines), `backend/lib/budget.mjs` (260 lines), `backend/lib/budgetlib/`
- Read DDD: `backend/src/1_domains/finance/`, `backend/src/2_adapters/finance/`, `backend/src/3_applications/finance/`
- Modify: `docs/_wip/audits/2026-01-13-function-parity-audit.md`

**Step 1: Audit Finance legacy functions**

**Step 2: Audit Finance DDD functions**

**Step 3: Update audit document**

**Step 4: Commit**

```bash
git add docs/_wip/audits/2026-01-13-function-parity-audit.md
git commit -m "$(cat <<'EOF'
docs: add Finance domain to function parity audit

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.5: Audit Messaging Domain Parity

**Files:**
- Read Legacy: `backend/lib/gmail.mjs` (119 lines), chatbot framework in `backend/chatbots/_lib/`
- Read DDD: `backend/src/1_domains/messaging/`, `backend/src/2_adapters/messaging/`
- Modify: `docs/_wip/audits/2026-01-13-function-parity-audit.md`

**Step 1: Audit Messaging legacy functions**

**Step 2: Audit Messaging DDD functions**

**Step 3: Update audit document**

**Step 4: Commit**

```bash
git add docs/_wip/audits/2026-01-13-function-parity-audit.md
git commit -m "$(cat <<'EOF'
docs: add Messaging domain to function parity audit

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.6: Audit Scheduling Domain Parity

**Files:**
- Read Legacy: `backend/lib/cron/TaskRegistry.mjs`, `backend/routers/cron.mjs` (420 lines)
- Read DDD: `backend/src/1_domains/scheduling/`, `backend/src/0_infrastructure/scheduling/`
- Modify: `docs/_wip/audits/2026-01-13-function-parity-audit.md`

**Step 1: Audit Scheduling legacy functions**

**Step 2: Audit Scheduling DDD functions**

**Step 3: Update audit document**

**Step 4: Commit**

```bash
git add docs/_wip/audits/2026-01-13-function-parity-audit.md
git commit -m "$(cat <<'EOF'
docs: add Scheduling domain to function parity audit

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Function Parity Audit - Adapters & Harvesters

### Task 2.1: Audit Third-Party API Adapters

**Files:**
- Read Legacy: `backend/lib/clickup.mjs`, `backend/lib/github.mjs`, `backend/lib/todoist.mjs`, `backend/lib/gcal.mjs`, `backend/lib/foursquare.mjs`, `backend/lib/lastfm.mjs`, `backend/lib/reddit.mjs`, `backend/lib/goodreads.mjs`, `backend/lib/letterboxd.mjs`
- Read DDD: `backend/src/2_adapters/harvester/`
- Modify: `docs/_wip/audits/2026-01-13-function-parity-audit.md`

**Step 1: List all legacy third-party API functions**

**Step 2: Map to DDD harvester equivalents**

**Step 3: Document gaps**

**Step 4: Commit**

```bash
git add docs/_wip/audits/2026-01-13-function-parity-audit.md
git commit -m "$(cat <<'EOF'
docs: add Third-Party API adapters to function parity audit

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.2: Audit AI/LLM Adapters

**Files:**
- Read Legacy: `backend/lib/gpt.mjs` (237 lines), `backend/lib/ai/`
- Read DDD: `backend/src/1_domains/ai/`, `backend/src/2_adapters/ai/`
- Modify: `docs/_wip/audits/2026-01-13-function-parity-audit.md`

**Step 1: Audit AI legacy functions**

**Step 2: Audit AI DDD functions**

**Step 3: Update audit document**

**Step 4: Commit**

```bash
git add docs/_wip/audits/2026-01-13-function-parity-audit.md
git commit -m "$(cat <<'EOF'
docs: add AI/LLM adapters to function parity audit

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.3: Audit Home Automation Adapters

**Files:**
- Read Legacy: `backend/lib/homeassistant.mjs`, `backend/routers/exe.mjs` (333 lines)
- Read DDD: `backend/src/1_domains/home-automation/`, `backend/src/2_adapters/home-automation/`
- Modify: `docs/_wip/audits/2026-01-13-function-parity-audit.md`

**Step 1: Audit Home Automation legacy functions**

**Step 2: Audit Home Automation DDD functions**

**Step 3: Update audit document**

**Step 4: Commit**

```bash
git add docs/_wip/audits/2026-01-13-function-parity-audit.md
git commit -m "$(cat <<'EOF'
docs: add Home Automation adapters to function parity audit

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.4: Audit Hardware Adapters

**Files:**
- Read Legacy: `backend/lib/thermalprint.mjs` (1247 lines), `backend/lib/mqtt.mjs`
- Read DDD: `backend/src/2_adapters/hardware/`
- Modify: `docs/_wip/audits/2026-01-13-function-parity-audit.md`

**Step 1: Audit Hardware legacy functions**

**Step 2: Audit Hardware DDD functions**

**Step 3: Update audit document**

**Step 4: Commit**

```bash
git add docs/_wip/audits/2026-01-13-function-parity-audit.md
git commit -m "$(cat <<'EOF'
docs: add Hardware adapters to function parity audit

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: Function Parity Audit - Infrastructure

### Task 3.1: Audit Core Infrastructure

**Files:**
- Read Legacy: `backend/lib/io.mjs` (671 lines), `backend/lib/config/`, `backend/lib/logging/`
- Read DDD: `backend/src/0_infrastructure/`
- Modify: `docs/_wip/audits/2026-01-13-function-parity-audit.md`

**Step 1: Audit Infrastructure legacy functions**

Document:
- io.mjs exports (YAML read/write, file operations)
- ConfigService legacy
- Logging infrastructure

**Step 2: Audit Infrastructure DDD functions**

Document:
- ConfigService (new)
- EventBus (WebSocket, MQTT adapters)
- Scheduler, TaskRegistry
- Logging transports

**Step 3: Update audit document**

**Step 4: Commit**

```bash
git add docs/_wip/audits/2026-01-13-function-parity-audit.md
git commit -m "$(cat <<'EOF'
docs: add Core Infrastructure to function parity audit

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.2: Audit Router Endpoints

**Files:**
- Read Legacy: All `backend/routers/*.mjs` (15 files, ~6000 lines)
- Read DDD: All `backend/src/4_api/routers/*.mjs` (28 files)
- Modify: `docs/_wip/audits/2026-01-13-function-parity-audit.md`

**Step 1: List all legacy endpoints by router**

**Step 2: Map to DDD router equivalents**

**Step 3: Document endpoint gaps**

**Step 4: Commit**

```bash
git add docs/_wip/audits/2026-01-13-function-parity-audit.md
git commit -m "$(cat <<'EOF'
docs: add Router Endpoints to function parity audit

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.3: Finalize Function Parity Audit

**Files:**
- Modify: `docs/_wip/audits/2026-01-13-function-parity-audit.md`

**Step 1: Update executive summary table with final counts**

**Step 2: Calculate overall parity percentage**

**Step 3: Prioritize remaining gaps**

**Step 4: Commit**

```bash
git add docs/_wip/audits/2026-01-13-function-parity-audit.md
git commit -m "$(cat <<'EOF'
docs: finalize function parity audit with summary

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: Schema Parity Audit

### Task 4.1: Create Schema Parity Audit - Entities

**Files:**
- Create: `docs/_wip/audits/2026-01-13-schema-parity-audit.md`
- Read: All entity files in `backend/src/1_domains/*/entities/`

**Step 1: Create schema audit document**

```markdown
# Schema Parity Audit - All Domains

**Date:** 2026-01-13
**Scope:** Compare data schemas between legacy YAML structures and DDD entities

---

## Executive Summary

| Domain | Legacy Schemas | DDD Entities | Parity % | Status |
|--------|----------------|--------------|----------|--------|
| Content | TBD | TBD | TBD | Pending |
| Fitness | TBD | TBD | TBD | Pending |
...

---

## 1. Content Domain Schemas

### 1.1 Legacy YAML Structure

Path: `data/households/{hid}/apps/tv/`

| File | Fields | Types |
|------|--------|-------|
| TBD | TBD | TBD |

### 1.2 DDD Entity Schema

| Entity | Properties | Types | Validation |
|--------|------------|-------|------------|
| Item | id, source, title, type, metadata | string, object | TBD |
| WatchState | playhead, duration, watchTime, playCount | number | TBD |

### 1.3 Schema Gaps

| Gap | Legacy | DDD | Migration Notes |
|-----|--------|-----|-----------------|
| TBD | TBD | TBD | TBD |
```

**Step 2: Document all DDD entity schemas**

**Step 3: Commit**

```bash
git add docs/_wip/audits/2026-01-13-schema-parity-audit.md
git commit -m "$(cat <<'EOF'
docs: start schema parity audit with entity analysis

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4.2: Audit YAML Data Schemas

**Files:**
- Read: Sample YAML files in `data/households/`
- Read: All YamlStore adapters in `backend/src/2_adapters/persistence/yaml/`
- Modify: `docs/_wip/audits/2026-01-13-schema-parity-audit.md`

**Step 1: Document legacy YAML file structures**

For each domain, document:
- File path pattern
- Top-level keys
- Nested structures
- Data types

**Step 2: Map to DDD store schemas**

**Step 3: Document migration requirements**

**Step 4: Commit**

```bash
git add docs/_wip/audits/2026-01-13-schema-parity-audit.md
git commit -m "$(cat <<'EOF'
docs: add YAML data schemas to schema parity audit

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4.3: Audit API Request/Response Schemas

**Files:**
- Read: Legacy router request handlers
- Read: DDD router request handlers
- Modify: `docs/_wip/audits/2026-01-13-schema-parity-audit.md`

**Step 1: Document legacy API schemas**

For key endpoints, document:
- Request body schema
- Response body schema
- Query parameters

**Step 2: Document DDD API schemas**

**Step 3: Identify breaking changes**

**Step 4: Commit**

```bash
git add docs/_wip/audits/2026-01-13-schema-parity-audit.md
git commit -m "$(cat <<'EOF'
docs: add API schemas to schema parity audit

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4.4: Finalize Schema Parity Audit

**Files:**
- Modify: `docs/_wip/audits/2026-01-13-schema-parity-audit.md`

**Step 1: Update executive summary**

**Step 2: Create migration checklist**

**Step 3: Prioritize schema changes**

**Step 4: Commit**

```bash
git add docs/_wip/audits/2026-01-13-schema-parity-audit.md
git commit -m "$(cat <<'EOF'
docs: finalize schema parity audit with migration checklist

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

| Phase | Tasks | Focus |
|-------|-------|-------|
| 1 | 1.1-1.6 | Domain function parity (Content, Fitness, Health, Finance, Messaging, Scheduling) |
| 2 | 2.1-2.4 | Adapter function parity (Third-party, AI, Home Automation, Hardware) |
| 3 | 3.1-3.3 | Infrastructure function parity (Core, Routers, Summary) |
| 4 | 4.1-4.4 | Schema parity (Entities, YAML, API, Summary) |

**Total Tasks:** 13
**Output Files:** 2 audit documents
- `docs/_wip/audits/2026-01-13-function-parity-audit.md`
- `docs/_wip/audits/2026-01-13-schema-parity-audit.md`
