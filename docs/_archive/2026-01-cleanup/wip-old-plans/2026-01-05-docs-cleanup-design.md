# Docs Cleanup Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganize timeless docs into domain-based folders with consistent naming and freshness tracking.

**Architecture:** Domain folders (fitness, tv, home, bots, finance) plus core/ for infrastructure and runbooks/ for operations. ai-context/ remains as curated Claude primers.

**Tech Stack:** Bash for file operations, git for tracking.

---

## Final Folder Structure

```
docs/
├── ai-context/        # Claude primers (unchanged)
├── fitness/           # Fitness domain reference
├── tv/                # TV/media domain reference
├── home/              # Home/office domain reference
├── bots/              # Chatbots domain reference
├── finance/           # Finance domain reference
├── core/              # Infrastructure, cross-cutting
├── runbooks/          # Operational procedures
├── _archive/          # Obsolete docs (unchanged)
├── _wip/              # Work in progress
│   ├── incidents/     # Postmortems, incident reports
│   ├── bugs/
│   ├── plans/
│   └── ...
└── docs-last-updated.txt  # Commit SHA for freshness tracking
```

## Naming Convention

**File names:** kebab-case.md
- `fitness-chart-layout.md` not `FitnessChartLayout.md`
- `websocket-message-bus.md` not `WebsocketMessageBus.Readme.md`

**Doc header format:**

```markdown
# Document Title

> **Related code:** `backend/lib/fitsync.mjs`, `frontend/src/apps/fitness/`

Brief description of what this doc covers.

---

[content]
```

## Update Strategy

**Freshness tracking:** `docs/docs-last-updated.txt` contains commit SHA of last docs review.

**Audit workflow:**
```bash
# See what code changed since last docs update
git diff $(cat docs/docs-last-updated.txt)..HEAD --name-only

# After reviewing/updating docs, update the marker
git rev-parse HEAD > docs/docs-last-updated.txt
```

**CLAUDE.md rules:**
- When modifying code, check related docs (via "Related code:" headers)
- Run freshness audit periodically
- Point-in-time docs go in `_wip/` with date prefix
- Obsolete docs go in `_archive/`

## Migration Mapping

### design/ → domains

| File | Destination |
|------|-------------|
| fitness-chart-layout-manager.md | `fitness/` |
| fitness-data-flow.md | `fitness/` |
| fitness-entityid-nullability.md | `fitness/` |
| fitness-identifier-contract.md | `fitness/` |
| fitness-identifier-decision-tree.md | `fitness/` |
| fitness-navigation-redesign.md | `fitness/` |
| guest-switch-session-transition.md | `fitness/` |
| session-entity-justification.md | `fitness/` |
| short-id-migration.md | `fitness/` |
| POSE_DATA_LAYERS.md | `fitness/pose-data-layers.md` |
| tv-menu-navigation-refactor.md | `tv/` |
| tv-season-view-enhancement.md | `tv/` |
| MidiWebSocketBroadcaster.Design.md | `home/midi-websocket-broadcaster.md` |
| telegram-integration-design.md | `bots/` |
| lifelog-extractors.md | `bots/` |
| nutrition-goals-source-of-truth.md | `bots/` |
| debriefs-example.yml | `bots/` |
| WebsocketMessageBus.Readme.md | `core/websocket-message-bus.md` |
| PRD_MessageBus.md | `core/message-bus-prd.md` |
| three-tier-architecture.md | `core/` |
| harvester-bifurcation.md | `core/` |

### features/ → domains

| File | Destination |
|------|-------------|
| fitness-session-spec.md | `fitness/` |
| vibration-sensors-fitness.md | `fitness/` |
| ambient-led-configuration.md | `home/` |
| ambient-led-fitness-zones-prd.md | `home/` |
| ambient-led-troubleshooting.md | `home/` |
| FamilySelector.md | `core/family-selector.md` |
| menu-selection-persistence.md | `core/` |
| shopping-harvester.md | `finance/` |

### guides/ → core (merge similar)

| File | Destination |
|------|-------------|
| HARVESTER_TESTS_QUICKSTART.md | `core/harvester-testing.md` |
| HARVEST_TESTS_README.md | merge into above |
| logging-auditor-agent.md | `core/logging-auditor.md` |
| logging-code-auditor-agent.md | merge into above |

### ops/ → runbooks + _wip

| File | Destination |
|------|-------------|
| INCIDENT-2024-12-16-revision-state-bug.md | `_wip/incidents/2024-12-16-revision-state-bug.md` |
| clickup-workflow.md | `runbooks/` |
| nutribot-data-migration.md | `runbooks/` |
| plex-log-diagnosis.md | `runbooks/` |
| plex-permissions.md | `runbooks/` |
| plex-session-collision-fix.md | `runbooks/` |
| shaka-startup-resilience.md | `runbooks/` |
| telegram-deployment-runbook.md | `runbooks/` |

## CLAUDE.md Addition

```markdown
## Documentation Maintenance

### When to Update Docs
When modifying code, check if related docs need updating:
- Changed `backend/lib/fitsync.mjs`? Check `docs/fitness/` for docs with that path in "Related code"
- Changed `frontend/src/apps/tv/`? Check `docs/tv/`
- Changed core infrastructure? Check `docs/core/`

### Freshness Audit
Run `git diff $(cat docs/docs-last-updated.txt)..HEAD --name-only` to see code changes since last docs review. Cross-reference with doc headers to identify stale docs.

### Doc Standards
- All reference docs use kebab-case filenames
- All reference docs have "Related code:" header listing relevant paths
- Point-in-time docs go in `_wip/` with date prefix
- Obsolete docs go in `_archive/`
```

## Summary

- **42 files** to reorganize
- **~8 files** to rename (non-kebab-case)
- **~4 files** to merge (duplicate guides)
- **1 incident** to move to _wip/incidents/
- **1 new file** docs-last-updated.txt
- **CLAUDE.md** update with maintenance rules
