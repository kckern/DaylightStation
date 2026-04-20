# Home Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build out `frontend/src/Apps/HomeApp.jsx` from a camera-only page into a full home dashboard: room cards (lights, climate, motion, optional camera), home summary (weather, 36h temp chart, 24h energy chart, scene buttons).

**Architecture:** Explicit YAML (`data/household/config/home-dashboard.yml`) drives curation. Existing `HomeAssistantAdapter` gains batch `getStates` + `getHistory`; these additions are mirrored on the `IHomeAutomationGateway` port. New application use cases (`GetDashboardConfig/State/History`, `ToggleDashboardEntity`, `ActivateDashboardScene`) enforce whitelist policy and shape domain-oriented responses. Thin API router at `/api/v1/home-dashboard/*` translates HTTP → container.getX().execute(). Frontend uses a single `useHomeDashboard` hook + Mantine 7 presentation.

**Tech Stack:** Node/Express (backend), Vitest (unit), Playwright (flow), React 18, Mantine 7, `@mantine/charts` (recharts).

**Design source:** `docs/_wip/plans/2026-04-20-home-dashboard-design.md` (read first; this plan assumes those decisions).

---

## Execution progress

Worktree: `.worktrees/home-dashboard`, branch `feat/home-dashboard`.

| Phase | Tasks | Status | Commits |
|---|---|---|---|
| A — Port + HA adapter | A1, A2, A3 | ✅ Complete (2026-04-20) | `7796f7f0`, `106a042c`, `a4d5cef9` |
| B — Config repository | B1, B2, B3 | ⏳ Next |  |
| C — Use cases + container | C1–C7 | Pending |  |
| D — API router + bootstrap | D1, D2, D3 | Pending |  |
| E — Frontend hook | E1 | Pending |  |
| F — Room cards | F1–F5 | Pending |  |
| G — Home summary | G1–G5 | Pending |  |
| H — Camera integration | H1 | Pending |  |
| I — Polish + flow test | I1, I2 | Pending |  |

**Phase A notes for subsequent work:**
- The worktree has no `node_modules`. Run vitest via the main worktree's binary: `/Users/kckern/Documents/GitHub/DaylightStation/frontend/node_modules/.bin/vitest` (the main worktree's root also has `node_modules/.bin/vitest`). Alternative: `cd .worktrees/home-dashboard && ln -s ../../node_modules node_modules` before running tests.
- All Phase A tests pass (7/7). Gateway port (`IHomeAutomationGateway`) now requires `getStates` and `getHistory`; the noop gateway returns empty Maps from both; `HomeAssistantAdapter` implements both with a 60s response cache for history keyed on `(sinceIso, sorted entityIds)`.
- Code-quality reviewer flagged minor polish items that are safe to defer: add an error-path test for `getHistory` (httpClient rejects → empty Map + logged); swap the `sinceIso` guard from plain `Error` to `InfrastructureError` from `#system/utils/errors` for file-level consistency; add a one-line comment on `#historyCache` noting the expected keyspace bound. Non-blocking; fold into Phase I polish if desired.

---

**Before starting each task:** Worktree already exists — `cd .worktrees/home-dashboard`. Each task commits. Tests go first (TDD). Don't batch phases.

---

## Phase A — Extend gateway port + HA adapter

### Task A1: Extend `IHomeAutomationGateway` port docs + validator

**Files:**
- Modify: `backend/src/3_applications/home-automation/ports/IHomeAutomationGateway.mjs`

**Step 1: Write the failing test**

Create `tests/unit/applications/home-automation/IHomeAutomationGateway.contract.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import {
  isHomeAutomationGateway,
  createNoOpGateway,
} from '#apps/home-automation/ports/IHomeAutomationGateway.mjs';

describe('IHomeAutomationGateway contract', () => {
  it('recognises a gateway with getStates and getHistory', () => {
    const obj = {
      getState:      async () => null,
      callService:   async () => ({ ok: true }),
      activateScene: async () => ({ ok: true }),
      getStates:     async () => new Map(),
      getHistory:    async () => new Map(),
    };
    expect(isHomeAutomationGateway(obj)).toBe(true);
  });

  it('rejects a gateway missing getStates', () => {
    const obj = {
      getState:      async () => null,
      callService:   async () => ({ ok: true }),
      activateScene: async () => ({ ok: true }),
      getHistory:    async () => new Map(),
    };
    expect(isHomeAutomationGateway(obj)).toBe(false);
  });

  it('noop gateway returns empty map from getStates', async () => {
    const noop = createNoOpGateway();
    const result = await noop.getStates(['light.x']);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('noop gateway returns empty map from getHistory', async () => {
    const noop = createNoOpGateway();
    const result = await noop.getHistory(['sensor.x'], { sinceIso: '2026-04-20T00:00:00Z' });
    expect(result).toBeInstanceOf(Map);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/applications/home-automation/IHomeAutomationGateway.contract.test.mjs
```

Expected: FAIL — `isHomeAutomationGateway` returns `true` for objects without `getStates` (current impl only checks 3 methods); noop missing `getStates`/`getHistory`.

**Step 3: Update port**

In `IHomeAutomationGateway.mjs`:

1. Extend `isHomeAutomationGateway` check to include `getStates` and `getHistory`.
2. Add the two methods to `createNoOpGateway()` returning `new Map()`.
3. Add JSDoc describing the new methods (match existing style — see the comment block listing current methods around lines 55–89).

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/applications/home-automation/IHomeAutomationGateway.contract.test.mjs
```

Expected: PASS (4/4).

**Step 5: Commit**

```bash
git add backend/src/3_applications/home-automation/ports/IHomeAutomationGateway.mjs \
        tests/unit/applications/home-automation/IHomeAutomationGateway.contract.test.mjs
git commit -m "feat(home-automation): extend gateway port with getStates + getHistory"
```

---

### Task A2: Implement `getStates` on `HomeAssistantAdapter`

**Files:**
- Modify: `backend/src/1_adapters/home-automation/homeassistant/HomeAssistantAdapter.mjs`
- Test: `tests/unit/adapters/home-automation/HomeAssistantAdapter.getStates.test.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect, vi } from 'vitest';
import { HomeAssistantAdapter } from '#adapters/home-automation/homeassistant/HomeAssistantAdapter.mjs';

function makeHttpClient(mockData) {
  return {
    get: vi.fn().mockResolvedValue({ data: mockData }),
    post: vi.fn(),
  };
}

describe('HomeAssistantAdapter.getStates', () => {
  it('returns a Map keyed by entityId, filtered to requested ids', async () => {
    const httpClient = makeHttpClient([
      { entity_id: 'light.a', state: 'on',  attributes: {}, last_changed: 't1' },
      { entity_id: 'light.b', state: 'off', attributes: {}, last_changed: 't2' },
      { entity_id: 'sensor.x', state: '71', attributes: { unit_of_measurement: '°F' }, last_changed: 't3' },
    ]);
    const adapter = new HomeAssistantAdapter(
      { baseUrl: 'http://ha', token: 'tok' },
      { httpClient }
    );

    const result = await adapter.getStates(['light.a', 'sensor.x', 'light.missing']);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(2);
    expect(result.get('light.a').state).toBe('on');
    expect(result.get('sensor.x').state).toBe('71');
    expect(result.has('light.missing')).toBe(false);
    expect(httpClient.get).toHaveBeenCalledTimes(1); // single batch call
    expect(httpClient.get.mock.calls[0][0]).toContain('/api/states');
  });

  it('returns empty Map when HA returns empty', async () => {
    const adapter = new HomeAssistantAdapter(
      { baseUrl: 'http://ha', token: 'tok' },
      { httpClient: makeHttpClient([]) }
    );
    const result = await adapter.getStates(['light.a']);
    expect(result.size).toBe(0);
  });

  it('returns empty Map when given empty entityIds', async () => {
    const httpClient = makeHttpClient([]);
    const adapter = new HomeAssistantAdapter(
      { baseUrl: 'http://ha', token: 'tok' },
      { httpClient }
    );
    const result = await adapter.getStates([]);
    expect(result.size).toBe(0);
    expect(httpClient.get).not.toHaveBeenCalled(); // short-circuit
  });
});
```

**Step 2: Run to verify it fails**

```bash
npx vitest run tests/unit/adapters/home-automation/HomeAssistantAdapter.getStates.test.mjs
```

Expected: FAIL — `adapter.getStates is not a function`.

**Step 3: Implement**

Add to `HomeAssistantAdapter`:

```javascript
/**
 * Batch read of current state for a list of entities.
 * Single HTTP call to /api/states, filtered locally.
 * @param {string[]} entityIds
 * @returns {Promise<Map<string, DeviceState>>}
 */
async getStates(entityIds) {
  if (!Array.isArray(entityIds) || entityIds.length === 0) return new Map();

  try {
    const response = await this.#apiGet('/api/states');
    const wanted = new Set(entityIds);
    const out = new Map();
    for (const entry of response || []) {
      if (!wanted.has(entry.entity_id)) continue;
      out.set(entry.entity_id, {
        entityId:    entry.entity_id,
        state:       entry.state,
        attributes:  entry.attributes || {},
        lastChanged: entry.last_changed,
      });
    }
    return out;
  } catch (error) {
    this.#logger.error?.('ha.getStates.error', { error: error.message });
    return new Map();
  }
}
```

**Step 4: Run to verify it passes**

```bash
npx vitest run tests/unit/adapters/home-automation/HomeAssistantAdapter.getStates.test.mjs
```

Expected: PASS (3/3).

**Step 5: Commit**

```bash
git add backend/src/1_adapters/home-automation/homeassistant/HomeAssistantAdapter.mjs \
        tests/unit/adapters/home-automation/HomeAssistantAdapter.getStates.test.mjs
git commit -m "feat(ha-adapter): implement batch getStates"
```

---

### Task A3: Implement `getHistory` with 60s response cache

**Files:**
- Modify: `backend/src/1_adapters/home-automation/homeassistant/HomeAssistantAdapter.mjs`
- Test: `tests/unit/adapters/home-automation/HomeAssistantAdapter.getHistory.test.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect, vi } from 'vitest';
import { HomeAssistantAdapter } from '#adapters/home-automation/homeassistant/HomeAssistantAdapter.mjs';

const sinceIso = '2026-04-20T00:00:00.000Z';

function makeAdapter(mockData) {
  const httpClient = {
    get: vi.fn().mockResolvedValue({ data: mockData }),
    post: vi.fn(),
  };
  const adapter = new HomeAssistantAdapter(
    { baseUrl: 'http://ha', token: 'tok' },
    { httpClient }
  );
  return { adapter, httpClient };
}

describe('HomeAssistantAdapter.getHistory', () => {
  it('returns a Map of entityId → series of { t, v }', async () => {
    const { adapter } = makeAdapter([
      [
        { entity_id: 'sensor.a', state: '70', last_changed: '2026-04-20T01:00:00Z' },
        { entity_id: 'sensor.a', state: '71', last_changed: '2026-04-20T02:00:00Z' },
      ],
      [
        { entity_id: 'sensor.b', state: '50', last_changed: '2026-04-20T01:00:00Z' },
      ],
    ]);

    const result = await adapter.getHistory(['sensor.a', 'sensor.b'], { sinceIso });

    expect(result).toBeInstanceOf(Map);
    expect(result.get('sensor.a')).toEqual([
      { t: '2026-04-20T01:00:00Z', v: 70 },
      { t: '2026-04-20T02:00:00Z', v: 71 },
    ]);
    expect(result.get('sensor.b')).toEqual([
      { t: '2026-04-20T01:00:00Z', v: 50 },
    ]);
  });

  it('caches identical calls within 60s', async () => {
    const { adapter, httpClient } = makeAdapter([[]]);
    await adapter.getHistory(['sensor.a'], { sinceIso });
    await adapter.getHistory(['sensor.a'], { sinceIso });
    expect(httpClient.get).toHaveBeenCalledTimes(1);
  });

  it('keeps string state when not numeric', async () => {
    const { adapter } = makeAdapter([[
      { entity_id: 'sensor.mode', state: 'auto', last_changed: '2026-04-20T01:00:00Z' },
    ]]);
    const result = await adapter.getHistory(['sensor.mode'], { sinceIso });
    expect(result.get('sensor.mode')).toEqual([
      { t: '2026-04-20T01:00:00Z', v: 'auto' },
    ]);
  });

  it('returns empty Map for empty entityIds', async () => {
    const { adapter, httpClient } = makeAdapter([]);
    const result = await adapter.getHistory([], { sinceIso });
    expect(result.size).toBe(0);
    expect(httpClient.get).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run to verify it fails**

```bash
npx vitest run tests/unit/adapters/home-automation/HomeAssistantAdapter.getHistory.test.mjs
```

Expected: FAIL — method missing.

**Step 3: Implement**

Add fields and method:

```javascript
// Near other private fields
#historyCache = new Map(); // key → { expires, data }
#HISTORY_TTL_MS = 60_000;

/**
 * Fetch historical state series for given entities since an ISO timestamp.
 * Response from HA is an array of arrays; each inner array is one entity's history.
 * Cached for 60 seconds keyed on (sinceIso, sorted entityIds).
 * @param {string[]} entityIds
 * @param {{ sinceIso: string }} options
 * @returns {Promise<Map<string, Array<{t:string,v:number|string}>>>}
 */
async getHistory(entityIds, { sinceIso } = {}) {
  if (!Array.isArray(entityIds) || entityIds.length === 0) return new Map();
  if (!sinceIso) throw new Error('getHistory requires sinceIso');

  const key = `${sinceIso}|${[...entityIds].sort().join(',')}`;
  const cached = this.#historyCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.data;

  const filter = entityIds.join(',');
  const path = `/api/history/period/${encodeURIComponent(sinceIso)}?filter_entity_id=${encodeURIComponent(filter)}&minimal_response`;

  try {
    const response = await this.#apiGet(path);
    const out = new Map();
    for (const series of response || []) {
      if (!Array.isArray(series) || series.length === 0) continue;
      const entityId = series[0].entity_id;
      const points = series.map(s => {
        const num = Number(s.state);
        return { t: s.last_changed, v: Number.isFinite(num) ? num : s.state };
      });
      out.set(entityId, points);
    }
    this.#historyCache.set(key, { expires: Date.now() + this.#HISTORY_TTL_MS, data: out });
    return out;
  } catch (error) {
    this.#logger.error?.('ha.getHistory.error', { error: error.message });
    return new Map();
  }
}
```

**Step 4: Run to verify it passes**

```bash
npx vitest run tests/unit/adapters/home-automation/HomeAssistantAdapter.getHistory.test.mjs
```

Expected: PASS (4/4).

**Step 5: Commit**

```bash
git add backend/src/1_adapters/home-automation/homeassistant/HomeAssistantAdapter.mjs \
        tests/unit/adapters/home-automation/HomeAssistantAdapter.getHistory.test.mjs
git commit -m "feat(ha-adapter): implement getHistory with 60s response cache"
```

---

## Phase B — Config repository

### Task B1: Write `IHomeDashboardConfigRepository` port

**Files:**
- Create: `backend/src/3_applications/home-automation/ports/IHomeDashboardConfigRepository.mjs`
- Test: `tests/unit/applications/home-automation/IHomeDashboardConfigRepository.contract.test.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import {
  isHomeDashboardConfigRepository,
} from '#apps/home-automation/ports/IHomeDashboardConfigRepository.mjs';

describe('IHomeDashboardConfigRepository contract', () => {
  it('recognises an object implementing load', () => {
    const repo = { load: async () => ({ rooms: [], summary: {} }) };
    expect(isHomeDashboardConfigRepository(repo)).toBe(true);
  });
  it('rejects objects without load', () => {
    expect(isHomeDashboardConfigRepository({})).toBe(false);
    expect(isHomeDashboardConfigRepository(null)).toBe(false);
  });
});
```

**Step 2: Run to verify it fails**

```bash
npx vitest run tests/unit/applications/home-automation/IHomeDashboardConfigRepository.contract.test.mjs
```

Expected: FAIL — module does not exist.

**Step 3: Implement**

```javascript
/**
 * IHomeDashboardConfigRepository
 *
 * Port for loading the home-dashboard configuration.
 *
 * load(): Promise<HomeDashboardConfig>
 *   Returns a plain object shaped like data/household/config/home-dashboard.yml.
 *   Implementations own storage format and path.
 */

export function isHomeDashboardConfigRepository(obj) {
  return obj && typeof obj.load === 'function';
}

export function assertHomeDashboardConfigRepository(obj) {
  if (!isHomeDashboardConfigRepository(obj)) {
    throw new Error('Object does not implement IHomeDashboardConfigRepository');
  }
}

export default { isHomeDashboardConfigRepository, assertHomeDashboardConfigRepository };
```

**Step 4: Run to verify it passes**

```bash
npx vitest run tests/unit/applications/home-automation/IHomeDashboardConfigRepository.contract.test.mjs
```

Expected: PASS (2/2).

**Step 5: Commit**

```bash
git add backend/src/3_applications/home-automation/ports/IHomeDashboardConfigRepository.mjs \
        tests/unit/applications/home-automation/IHomeDashboardConfigRepository.contract.test.mjs
git commit -m "feat(home-automation): add IHomeDashboardConfigRepository port"
```

---

### Task B2: Scaffold minimal `home-dashboard.yml`

**Files:**
- Create: `data/household/config/home-dashboard.yml`

No test here — it's data. Put one room with one light + temp so downstream use-case tests can read from it (but use-case tests will use fakes, not real file IO).

**Step 1: Write the file**

```yaml
summary:
  weather: true
  temp_chart:
    title: "Indoor / Outdoor · 36h"
    hours: 36
    series:
      - { entity: sensor.indoor_temp, label: "Indoor",  color: "#4dabf7" }
      - { entity: sensor.outdoor_temp, label: "Outdoor", color: "#ffa94d" }
  energy_chart:
    title: "Energy · 24h"
    hours: 24
    entity: sensor.home_energy_today
    color: "#63e6be"
  scenes: []   # fill in real scene IDs after verifying HA has them

rooms:
  - id: living_room
    label: "Living Room"
    icon: "sofa"
    lights: []
    climate: {}
```

Replace `sensor.indoor_temp` / `sensor.outdoor_temp` / `sensor.home_energy_today` with real entity IDs from your HA instance before testing end-to-end (check via `curl http://homeassistant.local:8123/api/states | jq`).

**Step 2: Commit**

```bash
git add data/household/config/home-dashboard.yml
git commit -m "feat(home-dashboard): scaffold minimal home-dashboard.yml"
```

---

### Task B3: Implement `YamlHomeDashboardConfigRepository`

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlHomeDashboardConfigRepository.mjs`
- Test: `tests/unit/adapters/persistence/yaml/YamlHomeDashboardConfigRepository.test.mjs`

Follow the existing pattern of other yaml stores (see `YamlWeatherDatastore.mjs` for the DataService injection pattern). The path inside the household is `config/home-dashboard`.

**Step 1: Write the failing test**

```javascript
import { describe, it, expect, vi } from 'vitest';
import { YamlHomeDashboardConfigRepository }
  from '#adapters/persistence/yaml/YamlHomeDashboardConfigRepository.mjs';

function makeRepo(returnValue) {
  const dataService = {
    household: {
      read: vi.fn().mockReturnValue(returnValue),
    },
  };
  const configService = { getDefaultHouseholdId: () => 'default' };
  return {
    repo: new YamlHomeDashboardConfigRepository({ dataService, configService }),
    dataService,
  };
}

describe('YamlHomeDashboardConfigRepository', () => {
  it('loads and returns the config from household/config/home-dashboard', async () => {
    const { repo, dataService } = makeRepo({
      summary: { weather: true },
      rooms: [{ id: 'lr', label: 'Living Room' }],
    });
    const result = await repo.load();
    expect(dataService.household.read).toHaveBeenCalledWith('config/home-dashboard', 'default');
    expect(result.rooms[0].id).toBe('lr');
  });

  it('returns empty shape when file missing', async () => {
    const { repo } = makeRepo(null);
    const result = await repo.load();
    expect(result).toEqual({ summary: {}, rooms: [] });
  });

  it('throws when dataService missing', () => {
    expect(() => new YamlHomeDashboardConfigRepository({}))
      .toThrow(/dataService/);
  });
});
```

**Step 2: Run to verify it fails**

```bash
npx vitest run tests/unit/adapters/persistence/yaml/YamlHomeDashboardConfigRepository.test.mjs
```

Expected: FAIL — module missing.

**Step 3: Implement**

```javascript
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const CONFIG_PATH = 'config/home-dashboard';

export class YamlHomeDashboardConfigRepository {
  #dataService;
  #householdId;
  #logger;

  constructor({ dataService, configService, householdId, logger = console }) {
    if (!dataService) {
      throw new InfrastructureError('YamlHomeDashboardConfigRepository requires dataService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataService',
      });
    }
    this.#dataService = dataService;
    this.#householdId = householdId || configService?.getDefaultHouseholdId() || 'default';
    this.#logger = logger;
  }

  async load() {
    const raw = this.#dataService.household.read(CONFIG_PATH, this.#householdId);
    if (!raw) {
      this.#logger.warn?.('home.dashboard.config.missing', { householdId: this.#householdId });
      return { summary: {}, rooms: [] };
    }
    return {
      summary: raw.summary || {},
      rooms:   Array.isArray(raw.rooms) ? raw.rooms : [],
    };
  }
}

export default YamlHomeDashboardConfigRepository;
```

**Step 4: Run to verify it passes**

```bash
npx vitest run tests/unit/adapters/persistence/yaml/YamlHomeDashboardConfigRepository.test.mjs
```

Expected: PASS (3/3).

**Step 5: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlHomeDashboardConfigRepository.mjs \
        tests/unit/adapters/persistence/yaml/YamlHomeDashboardConfigRepository.test.mjs
git commit -m "feat(home-dashboard): add YamlHomeDashboardConfigRepository"
```

---

## Phase C — Application services + use cases

### Task C1: `TimeSeriesDownsampler` (pure)

**Files:**
- Create: `backend/src/3_applications/home-automation/services/TimeSeriesDownsampler.mjs`
- Test: `tests/unit/applications/home-automation/TimeSeriesDownsampler.test.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { downsample } from '#apps/home-automation/services/TimeSeriesDownsampler.mjs';

describe('TimeSeriesDownsampler.downsample', () => {
  it('returns the series unchanged when shorter than target', () => {
    const series = [{ t: 't1', v: 1 }, { t: 't2', v: 2 }];
    expect(downsample(series, 10)).toEqual(series);
  });
  it('downsamples long series to target size by bucketed average', () => {
    const series = Array.from({ length: 1000 }, (_, i) => ({ t: `t${i}`, v: i }));
    const out = downsample(series, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].v).toBeGreaterThanOrEqual(0);
    expect(out.at(-1).v).toBeLessThanOrEqual(999);
  });
  it('handles non-numeric values by keeping first of each bucket', () => {
    const series = [
      { t: 't1', v: 'auto' }, { t: 't2', v: 'auto' },
      { t: 't3', v: 'heat' }, { t: 't4', v: 'heat' },
    ];
    const out = downsample(series, 2);
    expect(out).toHaveLength(2);
    expect(out[0].v).toBe('auto');
    expect(out[1].v).toBe('heat');
  });
  it('returns [] for empty input', () => {
    expect(downsample([], 10)).toEqual([]);
  });
});
```

**Step 2: Run to verify it fails**

```bash
npx vitest run tests/unit/applications/home-automation/TimeSeriesDownsampler.test.mjs
```

Expected: FAIL — module missing.

**Step 3: Implement**

```javascript
/**
 * Downsample a time-series to at most `target` points by bucketed mean
 * (for numeric values) or first-in-bucket (for non-numeric).
 * @param {Array<{t:string,v:number|string}>} series
 * @param {number} target - desired max number of output points
 */
export function downsample(series, target) {
  if (!Array.isArray(series) || series.length === 0) return [];
  if (series.length <= target) return series;
  const bucketSize = Math.ceil(series.length / target);
  const out = [];
  for (let i = 0; i < series.length; i += bucketSize) {
    const bucket = series.slice(i, i + bucketSize);
    const numeric = bucket.every(p => typeof p.v === 'number');
    if (numeric) {
      const sum = bucket.reduce((s, p) => s + p.v, 0);
      out.push({ t: bucket[0].t, v: sum / bucket.length });
    } else {
      out.push({ t: bucket[0].t, v: bucket[0].v });
    }
  }
  return out;
}

export default { downsample };
```

**Step 4: Run to verify it passes**

```bash
npx vitest run tests/unit/applications/home-automation/TimeSeriesDownsampler.test.mjs
```

Expected: PASS (4/4).

**Step 5: Commit**

```bash
git add backend/src/3_applications/home-automation/services/TimeSeriesDownsampler.mjs \
        tests/unit/applications/home-automation/TimeSeriesDownsampler.test.mjs
git commit -m "feat(home-automation): add TimeSeriesDownsampler service"
```

---

### Task C2: `GetDashboardConfig` use case

**Files:**
- Create: `backend/src/3_applications/home-automation/usecases/GetDashboardConfig.mjs`
- Test: `tests/unit/applications/home-automation/GetDashboardConfig.test.mjs`

Trivial use case — wraps `configRepo.load()` and returns a presentation-safe shape (strips any entity IDs that shouldn't go out over HTTP? for now, all are safe — but the use case is still the seam for future shaping).

**Step 1: Write the failing test**

```javascript
import { describe, it, expect, vi } from 'vitest';
import { GetDashboardConfig } from '#apps/home-automation/usecases/GetDashboardConfig.mjs';

describe('GetDashboardConfig', () => {
  it('delegates to repository.load()', async () => {
    const repo = { load: vi.fn().mockResolvedValue({ summary: { weather: true }, rooms: [] }) };
    const uc = new GetDashboardConfig({ configRepository: repo });
    const result = await uc.execute();
    expect(repo.load).toHaveBeenCalled();
    expect(result.summary.weather).toBe(true);
  });
  it('throws if configRepository missing', () => {
    expect(() => new GetDashboardConfig({})).toThrow(/configRepository/);
  });
});
```

**Step 2: Run to verify it fails**

```bash
npx vitest run tests/unit/applications/home-automation/GetDashboardConfig.test.mjs
```

Expected: FAIL.

**Step 3: Implement**

```javascript
export class GetDashboardConfig {
  #configRepository;
  #logger;
  constructor({ configRepository, logger }) {
    if (!configRepository) throw new Error('GetDashboardConfig: configRepository required');
    this.#configRepository = configRepository;
    this.#logger = logger || console;
  }
  async execute() {
    return this.#configRepository.load();
  }
}
export default GetDashboardConfig;
```

**Step 4–5: Run tests + commit**

```bash
npx vitest run tests/unit/applications/home-automation/GetDashboardConfig.test.mjs
git add backend/src/3_applications/home-automation/usecases/GetDashboardConfig.mjs \
        tests/unit/applications/home-automation/GetDashboardConfig.test.mjs
git commit -m "feat(home-automation): add GetDashboardConfig use case"
```

---

### Task C3: `GetDashboardState` use case (the main one)

**Files:**
- Create: `backend/src/3_applications/home-automation/usecases/GetDashboardState.mjs`
- Test: `tests/unit/applications/home-automation/GetDashboardState.test.mjs`

Composes config + `haGateway.getStates` into the domain-shaped response from the design doc.

**Step 1: Write the failing test**

```javascript
import { describe, it, expect, vi } from 'vitest';
import { GetDashboardState } from '#apps/home-automation/usecases/GetDashboardState.mjs';

const config = {
  summary: {
    weather: true,
    scenes: [{ id: 'scene.all_off', label: 'All Off', icon: 'power' }],
  },
  rooms: [
    {
      id: 'living_room',
      label: 'Living Room',
      icon: 'sofa',
      camera: 'doorbell',
      lights: [{ entity: 'light.lr_main', label: 'Main' }],
      climate: { temp: 'sensor.lr_temp', humidity: 'sensor.lr_hum' },
      motion: 'binary_sensor.lr_motion',
    },
  ],
};

function makeGateway(statesMap) {
  return { getStates: vi.fn().mockResolvedValue(statesMap) };
}

describe('GetDashboardState', () => {
  it('shapes config + state into domain response', async () => {
    const states = new Map([
      ['light.lr_main',         { state: 'on',  attributes: { brightness: 180 } }],
      ['sensor.lr_temp',        { state: '71.4', attributes: { unit_of_measurement: '°F' } }],
      ['sensor.lr_hum',         { state: '42',   attributes: { unit_of_measurement: '%' } }],
      ['binary_sensor.lr_motion', { state: 'off', lastChanged: '2026-04-20T12:00:00Z' }],
    ]);
    const uc = new GetDashboardState({
      configRepository: { load: async () => config },
      haGateway: makeGateway(states),
    });

    const result = await uc.execute();

    expect(result.summary.sceneButtons[0].id).toBe('scene.all_off');
    expect(result.rooms).toHaveLength(1);
    const room = result.rooms[0];
    expect(room.id).toBe('living_room');
    expect(room.camera).toBe('doorbell');
    expect(room.lights[0]).toMatchObject({
      entityId: 'light.lr_main', label: 'Main', on: true, available: true,
    });
    expect(room.climate).toMatchObject({ tempF: 71.4, humidityPct: 42, available: true });
    expect(room.motion).toMatchObject({ state: 'clear', available: true });
  });

  it('marks entities unavailable when not returned by gateway', async () => {
    const uc = new GetDashboardState({
      configRepository: { load: async () => config },
      haGateway: makeGateway(new Map()),
    });
    const result = await uc.execute();
    expect(result.rooms[0].lights[0].available).toBe(false);
    expect(result.rooms[0].climate.available).toBe(false);
    expect(result.rooms[0].motion.available).toBe(false);
  });

  it('batches gateway call with all distinct entity ids from config', async () => {
    const gateway = makeGateway(new Map());
    const uc = new GetDashboardState({
      configRepository: { load: async () => config },
      haGateway: gateway,
    });
    await uc.execute();
    const ids = gateway.getStates.mock.calls[0][0];
    expect(ids).toEqual(expect.arrayContaining([
      'light.lr_main', 'sensor.lr_temp', 'sensor.lr_hum', 'binary_sensor.lr_motion',
    ]));
  });
});
```

**Step 2: Run to verify it fails**

```bash
npx vitest run tests/unit/applications/home-automation/GetDashboardState.test.mjs
```

Expected: FAIL — module missing.

**Step 3: Implement**

```javascript
export class GetDashboardState {
  #configRepository;
  #haGateway;
  #logger;
  constructor({ configRepository, haGateway, logger }) {
    if (!configRepository) throw new Error('GetDashboardState: configRepository required');
    if (!haGateway)        throw new Error('GetDashboardState: haGateway required');
    this.#configRepository = configRepository;
    this.#haGateway = haGateway;
    this.#logger = logger || console;
  }

  async execute() {
    const config = await this.#configRepository.load();
    const entityIds = this.#collectEntityIds(config);
    const states = await this.#haGateway.getStates(entityIds);

    return {
      summary: {
        weather:      config.summary?.weather ?? false,
        sceneButtons: (config.summary?.scenes || []).map(s => ({
          id: s.id, label: s.label, icon: s.icon,
        })),
      },
      rooms: (config.rooms || []).map(room => this.#shapeRoom(room, states)),
    };
  }

  #collectEntityIds(config) {
    const out = new Set();
    for (const room of config.rooms || []) {
      (room.lights || []).forEach(l => l.entity && out.add(l.entity));
      if (room.climate?.temp)     out.add(room.climate.temp);
      if (room.climate?.humidity) out.add(room.climate.humidity);
      if (room.motion)            out.add(room.motion);
      if (room.media)             out.add(room.media);
    }
    return [...out];
  }

  #shapeRoom(room, states) {
    const lights = (room.lights || []).map(l => {
      const s = states.get(l.entity);
      return {
        entityId:  l.entity,
        label:     l.label,
        on:        s?.state === 'on',
        available: Boolean(s) && s.state !== 'unavailable' && s.state !== 'unknown',
      };
    });

    const temp = room.climate?.temp ? states.get(room.climate.temp) : null;
    const hum  = room.climate?.humidity ? states.get(room.climate.humidity) : null;
    const climate = {
      tempF:       this.#asNumber(temp?.state),
      humidityPct: this.#asNumber(hum?.state),
      available:   Boolean(temp) || Boolean(hum),
    };

    let motion = null;
    if (room.motion) {
      const m = states.get(room.motion);
      motion = {
        state:          m?.state === 'on' ? 'motion' : 'clear',
        lastChangedIso: m?.lastChanged || null,
        available:      Boolean(m),
      };
    }

    let media = null;
    if (room.media) {
      const m = states.get(room.media);
      media = { state: m?.state || 'unknown', available: Boolean(m) };
    }

    return {
      id: room.id, label: room.label, icon: room.icon || null,
      camera: room.camera || null,
      lights, climate, motion, media,
    };
  }

  #asNumber(v) {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
}
export default GetDashboardState;
```

**Step 4–5: Run + commit**

```bash
npx vitest run tests/unit/applications/home-automation/GetDashboardState.test.mjs
git add backend/src/3_applications/home-automation/usecases/GetDashboardState.mjs \
        tests/unit/applications/home-automation/GetDashboardState.test.mjs
git commit -m "feat(home-automation): add GetDashboardState use case"
```

---

### Task C4: `GetDashboardHistory` use case

**Files:**
- Create: `backend/src/3_applications/home-automation/usecases/GetDashboardHistory.mjs`
- Test: `tests/unit/applications/home-automation/GetDashboardHistory.test.mjs`

**Step 1: Failing test**

```javascript
import { describe, it, expect, vi } from 'vitest';
import { GetDashboardHistory } from '#apps/home-automation/usecases/GetDashboardHistory.mjs';

const config = {
  summary: {
    temp_chart: {
      hours: 36,
      series: [
        { entity: 'sensor.indoor',  label: 'Indoor',  color: '#4dabf7' },
        { entity: 'sensor.outdoor', label: 'Outdoor', color: '#ffa94d' },
      ],
    },
    energy_chart: { hours: 24, entity: 'sensor.energy_today', color: '#63e6be' },
  },
  rooms: [],
};

describe('GetDashboardHistory', () => {
  it('fetches temp and energy series, downsamples, returns per-chart payload', async () => {
    const mkSeries = (n, base) =>
      Array.from({ length: n }, (_, i) => ({ t: `t${i}`, v: base + i }));
    const historyMap = new Map([
      ['sensor.indoor',        mkSeries(500, 70)],
      ['sensor.outdoor',       mkSeries(500, 50)],
      ['sensor.energy_today',  mkSeries(500, 0)],
    ]);
    const haGateway = { getHistory: vi.fn().mockResolvedValue(historyMap) };
    const now = new Date('2026-04-20T12:00:00Z');

    const uc = new GetDashboardHistory({
      configRepository: { load: async () => config },
      haGateway,
      clock: () => now,
    });

    const result = await uc.execute();

    expect(result.tempChart.series).toHaveLength(2);
    expect(result.tempChart.series[0].label).toBe('Indoor');
    expect(result.tempChart.series[0].points.length).toBeLessThanOrEqual(150);
    expect(result.energyChart.points.length).toBeLessThanOrEqual(150);
    // since = now - hours, so gateway was called with an ISO 36h before now
    const call = haGateway.getHistory.mock.calls[0];
    expect(call[0]).toEqual(expect.arrayContaining([
      'sensor.indoor', 'sensor.outdoor', 'sensor.energy_today',
    ]));
    expect(call[1].sinceIso).toBe('2026-04-19T00:00:00.000Z'); // 36h before
  });

  it('returns null chart blocks when config lacks that chart', async () => {
    const uc = new GetDashboardHistory({
      configRepository: { load: async () => ({ summary: {}, rooms: [] }) },
      haGateway: { getHistory: vi.fn().mockResolvedValue(new Map()) },
      clock: () => new Date(),
    });
    const result = await uc.execute();
    expect(result.tempChart).toBeNull();
    expect(result.energyChart).toBeNull();
  });
});
```

**Step 2: Run to verify it fails.**

**Step 3: Implement**

```javascript
import { downsample } from '#apps/home-automation/services/TimeSeriesDownsampler.mjs';

const TARGET_POINTS = 150;

export class GetDashboardHistory {
  #configRepository;
  #haGateway;
  #clock;
  #logger;

  constructor({ configRepository, haGateway, clock, logger }) {
    if (!configRepository) throw new Error('GetDashboardHistory: configRepository required');
    if (!haGateway)        throw new Error('GetDashboardHistory: haGateway required');
    this.#configRepository = configRepository;
    this.#haGateway = haGateway;
    this.#clock = clock || (() => new Date());
    this.#logger = logger || console;
  }

  async execute() {
    const config = await this.#configRepository.load();
    const tempCfg   = config.summary?.temp_chart;
    const energyCfg = config.summary?.energy_chart;

    const entityIds = new Set();
    const maxHours = Math.max(
      tempCfg?.hours   || 0,
      energyCfg?.hours || 0,
    );
    if (maxHours === 0) return { tempChart: null, energyChart: null };

    (tempCfg?.series || []).forEach(s => entityIds.add(s.entity));
    if (energyCfg?.entity) entityIds.add(energyCfg.entity);

    const sinceIso = new Date(this.#clock().getTime() - maxHours * 3600_000).toISOString();
    const history = await this.#haGateway.getHistory([...entityIds], { sinceIso });

    const tempChart = tempCfg ? {
      title:  tempCfg.title || null,
      hours:  tempCfg.hours,
      series: (tempCfg.series || []).map(s => ({
        label:  s.label,
        color:  s.color,
        points: downsample(history.get(s.entity) || [], TARGET_POINTS),
      })),
    } : null;

    const energyChart = energyCfg ? {
      title:  energyCfg.title || null,
      hours:  energyCfg.hours,
      color:  energyCfg.color,
      points: downsample(history.get(energyCfg.entity) || [], TARGET_POINTS),
    } : null;

    return { tempChart, energyChart };
  }
}
export default GetDashboardHistory;
```

**Step 4–5:** run + commit.

```bash
git add backend/src/3_applications/home-automation/usecases/GetDashboardHistory.mjs \
        tests/unit/applications/home-automation/GetDashboardHistory.test.mjs
git commit -m "feat(home-automation): add GetDashboardHistory use case"
```

---

### Task C5: `ToggleDashboardEntity` use case (whitelist!)

**Files:**
- Create: `backend/src/3_applications/home-automation/usecases/ToggleDashboardEntity.mjs`
- Test: `tests/unit/applications/home-automation/ToggleDashboardEntity.test.mjs`

**Step 1: Failing test**

```javascript
import { describe, it, expect, vi } from 'vitest';
import { ToggleDashboardEntity } from '#apps/home-automation/usecases/ToggleDashboardEntity.mjs';

const config = {
  summary: { scenes: [] },
  rooms: [{
    id: 'lr', label: 'Living Room',
    lights: [{ entity: 'light.lr_main', label: 'Main' }],
    climate: {}, motion: null,
  }],
};

function makeUC({ callService } = {}) {
  return new ToggleDashboardEntity({
    configRepository: { load: async () => config },
    haGateway: { callService: callService || vi.fn().mockResolvedValue({ ok: true }) },
  });
}

describe('ToggleDashboardEntity', () => {
  it('calls HA light.turn_on when desiredState is on', async () => {
    const callService = vi.fn().mockResolvedValue({ ok: true });
    const uc = makeUC({ callService });
    const result = await uc.execute({ entityId: 'light.lr_main', desiredState: 'on' });
    expect(callService).toHaveBeenCalledWith('light', 'turn_on', { entity_id: 'light.lr_main' });
    expect(result.ok).toBe(true);
  });

  it('calls turn_off when desiredState is off', async () => {
    const callService = vi.fn().mockResolvedValue({ ok: true });
    const uc = makeUC({ callService });
    await uc.execute({ entityId: 'light.lr_main', desiredState: 'off' });
    expect(callService).toHaveBeenCalledWith('light', 'turn_off', { entity_id: 'light.lr_main' });
  });

  it('calls toggle when desiredState is toggle', async () => {
    const callService = vi.fn().mockResolvedValue({ ok: true });
    const uc = makeUC({ callService });
    await uc.execute({ entityId: 'light.lr_main', desiredState: 'toggle' });
    expect(callService).toHaveBeenCalledWith('light', 'toggle', { entity_id: 'light.lr_main' });
  });

  it('rejects entity not in YAML whitelist', async () => {
    const callService = vi.fn();
    const uc = makeUC({ callService });
    await expect(uc.execute({ entityId: 'light.hacker', desiredState: 'on' }))
      .rejects.toThrow(/not on dashboard/i);
    expect(callService).not.toHaveBeenCalled();
  });

  it('rejects invalid desiredState', async () => {
    const uc = makeUC();
    await expect(uc.execute({ entityId: 'light.lr_main', desiredState: 'explode' }))
      .rejects.toThrow(/desiredState/);
  });
});
```

**Step 2: Run to verify it fails.**

**Step 3: Implement**

```javascript
const VALID_STATES = new Set(['on', 'off', 'toggle']);

export class ToggleDashboardEntity {
  #configRepository;
  #haGateway;
  #logger;

  constructor({ configRepository, haGateway, logger }) {
    if (!configRepository) throw new Error('ToggleDashboardEntity: configRepository required');
    if (!haGateway)        throw new Error('ToggleDashboardEntity: haGateway required');
    this.#configRepository = configRepository;
    this.#haGateway = haGateway;
    this.#logger = logger || console;
  }

  async execute({ entityId, desiredState }) {
    if (!VALID_STATES.has(desiredState)) {
      throw new Error(`ToggleDashboardEntity: desiredState must be on|off|toggle, got ${desiredState}`);
    }
    const config = await this.#configRepository.load();
    if (!this.#isAllowed(config, entityId)) {
      const err = new Error(`Entity ${entityId} is not on dashboard`);
      err.status = 403;
      throw err;
    }
    const domain = entityId.split('.')[0];
    const service = desiredState === 'toggle' ? 'toggle'
                  : desiredState === 'on'     ? 'turn_on'
                  : 'turn_off';
    this.#logger.info?.('home.dashboard.toggle', { entityId, desiredState });
    return this.#haGateway.callService(domain, service, { entity_id: entityId });
  }

  #isAllowed(config, entityId) {
    for (const room of config.rooms || []) {
      for (const l of room.lights || []) {
        if (l.entity === entityId) return true;
      }
    }
    return false;
  }
}
export default ToggleDashboardEntity;
```

**Step 4–5:** run + commit.

```bash
git add backend/src/3_applications/home-automation/usecases/ToggleDashboardEntity.mjs \
        tests/unit/applications/home-automation/ToggleDashboardEntity.test.mjs
git commit -m "feat(home-automation): add ToggleDashboardEntity with whitelist"
```

---

### Task C6: `ActivateDashboardScene` use case

**Files:**
- Create: `backend/src/3_applications/home-automation/usecases/ActivateDashboardScene.mjs`
- Test: `tests/unit/applications/home-automation/ActivateDashboardScene.test.mjs`

**Step 1: Failing test**

```javascript
import { describe, it, expect, vi } from 'vitest';
import { ActivateDashboardScene } from '#apps/home-automation/usecases/ActivateDashboardScene.mjs';

const config = {
  summary: { scenes: [{ id: 'scene.all_off', label: 'All Off', icon: 'power' }] },
  rooms: [],
};

describe('ActivateDashboardScene', () => {
  it('activates an allowed scene', async () => {
    const activateScene = vi.fn().mockResolvedValue({ ok: true });
    const uc = new ActivateDashboardScene({
      configRepository: { load: async () => config },
      haGateway: { activateScene },
    });
    const result = await uc.execute({ sceneId: 'scene.all_off' });
    expect(activateScene).toHaveBeenCalledWith('scene.all_off');
    expect(result.ok).toBe(true);
  });
  it('rejects scene not listed in YAML', async () => {
    const activateScene = vi.fn();
    const uc = new ActivateDashboardScene({
      configRepository: { load: async () => config },
      haGateway: { activateScene },
    });
    await expect(uc.execute({ sceneId: 'scene.unknown' }))
      .rejects.toThrow(/not on dashboard/i);
    expect(activateScene).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run to verify it fails.**

**Step 3: Implement**

```javascript
export class ActivateDashboardScene {
  #configRepository;
  #haGateway;
  #logger;

  constructor({ configRepository, haGateway, logger }) {
    if (!configRepository) throw new Error('ActivateDashboardScene: configRepository required');
    if (!haGateway)        throw new Error('ActivateDashboardScene: haGateway required');
    this.#configRepository = configRepository;
    this.#haGateway = haGateway;
    this.#logger = logger || console;
  }

  async execute({ sceneId }) {
    const config = await this.#configRepository.load();
    const allowed = (config.summary?.scenes || []).some(s => s.id === sceneId);
    if (!allowed) {
      const err = new Error(`Scene ${sceneId} is not on dashboard`);
      err.status = 403;
      throw err;
    }
    this.#logger.info?.('home.dashboard.scene.activate', { sceneId });
    return this.#haGateway.activateScene(sceneId);
  }
}
export default ActivateDashboardScene;
```

**Step 4–5:** run + commit.

```bash
git add backend/src/3_applications/home-automation/usecases/ActivateDashboardScene.mjs \
        tests/unit/applications/home-automation/ActivateDashboardScene.test.mjs
git commit -m "feat(home-automation): add ActivateDashboardScene with whitelist"
```

---

### Task C7: `HomeAutomationContainer`

**Files:**
- Create: `backend/src/3_applications/home-automation/HomeAutomationContainer.mjs`
- Test: `tests/unit/applications/home-automation/HomeAutomationContainer.test.mjs`
- Create: `backend/src/3_applications/home-automation/usecases/index.mjs` (barrel)

**Step 1: Failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { HomeAutomationContainer } from '#apps/home-automation/HomeAutomationContainer.mjs';

const fakeRepo = { load: async () => ({ summary: {}, rooms: [] }) };
const fakeGateway = {
  getState: async () => null,
  callService: async () => ({ ok: true }),
  activateScene: async () => ({ ok: true }),
  runScript: async () => ({ ok: true }),
  waitForState: async () => ({ reached: true }),
  getStates: async () => new Map(),
  getHistory: async () => new Map(),
};

describe('HomeAutomationContainer', () => {
  it('lazy-creates use cases with injected deps', () => {
    const c = new HomeAutomationContainer({
      configRepository: fakeRepo,
      haGateway: fakeGateway,
    });
    const uc1 = c.getDashboardConfig();
    const uc2 = c.getDashboardConfig();
    expect(uc1).toBe(uc2); // cached
    expect(c.getDashboardState()).toBeTruthy();
    expect(c.getDashboardHistory()).toBeTruthy();
    expect(c.toggleDashboardEntity()).toBeTruthy();
    expect(c.activateDashboardScene()).toBeTruthy();
  });
  it('throws when required deps missing', () => {
    expect(() => new HomeAutomationContainer({ haGateway: fakeGateway }))
      .toThrow(/configRepository/);
    expect(() => new HomeAutomationContainer({ configRepository: fakeRepo }))
      .toThrow(/haGateway/);
  });
});
```

**Step 2–3:** run failing, implement:

`usecases/index.mjs`:

```javascript
export { GetDashboardConfig }      from './GetDashboardConfig.mjs';
export { GetDashboardState }       from './GetDashboardState.mjs';
export { GetDashboardHistory }     from './GetDashboardHistory.mjs';
export { ToggleDashboardEntity }   from './ToggleDashboardEntity.mjs';
export { ActivateDashboardScene }  from './ActivateDashboardScene.mjs';
```

`HomeAutomationContainer.mjs`:

```javascript
import {
  GetDashboardConfig, GetDashboardState, GetDashboardHistory,
  ToggleDashboardEntity, ActivateDashboardScene,
} from './usecases/index.mjs';

export class HomeAutomationContainer {
  #configRepository;
  #haGateway;
  #logger;

  #getConfig; #getState; #getHistory; #toggle; #activateScene;

  constructor({ configRepository, haGateway, logger }) {
    if (!configRepository) throw new Error('HomeAutomationContainer: configRepository required');
    if (!haGateway)        throw new Error('HomeAutomationContainer: haGateway required');
    this.#configRepository = configRepository;
    this.#haGateway = haGateway;
    this.#logger = logger || console;
  }

  getDashboardConfig() {
    if (!this.#getConfig) {
      this.#getConfig = new GetDashboardConfig({
        configRepository: this.#configRepository, logger: this.#logger,
      });
    }
    return this.#getConfig;
  }
  getDashboardState() {
    if (!this.#getState) {
      this.#getState = new GetDashboardState({
        configRepository: this.#configRepository,
        haGateway: this.#haGateway, logger: this.#logger,
      });
    }
    return this.#getState;
  }
  getDashboardHistory() {
    if (!this.#getHistory) {
      this.#getHistory = new GetDashboardHistory({
        configRepository: this.#configRepository,
        haGateway: this.#haGateway, logger: this.#logger,
      });
    }
    return this.#getHistory;
  }
  toggleDashboardEntity() {
    if (!this.#toggle) {
      this.#toggle = new ToggleDashboardEntity({
        configRepository: this.#configRepository,
        haGateway: this.#haGateway, logger: this.#logger,
      });
    }
    return this.#toggle;
  }
  activateDashboardScene() {
    if (!this.#activateScene) {
      this.#activateScene = new ActivateDashboardScene({
        configRepository: this.#configRepository,
        haGateway: this.#haGateway, logger: this.#logger,
      });
    }
    return this.#activateScene;
  }
}
export default HomeAutomationContainer;
```

**Step 4–5:** run + commit.

```bash
git add backend/src/3_applications/home-automation/HomeAutomationContainer.mjs \
        backend/src/3_applications/home-automation/usecases/index.mjs \
        tests/unit/applications/home-automation/HomeAutomationContainer.test.mjs
git commit -m "feat(home-automation): add HomeAutomationContainer"
```

---

## Phase D — API router + bootstrap wiring

### Task D1: Router + 5 thin handlers

**Files:**
- Create: `backend/src/4_api/v1/routers/home-dashboard.mjs`
- Create: `backend/src/4_api/v1/handlers/home-dashboard/config.mjs`
- Create: `backend/src/4_api/v1/handlers/home-dashboard/state.mjs`
- Create: `backend/src/4_api/v1/handlers/home-dashboard/history.mjs`
- Create: `backend/src/4_api/v1/handlers/home-dashboard/toggle.mjs`
- Create: `backend/src/4_api/v1/handlers/home-dashboard/scene.mjs`
- Create: `backend/src/4_api/v1/handlers/home-dashboard/index.mjs` (barrel)

Each handler is the factory pattern from `api-layer-guidelines.md`.

**Example handler (`state.mjs`):**

```javascript
export function homeDashboardStateHandler({ container, logger = console }) {
  return async (_req, res) => {
    const uc = container.getDashboardState();
    const result = await uc.execute();
    res.json(result);
  };
}
```

**Toggle handler (`toggle.mjs`):**

```javascript
import { requireParam } from '#api/utils/validation.mjs';
export function homeDashboardToggleHandler({ container }) {
  return async (req, res) => {
    const body = { ...req.query, ...req.body };
    const entityId     = requireParam(body, 'entityId');
    const desiredState = requireParam(body, 'desiredState');
    const result = await container.toggleDashboardEntity().execute({ entityId, desiredState });
    res.json(result);
  };
}
```

**Scene handler (`scene.mjs`):**

```javascript
export function homeDashboardSceneHandler({ container }) {
  return async (req, res) => {
    const result = await container.activateDashboardScene().execute({ sceneId: req.params.sceneId });
    res.json(result);
  };
}
```

**History handler accepts `?hours=36` but use case ignores it for v1** (the config hours drive history). Keep the query param as a hint; actual hour ranges come from YAML:

```javascript
export function homeDashboardHistoryHandler({ container }) {
  return async (_req, res) => {
    const result = await container.getDashboardHistory().execute();
    res.json(result);
  };
}
```

**Router (`home-dashboard.mjs`):**

```javascript
import { Router } from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import {
  homeDashboardConfigHandler,
  homeDashboardStateHandler,
  homeDashboardHistoryHandler,
  homeDashboardToggleHandler,
  homeDashboardSceneHandler,
} from '#api/v1/handlers/home-dashboard/index.mjs';

export function createHomeDashboardRouter({ container, logger = console } = {}) {
  if (!container) throw new Error('createHomeDashboardRouter: container required');
  const router = Router();
  router.get('/config',  asyncHandler(homeDashboardConfigHandler({ container, logger })));
  router.get('/state',   asyncHandler(homeDashboardStateHandler({ container, logger })));
  router.get('/history', asyncHandler(homeDashboardHistoryHandler({ container, logger })));
  router.post('/toggle', asyncHandler(homeDashboardToggleHandler({ container, logger })));
  router.post('/scene/:sceneId', asyncHandler(homeDashboardSceneHandler({ container, logger })));
  return router;
}
export default createHomeDashboardRouter;
```

**Step 5: Commit (no unit test for the router; covered by integration test in D3):**

```bash
git add backend/src/4_api/v1/routers/home-dashboard.mjs \
        backend/src/4_api/v1/handlers/home-dashboard/
git commit -m "feat(api): add thin /api/v1/home-dashboard router + handlers"
```

---

### Task D2: Bootstrap wiring

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs` (wire container + mount router)
- Modify: `backend/src/4_api/v1/routers/index.mjs` (export new factory)

**Step 1:** Export the new router factory from `v1/routers/index.mjs`:

```javascript
export { createHomeDashboardRouter } from './home-dashboard.mjs';
```

**Step 2:** In `bootstrap.mjs` locate `createHomeAutomationAdapters` (exists) — this already produces `haGateway`. After it, construct:

```javascript
// Around the section where containers are built and routers mounted:
import { HomeAutomationContainer } from '#apps/home-automation/HomeAutomationContainer.mjs';
import { YamlHomeDashboardConfigRepository }
  from '#adapters/persistence/yaml/YamlHomeDashboardConfigRepository.mjs';
import { createHomeDashboardRouter } from '#api/v1/routers/index.mjs';

const homeDashboardConfigRepo = new YamlHomeDashboardConfigRepository({
  dataService, configService, logger,
});

const homeAutomationContainer = haGateway
  ? new HomeAutomationContainer({
      configRepository: homeDashboardConfigRepo,
      haGateway,
      logger,
    })
  : null;

if (homeAutomationContainer) {
  app.use('/api/v1/home-dashboard',
    createHomeDashboardRouter({ container: homeAutomationContainer, logger }));
}
```

Exact placement depends on how bootstrap structures app construction — look for existing `app.use('/api/v1/...')` mounts and follow the same ordering. Do NOT import adapter or container at top-of-module if bootstrap uses lazy patterns.

**Step 3: Verify server boots**

```bash
# from repo root
npm run backend:dev
# In another terminal:
curl -s http://localhost:3112/api/v1/home-dashboard/config | head
```

Expected: returns the YAML config as JSON. If HA is not configured, the route should 404 (since the container wasn't built).

**Step 4: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs backend/src/4_api/v1/routers/index.mjs
git commit -m "feat(bootstrap): wire HomeAutomationContainer and home-dashboard router"
```

---

### Task D3: Live API integration tests

**Files:**
- Create: `tests/live/api/home-dashboard.config.test.mjs`
- Create: `tests/live/api/home-dashboard.state.test.mjs`
- Create: `tests/live/api/home-dashboard.toggle.test.mjs`

Follow the pattern of existing tests in `tests/live/api/`. One test per endpoint: config returns expected keys, state returns rooms array, toggle with unknown entity returns 403.

```javascript
// home-dashboard.config.test.mjs
import { describe, it, expect } from 'vitest';
import { getAppPort } from '#testlib/configHelper.mjs';

describe('GET /api/v1/home-dashboard/config', () => {
  it('returns summary + rooms arrays', async () => {
    const port = await getAppPort();
    const res = await fetch(`http://localhost:${port}/api/v1/home-dashboard/config`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('summary');
    expect(Array.isArray(body.rooms)).toBe(true);
  });
});
```

**Step 5: Run + commit.**

```bash
npm run test:live:api -- --pattern=home-dashboard
git add tests/live/api/home-dashboard.*.test.mjs
git commit -m "test(home-dashboard): add live API integration tests"
```

---

## Phase E — Frontend hook

### Task E1: `useHomeDashboard` hook

**Files:**
- Create: `frontend/src/hooks/useHomeDashboard.js`
- Test: (optional — hook is thin; covered by flow test in Phase I)

**Shape:**

```javascript
import { useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../lib/logging/Logger.js';

const STATE_POLL_MS   = 3_000;
const STATE_BACKOFF_MS = 10_000;
const HISTORY_REFRESH_MS = 5 * 60_000;

export default function useHomeDashboard() {
  const logger = useMemo(() => getLogger().child({ component: 'home-dashboard' }), []);
  const [config,  setConfig]  = useState(null);
  const [state,   setState]   = useState(null);
  const [history, setHistory] = useState(null);
  const [error,   setError]   = useState(null);

  const failureCount = useRef(0);

  // Config — once
  useEffect(() => {
    fetch('/api/v1/home-dashboard/config')
      .then(r => r.json())
      .then(c => { setConfig(c); logger.info('home.dashboard.config.loaded'); })
      .catch(e => { setError(e); logger.error('home.dashboard.config.error', { error: e.message }); });
  }, [logger]);

  // State — polling
  useEffect(() => {
    let cancelled = false;
    let timer;
    async function tick() {
      try {
        const res = await fetch('/api/v1/home-dashboard/state');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (cancelled) return;
        setState(body);
        setError(null);
        failureCount.current = 0;
      } catch (e) {
        failureCount.current += 1;
        logger.warn('home.dashboard.state.error', { error: e.message, failures: failureCount.current });
        if (failureCount.current >= 2) setError(e);
      } finally {
        if (!cancelled) {
          const delay = failureCount.current >= 2 ? STATE_BACKOFF_MS : STATE_POLL_MS;
          timer = setTimeout(tick, delay);
        }
      }
    }
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [logger]);

  // History — every 5 min
  useEffect(() => {
    let cancelled = false;
    let timer;
    async function load() {
      try {
        const res = await fetch('/api/v1/home-dashboard/history');
        const body = await res.json();
        if (!cancelled) setHistory(body);
      } catch (e) {
        logger.warn('home.dashboard.history.error', { error: e.message });
      } finally {
        if (!cancelled) timer = setTimeout(load, HISTORY_REFRESH_MS);
      }
    }
    load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [logger]);

  // Actions
  const toggleLight = async (entityId, desiredState) => {
    try {
      const res = await fetch('/api/v1/home-dashboard/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityId, desiredState }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      logger.info('home.dashboard.toggle.success', { entityId, desiredState });
      return true;
    } catch (e) {
      logger.error('home.dashboard.toggle.fail', { entityId, error: e.message });
      return false;
    }
  };

  const activateScene = async (sceneId) => {
    try {
      const res = await fetch(`/api/v1/home-dashboard/scene/${encodeURIComponent(sceneId)}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      logger.info('home.dashboard.scene.success', { sceneId });
      return true;
    } catch (e) {
      logger.error('home.dashboard.scene.fail', { sceneId, error: e.message });
      return false;
    }
  };

  return { config, state, history, error, toggleLight, activateScene };
}
```

**Step 5: Commit**

```bash
git add frontend/src/hooks/useHomeDashboard.js
git commit -m "feat(frontend): add useHomeDashboard hook"
```

---

## Phase F — Room card components

### Task F1: `<LightRow>` with optimistic Mantine Switch

**Files:**
- Create: `frontend/src/modules/HomeDashboard/LightRow.jsx`
- Create: `frontend/src/modules/HomeDashboard/LightRow.scss`

```jsx
import { useState, useEffect } from 'react';
import { Switch, Group, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import './LightRow.scss';

export default function LightRow({ lights, onToggle }) {
  return (
    <div className="light-row">
      {lights.map(light => (
        <LightItem key={light.entityId} light={light} onToggle={onToggle} />
      ))}
    </div>
  );
}

function LightItem({ light, onToggle }) {
  const [checked, setChecked] = useState(light.on);
  useEffect(() => { setChecked(light.on); }, [light.on]);

  const handle = async (e) => {
    const next = e.currentTarget.checked;
    setChecked(next); // optimistic
    const ok = await onToggle(light.entityId, next ? 'on' : 'off');
    if (!ok) {
      setChecked(!next); // revert
      notifications.show({ color: 'red', title: 'Light', message: `Couldn't reach ${light.label}` });
    }
  };

  return (
    <Group className={`light-row__item ${light.available ? '' : 'light-row__item--unavailable'}`} justify="space-between">
      <Text size="sm">{light.label}</Text>
      <Switch checked={checked} onChange={handle} disabled={!light.available} />
    </Group>
  );
}
```

**Step 5: Commit**

```bash
git add frontend/src/modules/HomeDashboard/LightRow.jsx \
        frontend/src/modules/HomeDashboard/LightRow.scss
git commit -m "feat(home-dashboard): add LightRow with optimistic toggle"
```

---

### Task F2: `<ClimateReadout>`

**Files:**
- Create: `frontend/src/modules/HomeDashboard/ClimateReadout.jsx`
- Create: `frontend/src/modules/HomeDashboard/ClimateReadout.scss`

```jsx
import './ClimateReadout.scss';

export default function ClimateReadout({ climate }) {
  if (!climate?.available) {
    return <div className="climate-readout climate-readout--unavailable">—</div>;
  }
  return (
    <div className="climate-readout">
      <div className="climate-readout__temp">
        {climate.tempF != null ? `${climate.tempF.toFixed(1)}°` : '—'}
      </div>
      {climate.humidityPct != null && (
        <div className="climate-readout__hum">{climate.humidityPct}% RH</div>
      )}
    </div>
  );
}
```

**Commit:**

```bash
git add frontend/src/modules/HomeDashboard/ClimateReadout.*
git commit -m "feat(home-dashboard): add ClimateReadout"
```

---

### Task F3: `<MotionBadge>`

**Files:**
- Create: `frontend/src/modules/HomeDashboard/MotionBadge.jsx`
- Create: `frontend/src/modules/HomeDashboard/MotionBadge.scss`

```jsx
import { Badge } from '@mantine/core';

export default function MotionBadge({ motion }) {
  if (!motion) return null;
  if (!motion.available) return <Badge color="gray" variant="light">—</Badge>;
  if (motion.state === 'motion') return <Badge color="red">Motion now</Badge>;
  const ago = motion.lastChangedIso ? formatAgo(motion.lastChangedIso) : '';
  return <Badge color="green" variant="light">Clear {ago && `· ${ago}`}</Badge>;
}

function formatAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60_000);
  if (m < 1)  return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
```

**Commit:**

```bash
git add frontend/src/modules/HomeDashboard/MotionBadge.*
git commit -m "feat(home-dashboard): add MotionBadge"
```

---

### Task F4: `<RoomCard>` composing F1–F3

**Files:**
- Create: `frontend/src/modules/HomeDashboard/RoomCard.jsx`
- Create: `frontend/src/modules/HomeDashboard/RoomCard.scss`

```jsx
import { Card, Text, Group } from '@mantine/core';
import CameraFeed from '../CameraFeed/CameraFeed.jsx';
import LightRow from './LightRow.jsx';
import ClimateReadout from './ClimateReadout.jsx';
import MotionBadge from './MotionBadge.jsx';
import './RoomCard.scss';

export default function RoomCard({ room, onToggle }) {
  return (
    <Card className="room-card" withBorder shadow="xs">
      <Group justify="space-between" mb="xs">
        <Text fw={600}>{room.label}</Text>
        <MotionBadge motion={room.motion} />
      </Group>
      {room.camera && (
        <div className="room-card__camera">
          <CameraFeed cameraId={room.camera} />
        </div>
      )}
      <div className="room-card__body">
        {room.lights?.length > 0 && <LightRow lights={room.lights} onToggle={onToggle} />}
        {room.climate && <ClimateReadout climate={room.climate} />}
      </div>
    </Card>
  );
}
```

**Commit:**

```bash
git add frontend/src/modules/HomeDashboard/RoomCard.*
git commit -m "feat(home-dashboard): add RoomCard"
```

---

### Task F5: `<RoomGrid>` + integrate into `HomeApp.jsx`

**Files:**
- Create: `frontend/src/modules/HomeDashboard/RoomGrid.jsx`
- Modify: `frontend/src/Apps/HomeApp.jsx`

```jsx
// RoomGrid.jsx
import { SimpleGrid } from '@mantine/core';
import RoomCard from './RoomCard.jsx';

export default function RoomGrid({ rooms, onToggle }) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3, xl: 4 }} spacing="md">
      {rooms.map(r => <RoomCard key={r.id} room={r} onToggle={onToggle} />)}
    </SimpleGrid>
  );
}
```

**Rewrite `HomeApp.jsx`** — replace the existing camera-only body with:

```jsx
import { useMemo } from 'react';
import { Loader, Alert } from '@mantine/core';
import './HomeApp.scss';
import { getChildLogger } from '../lib/logging/singleton.js';
import useHomeDashboard from '../hooks/useHomeDashboard.js';
import RoomGrid from '../modules/HomeDashboard/RoomGrid.jsx';

function HomeApp() {
  const logger = useMemo(() => getChildLogger({ app: 'home' }), []);
  const { config, state, error, toggleLight } = useHomeDashboard();

  if (!config || !state) return <Loader />;

  return (
    <div className="App home-app">
      <div className="home-container">
        <h1>Home</h1>
        {error && <Alert color="red" variant="light">HA unreachable · retrying</Alert>}
        <RoomGrid rooms={state.rooms} onToggle={toggleLight} />
      </div>
    </div>
  );
}

export default HomeApp;
```

Cameras are now handled by `<RoomCard>` (based on the room's `camera` field in the YAML). The old `.home-cameras` section is removed.

**Verify in browser:** `npm run dev` then open `http://localhost:3111/home`. Expected: your scaffold room renders with a placeholder card. Toggling a light flips the switch.

**Commit:**

```bash
git add frontend/src/modules/HomeDashboard/RoomGrid.jsx frontend/src/Apps/HomeApp.jsx
git commit -m "feat(home-dashboard): rebuild HomeApp around RoomGrid"
```

---

## Phase G — Home summary

### Task G1: `<WeatherStrip>`

Reuses existing `/home/weather` endpoint. Keep this minimal — just the current conditions.

**Files:**
- Create: `frontend/src/modules/HomeDashboard/WeatherStrip.jsx`

```jsx
import { useEffect, useState } from 'react';
import { Paper, Group, Text } from '@mantine/core';

export default function WeatherStrip() {
  const [wx, setWx] = useState(null);
  useEffect(() => {
    fetch('/api/v1/home/weather').then(r => r.json()).then(setWx).catch(() => {});
  }, []);
  if (!wx?.current) return null;
  const { temperature, summary, humidity } = wx.current;
  return (
    <Paper withBorder p="sm">
      <Group gap="md">
        <Text size="xl" fw={700}>{Math.round(temperature)}°</Text>
        <Text>{summary}</Text>
        {humidity != null && <Text c="dimmed">{humidity}% RH</Text>}
      </Group>
    </Paper>
  );
}
```

(Adjust field names to match the actual `/home/weather` response — check `curl http://localhost:3112/api/v1/home/weather` before finalising.)

**Commit:**

```bash
git add frontend/src/modules/HomeDashboard/WeatherStrip.jsx
git commit -m "feat(home-dashboard): add WeatherStrip"
```

---

### Task G2: `<TempChart>`

**Files:**
- Create: `frontend/src/modules/HomeDashboard/TempChart.jsx`

```jsx
import { LineChart } from '@mantine/charts';
import { Paper, Text } from '@mantine/core';

export default function TempChart({ chart }) {
  if (!chart) return null;
  const data = zipSeries(chart.series);
  return (
    <Paper withBorder p="sm">
      {chart.title && <Text size="sm" mb={4}>{chart.title}</Text>}
      <LineChart
        h={160}
        data={data}
        dataKey="t"
        series={chart.series.map(s => ({ name: s.label, color: s.color }))}
        withDots={false}
        withXAxis={false}
        tooltipProps={{ content: undefined }}
      />
    </Paper>
  );
}

function zipSeries(seriesArr) {
  // series: [{ label, color, points: [{t,v}, ...] }, ...]
  const byT = new Map();
  for (const s of seriesArr) {
    for (const p of s.points) {
      if (!byT.has(p.t)) byT.set(p.t, { t: p.t });
      byT.get(p.t)[s.label] = p.v;
    }
  }
  return [...byT.values()].sort((a, b) => a.t.localeCompare(b.t));
}
```

**Commit:**

```bash
git add frontend/src/modules/HomeDashboard/TempChart.jsx
git commit -m "feat(home-dashboard): add TempChart"
```

---

### Task G3: `<EnergyChart>`

**Files:**
- Create: `frontend/src/modules/HomeDashboard/EnergyChart.jsx`

```jsx
import { AreaChart } from '@mantine/charts';
import { Paper, Text } from '@mantine/core';

export default function EnergyChart({ chart }) {
  if (!chart) return null;
  const data = chart.points.map(p => ({ t: p.t, kWh: p.v }));
  return (
    <Paper withBorder p="sm">
      {chart.title && <Text size="sm" mb={4}>{chart.title}</Text>}
      <AreaChart
        h={160}
        data={data}
        dataKey="t"
        series={[{ name: 'kWh', color: chart.color || 'teal' }]}
        withDots={false}
        withXAxis={false}
      />
    </Paper>
  );
}
```

**Commit:**

```bash
git add frontend/src/modules/HomeDashboard/EnergyChart.jsx
git commit -m "feat(home-dashboard): add EnergyChart"
```

---

### Task G4: `<SceneRow>`

**Files:**
- Create: `frontend/src/modules/HomeDashboard/SceneRow.jsx`

```jsx
import { Button, Group } from '@mantine/core';

export default function SceneRow({ scenes, onActivate }) {
  if (!scenes?.length) return null;
  return (
    <Group gap="xs">
      {scenes.map(s => (
        <Button key={s.id} variant="light" onClick={() => onActivate(s.id)}>{s.label}</Button>
      ))}
    </Group>
  );
}
```

**Commit:**

```bash
git add frontend/src/modules/HomeDashboard/SceneRow.jsx
git commit -m "feat(home-dashboard): add SceneRow"
```

---

### Task G5: `<HomeSummary>` + wire into `HomeApp.jsx`

**Files:**
- Create: `frontend/src/modules/HomeDashboard/HomeSummary.jsx`
- Modify: `frontend/src/Apps/HomeApp.jsx`

```jsx
// HomeSummary.jsx
import { Stack } from '@mantine/core';
import WeatherStrip from './WeatherStrip.jsx';
import TempChart from './TempChart.jsx';
import EnergyChart from './EnergyChart.jsx';
import SceneRow from './SceneRow.jsx';

export default function HomeSummary({ state, history, onActivateScene }) {
  return (
    <Stack gap="md" mb="md">
      <WeatherStrip />
      <SceneRow scenes={state?.summary?.sceneButtons} onActivate={onActivateScene} />
      <TempChart chart={history?.tempChart} />
      <EnergyChart chart={history?.energyChart} />
    </Stack>
  );
}
```

In `HomeApp.jsx`, between the `<Alert>` and `<RoomGrid>` add:

```jsx
<HomeSummary state={state} history={history} onActivateScene={activateScene} />
```

And grab the extra destructured values:

```jsx
const { config, state, history, error, toggleLight, activateScene } = useHomeDashboard();
```

**Verify in browser** — charts render once history fetches, scene buttons fire POSTs.

**Commit:**

```bash
git add frontend/src/modules/HomeDashboard/HomeSummary.jsx frontend/src/Apps/HomeApp.jsx
git commit -m "feat(home-dashboard): wire HomeSummary into HomeApp"
```

---

## Phase H — Camera integration completeness

### Task H1: `<UnassignedCameraRow>` for cameras not bound to a room

**Files:**
- Create: `frontend/src/modules/HomeDashboard/UnassignedCameraRow.jsx`
- Modify: `frontend/src/Apps/HomeApp.jsx`

Fetch `/api/v1/camera` as before; filter out camera IDs already referenced by any room in `state.rooms`; render the remainder in a simple grid.

```jsx
import { useEffect, useState } from 'react';
import { SimpleGrid } from '@mantine/core';
import CameraFeed from '../CameraFeed/CameraFeed.jsx';

export default function UnassignedCameraRow({ rooms }) {
  const [cameras, setCameras] = useState([]);
  useEffect(() => {
    fetch('/api/v1/camera').then(r => r.json()).then(d => setCameras(d.cameras || [])).catch(() => {});
  }, []);

  const roomCameraIds = new Set((rooms || []).map(r => r.camera).filter(Boolean));
  const unassigned = cameras.filter(c => !roomCameraIds.has(c.id));
  if (unassigned.length === 0) return null;

  return (
    <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md" mb="md">
      {unassigned.map(cam => (
        <div key={cam.id} className="home-cameras__card">
          <CameraFeed cameraId={cam.id} />
        </div>
      ))}
    </SimpleGrid>
  );
}
```

In `HomeApp.jsx`, render above the `<RoomGrid>`:

```jsx
<UnassignedCameraRow rooms={state.rooms} />
```

**Commit:**

```bash
git add frontend/src/modules/HomeDashboard/UnassignedCameraRow.jsx frontend/src/Apps/HomeApp.jsx
git commit -m "feat(home-dashboard): fold cameras — room bindings + unassigned row"
```

---

## Phase I — Polish, error states, flow test

### Task I1: Offline-banner dismissal + styling pass

**Files:**
- Modify: `frontend/src/Apps/HomeApp.scss`
- Modify: `frontend/src/modules/HomeDashboard/*.scss`

Clean up the SCSS (existing `HomeApp.scss` still has camera-era styles). Ensure tile heights are consistent, unavailable tiles have visible greying, motion badge colors meet contrast.

**Responsive check:** open Chrome devtools, toggle device toolbar, test at 375px (iPhone SE), 768px (iPad), 1440px (laptop). Cards shouldn't overflow, switches should remain tappable (≥44px), charts should shrink gracefully.

**Commit:**

```bash
git add frontend/src/Apps/HomeApp.scss frontend/src/modules/HomeDashboard/*.scss
git commit -m "style(home-dashboard): responsive polish + unavailable states"
```

---

### Task I2: Playwright flow test

**Files:**
- Create: `tests/live/flow/home/home-happy-path.runtime.test.mjs`

```javascript
import { test, expect } from '@playwright/test';
import { getAppPort } from '#testlib/configHelper.mjs';

test('/home loads, renders at least one room card', async ({ page }) => {
  const port = await getAppPort();
  await page.goto(`http://localhost:${port}/home`);
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(page.locator('.room-card').first()).toBeVisible({ timeout: 10_000 });
});

test('/home surfaces an error banner if /state fails', async ({ page }) => {
  const port = await getAppPort();
  await page.route('**/api/v1/home-dashboard/state', r => r.abort());
  await page.goto(`http://localhost:${port}/home`);
  await expect(page.getByText(/HA unreachable/)).toBeVisible({ timeout: 15_000 });
});
```

**Step 5: Run + commit.**

```bash
npx playwright test tests/live/flow/home/home-happy-path.runtime.test.mjs --reporter=line
git add tests/live/flow/home/home-happy-path.runtime.test.mjs
git commit -m "test(home-dashboard): playwright flow — happy path + error banner"
```

---

## Verification checklist before merging

- [ ] `npm run test:unit` — all green (new unit tests in `tests/unit/adapters/home-automation/`, `tests/unit/applications/home-automation/`, `tests/unit/adapters/persistence/yaml/`).
- [ ] `npm run test:live:api -- --pattern=home-dashboard` — green.
- [ ] `npx playwright test tests/live/flow/home/` — green.
- [ ] Manually loaded `/home` in browser; lights toggle; chart renders; scene button fires.
- [ ] Phone width (375px) usable; no overflow.
- [ ] Killed HA connectivity (`sudo ifconfig en0 down` briefly, or mock in devtools); banner appears, tiles grey out, recovers when HA returns.
- [ ] `home-dashboard.yml` references at least one real HA entity per room in your household.

---

## Finish-the-branch checklist

Per `docs/reference/core/layers-of-abstraction/*.md`:

- [ ] No `4_api/` file imports from `3_applications/` or `1_adapters/`.
- [ ] No `3_applications/` file imports from `1_adapters/`.
- [ ] No `3_applications/` file imports from `0_system/config/` (only `0_system/utils/`).
- [ ] No path construction in use cases or handlers (yaml path lives in the repository adapter).
- [ ] All new code uses the logging framework — no raw `console.log`.
- [ ] Toggle + scene endpoints reject entities not listed in YAML (verified by unit test).

When green: merge via worktree finish (use `superpowers:finishing-a-development-branch`), then record in `docs/_archive/deleted-branches.md` and delete the worktree.
