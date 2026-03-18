# Lifeplan Router Wiring & Seed Data Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the lifeplan domain router into the app so all `/api/v1/life/*` endpoints are reachable, create seed data, and verify with existing Playwright tests.

**Architecture:** The lifeplan domain is fully implemented (bootstrap, container, services, routers, frontend) but never connected to the app. Three changes are needed: (1) import and call `bootstrapLifeplan()` in `app.mjs`, (2) add `'/life': 'life'` to the route map in `api.mjs`, (3) pass lifeplan services to the agents router so the guide agent works. Seed data goes into the container's data volume at `data/users/kckern/lifeplan.yml`.

**Tech Stack:** Express.js, YAML persistence, Playwright for verification

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `backend/src/app.mjs:30-77` | Add import of `bootstrapLifeplan` |
| Modify | `backend/src/app.mjs:~587` | Call `bootstrapLifeplan()` after lifelog services |
| Modify | `backend/src/app.mjs:~1097` | Assign `v1Routers.life` |
| Modify | `backend/src/app.mjs:~1625` | Pass `lifeplanResult` to agents router |
| Modify | `backend/src/4_api/v1/routers/api.mjs:56-102` | Add `'/life': 'life'` to `routeMap` |
| Create | `data/users/kckern/lifeplan.yml` (in container) | Seed plan data |
| Verify | `tests/live/flow/life/life-app-happy-paths.runtime.test.mjs` | Existing Playwright tests |

---

### Task 1: Add lifeplan bootstrap import to app.mjs

**Files:**
- Modify: `backend/src/app.mjs:30-77`

- [ ] **Step 1: Add the import**

In the import block from `'./0_system/bootstrap.mjs'` (lines 30-77), there is no `bootstrapLifeplan`. It lives in a separate file at `backend/src/0_system/bootstrap/lifeplan.mjs`. Add a direct import after line 77:

```javascript
import { bootstrapLifeplan } from './0_system/bootstrap/lifeplan.mjs';
```

- [ ] **Step 2: Verify the import path resolves**

Run: `node -e "import('./backend/src/0_system/bootstrap/lifeplan.mjs').then(m => console.log(Object.keys(m)))"`
Expected: `['bootstrapLifeplan']`

If that doesn't work due to import aliases, just verify the file exists:
Run: `ls backend/src/0_system/bootstrap/lifeplan.mjs`
Expected: file exists

---

### Task 2: Call bootstrapLifeplan() in app.mjs

**Files:**
- Modify: `backend/src/app.mjs:~587` (after lifelog services block)

- [ ] **Step 1: Add the bootstrap call**

After the lifelog services block (line 586: `});` closing `createLifelogServices`), add:

```javascript
  // Lifeplan domain
  const lifeplanResult = bootstrapLifeplan({
    dataPath: path.join(dataBasePath, 'users'),
    aggregator: lifelogServices.lifelogAggregator,
    notificationService: null,
    clock: null,
    logger: rootLogger.child({ module: 'lifeplan' }),
  });
```

**Key detail:** `dataPath` must point to `data/users/` because `YamlLifePlanStore` builds paths as `path.join(basePath, username, 'lifeplan.yml')`. The store expects the users root directory, not the data root.

**Dependencies:** This uses `dataBasePath` (line 309), `lifelogServices` (line 583), and `rootLogger` — all already available at this point in the file.

- [ ] **Step 2: Verify `path` is imported**

Check that `import path from 'path'` exists at the top of `app.mjs`. It should — the file already uses `path.join()` elsewhere. If not, add it.

---

### Task 3: Mount the life router in v1Routers

**Files:**
- Modify: `backend/src/app.mjs:~1097` (after lifelog router block)

- [ ] **Step 1: Add the router assignment**

After the lifelog router block (line 1097: `});` closing `createLifelogApiRouter`), add:

```javascript
  // Lifeplan domain router
  v1Routers.life = lifeplanResult.router;
```

**Note:** Unlike other domains that call a `createXxxApiRouter()` factory, lifeplan's `bootstrapLifeplan()` already creates and returns the fully-assembled router. No additional wrapping needed.

---

### Task 4: Add route map entry in api.mjs

**Files:**
- Modify: `backend/src/4_api/v1/routers/api.mjs:56-102`

- [ ] **Step 1: Add the route entry**

In the `routeMap` object, add `'/life': 'life'` alongside the existing `'/lifelog': 'lifelog'` entry. Insert it right before `/lifelog` (line 76) so they're adjacent:

```javascript
    '/life': 'life',
    '/lifelog': 'lifelog',
```

- [ ] **Step 2: Add JSDoc for the new router**

In the JSDoc block above `createApiRouter` (lines 22-48), add after the lifelog entry (line 32):

```javascript
 * @param {express.Router} [config.routers.life] - Life (lifeplan) router
```

---

### Task 5: Wire lifeplan services into agents router

**Files:**
- Modify: `backend/src/app.mjs:~1625` (agents router creation)

The agents bootstrap at `bootstrap.mjs:2645-2666` already checks for `config.lifeplanServices` to register the `LifeplanGuideAgent`. Currently this property is never passed. Add it.

- [ ] **Step 1: Pass lifeplanServices to createAgentsApiRouter**

At line 1625, the `createAgentsApiRouter` call has config properties. Add `lifeplanServices` and `notificationService`:

```javascript
  v1Routers.agents = createAgentsApiRouter({
    logger: rootLogger.child({ module: 'agents-api' }),
    healthStore: healthServices.healthStore,
    healthService: healthServices.healthService,
    fitnessPlayableService,
    sessionService: fitnessServices.sessionService,
    mediaProgressMemory,
    dataService,
    configService,
    aiGateway: sharedAiGateway,
    httpClient: axios,
    lifeplanServices: {
      container: lifeplanResult.container,
      services: lifeplanResult.services,
      aggregator: lifelogServices.lifelogAggregator,
    },
  });
```

**Key:** The agents bootstrap at `bootstrap.mjs:2653-2662` accesses `config.lifeplanServices.container`, `config.lifeplanServices.services`, and `config.lifeplanServices.aggregator`. The shape must match.

---

### Task 6: Create seed lifeplan data

**Files:**
- Create: `data/users/kckern/lifeplan.yml` (inside Docker container)

- [ ] **Step 1: Write seed data into the container**

Run the following to create the seed file. The YAML structure matches what `LifePlan` constructor and `YamlLifePlanStore.load()` expect:

```bash
sudo docker exec daylight-station sh -c "cat > data/users/kckern/lifeplan.yml << 'SEEDEOF'
purpose:
  statement: To build systems that help my family flourish and to grow into the person my potential demands
  adopted: 2026-01-01
  last_reviewed: null
  review_cadence: era
  notes: null
  grounded_in:
    beliefs:
      - deliberate-systems
    values:
      - family
      - craft

cadence:
  unit: 1d
  cycle: 1w
  phase: 4w
  season: 13w
  era: 52w

goals:
  - id: ship-lifeplan
    name: Ship the Lifeplan feature in DaylightStation
    state: committed
    quality: builder-craft
    why: Dogfooding the JOP framework — build the tool, use the tool, improve the tool
    sacrifice: Evening and weekend coding sessions
    deadline: 2026-04-01
    metrics:
      - name: api_endpoints_live
        target: 15
        current: 0
    audacity: moderate
    milestones:
      - id: router-wired
        description: Life router mounted and API reachable
        target_date: 2026-03-17
        completed: false
    state_history:
      - from: dream
        to: considered
        reason: Designed the domain spec
        timestamp: 2026-01-29
      - from: considered
        to: committed
        reason: Implementation complete, wiring needed
        timestamp: 2026-03-12
    dependencies: []
    avoids_nightmare: null
    nightmare_proximity: null
    retrospective: null
    achieved_date: null
    failed_date: null
    abandoned_reason: null
    paused_reason: null
    resume_conditions: null

  - id: family-fitness
    name: Establish a consistent family fitness routine
    state: committed
    quality: physical-vitality
    why: Model healthy habits for the kids while staying energized for demanding work
    sacrifice: null
    deadline: null
    metrics:
      - name: weekly_sessions
        target: 4
        current: 2
    audacity: moderate
    milestones: []
    state_history:
      - from: dream
        to: committed
        reason: Garage gym is set up, fitness extension works
        timestamp: 2026-02-01
    dependencies: []
    avoids_nightmare: null
    nightmare_proximity: null
    retrospective: null
    achieved_date: null
    failed_date: null
    abandoned_reason: null
    paused_reason: null
    resume_conditions: null

beliefs:
  - id: deliberate-systems
    if: I build deliberate systems for daily life
    then: My family runs more smoothly and I have more creative energy
    state: confirmed
    confidence: 0.8
    foundational: true
    signals: []
    evidence_history:
      - type: observation
        date: 2026-01-15
        note: DaylightStation morning routine screen reduced friction
        delta: 0.1
    evidence_quality:
      sample_size: 1
      observation_span: 2m
      biases_considered: []
    depends_on: []
    state_history: []
    origin: experience

  - id: consistency-over-intensity
    if: I show up consistently at moderate effort
    then: Results compound faster than sporadic intense effort
    state: hypothesized
    confidence: 0.6
    foundational: false
    signals: []
    evidence_history: []
    evidence_quality:
      sample_size: 0
      observation_span: null
      biases_considered: []
    depends_on: []
    state_history: []
    origin: null

values:
  - id: family
    name: Family
    rank: 1
    description: Being present and intentional with Elizabeth and the kids
    justified_by:
      - deliberate-systems
    conflicts_with: []
    alignment: aligned
    drift_history: []

  - id: craft
    name: Craft
    rank: 2
    description: Building excellent software systems
    justified_by: []
    conflicts_with: []
    alignment: aligned
    drift_history: []

  - id: health
    name: Health
    rank: 3
    description: Physical vitality as the foundation for everything else
    justified_by:
      - consistency-over-intensity
    conflicts_with: []
    alignment: aligned
    drift_history: []

qualities:
  - id: builder-craft
    name: Builder Craft
    description: Relentless focus on shipping useful systems
    principles:
      - Ship small, iterate fast
      - Dogfood everything
    rules: []
    grounded_in:
      beliefs:
        - deliberate-systems
      values:
        - craft
    shadow: perfectionism
    shadow_state: dormant
    last_shadow_check: null

  - id: physical-vitality
    name: Physical Vitality
    description: Consistent movement and recovery
    principles:
      - Move every day
      - Recovery is not optional
    rules: []
    grounded_in:
      beliefs:
        - consistency-over-intensity
      values:
        - health
    shadow: null
    shadow_state: dormant
    last_shadow_check: null

rules: []
dependencies: []
life_events: []
anti_goals: []
cycles: []
ceremony_records: []
feedback: []

ceremonies:
  unit_intention:
    enabled: true
    cadence: unit
    channel: kiosk
  unit_capture:
    enabled: true
    cadence: unit
    channel: kiosk
  cycle_retro:
    enabled: true
    cadence: cycle
    channel: app
  phase_review:
    enabled: true
    cadence: phase
    channel: app
  season_alignment:
    enabled: false
    cadence: season
    channel: app
  era_vision:
    enabled: false
    cadence: era
    channel: app
SEEDEOF"
```

- [ ] **Step 2: Verify the seed file was written**

```bash
sudo docker exec daylight-station sh -c 'cat data/users/kckern/lifeplan.yml | head -5'
```

Expected output:
```
purpose:
  statement: To build systems that help my family flourish and to grow into the person my potential demands
  adopted: 2026-01-01
  last_reviewed: null
  review_cadence: era
```

---

### Task 7: Rebuild and deploy to verify

**Files:**
- Verify: All modified files

- [ ] **Step 1: Build the Docker image**

```bash
cd /opt/Code/DaylightStation
sudo docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  .
```

Expected: Build succeeds. Watch for import errors during the build's `vite build` step.

- [ ] **Step 2: Redeploy the container**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 3: Re-create the seed data**

The container was recreated, so the seed file from Task 6 is gone (data volume persists, but verify):

```bash
sudo docker exec daylight-station sh -c 'ls data/users/kckern/lifeplan.yml 2>/dev/null || echo "MISSING"'
```

If MISSING, re-run the heredoc from Task 6 Step 1. The data volume is bind-mounted, so the seed file written in Task 6 should still be there — but verify.

- [ ] **Step 4: Verify the API is reachable**

```bash
curl -s http://localhost:3111/api/v1/life/health | head -20
```

Expected: JSON response with plan loaded status, service availability checks, no timeout.

```bash
curl -s http://localhost:3111/api/v1/life/plan?username=kckern | head -20
```

Expected: JSON containing the seed plan data (purpose, goals, beliefs, values).

- [ ] **Step 5: Verify the status endpoint includes /life**

```bash
curl -s http://localhost:3111/api/v1/status | python3 -c "import sys,json; routes=json.load(sys.stdin)['routes']; print('/life' in routes)"
```

Expected: `True`

---

### Task 8: Run Playwright tests

**Files:**
- Verify: `tests/live/flow/life/life-app-happy-paths.runtime.test.mjs`

- [ ] **Step 1: Run the full test suite**

```bash
npx playwright test tests/live/flow/life/life-app-happy-paths.runtime.test.mjs --reporter=line
```

Expected: Most tests pass now. API read tests should return data instead of timing out. API write tests should succeed or fail with meaningful errors (not timeouts).

- [ ] **Step 2: Review any remaining failures**

If API write tests fail, check the error response — likely missing data fields or validation. These are real issues to address, not wiring problems.

- [ ] **Step 3: Commit**

```bash
git add backend/src/app.mjs backend/src/4_api/v1/routers/api.mjs
git commit -m "feat(lifeplan): wire life router into app and mount at /api/v1/life

Calls bootstrapLifeplan() in app.mjs, adds '/life' to the API route map,
and passes lifeplan services to the agents router for guide agent registration."
```

The seed data is in the Docker volume, not in the repo — no file to commit for that.
