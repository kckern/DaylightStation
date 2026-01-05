# Claude-Ready Documentation System Design

**Date:** 2026-01-05
**Status:** Approved
**Purpose:** Make DaylightStation best-in-class for Claude Code sessions

---

## Overview

A curated AI context system that keeps CLAUDE.md lean while providing deep documentation Claude can pull in as needed. All environment-specific values (paths, hosts, ports) live in a single gitignored settings file.

---

## File Structure

```
DaylightStation/
├── CLAUDE.md                         # Version controlled - navigation hub
├── .claude/
│   └── settings.local.json           # Gitignored - all local paths/hosts/ports
└── docs/
    └── ai-context/
        ├── architecture.md           # Project structure, data flow, conventions, config
        ├── foundations.md            # Shared: Player, WebSocket, logging, exe.mjs, HA, etc.
        ├── fitness.md                # Fitness domain
        ├── home-office.md            # Home/Office domain (includes piano)
        ├── tv.md                     # TV/media domain
        ├── finance.md                # Finance domain
        ├── bots.md                   # Chatbots (journalist, nutribot)
        ├── cli-tools.md              # CLI reference + ClickUp workflow
        └── testing.md                # Test infrastructure
```

---

## CLAUDE.md Specification

### Role
Lean navigation hub - no hard-coded paths, hosts, or ports.

### Contents
1. **Environment instruction** - Read `.claude/settings.local.json` for all environment-specific values
2. **Generic devops patterns** - Mount concepts, dev workflow, logging approach
3. **Rules** - No auto-commit, no auto-deploy, docs in /docs folder
4. **Navigation table** - Points to ai-context files by topic/situation

### What Moves Out
- ClickUp workflow details → `cli-tools.md`
- Hard-coded paths/hosts/ports → `settings.local.json`

---

## settings.local.json Specification

### Current Keys (keep)
- `mounts.data` - Data mount path
- `mounts.media` - Media mount path

### New Keys (add)
- `hosts.prod` - Production SSH hostname
- `hosts.fitness` - Fitness client hostname
- `ports.frontend` - Frontend dev port
- `ports.backend` - Backend HTTP/WS port
- `ports.api` - Secondary API port
- `docker.container` - Docker container name
- `clickup.listIds` - Map of ClickUp list names to IDs
- `ssh.user` - SSH username for prod

---

## architecture.md Specification

### Priority Order
1. **Project structure** - Directory layout, where things live
2. **Data flow patterns** - Frontend ↔ backend, WebSocket, state management
3. **Code conventions** - Naming, file extensions (.mjs/.jsx/.js), import patterns
4. **Config system** - ConfigService, YAML hierarchy, environment variables
5. **CLI tools overview** - Brief mention, details in cli-tools.md

### Key Sections
- Top-level directory purpose
- Frontend structure (Apps, modules, hooks, context, lib)
- Backend structure (routers, lib, chatbots, jobs)
- How frontend talks to backend (REST, WebSocket)
- State management approach
- File naming conventions
- Import/export patterns

---

## foundations.md Specification

### Components to Document

1. **Player.jsx**
   - Media playback system
   - Backend service dependencies
   - State management
   - Events/callbacks

2. **WebSocket/MessageBus**
   - Connection management
   - Message types
   - Frontend subscription pattern
   - Backend broadcast pattern

3. **ContentScroller**
   - Purpose and usage
   - Configuration options
   - Integration with apps

4. **DaylightLogger**
   - Frontend logging
   - Backend logging
   - WebSocket transport
   - Event naming conventions

5. **API client (lib/api.mjs)**
   - Available methods
   - Error handling
   - Authentication

6. **Auth/UserService**
   - User identity model
   - Household context
   - Profile vs Entity distinction

7. **exe.mjs**
   - Purpose
   - Usage patterns
   - Safety considerations

8. **Home Assistant integration**
   - Connection setup
   - Entity control
   - Event subscription
   - Common use cases

9. **io.mjs**
   - YAML data access
   - Path resolution
   - Deprecation status (if applicable)

---

## Domain File Template

Each domain file follows this structure:

```markdown
# [Domain] Context

## Purpose
What this domain does - one paragraph overview.

## Key Concepts
Domain-specific terminology and mental models Claude needs to understand.

| Term | Definition |
|------|------------|
| ... | ... |

## Exports
Modules and components this domain provides for other apps to import.

| Export | Location | Used By |
|--------|----------|---------|
| ... | ... | ... |

## Imports
Dependencies this domain pulls from other domains or foundations.

| Import | From | Purpose |
|--------|------|---------|
| ... | ... | ... |

## File Locations

### Frontend
- `frontend/src/Apps/[App].jsx` - Main app entry
- `frontend/src/modules/[Domain]/` - UI components
- `frontend/src/hooks/[domain]/` - Domain hooks
- `frontend/src/context/[Domain]Context.jsx` - State management

### Backend
- `backend/routers/[domain].mjs` - API endpoints
- `backend/lib/[domain].mjs` - Business logic
- `backend/jobs/[domain]/` - Background jobs

### Config
- `data/households/{hid}/apps/[domain]/config.yml`

## Common Tasks
Typical things Claude helps with in this domain.

- Task 1: Brief description
- Task 2: Brief description
```

---

## Domain Files Overview

### fitness.md
- Sessions, entities, profiles
- Governance engine (video lock)
- TreasureBox (coins)
- Heart rate zones
- Device management
- Participant roster

### home-office.md
- Dashboard components
- Piano/MIDI integration
- Ambient controls
- Widget system

### tv.md
- Plex integration
- Media playback control
- Story/playlist system
- Season/episode navigation

### finance.md
- Buxfer integration
- Payroll sync
- Transaction display
- Budget tracking

### bots.md
- Bot framework architecture
- Journalist bot (lifelog)
- Nutribot (nutrition)
- Adapter pattern (HTTP, Canvas)
- Message builders

---

## cli-tools.md Specification

### Contents
1. **Available CLI tools** - What's in `cli/` folder
2. **clickup.cli.mjs** - Full ClickUp workflow (moved from CLAUDE.md)
3. **auth-validator.cli.mjs** - Purpose and usage
4. **fitsync-auth.cli.mjs** - Purpose and usage
5. **npm scripts** - Key package.json scripts

---

## testing.md Specification

### Contents
1. **Test infrastructure** - Jest, Playwright setup
2. **Test types** - Unit, integration, e2e, smoke
3. **Running tests** - Commands and options
4. **Test household** - Test data setup
5. **Writing tests** - Conventions and patterns

---

## Implementation Steps

1. **Expand settings.local.json** - Add new keys for hosts, ports, etc.
2. **Create docs/ai-context/ folder**
3. **Write architecture.md** - Project structure and patterns
4. **Write foundations.md** - Shared components
5. **Write domain files** - fitness, home-office, tv, finance, bots
6. **Write cli-tools.md** - CLI reference with ClickUp workflow
7. **Write testing.md** - Test infrastructure
8. **Refactor CLAUDE.md** - Slim down, add navigation, remove hard-coded values
9. **Update .gitignore** - Ensure settings.local.json is ignored (should already be)
10. **Test** - Start fresh Claude session, verify navigation works

---

## Success Criteria

- [ ] CLAUDE.md contains zero hard-coded paths, hosts, or ports
- [ ] Fresh Claude session can navigate to relevant context via CLAUDE.md pointers
- [ ] Each domain file follows the template consistently
- [ ] settings.local.json is the single source for environment values
- [ ] All files are version controlled except settings.local.json
- [ ] Existing docs/claude-code-best-practices.md content is incorporated or deprecated

---

## Notes

- The existing `docs/claude-code-best-practices.md` (2300+ lines) contains valuable content that should be reviewed and incorporated into the appropriate ai-context files
- AGENTS.md can remain minimal or be removed (currently just "document new functions")
- Consider adding a `CLAUDE.local.example.md` showing what keys exist in settings if helpful for open source
