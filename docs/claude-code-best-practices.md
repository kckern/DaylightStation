# Claude Code Best Practices for DaylightStation

**Document Type:** Developer Guide
**Date:** 2026-01-03
**Status:** Living Document
**Purpose:** Enable Claude Code to effectively understand, develop, test, deploy, and maintain DaylightStation

---

## Table of Contents

1. [Project Understanding](#project-understanding)
2. [Code Writing Standards](#code-writing-standards)
3. [Testing Infrastructure](#testing-infrastructure)
4. [Log Analysis](#log-analysis)
5. [Documentation Standards](#documentation-standards)
6. [Architecture Maintenance](#architecture-maintenance)
7. [Anti-Pattern Detection](#anti-pattern-detection)
8. [Deployment Management](#deployment-management)
9. [Configuration Management](#configuration-management)
10. [Open Source Readiness](#open-source-readiness)

---

## Project Understanding

### Project Structure

```
DaylightStation/
├── backend/
│   ├── api.mjs                          # Main Express API server
│   ├── chatbots/                        # Bot framework (homebot, nutribot, etc.)
│   │   ├── _lib/config/                 # Bot configuration infrastructure
│   │   ├── adapters/                    # HTTP, WebSocket adapters
│   │   └── bots/                        # Individual bot implementations
│   ├── lib/                             # Shared backend utilities
│   │   ├── config/                      # ConfigService, UserService, pathResolver
│   │   ├── logging/                     # DaylightLogger infrastructure
│   │   ├── buxfer.mjs                   # Finance API integration
│   │   ├── fitsync.mjs                  # Fitness data sync
│   │   └── thermalprint.mjs             # Receipt printer integration
│   ├── routers/                         # Express route handlers
│   │   ├── cron.mjs                     # Scheduled tasks
│   │   ├── fetch.mjs                    # Proxy/fetch endpoints
│   │   ├── fitness.mjs                  # Fitness API endpoints
│   │   └── websocket.mjs                # WebSocket message handlers
│   └── scripts/                         # Maintenance scripts
├── frontend/
│   ├── src/
│   │   ├── Apps/                        # Top-level app entry points
│   │   │   ├── FitnessApp.jsx           # Fitness tracking app
│   │   │   ├── HomeApp.jsx              # Home automation
│   │   │   ├── OfficeApp.jsx            # Office dashboard
│   │   │   └── LifelogApp.jsx           # Life logging
│   │   ├── context/                     # React contexts
│   │   │   └── FitnessContext.jsx       # Fitness state management
│   │   ├── hooks/                       # Custom React hooks
│   │   │   └── fitness/                 # Fitness domain hooks
│   │   │       ├── FitnessSession.js    # Session management
│   │   │       ├── TreasureBox.js       # Coin accumulation
│   │   │       ├── GovernanceEngine.js  # Policy enforcement
│   │   │       ├── ParticipantRoster.js # Participant tracking
│   │   │       └── DeviceManager.js     # Device management
│   │   ├── modules/                     # Feature modules
│   │   │   └── Fitness/                 # Fitness UI components
│   │   ├── lib/                         # Frontend utilities
│   │   │   ├── api.mjs                  # API client
│   │   │   └── logging/                 # Frontend logging
│   │   └── main.jsx                     # React app entry
│   └── vite.config.js                   # Vite build configuration
├── docs/                                # All documentation
│   ├── postmortem-*.md                  # Incident postmortems
│   ├── design/                          # Architecture decisions
│   ├── bugs/                            # Bug analysis
│   └── improvements/                    # Enhancement proposals
└── data/                                # Runtime data (gitignored)
    └── households/
        └── default/
            ├── apps/                    # App-specific config
            │   └── fitness/
            │       └── config.yml       # Fitness app configuration
            └── users/                   # User profiles and data
```

### Key Architectural Patterns

#### 1. **Chatbot Framework**
- **Pattern:** Adapter-based bot architecture
- **Location:** `backend/chatbots/`
- **Key Concepts:**
  - Bots extend base bot class
  - ConfigProvider manages bot configuration
  - Adapters translate between protocols (HTTP, Canvas)
  - Message builders format responses

#### 2. **Fitness Session Entity Architecture**
- **Pattern:** Session Entity (participation instance)
- **Location:** `frontend/src/hooks/fitness/`
- **Key Concepts:**
  - **Profile:** Who someone is (persistent identity)
  - **Entity:** A participation instance in a session
  - **Device:** Physical hardware (heart rate monitors)
  - **Ledger:** Device assignment tracking
  - **Roster:** Current session participants

**See:** `docs/design/session-entity-justification.md`

#### 3. **Configuration Management**
- **Pattern:** Hierarchical YAML configs with fallbacks
- **Location:** `backend/lib/config/`, `data/households/`
- **Key Concepts:**
  - Household-level configs
  - App-level configs
  - User-level preferences
  - Fallback to defaults

#### 4. **DaylightLogger**
- **Pattern:** Structured logging with WebSocket transport
- **Location:** `backend/lib/logging/`, `frontend/src/lib/logging/`
- **Key Concepts:**
  - Event-based logging (not message strings)
  - Contextual metadata
  - Frontend → Backend log forwarding via WebSocket
  - Persistent logs to `dev.log`

---

## Code Writing Standards

### File Naming Conventions

```javascript
// CORRECT: PascalCase for React components
FitnessApp.jsx
GovernanceEngine.js
ParticipantRoster.js

// CORRECT: camelCase for utilities/services
pathResolver.mjs
configService.mjs
userService.mjs

// CORRECT: kebab-case for documentation
claude-code-best-practices.md
postmortem-governance-entityid-failure.md
```

### Import Style

```javascript
// CORRECT: Use .mjs for ES modules (backend)
import { ConfigService } from './lib/config/ConfigService.mjs';
import express from 'express';

// CORRECT: Use .jsx for React components (frontend)
import FitnessApp from './Apps/FitnessApp.jsx';
import { FitnessProvider } from './context/FitnessContext.jsx';

// CORRECT: Use .js for plain JavaScript (frontend hooks)
import { FitnessSession } from './hooks/fitness/FitnessSession.js';
```

### Code Organization Principles

#### 1. **Single Responsibility Principle**

```javascript
// GOOD: Each class has one clear responsibility
class TreasureBox {
  // ONLY handles coin accumulation and zone tracking
}

class GovernanceEngine {
  // ONLY handles policy evaluation
}

class ParticipantRoster {
  // ONLY handles roster computation
}

// BAD: God class doing everything
class FitnessSession {
  // Manages devices, participants, timeline, governance, zones...
  // TOO MANY RESPONSIBILITIES
}
```

#### 2. **Explicit Over Implicit**

```javascript
// GOOD: Explicit identifier types
interface GovernanceInput {
  activeParticipants: string[];  // Array of userIds (e.g., "kckern", "milo")
  userZoneMap: Record<string, string>;  // Map userId -> zoneId
}

// BAD: Implicit assumptions
function evaluate(participants, zones) {
  // What type are participants? Names? IDs? EntityIds? 🤷
}
```

#### 3. **Fail Loudly**

```javascript
// GOOD: Explicit error on missing data
const zone = userZoneMap[userId];
if (!zone) {
  getLogger().error('zone_lookup_failed', {
    userId,
    availableKeys: Object.keys(userZoneMap)
  });
  throw new Error(`Zone not found for user: ${userId}`);
}

// BAD: Silent failure with default
const zone = userZoneMap[userId] || 'unknown';
```

#### 4. **Document Data Contracts**

```javascript
/**
 * Build governance evaluation inputs
 * @returns {Object} Governance inputs
 * @returns {string[]} return.activeParticipants - Array of userIds (NOT names, NOT entityIds)
 * @returns {Record<string, string>} return.userZoneMap - Map userId -> zoneId
 * @returns {Record<string, number>} return.zoneRankMap - Map zoneId -> rank (0-4)
 */
buildGovernanceInputs() {
  // ...
}
```

### Identifier Usage Rules

**CRITICAL:** Always use stable, unique identifiers as dictionary keys

```javascript
// ✅ CORRECT: Use userId as key
const userZoneMap = {};
roster.forEach(entry => {
  const userId = entry.id || entry.profileId;
  userZoneMap[userId] = entry.zoneId;
});

// ❌ WRONG: Use name as key (case-sensitive, not unique)
const userZoneMap = {};
roster.forEach(entry => {
  userZoneMap[entry.name] = entry.zoneId;  // FRAGILE!
});
```

**Identifier Type Reference:**

| Type | Format | Example | Use Case |
|------|--------|---------|----------|
| **userId** | String (lowercase) | `"kckern"`, `"milo"` | Persistent user identity |
| **entityId** | `entity-{timestamp}-{hash}` | `"entity-1735689600000-abc"` | Session participation instance |
| **deviceId** | String | `"42"`, `"device-abc123"` | Physical device ID |
| **name** | String (any case) | `"Alan"`, `"KC Kern"` | **Display ONLY, NOT for keys** |

**Rule:** Always use `userId` or `entityId` as dictionary keys, NEVER `name`.

---

## Testing Infrastructure

### Test Household Setup

**Location:** `data/households/test/`

```yaml
# Structure
data/
└── households/
    ├── default/          # Production household
    └── test/             # Test household (gitignored)
        ├── apps/
        │   ├── fitness/
        │   │   └── config.yml
        │   └── lifelog/
        │       └── config.yml
        └── users/
            ├── test-user-1.yml
            ├── test-user-2.yml
            └── test-guest.yml
```

#### Test User Configuration

```yaml
# data/households/test/users/test-user-1.yml
userId: test-user-1
name: Test User 1
email: test1@example.com
profiles:
  fitness:
    zones:
      cool: { min: 0, max: 100 }
      active: { min: 100, max: 120 }
      warm: { min: 120, max: 140 }
      hot: { min: 140, max: 160 }
      fire: { min: 160, max: 220 }
```

#### Test Fitness Configuration

```yaml
# data/households/test/apps/fitness/config.yml
governance:
  grace_period_seconds: 5  # Short for testing
  superusers:
    - test-user-1
  policies:
    test-policy:
      base_requirement:
        - active: all
      min_participants: 1

treasure_box:
  coin_time_unit_ms: 1000  # 1 second for fast testing
  zones:
    cool: { rank: 0, coins_per_unit: 1 }
    active: { rank: 1, coins_per_unit: 2 }
    warm: { rank: 2, coins_per_unit: 3 }
    hot: { rank: 3, coins_per_unit: 4 }
    fire: { rank: 4, coins_per_unit: 5 }
```

### Test Types and Locations

#### 1. Unit Tests

**Pattern:** Test individual functions/classes in isolation

**Location:** `tests/unit/`

```javascript
// tests/unit/GovernanceEngine.test.js
import { GovernanceEngine } from '../../frontend/src/hooks/fitness/GovernanceEngine.js';

describe('GovernanceEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new GovernanceEngine();
    engine.configure({
      policies: {
        'test-policy': {
          baseRequirement: [{ active: 'all' }],
          minParticipants: 2
        }
      }
    });
  });

  test('detects all users in active zone or higher', () => {
    const result = engine.evaluate({
      activeParticipants: ['user1', 'user2'],
      userZoneMap: {
        'user1': 'fire',
        'user2': 'hot'
      },
      zoneRankMap: {
        'cool': 0,
        'active': 1,
        'warm': 2,
        'hot': 3,
        'fire': 4
      }
    });

    expect(result.satisfied).toBe(true);
    expect(result.actualCount).toBe(2);
  });

  test('fails when user below active zone', () => {
    const result = engine.evaluate({
      activeParticipants: ['user1', 'user2'],
      userZoneMap: {
        'user1': 'fire',
        'user2': 'cool'  // Below active
      },
      zoneRankMap: {
        'cool': 0,
        'active': 1,
        'fire': 4
      }
    });

    expect(result.satisfied).toBe(false);
    expect(result.actualCount).toBe(1);
    expect(result.missingUsers).toContain('user2');
  });
});
```

**Run:** `npm run test:unit`

#### 2. Integration Tests

**Pattern:** Test multiple components working together

**Location:** `tests/integration/`

```javascript
// tests/integration/fitness-session.test.js
import { FitnessSession } from '../../frontend/src/hooks/fitness/FitnessSession.js';
import { TreasureBox } from '../../frontend/src/hooks/fitness/TreasureBox.js';
import { GovernanceEngine } from '../../frontend/src/hooks/fitness/GovernanceEngine.js';

describe('Fitness Session Integration', () => {
  let session;

  beforeEach(() => {
    // Set up complete session with all subsystems
    const treasureBox = new TreasureBox();
    const governance = new GovernanceEngine();

    session = new FitnessSession({
      sessionId: 'test-session-1',
      treasureBox,
      governance
    });

    session.start();
  });

  test('participant flow: add → heart rate → zone → coins → governance', () => {
    // Add participant
    session.addParticipant({
      userId: 'test-user-1',
      name: 'Test User',
      deviceId: '42'
    });

    // Simulate heart rate data
    session.recordHeartRate('42', 150);  // Hot zone

    // Update snapshot (triggers all subsystems)
    session.updateSnapshot();

    // Verify TreasureBox tracked coins
    const coins = session.getUserCoins('test-user-1');
    expect(coins).toBeGreaterThan(0);

    // Verify GovernanceEngine detected user
    const governanceResult = session.getGovernanceStatus();
    expect(governanceResult.actualCount).toBe(1);
    expect(governanceResult.satisfied).toBe(true);
  });

  test('identifier consistency across subsystems', () => {
    session.addParticipant({ userId: 'user1', deviceId: '1' });
    session.addParticipant({ userId: 'user2', deviceId: '2' });

    session.recordHeartRate('1', 140);
    session.recordHeartRate('2', 160);

    session.updateSnapshot();

    // Verify all subsystems use same identifier
    const roster = session.getRoster();
    const activeParticipants = session.getActiveParticipants();
    const governanceInputs = session.buildGovernanceInputs();

    // All should use userId as key
    expect(activeParticipants).toContain('user1');
    expect(activeParticipants).toContain('user2');
    expect(Object.keys(governanceInputs.userZoneMap)).toContain('user1');
    expect(Object.keys(governanceInputs.userZoneMap)).toContain('user2');
  });
});
```

**Run:** `npm run test:integration`

#### 3. End-to-End Tests

**Pattern:** Test complete user workflows with real browser

**Location:** `tests/e2e/`

**Tool:** Playwright or Puppeteer

```javascript
// tests/e2e/fitness-app.spec.js
import { test, expect } from '@playwright/test';

test.describe('Fitness App E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Set test household
    process.env.HOUSEHOLD = 'test';

    // Navigate to fitness app
    await page.goto('http://localhost:5173/fitness');

    // Wait for app to load
    await page.waitForSelector('[data-testid="fitness-app"]');
  });

  test('complete workout session flow', async ({ page }) => {
    // 1. Start session
    await page.click('[data-testid="start-session"]');
    await expect(page.locator('[data-testid="session-active"]')).toBeVisible();

    // 2. Add participant
    await page.click('[data-testid="add-participant"]');
    await page.fill('[data-testid="user-select"]', 'test-user-1');
    await page.click('[data-testid="device-select-42"]');
    await page.click('[data-testid="confirm-assignment"]');

    // 3. Verify participant appears in roster
    await expect(page.locator('[data-testid="roster-entry-test-user-1"]')).toBeVisible();

    // 4. Simulate heart rate (via WebSocket mock)
    await page.evaluate(() => {
      window.mockHeartRate('42', 150);
    });

    // 5. Verify zone display
    await expect(page.locator('[data-testid="user-zone-test-user-1"]')).toHaveText('hot');

    // 6. Verify coins accumulating
    const initialCoins = await page.locator('[data-testid="user-coins-test-user-1"]').textContent();
    await page.waitForTimeout(2000);  // Wait for coins to accumulate
    const updatedCoins = await page.locator('[data-testid="user-coins-test-user-1"]').textContent();
    expect(parseInt(updatedCoins)).toBeGreaterThan(parseInt(initialCoins));

    // 7. Verify governance overlay NOT blocking (user in hot zone)
    await expect(page.locator('[data-testid="governance-overlay"]')).not.toBeVisible();

    // 8. End session
    await page.click('[data-testid="end-session"]');
    await expect(page.locator('[data-testid="session-summary"]')).toBeVisible();
  });

  test('governance blocks when requirements not met', async ({ page }) => {
    await page.click('[data-testid="start-session"]');

    // Add user with low heart rate (cool zone)
    await page.evaluate(() => {
      window.addParticipant('test-user-1', '42');
      window.mockHeartRate('42', 80);  // Cool zone
    });

    // Start governed video
    await page.click('[data-testid="play-governed-video"]');

    // Verify governance overlay blocks playback
    await expect(page.locator('[data-testid="governance-overlay"]')).toBeVisible();
    await expect(page.locator('[data-testid="governance-message"]'))
      .toContainText('Waiting for participants');

    // Increase heart rate to meet requirement
    await page.evaluate(() => {
      window.mockHeartRate('42', 150);  // Hot zone
    });

    // Verify overlay disappears
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-testid="governance-overlay"]')).not.toBeVisible();
  });
});
```

**Run:** `npm run test:e2e`

#### 4. Puppeteer UI Tests

**Pattern:** Visual regression testing, screenshot comparison

**Location:** `tests/ui/`

```javascript
// tests/ui/fitness-ui.test.js
import puppeteer from 'puppeteer';
import { toMatchImageSnapshot } from 'jest-image-snapshot';

expect.extend({ toMatchImageSnapshot });

describe('Fitness App UI', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await puppeteer.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  beforeEach(async () => {
    page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto('http://localhost:5173/fitness');
  });

  test('fitness sidebar renders correctly', async () => {
    await page.waitForSelector('[data-testid="fitness-sidebar"]');

    const screenshot = await page.screenshot({
      clip: { x: 0, y: 0, width: 400, height: 1080 }
    });

    expect(screenshot).toMatchImageSnapshot({
      customSnapshotIdentifier: 'fitness-sidebar-default'
    });
  });

  test('governance overlay appearance', async () => {
    // Trigger governance overlay
    await page.evaluate(() => {
      window.showGovernanceOverlay({ message: 'Test governance message' });
    });

    await page.waitForSelector('[data-testid="governance-overlay"]');

    const screenshot = await page.screenshot();

    expect(screenshot).toMatchImageSnapshot({
      customSnapshotIdentifier: 'governance-overlay-visible'
    });
  });
});
```

**Run:** `npm run test:ui`

### Test Script Configuration

**Add to `package.json`:**

```json
{
  "scripts": {
    "test": "npm run test:unit && npm run test:integration",
    "test:unit": "NODE_ENV=test jest tests/unit --coverage",
    "test:integration": "NODE_ENV=test jest tests/integration",
    "test:e2e": "NODE_ENV=test playwright test tests/e2e",
    "test:ui": "NODE_ENV=test jest tests/ui",
    "test:all": "npm run test:unit && npm run test:integration && npm run test:e2e && npm run test:ui",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage --coverageReporters=html lcov"
  }
}
```

### Test Data Management

**Fixtures Location:** `tests/fixtures/`

```javascript
// tests/fixtures/users.js
export const testUsers = {
  user1: {
    userId: 'test-user-1',
    name: 'Test User 1',
    profiles: {
      fitness: {
        zones: {
          cool: { min: 0, max: 100 },
          active: { min: 100, max: 120 },
          warm: { min: 120, max: 140 },
          hot: { min: 140, max: 160 },
          fire: { min: 160, max: 220 }
        }
      }
    }
  },
  user2: {
    userId: 'test-user-2',
    name: 'Test User 2',
    profiles: { /* ... */ }
  },
  guest: {
    userId: 'test-guest',
    name: 'Guest User',
    isGuest: true
  }
};

// tests/fixtures/sessions.js
export const testSessions = {
  activeSession: {
    sessionId: 'test-session-active',
    status: 'active',
    participants: ['test-user-1', 'test-user-2']
  },
  emptySession: {
    sessionId: 'test-session-empty',
    status: 'active',
    participants: []
  }
};
```

---

## Log Analysis

### Local Development Logs

**Location:** `dev.log` (root directory)

**Format:** NDJSON (Newline-Delimited JSON)

```json
{"timestamp":"2026-01-03T04:30:15.123Z","event":"governance.evaluate.called","level":"warn","context":{"app":"frontend"},"data":{"activeParticipantsCount":5,"hasMedia":true}}
{"timestamp":"2026-01-03T04:30:15.234Z","event":"treasurebox.tick","level":"info","context":{"app":"backend"},"data":{"tick":42,"participants":["kckern","milo"]}}
```

#### Reading Logs with Claude

**Command Examples:**

```bash
# Show recent errors
tail -100 dev.log | grep '"level":"error"'

# Show governance events
tail -200 dev.log | grep -E "governance\.(evaluate|policy|requirement)"

# Show specific event type
tail -500 dev.log | grep '"event":"treasurebox.tick"'

# Show all events from frontend
tail -300 dev.log | grep '"app":"frontend"'

# Pretty-print JSON logs
tail -50 dev.log | jq '.'

# Filter by timestamp range (requires jq)
cat dev.log | jq 'select(.timestamp > "2026-01-03T04:00:00Z")'

# Show participant-related events
tail -200 dev.log | grep -E "participant\.(added|removed|zone|active)"
```

#### Log Analysis Patterns

**Pattern 1: Trace Event Flow**

```bash
# Find all events in a specific session
cat dev.log | jq 'select(.data.sessionId == "abc123")'

# Trace participant through system
cat dev.log | jq 'select(.data.userId == "kckern" or .data.trackingId == "kckern")'
```

**Pattern 2: Identify Performance Issues**

```bash
# Find slow operations (custom field)
cat dev.log | jq 'select(.data.durationMs > 1000)'

# Find frequent events (count by event type)
cat dev.log | jq -r '.event' | sort | uniq -c | sort -rn
```

**Pattern 3: Debug Data Flow**

```bash
# Show governance inputs
tail -100 dev.log | jq 'select(.event == "governance.evaluate.inputs")'

# Show TreasureBox state
tail -100 dev.log | jq 'select(.event | startswith("treasurebox."))'
```

#### Claude Log Reading Workflow

**When asked to "check logs":**

1. **Read recent logs:**
   ```bash
   tail -200 dev.log
   ```

2. **Filter to relevant events:**
   ```bash
   tail -500 dev.log | grep "governance"
   ```

3. **Analyze specific data fields:**
   ```bash
   cat dev.log | jq 'select(.event == "governance.evaluate.called") | .data'
   ```

4. **Report findings to user:**
   - Summarize what events occurred
   - Highlight errors or unexpected data
   - Identify missing events (e.g., "governance.evaluate never called")

### Production Logs (SSH)

**Location:** Remote server via SSH

**Access Pattern:**

```bash
# SSH into production server
ssh user@production-server

# Read logs
tail -f /var/log/daylightstation/app.log

# Search for errors in last hour
journalctl -u daylightstation --since "1 hour ago" | grep ERROR

# Export logs for analysis
scp user@production-server:/var/log/daylightstation/app.log ./prod.log
```

#### Production Log Analysis

**Pattern 1: Real-time Monitoring**

```bash
# Watch logs in real-time
ssh user@prod-server 'tail -f /var/log/daylightstation/app.log | grep -E "error|warn|critical"'
```

**Pattern 2: Download and Analyze Locally**

```bash
# Download last 10MB of logs
ssh user@prod-server 'tail -c 10M /var/log/daylightstation/app.log' > prod-recent.log

# Analyze locally
cat prod-recent.log | jq 'select(.level == "error")'
```

**Pattern 3: Aggregate Analysis**

```bash
# Count errors by event type (on server)
ssh user@prod-server 'cat /var/log/daylightstation/app.log | jq -r "select(.level == \"error\") | .event" | sort | uniq -c | sort -rn'
```

---

## Documentation Standards

### Function Documentation (JSDoc)

**Required for all public functions:**

```javascript
/**
 * Evaluate governance requirements for current session state
 *
 * @param {Object} inputs - Governance evaluation inputs
 * @param {string[]} inputs.activeParticipants - Array of userIds (e.g., ["kckern", "milo"])
 * @param {Record<string, string>} inputs.userZoneMap - Map userId -> zoneId (e.g., {"kckern": "fire"})
 * @param {Record<string, number>} inputs.zoneRankMap - Map zoneId -> rank (0-4, higher is more intense)
 * @param {Record<string, Object>} inputs.zoneInfoMap - Map zoneId -> zone metadata
 * @param {number} inputs.totalCount - Total participant count
 *
 * @returns {Object} Governance evaluation result
 * @returns {boolean} return.satisfied - Whether requirements are met
 * @returns {number} return.actualCount - Number of participants meeting requirements
 * @returns {string[]} return.missingUsers - UserIds of participants not meeting requirements
 * @returns {Object} return.requirement - The requirement that was evaluated
 *
 * @throws {Error} If no policy is configured
 *
 * @example
 * const result = engine.evaluate({
 *   activeParticipants: ['kckern', 'milo'],
 *   userZoneMap: { 'kckern': 'fire', 'milo': 'hot' },
 *   zoneRankMap: { 'cool': 0, 'active': 1, 'warm': 2, 'hot': 3, 'fire': 4 }
 * });
 * // { satisfied: true, actualCount: 2, missingUsers: [] }
 */
evaluate({ activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount }) {
  // Implementation...
}
```

### Architecture Documentation

**Create architecture decision records (ADRs):**

**Location:** `docs/design/`

**Template:**

```markdown
# ADR-001: Session Entity Architecture

**Date:** 2026-01-01
**Status:** Accepted
**Deciders:** Engineering Team

## Context

The previous architecture used profileId as the key for all tracking, making guest
reassignment impossible because profiles couldn't participate multiple times in
one session.

## Decision

Introduce Session Entity pattern: separate "who someone is" (profile) from "a
participation instance" (entity).

## Consequences

**Positive:**
- Guest reassignment works correctly
- Session audit trails preserved
- Profile aggregation possible

**Negative:**
- Additional complexity (entityId tracking)
- Dual-write during migration period
- More identifiers to manage

## References

- `docs/design/session-entity-justification.md`
- `docs/postmortem-entityid-migration-fitnessapp.md`
```

### Postmortem Documentation

**Create postmortems for all significant issues:**

**Location:** `docs/postmortem-{issue-name}.md`

**Required Sections:**
1. Executive Summary
2. Timeline
3. Root Cause Analysis
4. What Broke and Why
5. Architectural Defects Identified
6. Lessons Learned
7. Recommendations
8. What Still Needs To Be Done

**Example:** `docs/postmortem-governance-entityid-failure.md`

### API Documentation

**Document all API endpoints:**

**Location:** `docs/api/`

```markdown
# Fitness API Endpoints

## POST /api/fitness/session/start

Start a new fitness session.

**Request Body:**
```json
{
  "householdId": "default",
  "metadata": {
    "location": "gym"
  }
}
```

**Response:**
```json
{
  "sessionId": "session-1735689600000-abc123",
  "status": "active",
  "startTime": "2026-01-03T04:00:00Z"
}
```

**Errors:**
- `400` - Invalid request body
- `409` - Session already active
- `500` - Internal server error
```

### README Requirements

**Each major module should have a README:**

```markdown
# GovernanceEngine

Policy-based video lock mechanism for fitness app.

## Purpose

Blocks video playback until fitness requirements are met (e.g., all users in
active zone or higher).

## Usage

```javascript
import { GovernanceEngine } from './GovernanceEngine.js';

const engine = new GovernanceEngine();
engine.configure({ policies: { /* ... */ } });

const result = engine.evaluate({
  activeParticipants: ['user1'],
  userZoneMap: { 'user1': 'fire' }
});

if (!result.satisfied) {
  showVideoLock(result.missingUsers);
}
```

## Configuration

See `data/households/default/apps/fitness/config.yml` for policy configuration.

## Architecture

- **Policies:** Define requirements (base + challenges)
- **Requirements:** Zone-based or participant count rules
- **Evaluation:** Checks if current state satisfies active policy

## Related

- `docs/postmortem-governance-entityid-failure.md` - Major incident analysis
- `tests/unit/GovernanceEngine.test.js` - Unit tests
```

---

## Architecture Maintenance

### Architectural Principles

#### 1. **Domain-Driven Design**

Organize code by domain, not technical layer:

```
✅ GOOD:
frontend/src/hooks/fitness/
├── FitnessSession.js      # Session aggregate root
├── TreasureBox.js         # Coin domain
├── GovernanceEngine.js    # Policy domain
└── ParticipantRoster.js   # Roster domain

❌ BAD:
frontend/src/
├── models/
│   └── fitness.js
├── services/
│   └── fitnessService.js
└── utils/
    └── fitnessUtils.js
```

#### 2. **Bounded Contexts**

Each app is a bounded context with clear boundaries:

```
frontend/src/Apps/
├── FitnessApp.jsx     # Fitness bounded context
├── LifelogApp.jsx     # Lifelog bounded context
└── HomeApp.jsx        # Home automation bounded context
```

Don't leak domain concepts across contexts.

#### 3. **Dependency Inversion**

High-level modules don't depend on low-level modules:

```javascript
// GOOD: Session depends on abstractions
class FitnessSession {
  constructor({ treasureBox, governance }) {
    this.treasureBox = treasureBox;  // Injected dependency
    this.governance = governance;    // Injected dependency
  }
}

// BAD: Session creates dependencies directly
class FitnessSession {
  constructor() {
    this.treasureBox = new TreasureBox();  // Tight coupling
    this.governance = new GovernanceEngine();
  }
}
```

### Architecture Review Checklist

**Before committing significant changes:**

- [ ] Does this change introduce new dependencies?
- [ ] Are all public APIs documented (JSDoc)?
- [ ] Are identifiers used consistently (userId, not names)?
- [ ] Are errors logged explicitly (not silently caught)?
- [ ] Is the change covered by tests?
- [ ] Does it follow single responsibility principle?
- [ ] Is backward compatibility maintained?
- [ ] Are migrations complete (not half-done)?

### Architectural Diagrams

**Create diagrams for complex flows:**

**Location:** `docs/architecture/`

**Example:** Data flow diagram

```
DeviceManager
    ↓ (deviceId, HR value)
ParticipantRoster
    ↓ (roster with userId, zoneId)
FitnessSession.updateSnapshot()
    ├→ TreasureBox.processTick(activeParticipants: userId[])
    │      ↓ (accumulate coins by userId)
    │  Timeline.assignMetric('user:{userId}:coins', value)
    │
    └→ GovernanceEngine.evaluate({
           activeParticipants: userId[],
           userZoneMap: Record<userId, zoneId>
       })
           ↓ (satisfied: true/false)
       VideoPlayer (lock/unlock)
```

---

## Anti-Pattern Detection

### Common Anti-Patterns to Detect

#### 1. **Using Names as Dictionary Keys**

**Anti-pattern:**
```javascript
// ❌ BAD
const userZoneMap = {};
roster.forEach(entry => {
  userZoneMap[entry.name] = entry.zoneId;  // Case-sensitive, not unique
});
```

**Detection:**
```bash
grep -rn "\\.name\]" frontend/src/hooks/fitness/
grep -rn "\\.name}" frontend/src/hooks/fitness/
```

**Fix:**
```javascript
// ✅ GOOD
const userZoneMap = {};
roster.forEach(entry => {
  const userId = entry.id || entry.profileId;
  userZoneMap[userId] = entry.zoneId;
});
```

#### 2. **Silent Failures**

**Anti-pattern:**
```javascript
// ❌ BAD
const zone = userZoneMap[key] || 'unknown';  // Silently defaults
```

**Detection:**
```bash
grep -rn "|| 'unknown'" frontend/src/
grep -rn "|| 0" frontend/src/  # Check if fallback is intentional
```

**Fix:**
```javascript
// ✅ GOOD
const zone = userZoneMap[key];
if (!zone) {
  getLogger().error('zone_lookup_failed', { key, availableKeys: Object.keys(userZoneMap) });
  throw new Error(`Zone not found for key: ${key}`);
}
```

#### 3. **God Classes**

**Anti-pattern:**
```javascript
// ❌ BAD: Class with too many responsibilities
class FitnessSession {
  // Device management
  addDevice() { }
  removeDevice() { }

  // Participant management
  addParticipant() { }
  removeParticipant() { }

  // Timeline recording
  recordMetric() { }
  getTimeline() { }

  // Governance
  checkGovernance() { }
  evaluatePolicy() { }

  // Zone management
  calculateZone() { }
  updateZones() { }
}
```

**Detection:**
- Classes with >10 public methods
- Classes with >500 lines
- Files with multiple export classes

**Fix:** Split into single-responsibility classes

#### 4. **Incomplete Migrations**

**Anti-pattern:**
```javascript
// ❌ BAD: Half-migrated code
const key = entry.entityId || entry.id || entry.name;  // Supports 3 identifier types
```

**Detection:**
```bash
# Find all places using fallback chains
grep -rn "|| entry\\.id || entry\\.name" frontend/src/
grep -rn "|| entry\\.profileId || entry\\.entityId" frontend/src/
```

**Fix:** Complete migration to single identifier scheme

#### 5. **Magic Strings/Numbers**

**Anti-pattern:**
```javascript
// ❌ BAD
if (zone === 'fire' && rank >= 4) {
  // What does 4 mean?
}
```

**Detection:**
```bash
grep -rn "=== '[a-z]*'" frontend/src/  # Find string comparisons
grep -rn ">= [0-9]" frontend/src/  # Find numeric comparisons
```

**Fix:**
```javascript
// ✅ GOOD
const ZONE_FIRE = 'fire';
const MAX_ZONE_RANK = 4;

if (zone === ZONE_FIRE && rank >= MAX_ZONE_RANK) {
  // Clear intent
}
```

#### 6. **Implicit Dependencies**

**Anti-pattern:**
```javascript
// ❌ BAD: Relies on global state
function processUser(userId) {
  const user = window.currentSession.users[userId];  // Implicit dependency
}
```

**Detection:**
```bash
grep -rn "window\\." frontend/src/hooks/  # Find global state access
grep -rn "document\\." frontend/src/hooks/  # Should be in components, not hooks
```

**Fix:**
```javascript
// ✅ GOOD: Explicit dependencies
function processUser(userId, session) {
  const user = session.users[userId];
}
```

### Anti-Pattern Audit Script

**Create:** `scripts/audit-antipatterns.sh`

```bash
#!/bin/bash

echo "=== DaylightStation Anti-Pattern Audit ==="
echo ""

echo "1. Checking for name-based dictionary keys..."
grep -rn "\.name\]" frontend/src/hooks/fitness/ | wc -l

echo "2. Checking for silent failures (|| default)..."
grep -rn "|| '" frontend/src/hooks/fitness/ | wc -l

echo "3. Checking for magic strings..."
grep -rn "=== '[a-z]*'" frontend/src/hooks/fitness/ | wc -l

echo "4. Checking for global state access in hooks..."
grep -rn "window\." frontend/src/hooks/ | wc -l

echo "5. Checking for incomplete migrations (fallback chains)..."
grep -rn "|| entry\.id || entry\.name" frontend/src/ | wc -l

echo ""
echo "=== Detailed Findings ==="
echo ""

echo "## Name-based keys (should use userId):"
grep -rn "\.name\]" frontend/src/hooks/fitness/ || echo "None found"

echo ""
echo "## Silent failures:"
grep -rn "|| 'unknown'\||| 0" frontend/src/hooks/fitness/ || echo "None found"

echo ""
echo "Done."
```

**Run:** `npm run audit:antipatterns`

---

## Deployment Management

### Deployment Environments

#### 1. **Local Development**

**Environment:** `NODE_ENV=development`
**Data:** `data/households/default/`
**Logs:** `dev.log`
**URL:** `http://localhost:5173`

**Start:**
```bash
npm run dev
```

#### 2. **Test Environment**

**Environment:** `NODE_ENV=test`
**Data:** `data/households/test/`
**Logs:** `test.log`
**URL:** `http://localhost:5174`

**Start:**
```bash
HOUSEHOLD=test npm run dev
```

#### 3. **Production**

**Environment:** `NODE_ENV=production`
**Data:** `/var/lib/daylightstation/data/`
**Logs:** `/var/log/daylightstation/app.log`
**URL:** `https://daylight.yourdomain.com`

**Deploy:**
```bash
npm run build
npm run deploy:prod
```

### Pre-Deployment Checklist

**Before deploying to production:**

- [ ] All tests pass (`npm run test:all`)
- [ ] No console errors in browser
- [ ] Logs reviewed for warnings/errors
- [ ] Configuration validated (`npm run validate:config`)
- [ ] Database migrations applied (if any)
- [ ] Environment variables set correctly
- [ ] Backward compatibility verified
- [ ] Rollback plan documented
- [ ] Monitoring alerts configured
- [ ] Documentation updated

### Deployment Scripts

**Add to `package.json`:**

```json
{
  "scripts": {
    "build": "vite build",
    "build:test": "NODE_ENV=test vite build",
    "deploy:test": "npm run build:test && ./scripts/deploy-test.sh",
    "deploy:prod": "npm run build && ./scripts/deploy-prod.sh",
    "validate:config": "node scripts/validate-config.js",
    "db:migrate": "node scripts/migrate-database.js",
    "rollback": "./scripts/rollback.sh"
  }
}
```

### Deployment Process

#### Deploy to Production

```bash
# 1. Pre-deployment checks
npm run test:all
npm run validate:config

# 2. Build production bundle
npm run build

# 3. Backup current deployment
ssh user@prod-server './backup-current.sh'

# 4. Deploy new version
./scripts/deploy-prod.sh

# 5. Verify deployment
curl https://daylight.yourdomain.com/api/health

# 6. Monitor logs
ssh user@prod-server 'tail -f /var/log/daylightstation/app.log'

# 7. If issues, rollback
npm run rollback
```

#### Rollback Process

**Script:** `scripts/rollback.sh`

```bash
#!/bin/bash

echo "Rolling back deployment..."

# Stop current version
ssh user@prod-server 'systemctl stop daylightstation'

# Restore previous version
ssh user@prod-server 'cp -r /var/lib/daylightstation/backup/* /var/lib/daylightstation/current/'

# Restart service
ssh user@prod-server 'systemctl start daylightstation'

# Verify
curl https://daylight.yourdomain.com/api/health

echo "Rollback complete"
```

### Health Checks

**Create health check endpoint:**

```javascript
// backend/routers/health.mjs
export default function healthRouter(app) {
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      env: process.env.NODE_ENV
    });
  });
}
```

**Monitor:**
```bash
# Check health
curl http://localhost:3000/api/health

# Monitor continuously
watch -n 5 'curl -s http://localhost:3000/api/health | jq .'
```

---

## Configuration Management

### Configuration Hierarchy

```
1. Default configs (in code)
   ↓ (override)
2. Household-level configs (data/households/{household}/config.yml)
   ↓ (override)
3. App-level configs (data/households/{household}/apps/{app}/config.yml)
   ↓ (override)
4. User-level configs (data/households/{household}/users/{userId}.yml)
   ↓ (override)
5. Environment variables
```

### Configuration Files

#### Household Config

**Location:** `data/households/default/config.yml`

```yaml
household:
  id: default
  name: "My Household"
  timezone: "America/Los_Angeles"

logging:
  level: info
  outputs:
    - file
    - websocket

integrations:
  home_assistant:
    url: "http://homeassistant.local:8123"
    token: "${HOME_ASSISTANT_TOKEN}"  # From env var

  strava:
    client_id: "${STRAVA_CLIENT_ID}"
    client_secret: "${STRAVA_CLIENT_SECRET}"
```

#### App-Specific Config

**Location:** `data/households/default/apps/fitness/config.yml`

```yaml
governance:
  grace_period_seconds: 30
  superusers:
    - kckern
  policies:
    default:
      base_requirement:
        - active: all
      challenges:
        - interval: [30, 120]
          requirement:
            - fire: 1

treasure_box:
  coin_time_unit_ms: 5000
  zones:
    cool: { rank: 0, coins_per_unit: 1, color: "#3b82f6" }
    active: { rank: 1, coins_per_unit: 2, color: "#10b981" }
    warm: { rank: 2, coins_per_unit: 3, color: "#f59e0b" }
    hot: { rank: 3, coins_per_unit: 4, color: "#ef4444" }
    fire: { rank: 4, coins_per_unit: 5, color: "#dc2626" }

devices:
  heart_rate_monitors:
    - device_id: "42"
      name: "Monitor 1"
      type: "polar_h10"
```

### Configuration Loading

**Service:** `backend/lib/config/ConfigService.mjs`

```javascript
/**
 * Load configuration with fallback hierarchy
 * @param {string} household - Household ID
 * @param {string} app - App name (optional)
 * @param {string} userId - User ID (optional)
 * @returns {Object} Merged configuration
 */
export async function loadConfig(household, app = null, userId = null) {
  const configs = [];

  // 1. Load household config
  const householdConfig = await loadYaml(`data/households/${household}/config.yml`);
  configs.push(householdConfig);

  // 2. Load app config (if specified)
  if (app) {
    const appConfig = await loadYaml(`data/households/${household}/apps/${app}/config.yml`);
    configs.push(appConfig);
  }

  // 3. Load user config (if specified)
  if (userId) {
    const userConfig = await loadYaml(`data/households/${household}/users/${userId}.yml`);
    configs.push(userConfig);
  }

  // 4. Merge configs (later overrides earlier)
  const merged = deepMerge(...configs);

  // 5. Resolve environment variables
  return resolveEnvVars(merged);
}
```

### Environment Variable Resolution

```javascript
/**
 * Resolve environment variable references in config
 * Pattern: ${VAR_NAME} or ${VAR_NAME:default_value}
 */
function resolveEnvVars(config) {
  const envVarPattern = /\$\{([A-Z_]+)(?::([^}]+))?\}/g;

  return JSON.parse(
    JSON.stringify(config).replace(envVarPattern, (match, varName, defaultValue) => {
      return process.env[varName] || defaultValue || '';
    })
  );
}
```

**Example:**

```yaml
# config.yml
strava:
  client_id: "${STRAVA_CLIENT_ID:default-client-id}"
  client_secret: "${STRAVA_CLIENT_SECRET}"
```

**Resolves to:**
```javascript
{
  strava: {
    client_id: process.env.STRAVA_CLIENT_ID || 'default-client-id',
    client_secret: process.env.STRAVA_CLIENT_SECRET || ''
  }
}
```

### Config Validation

**Create validator:** `scripts/validate-config.js`

```javascript
import Ajv from 'ajv';
import { loadConfig } from '../backend/lib/config/ConfigService.mjs';

const ajv = new Ajv();

// Define JSON schema for fitness config
const fitnessConfigSchema = {
  type: 'object',
  required: ['governance', 'treasure_box'],
  properties: {
    governance: {
      type: 'object',
      required: ['grace_period_seconds', 'policies'],
      properties: {
        grace_period_seconds: { type: 'number', minimum: 0 },
        superusers: { type: 'array', items: { type: 'string' } },
        policies: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            required: ['base_requirement'],
            properties: {
              base_requirement: { type: 'array' },
              min_participants: { type: 'number', minimum: 1 }
            }
          }
        }
      }
    },
    treasure_box: {
      type: 'object',
      required: ['coin_time_unit_ms', 'zones'],
      properties: {
        coin_time_unit_ms: { type: 'number', minimum: 1000 },
        zones: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            required: ['rank', 'coins_per_unit'],
            properties: {
              rank: { type: 'number', minimum: 0 },
              coins_per_unit: { type: 'number', minimum: 0 }
            }
          }
        }
      }
    }
  }
};

const validate = ajv.compile(fitnessConfigSchema);

// Load and validate config
const config = await loadConfig('default', 'fitness');
const valid = validate(config);

if (!valid) {
  console.error('Config validation failed:');
  console.error(validate.errors);
  process.exit(1);
}

console.log('Config validation passed ✓');
```

**Run:** `npm run validate:config`

### Configuration Fallbacks

**Pattern:** Always provide safe defaults

```javascript
// GOOD: Safe fallbacks
const gracePeriod = config?.governance?.grace_period_seconds ?? 30;
const coinUnit = config?.treasure_box?.coin_time_unit_ms ?? 5000;

// BAD: No fallback, can break if config missing
const gracePeriod = config.governance.grace_period_seconds;  // Throws if undefined
```

---

## Open Source Readiness

### Pre-Open Source Checklist

**Before making repository public:**

- [ ] Remove all secrets from git history
- [ ] Remove hardcoded API keys, tokens, passwords
- [ ] Add comprehensive README
- [ ] Add LICENSE file
- [ ] Add CONTRIBUTING guide
- [ ] Add CODE_OF_CONDUCT
- [ ] Add issue templates
- [ ] Add PR template
- [ ] Document installation process
- [ ] Document configuration
- [ ] Remove personal data from commit history
- [ ] Add .gitignore for sensitive files
- [ ] Set up CI/CD for public repo
- [ ] Add security policy (SECURITY.md)

### Secret Removal

**Scan for secrets:**

```bash
# Install gitleaks
brew install gitleaks

# Scan repository
gitleaks detect --source . --verbose

# Scan specific file
gitleaks detect --source ./backend/api.mjs
```

**Remove secrets from history:**

```bash
# Use BFG Repo-Cleaner
brew install bfg

# Remove file from history
bfg --delete-files credentials.json

# Remove string patterns from history
bfg --replace-text passwords.txt  # File containing SECRET==> to replace

# Clean up
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

### Environment Variable Template

**Create:** `.env.example`

```bash
# DaylightStation Environment Variables

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=daylightstation
DB_USER=your-username
DB_PASSWORD=your-password

# Home Assistant
HOME_ASSISTANT_URL=http://homeassistant.local:8123
HOME_ASSISTANT_TOKEN=your-long-lived-access-token

# Strava
STRAVA_CLIENT_ID=your-client-id
STRAVA_CLIENT_SECRET=your-client-secret

# Buxfer (Finance)
BUXFER_USER=your-username
BUXFER_PASSWORD=your-password

# Node Environment
NODE_ENV=development
PORT=3000

# Logging
LOG_LEVEL=info
```

**Add to README:**

```markdown
## Environment Setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Fill in your credentials in `.env`

3. Never commit `.env` to git
```

### README Template

**Create:** `README.md`

```markdown
# DaylightStation

A personal dashboard for fitness tracking, life logging, home automation, and more.

## Features

- **Fitness Tracking:** Heart rate zones, coin accumulation, governance-based workouts
- **Life Logging:** Daily entries, gratitude tracking, voice memos
- **Home Automation:** Integration with Home Assistant
- **Finance:** Buxfer integration for expense tracking
- **Office Dashboard:** Task management, music control

## Installation

### Prerequisites

- Node.js 18+
- npm or yarn
- (Optional) Docker for containerized deployment

### Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/DaylightStation.git
   cd DaylightStation
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

4. Create household data directory:
   ```bash
   mkdir -p data/households/default
   ```

5. Start development server:
   ```bash
   npm run dev
   ```

6. Open http://localhost:5173

## Configuration

See `docs/configuration.md` for detailed configuration guide.

## Testing

```bash
# Run all tests
npm run test:all

# Run specific test suite
npm run test:unit
npm run test:integration
npm run test:e2e
```

## Documentation

- [Architecture Overview](docs/architecture-overview.md)
- [Configuration Guide](docs/configuration.md)
- [API Documentation](docs/api/)
- [Contributing Guide](CONTRIBUTING.md)

## License

MIT License - see [LICENSE](LICENSE) file for details

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## Support

- Issues: https://github.com/yourusername/DaylightStation/issues
- Discussions: https://github.com/yourusername/DaylightStation/discussions
```

### CONTRIBUTING Guide

**Create:** `CONTRIBUTING.md`

```markdown
# Contributing to DaylightStation

Thank you for your interest in contributing!

## Development Setup

See [README.md](README.md#installation) for installation instructions.

## Code Style

- Use ESLint configuration (`.eslintrc.js`)
- Format with Prettier
- Follow existing code conventions
- Add JSDoc comments to public functions

## Testing Requirements

All PRs must include tests:
- Unit tests for new functions/classes
- Integration tests for cross-module changes
- E2E tests for user-facing features

Run tests before submitting PR:
```bash
npm run test:all
```

## Commit Message Format

Use conventional commits:

```
feat: Add heart rate zone configuration
fix: Resolve governance detection bug
docs: Update API documentation
test: Add integration tests for TreasureBox
refactor: Split FitnessSession into smaller classes
```

## Pull Request Process

1. Fork the repository
2. Create feature branch (`git checkout -b feature/your-feature`)
3. Make changes and add tests
4. Run tests (`npm run test:all`)
5. Commit changes using conventional commits
6. Push to your fork
7. Open PR with clear description
8. Address review feedback

## Code Review Checklist

- [ ] Code follows project conventions
- [ ] All tests pass
- [ ] New code is covered by tests
- [ ] Documentation updated (if applicable)
- [ ] No secrets or personal data committed
- [ ] JSDoc comments added to public functions
- [ ] Identifiers used consistently (userId, not names)

## Questions?

Open an issue or discussion on GitHub.
```

### Security Policy

**Create:** `SECURITY.md`

```markdown
# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, email security@yourdomain.com with:
- Description of vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You should receive a response within 48 hours.

## Security Best Practices

When contributing:
- Never commit secrets, API keys, or passwords
- Use environment variables for sensitive data
- Validate all user input
- Sanitize data before database queries
- Use parameterized queries (prevent SQL injection)
- Escape user content before rendering (prevent XSS)

## Disclosure Policy

We follow responsible disclosure:
1. Vulnerability reported privately
2. Patch developed and tested
3. Patch released
4. Public disclosure (after users have time to update)
```

### License

**Create:** `LICENSE`

```
MIT License

Copyright (c) 2026 Your Name

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Claude Code Workflows

### Workflow 1: Understanding the Codebase

**When asked:** "How does X work?" or "Explain Y feature"

1. **Read relevant files:**
   ```bash
   Read frontend/src/hooks/fitness/GovernanceEngine.js
   Read docs/design/session-entity-justification.md
   ```

2. **Trace data flow:**
   - Find entry point (e.g., user action)
   - Follow through components
   - Document flow in response

3. **Identify key concepts:**
   - What problem does it solve?
   - What are the main abstractions?
   - How does it integrate with other systems?

### Workflow 2: Writing New Code

**When asked:** "Add feature X" or "Implement Y"

1. **Understand requirements:**
   - Ask clarifying questions if needed
   - Check existing similar features
   - Read related documentation

2. **Plan implementation:**
   - Use EnterPlanMode for non-trivial features
   - Break down into steps
   - Identify affected files

3. **Write code:**
   - Follow code standards
   - Add JSDoc documentation
   - Use consistent identifiers
   - Add logging for key events

4. **Add tests:**
   - Unit tests for functions
   - Integration tests for cross-module
   - E2E tests for user flows

5. **Update documentation:**
   - Update README if public API changes
   - Add architecture docs if needed
   - Document design decisions

### Workflow 3: Debugging Issues

**When asked:** "X is broken" or "Check logs"

1. **Read recent logs:**
   ```bash
   tail -200 dev.log | grep "error"
   ```

2. **Identify error patterns:**
   - What events are missing?
   - What data is unexpected?
   - When did it start failing?

3. **Trace code execution:**
   - Add checkpoint logging
   - Verify data flow
   - Check identifier consistency

4. **Fix root cause:**
   - Don't just patch symptoms
   - Fix architectural issues
   - Add prevention (tests, validation)

5. **Document findings:**
   - Create postmortem for significant issues
   - Update anti-pattern guide
   - Add to lessons learned

### Workflow 4: Running Tests

**When asked:** "Run tests" or "Check if tests pass"

1. **Run test suite:**
   ```bash
   npm run test:unit
   npm run test:integration
   ```

2. **Analyze failures:**
   - Read error messages
   - Check test logs
   - Identify root cause

3. **Fix failures:**
   - Update code if bug
   - Update tests if behavior changed
   - Add missing tests if needed

4. **Verify fix:**
   ```bash
   npm run test:all
   ```

### Workflow 5: Deployment

**When asked:** "Deploy to production" or "Release new version"

1. **Pre-deployment checks:**
   ```bash
   npm run test:all
   npm run validate:config
   npm run audit:antipatterns
   ```

2. **Build:**
   ```bash
   npm run build
   ```

3. **Deploy:**
   ```bash
   npm run deploy:prod
   ```

4. **Verify:**
   ```bash
   curl https://daylight.yourdomain.com/api/health
   ```

5. **Monitor:**
   ```bash
   ssh user@prod-server 'tail -f /var/log/daylightstation/app.log'
   ```

---

## Summary: Claude Code Capabilities

With this guide, Claude Code can:

✅ **Understand Code:**
- Read project structure
- Trace data flows
- Identify patterns and anti-patterns

✅ **Write Code:**
- Follow project conventions
- Use consistent identifiers
- Add proper documentation
- Write comprehensive tests

✅ **Run Tests:**
- Unit tests with Jest
- Integration tests
- E2E tests with Playwright
- UI tests with Puppeteer

✅ **Analyze Logs:**
- Read local dev.log
- SSH to production logs
- Filter and analyze events
- Identify patterns and issues

✅ **Document:**
- JSDoc function documentation
- Architecture decision records
- Postmortem reports
- API documentation

✅ **Maintain Architecture:**
- Review changes for principles
- Detect anti-patterns
- Suggest refactorings
- Ensure consistency

✅ **Deploy:**
- Run pre-deployment checks
- Build and deploy
- Verify deployment
- Monitor logs
- Rollback if needed

✅ **Manage Configs:**
- Load hierarchical configs
- Resolve environment variables
- Validate configurations
- Document config options

✅ **Prepare for Open Source:**
- Remove secrets
- Add necessary files (LICENSE, CONTRIBUTING)
- Document installation
- Set up CI/CD

---

**Document Owner:** KC Kern (with Claude Code assistance)
**Created:** 2026-01-03
**Status:** Living Document
**Next Review:** As project evolves

---

## Quick Reference

### Most Common Claude Commands

```bash
# Understand code
"How does GovernanceEngine work?"
"Explain the fitness session flow"

# Write code
"Add validation to TreasureBox.recordHeartRate()"
"Implement grace period transfer feature"

# Debug
"Check logs for governance errors"
"Why are coins not accumulating?"

# Test
"Run unit tests"
"Add integration test for governance detection"

# Deploy
"Deploy to production"
"Check production health"

# Document
"Document the ParticipantRoster class"
"Create postmortem for X bug"
```

### File Locations Quick Reference

| What | Where |
|------|-------|
| Frontend code | `frontend/src/` |
| Backend code | `backend/` |
| Tests | `tests/` |
| Documentation | `docs/` |
| Configuration | `data/households/*/apps/*/config.yml` |
| Logs (dev) | `dev.log` |
| Logs (prod) | `/var/log/daylightstation/app.log` |
