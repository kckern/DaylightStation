# ClickUp Workflow for DaylightStation

This document defines how ClickUp is used as the primary interface for designing, assigning, and shipping work on the DaylightStation project with GitHub Copilot as the AI development partner.

## Folder Structure

**ClickUp Folder:** [DaylightStation](https://app.clickup.com/3833120/v/o/f/12120791?pr=5887321)

### List → Project Area Mapping

| List | ID | Project Area | Description |
|------|-----|--------------|-------------|
| **TV View** | `901607520316` | `frontend/src/apps/tv/`, `backend/story/` | Display modules, shaders, watchlist, news, gratitude, audiobooks |
| **Finances** | `24805956` | `frontend/src/apps/finances/`, `backend/jobs/finance/` | Budget tracking, spending drilldown, account management, payroll |
| **Home/Office** | `901606966797` | `frontend/src/apps/home/`, `backend/lib/homeassistant.mjs` | Home automation, office programs, calendar, entropy tracking |
| **Journalist / Lifelog** | `901606966817` | `backend/chatbots/bots/journalist/`, `backend/lib/` | Journaling bot, lifelog data collection, API integrations |
| **Nutribot / Health** | `901606966820` | `backend/chatbots/bots/nutribot/`, `frontend/src/apps/health/` | Nutrition tracking, coaching, health data visualization |
| **Fitness** | `901610284012` | `_extentions/fitness/`, `backend/lib/fitsync.mjs` | FitnessApp on garage, workout programs, challenges, metrics |
| **Admin / Config** | `901612664297` | `backend/lib/config/`, `config/` | System configuration, shared services, admin interfaces |

---

## Task Statuses & Workflow

### Status Flow

```
backlog → on deck → in progress → ready → done
              ↓
           blocked
```

### Status Definitions

| Status | Meaning | Who Acts |
|--------|---------|----------|
| **backlog** | Idea captured, not prioritized | - |
| **on deck** | Design & PRD phase - requirements being refined | Copilot writes PRD, user reviews |
| **in progress** | Actively being implemented & tested | Copilot coding & testing |
| **ready** | PR ready for review | User reviews code |
| **done** | Merged and deployed | - |
| **blocked** | Waiting on external dependency | - |

---

## Development Lifecycle

### Phase 1: Requirements (User → ClickUp)

1. User creates task in appropriate list
2. User writes requirements in task description:
   - **Goal**: What should this accomplish?
   - **Acceptance Criteria**: How do we know it's done?
   - **Context**: Related files, dependencies, background
3. User sets status to `on deck`

### Phase 2: Design (Copilot → ClickUp Comments) - ON DECK

1. Copilot picks up `on deck` tasks
2. Copilot posts detailed PRD as a comment:
   - **Technical Approach**
   - **Files to Create/Modify**
   - **API Changes** (if any)
   - **Test Plan**
   - **Estimated Complexity** (S/M/L)
3. Copilot adds comment: "📋 PRD ready for review"
4. User reviews PRD, asks questions via comments
5. Iterate until user approves
6. User comments: "✅ Approved - proceed with implementation"

### Phase 3: Implementation (Copilot → Codebase) - IN PROGRESS

1. Copilot sets status to `in progress`
2. Copilot implements the feature:
   - Creates/modifies files per PRD
   - Writes tests
   - Ensures no regressions
3. Copilot runs tests, posts results as comment
4. Copilot creates git branch and commits
5. Copilot comments: "🔧 Implementation complete"
6. Copilot sets status to `ready`

### Phase 4: Review (User → GitHub/ClickUp) - READY

1. PR is ready for user review
2. User reviews code changes
3. User approves or requests changes via comments
4. If changes needed → back to `in progress`
5. If approved → User comments: "🚀 Ship it"

### Phase 5: Ship (User → Production)

1. User runs `./deploy.sh` (manual per workspace rules)
2. Copilot sets status to `done`
3. Copilot adds final comment with deployment notes

---

## ClickUp Comment Templates

### PRD Comment (Copilot)
```markdown
## 📋 Product Requirements Document

### Technical Approach
[How the feature will be implemented]

### Files to Modify
- `path/to/file.mjs` - [changes]
- `path/to/new-file.mjs` - [new file purpose]

### API Changes
- [ ] New endpoint: `GET /api/...`
- [ ] Modified endpoint: `PUT /api/...`

### Test Plan
1. Unit tests for [component]
2. Integration test for [flow]
3. Manual verification: [steps]

### Complexity
**Medium** - Estimated 2-3 implementation cycles

---
📋 PRD ready for review
```

### Implementation Complete Comment (Copilot)
```markdown
## 🔧 Implementation Complete

### Changes Made
- [List of actual changes]

### Test Results
```
✅ All tests passing
- test_feature_x: PASS
- test_integration_y: PASS
```

### Files Changed
- `path/to/file.mjs` (+50, -10)

### Notes
[Any important observations]

---
Ready for review. Branch: `feature/task-id-description`
```

---

## CLI Commands

The ClickUp CLI at `cli/clickup.cli.mjs` supports this workflow:

```bash
# List all tasks in a list
node cli/clickup.cli.mjs tasks 901607520316

# Get task details
node cli/clickup.cli.mjs task <task-id>

# Update task status
node cli/clickup.cli.mjs update <task-id> --status "in progress"

# Add a comment (via interactive mode)
node cli/clickup.cli.mjs
```

---

## "Get to Work!" Protocol

When user says **"get to work!"**, Copilot will:

1. Query ClickUp for tasks in `on deck`, `in progress`, or `ready` status
2. Prioritize:
   - `in progress` tasks first (continue implementation)
   - `on deck` tasks (need PRD/design)
   - `ready` tasks (need review feedback addressed)
   - Tasks in the list matching current file context
3. Display task summary and begin work
4. Follow the lifecycle phases above

---

## Best Practices

### For User
- Write clear acceptance criteria
- Provide context links to related code
- Respond promptly to design questions
- Use reactions (👍) to acknowledge comments

### For Copilot
- Always check for pending tasks before starting new work
- Post PRD during `on deck` phase before implementation
- Move to `in progress` only after PRD approval
- Move to `ready` only after implementation & tests complete
- Update status at each phase transition
- Include test results in comments
- Never deploy without explicit user approval

---

## Configuration

**Team ID:** `3833120`  
**Folder ID:** `12120791`  
**API Token:** Stored in `config.secrets.yml` as `CLICKUP_PK`
