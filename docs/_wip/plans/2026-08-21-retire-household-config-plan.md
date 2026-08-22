# Retire `data/household/config/` — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Delete `data/household/config/` by moving all 26 configs and 2 subdirectories into their domain folders, replacing scan-based config discovery with one explicit registry, and fixing the two live bugs this uncovered.

**Architecture:** A single `shared/contracts/householdConfig.mjs` maps app name → path under the household folder. It lives in `shared/` rather than `0_system/config/` because `3_applications/` may not import `#system/config/*` (rule `apps-no-config-internals`, `scripts/audit-layer-imports.mjs:26`) and the registry is a naming contract, not config internals — no logic, no I/O. `shared/contracts/media/` is the same pattern, and the admin frontend already imports from `shared/` via relative paths. `configLoader` and `ConfigService` read from it instead of scanning; `AppsConfigService` and `YamlConfigFileService` **derive** their path lists from it instead of hand-maintaining them. Every reader gains a legacy fallback first (deployable no-op), then data moves, then fallbacks are deleted. Design rationale: `docs/_wip/plans/2026-08-21-retire-household-config-directory.md`.

**Tech Stack:** Node ESM (`.mjs`), vitest (globals on, `#system/` `#apps/` `#adapters/` `#domains/` import aliases), js-yaml, Express.

---

## Layer rules you WILL trip over

`scripts/audit-layer-imports.mjs` is a ratchet with per-rule baselines. Two rules
bind this work:

- `apps-no-config-internals` — `3_applications/` may not import `#system/config/*`
  AT ALL. No exemption for pure constants. This is why the registry lives in
  `shared/contracts/`. Baseline is 8; it must still read 8 when you are done.
- `no-storage-paths` — scans `backend/src/` and `shared/` for a literal
  `'household/<lowercase>`. `0_system/config/`, `1_adapters/`, `5_composition/`,
  `app.mjs`, and `3_applications/admin/` are excluded. Registry values are
  household-RELATIVE (`hardware/scales`), so they do not trip it.

`npm run audit:layers` already exits 1 on unrelated pre-existing regressions
(`apps-success-false`, `domains-tojson`). Judge your change by whether YOUR rule's
count moved, not by the exit code.

## Context you need before starting

**The data tree is NOT in this repo.** It lives at
`$DAYLIGHT_BASE_PATH/data` (see `.env`), is Dropbox-synced, and is the SAME tree
prod reads. A file you move here appears on prod within minutes — **before** any
code deploys. That is why every task in Phase A adds a fallback and moves nothing.

**Config is cached at boot.** `getHouseholdAppConfig` reads an in-memory
`#config` built once by `loadConfig()`. Editing YAML has no effect until a restart
or a `reloadHouseholdAppConfig` call.

**Never start a second backend.** `node backend/index.js` is a live household
controller — it makes real Home Assistant calls. If you need a running server,
use the one that is already running.

**Run a test:** `npx vitest run <path/to/file.test.mjs>` (globals are enabled; do
not import `describe`/`it`/`expect`).

**Layer rule:** no `fs` in `3_applications/`. The registry is `0_system/`, which
may do I/O.

---

## Phase A — Registry and dual-read (deployable, behavior no-op)

### Task 1: Create the household config registry

**Files:**
- Create: `shared/contracts/householdConfig.mjs`
- Test: `shared/contracts/householdConfig.test.mjs`

**Step 1: Write the failing test**

```javascript
// shared/contracts/householdConfig.test.mjs
import {
  HOUSEHOLD_APP_CONFIGS,
  appConfigRelPath,
  legacyAppConfigRelPath,
  allAppNames,
} from '#shared/contracts/householdConfig.mjs';

describe('householdConfigRegistry', () => {
  it('maps an app to its grouped path under the household folder', () => {
    expect(appConfigRelPath('scales')).toBe('hardware/scales');
    expect(appConfigRelPath('vehicles')).toBe('automotive/vehicles');
    expect(appConfigRelPath('concierge')).toBe('agents/concierge');
  });

  it('returns null for an app it does not know', () => {
    expect(appConfigRelPath('nope')).toBeNull();
  });

  it('gives the legacy flat path for any app name', () => {
    expect(legacyAppConfigRelPath('scales')).toBe('config/scales');
    expect(legacyAppConfigRelPath('nope')).toBe('config/nope');
  });

  it('keeps the media domain/surface split honest', () => {
    // `media` is the DOMAIN (plex host, infinity board ids).
    // `media-app` is the SURFACE (browse menu, searchScopes).
    expect(appConfigRelPath('media')).toBe('media/config');
    expect(appConfigRelPath('media-app')).toBe('media/app');
  });

  it('names school explicitly rather than by convention', () => {
    expect(appConfigRelPath('school')).toBe('school/school');
  });

  it('has no duplicate destination paths', () => {
    const paths = Object.values(HOUSEHOLD_APP_CONFIGS);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('lists every registered app', () => {
    expect(allAppNames()).toContain('playback-hub');
    expect(allAppNames().length).toBe(Object.keys(HOUSEHOLD_APP_CONFIGS).length);
  });
});
```

**Step 2: Run it and watch it fail**

```
npx vitest run shared/contracts/householdConfig.test.mjs
```
Expected: FAIL — cannot resolve `#shared/contracts/householdConfig.mjs`.

**Step 3: Write the registry**

```javascript
// shared/contracts/householdConfig.mjs
/**
 * The single source of truth for where a household app's config lives.
 *
 * Folder = the DOMAIN, named after `backend/src/3_applications/`.
 * Filename = the facet: `config` for domain policy, another name for a
 * surface or a second facet of the same domain.
 *
 * This replaces the directory scan that `configLoader` used to do. A scan
 * cannot express grouping (`hardware/scales.yml` is not `<app>/config.yml`),
 * and — more importantly — it left `AppsConfigService.APP_CONFIGS` and
 * `YamlConfigFileService.ALLOWED_FILES` to be maintained BY HAND. Both drifted:
 * ALLOWED_FILES shipped covering 3 of the 11 files task-13 created, silently
 * 403ing the rest in the admin YAML browser. Both now derive from this map, so
 * adding an app here is the only edit an app needs.
 *
 * Paths are relative to the household folder, WITHOUT extension — callers
 * resolve .yml/.yaml via `resolveYamlPath`.
 */
export const HOUSEHOLD_APP_CONFIGS = Object.freeze({
  agents:           'agents/config',
  ambient:          'ambient/config',
  art:              'art/config',
  artmode:          'art/artmode',
  barcode:          'hardware/barcode/config',
  'barcode-relay':  'hardware/barcode/relay',
  'camera-archive': 'camera/archive',
  chess:            'gaming/chess',
  concierge:        'agents/concierge',
  donow:            'donow/config',
  entropy:          'entropy/config',
  finance:          'finance/config',
  fitness:          'fitness/config',
  games:            'gaming/games',
  gameshow:         'gaming/gameshow/config',
  gratitude:        'gratitude/config',
  harvest:          'harvest/config',
  livestream:       'livestream/config',
  // `media` is the DOMAIN (plex host, protocol, infinity board ids) and
  // `media-app` is the MediaApp SURFACE (browse menu, searchScopes). The files
  // on disk were named the other way round before this migration — see the
  // design doc, "The media pair proves the current names are backwards".
  media:            'media/config',
  'media-app':      'media/app',
  newsreporter:     'newsreporter/config',
  notifications:    'notifications/config',
  'omr-readers':    'hardware/omr/readers',
  piano:            'piano/config',
  'playback-hub':   'playback-hub/config',
  'pressure-mats':  'hardware/pressure-mats/config',
  retroarch:        'gaming/retroarch/config',
  scales:           'hardware/scales',
  // A named policy file reads better than a generic config.yml sitting beside
  // records/ and runtime/ — kept from task-13.
  school:           'school/school',
  sheets:           'sheets/config',
  vehicles:         'automotive/vehicles',
});

/** Grouped path for an app, or null when the app is not registered. */
export function appConfigRelPath(appName) {
  return HOUSEHOLD_APP_CONFIGS[appName] ?? null;
}

/**
 * The retiring flat path. Kept ONLY so a tree that has not synced the data move
 * yet still resolves. Deleted in Phase E.
 */
export function legacyAppConfigRelPath(appName) {
  return `config/${appName}`;
}

/** Every registered app name. */
export function allAppNames() {
  return Object.keys(HOUSEHOLD_APP_CONFIGS);
}
```

**Step 4: Run it and watch it pass**

```
npx vitest run shared/contracts/householdConfig.test.mjs
```
Expected: PASS, 7 tests.

**Step 5: Commit**

```bash
git add shared/contracts/householdConfig.mjs \
        shared/contracts/householdConfig.test.mjs
git commit -m "feat(config): add household config registry (app -> grouped path)"
```

---

### Task 2: `ConfigService` resolves through the registry

**Files:**
- Modify: `backend/src/0_system/config/ConfigService.mjs:236-241` (`#resolveHouseholdAppConfigPath`)
- Test: `backend/tests/unit/system/config/configServiceAppPath.test.mjs`

**Step 1: Write the failing test**

```javascript
// backend/tests/unit/system/config/configServiceAppPath.test.mjs
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { ConfigService } from '#system/config/ConfigService.mjs';

let dataDir;
beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cfgsvc-'));
});
afterEach(async () => { await fs.rm(dataDir, { recursive: true, force: true }); });

const write = async (rel, body) => {
  const full = path.join(dataDir, 'household', rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body, 'utf8');
};

// Minimal ConfigService standing in for a booted one.
// VERIFIED against ConfigService.mjs:22 — constructor(config, secretsHandler).
// getDataDir() reads config.system.dataDir (line 368) and
// getDefaultHouseholdId() reads config.system.defaultHouseholdId (line 86),
// so BOTH live under `system`, not at the top level.
const svc = () => new ConfigService({
  system: { dataDir, defaultHouseholdId: 'default' },
  households: { default: { _folderName: 'household', apps: {} } },
});

describe('ConfigService app config path resolution', () => {
  it('prefers the grouped registry path', async () => {
    await write('hardware/scales.yml', 'a: 1\n');
    await write('config/scales.yml', 'a: 2\n');
    expect(svc().reloadHouseholdAppConfig('default', 'scales')).toEqual({ a: 1 });
  });

  it('falls back to the legacy flat path while data has not moved yet', async () => {
    await write('config/scales.yml', 'a: 2\n');
    expect(svc().reloadHouseholdAppConfig('default', 'scales')).toEqual({ a: 2 });
  });

  it('resolves the WRITE path to the same file the read side picked', async () => {
    await write('hardware/scales.yml', 'a: 1\n');
    expect(svc().getHouseholdAppConfigPath('default', 'scales'))
      .toBe(path.join(dataDir, 'household', 'hardware', 'scales.yml'));
  });

  it('defaults an unwritten config to its grouped path, not the legacy one', () => {
    expect(svc().getHouseholdAppConfigPath('default', 'sheets'))
      .toBe(path.join(dataDir, 'household', 'sheets', 'config.yml'));
  });
});
```

> Signature verified 2026-08-21 — no adaptation needed.

**Step 2: Run it and watch it fail**

```
npx vitest run backend/tests/unit/system/config/configServiceAppPath.test.mjs
```
Expected: FAIL on the first case — legacy currently wins for `scales` because
`hardware/scales.yml` is not `<app>/config.yml`.

**Step 3: Replace the resolver**

In `ConfigService.mjs`, add to the imports:

```javascript
import { appConfigRelPath, legacyAppConfigRelPath } from '#shared/contracts/householdConfig.mjs';
```

Replace the whole body of `#resolveHouseholdAppConfigPath` (currently lines 236-241):

```javascript
  #resolveHouseholdAppConfigPath(dataDir, folderName, appName) {
    const grouped = appConfigRelPath(appName);
    if (grouped) {
      const groupedPath = `${dataDir}/${folderName}/${grouped}`;
      if (yamlExists(groupedPath)) return groupedPath;
    }
    // Retiring: a tree that has not synced the data move yet. Phase E deletes
    // this branch along with the directory.
    const legacyPath = `${dataDir}/${folderName}/${legacyAppConfigRelPath(appName)}`;
    if (yamlExists(legacyPath)) return legacyPath;
    // Neither exists — hand back the grouped path so a first write lands in the
    // new home rather than recreating config/.
    return grouped ? `${dataDir}/${folderName}/${grouped}` : legacyPath;
  }
```

Update the doc comment above it to describe registry-first, and delete the
`configBasename`/school special case — school is now a registry entry.

**Step 4: Run it and watch it pass**

```
npx vitest run backend/tests/unit/system/config/configServiceAppPath.test.mjs
```
Expected: PASS, 4 tests.

**Step 5: Guard against regressions elsewhere**

```
npx vitest run backend/tests/unit/applications/admin/yamlConfigFileService.test.mjs
npm run test:refactor
```
Expected: PASS. `test:refactor` is the project's ratchet gate — it must stay green.

**Step 6: Commit**

```bash
git add backend/src/0_system/config/ConfigService.mjs \
        backend/tests/unit/system/config/configServiceAppPath.test.mjs
git commit -m "refactor(config): resolve app config paths through the registry"
```

---

### Task 3: `configLoader` builds the app union from the registry

**Files:**
- Modify: `backend/src/0_system/config/configLoader.mjs:149-193` (`loadHouseholdApps`)
- Test: `backend/tests/unit/system/config/loadHouseholdApps.test.mjs`

**Step 1: Write the failing test**

```javascript
// backend/tests/unit/system/config/loadHouseholdApps.test.mjs
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { loadConfig } from '#system/config/configLoader.mjs';

let dataDir;
beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cfgload-'));
  await fs.mkdir(path.join(dataDir, 'system', 'config'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'system', 'config', 'system.yml'), 'timezone: UTC\n');
  await fs.writeFile(path.join(dataDir, 'household', 'household.yml'), '');
});
afterEach(async () => { await fs.rm(dataDir, { recursive: true, force: true }); });

const write = async (rel, body) => {
  const full = path.join(dataDir, 'household', rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body, 'utf8');
};
const apps = () => loadConfig(dataDir).households.default.apps;

describe('loadHouseholdApps', () => {
  it('loads a grouped config', async () => {
    await write('hardware/scales.yml', 'unit: g\n');
    expect(apps().scales).toEqual({ unit: 'g' });
  });

  it('loads a legacy flat config while data has not moved', async () => {
    await write('config/scales.yml', 'unit: kg\n');
    expect(apps().scales).toEqual({ unit: 'kg' });
  });

  it('lets the grouped config win over the legacy one', async () => {
    await write('hardware/scales.yml', 'unit: g\n');
    await write('config/scales.yml', 'unit: kg\n');
    expect(apps().scales).toEqual({ unit: 'g' });
  });

  it('does not invent an app for a registered path with no file', async () => {
    expect(apps().scales).toBeUndefined();
  });

  it('still loads an UNREGISTERED legacy config so nothing silently vanishes', async () => {
    await write('config/experimental-thing.yml', 'x: 1\n');
    expect(apps()['experimental-thing']).toEqual({ x: 1 });
  });
});
```

> The last case matters. If the registry misses an app, a registry-only loader
> would drop it with no error — the exact silent-shrink failure that task-13's
> review flagged as Important 3.

**Step 2: Run it and watch it fail**

```
npx vitest run backend/tests/unit/system/config/loadHouseholdApps.test.mjs
```
Expected: FAIL on the grouped cases.

**Step 3: Rewrite `loadHouseholdApps`**

Add to `configLoader.mjs` imports:

```javascript
import { HOUSEHOLD_APP_CONFIGS } from '#shared/contracts/householdConfig.mjs';
```

Replace `loadHouseholdApps` (lines 149-193) with:

```javascript
/**
 * Build the app config union for one household.
 *
 * Precedence, lowest to highest:
 *   1. apps/<name>.yml or apps/<name>/config.yml   (legacy)
 *   2. config/<name>.yml                            (retiring — Phase E deletes)
 *   3. the grouped path in HOUSEHOLD_APP_CONFIGS    (preferred)
 *
 * The config/ scan is kept until the data move lands so an unsynced tree still
 * boots, and it also catches an app missing from the registry rather than
 * dropping it silently.
 *
 * Non-app configs are never picked up here: household.yml and integrations.yml
 * sit at the household root, devices.yml under hardware/.
 */
function loadHouseholdApps(dataDir, folderName) {
  const householdDir = path.join(dataDir, folderName);
  const appsFromLegacy = loadAppsFromDir(path.join(householdDir, 'apps'));

  // Retiring flat directory.
  const NON_APP_CONFIGS = new Set(['household', 'integrations', 'devices']);
  const appsFromConfigDir = {};
  for (const file of listYamlFiles(path.join(householdDir, 'config'))) {
    const name = path.basename(file, '.yml');
    if (NON_APP_CONFIGS.has(name)) continue;
    const config = readYaml(file);
    if (config) appsFromConfigDir[name] = config;
  }

  // Registry — the preferred location.
  const appsFromRegistry = {};
  for (const [appName, relPath] of Object.entries(HOUSEHOLD_APP_CONFIGS)) {
    const resolved = resolveYamlPath(path.join(householdDir, relPath));
    const config = resolved ? readYaml(resolved) : null;
    if (config) appsFromRegistry[appName] = config;
  }

  return { ...appsFromLegacy, ...appsFromConfigDir, ...appsFromRegistry };
}
```

Delete the now-unused `listDirs` import if nothing else in the file uses it.

**Step 4: Run it and watch it pass**

```
npx vitest run backend/tests/unit/system/config/loadHouseholdApps.test.mjs
```
Expected: PASS, 5 tests.

**Step 5: Commit**

```bash
git add backend/src/0_system/config/configLoader.mjs \
        backend/tests/unit/system/config/loadHouseholdApps.test.mjs
git commit -m "refactor(config): build household app union from the registry"
```

---

### Task 4: Derive `AppsConfigService.APP_CONFIGS` from the registry

**Files:**
- Modify: `backend/src/3_applications/admin/AppsConfigService.mjs:22-39`
- Test: `backend/tests/unit/applications/admin/appsConfigService.registry.test.mjs`

**Step 1: Write the failing test**

```javascript
// backend/tests/unit/applications/admin/appsConfigService.registry.test.mjs
import { APP_CONFIGS } from '#apps/admin/AppsConfigService.mjs';
import { HOUSEHOLD_APP_CONFIGS } from '#shared/contracts/householdConfig.mjs';

describe('AppsConfigService path registry', () => {
  it('points every admin app at its registry path, not a hardcoded one', () => {
    for (const [appId, filePath] of Object.entries(APP_CONFIGS)) {
      expect(filePath.startsWith('household/config/')).toBe(false);
      expect(filePath).toMatch(/^household\//);
      expect(appId).not.toBe('chatbots'); // dead duplicate, removed
    }
  });

  it('resolves the admin "media" app to the MediaApp surface file', () => {
    expect(APP_CONFIGS.media).toBe(`household/${HOUSEHOLD_APP_CONFIGS['media-app']}.yml`);
  });

  it('resolves finance to the renamed singular folder', () => {
    expect(APP_CONFIGS.finance).toBe('household/finance/config.yml');
  });
});
```

**Step 2: Run it and watch it fail**

```
npx vitest run backend/tests/unit/applications/admin/appsConfigService.registry.test.mjs
```
Expected: FAIL — `APP_CONFIGS` is not exported, and entries still say `household/config/`.

**Step 3: Derive the map**

In `AppsConfigService.mjs`, replace the `APP_CONFIGS` block (lines 22-39):

```javascript
import { HOUSEHOLD_APP_CONFIGS } from '#shared/contracts/householdConfig.mjs';

/**
 * Admin-app-ID → config file path, derived from the household config registry
 * so it cannot drift from what the loader actually reads. Only the admin's
 * friendly IDs differ from app names:
 *   shopping → harvest      (the admin calls it Shopping)
 *   media    → media-app    (the admin edits the SURFACE: browse + searchScopes)
 */
const ADMIN_ID_TO_APP = {
  fitness: 'fitness',
  finance: 'finance',
  gratitude: 'gratitude',
  shopping: 'harvest',
  media: 'media-app',
  entropy: 'entropy',
  piano: 'piano',
};

export const APP_CONFIGS = Object.freeze(
  Object.fromEntries(
    Object.entries(ADMIN_ID_TO_APP)
      .map(([adminId, appName]) => [adminId, `household/${HOUSEHOLD_APP_CONFIGS[appName]}.yml`])
  )
);
```

`chatbots` and `keyboard` leave this map: `chatbots.yml` is deleted and
`keyboard.yml` becomes trigger bindings (Task 7, item 3).

**`keyboard` is deliberately NOT in `HOUSEHOLD_APP_CONFIGS`.** It is a uid'd list
of key bindings — the same shape as `triggers/bindings/nfc/` — not app config.
Verified safe: nothing reads `apps.keyboard` through the app union; its only two
consumers read the file directly (`routers/device.mjs:150`,
`routers/homeAutomation.mjs:275`). But removing it from `APP_CONFIGS` WOULD take
away its admin editing surface, so Task 5 adds
`household/triggers/bindings/keyboard.yml` to `ALLOWED_FILES` explicitly.

**Step 4: Run it and watch it pass**

```
npx vitest run backend/tests/unit/applications/admin/appsConfigService.registry.test.mjs
```
Expected: PASS, 3 tests.

**Step 5: Commit**

```bash
git add backend/src/3_applications/admin/AppsConfigService.mjs \
        backend/tests/unit/applications/admin/appsConfigService.registry.test.mjs
git commit -m "refactor(admin): derive AppsConfigService paths from the config registry"
```

---

### Task 5: Derive `YamlConfigFileService.ALLOWED_FILES` from the registry

This is the highest-value task in Phase A. This list is the one that fails
**silently** — a missing entry 403s a file in the admin YAML browser with no
signal anywhere else.

**Files:**
- Modify: `backend/src/3_applications/admin/YamlConfigFileService.mjs:36-72`
- Test: `backend/tests/unit/applications/admin/yamlConfigFileService.allowlist.test.mjs`

**Step 1: Write the failing test**

```javascript
// backend/tests/unit/applications/admin/yamlConfigFileService.allowlist.test.mjs
import { ALLOWED_FILES } from '#apps/admin/YamlConfigFileService.mjs';
import { HOUSEHOLD_APP_CONFIGS } from '#shared/contracts/householdConfig.mjs';

describe('admin YAML browser allowlist', () => {
  it('covers EVERY registered app config — no app is silently 403ed', () => {
    const missing = Object.entries(HOUSEHOLD_APP_CONFIGS)
      .map(([app, rel]) => [app, `household/${rel}.yml`])
      .filter(([, file]) => !ALLOWED_FILES.includes(file));
    expect(missing).toEqual([]);
  });

  it('still allows the root-level files that are not app configs', () => {
    expect(ALLOWED_FILES).toContain('household/integrations.yml');
  });

  it('never grants a whole domain directory (would expose log trees)', () => {
    for (const entry of ALLOWED_FILES) expect(entry).toMatch(/\.ya?ml$/);
  });
});
```

**Step 2: Run it and watch it fail**

```
npx vitest run backend/tests/unit/applications/admin/yamlConfigFileService.allowlist.test.mjs
```
Expected: FAIL — `ALLOWED_FILES` is not exported and covers ~12 of 32 apps.

**Step 3: Derive the list**

In `YamlConfigFileService.mjs`, add the import and replace `ALLOWED_FILES`
(lines 43-72):

```javascript
import { HOUSEHOLD_APP_CONFIGS } from '#shared/contracts/householdConfig.mjs';

/**
 * Individual files the admin YAML browser may read and write.
 *
 * DERIVED from the household config registry — deliberately a file allowlist,
 * never a directory one: a grant on `household/fitness` would also expose
 * `household/fitness/log/`, a 2000+-entry session-telemetry tree.
 *
 * This list used to be hand-maintained and it drifted: it shipped covering 3 of
 * the 11 files task-13 colocated, silently 403ing the other 8 with no error
 * anywhere. Deriving it means adding an app to the registry is the only edit an
 * app needs.
 */
export const ALLOWED_FILES = Object.freeze([
  ...Object.values(HOUSEHOLD_APP_CONFIGS).map((rel) => `household/${rel}.yml`),
  // Not an app config: no dedicated write surface exists
  // (IntegrationsQueryService is read-only), so without this entry the file is
  // editable only by shelling into the container. household.yml and
  // hardware/devices.yml DO have real write surfaces and stay off this list.
  'household/integrations.yml',
  'household/media/content-prefixes.yml',
  // Trigger bindings, not an app config — but it WAS admin-editable via
  // AppsConfigService before this migration. Without this entry, moving
  // keyboard.yml out of the app registry would silently take away the only UI
  // for editing the Office Keypad bindings. (Found by the Task 1 verification
  // pass, 2026-08-21.)
  'household/triggers/bindings/keyboard.yml',
]);
```

**Step 4: Run it and watch it pass**

```
npx vitest run backend/tests/unit/applications/admin/yamlConfigFileService.allowlist.test.mjs
npx vitest run backend/tests/unit/applications/admin/yamlConfigFileService.test.mjs
```
Expected: PASS both. The second is the existing security test — it must stay green.

**Step 5: Commit**

```bash
git add backend/src/3_applications/admin/YamlConfigFileService.mjs \
        backend/tests/unit/applications/admin/yamlConfigFileService.allowlist.test.mjs
git commit -m "fix(admin): derive YAML browser allowlist from the config registry"
```

---

### Task 6: Teach `artmodeConfig` both paths

**Files:**
- Modify: `backend/src/1_adapters/content/art/artmodeConfig.mjs:26`
- Modify: `backend/tests/unit/adapters/art/artmodeConfig.schedule.test.mjs:20`

**Step 1: Add a failing case to the existing test**

In `artmodeConfig.schedule.test.mjs`, add alongside the existing `write` helper:

```javascript
const writeGrouped = async (body) => {
  await fs.mkdir(path.join(householdPath, 'art'), { recursive: true });
  return fs.writeFile(path.join(householdPath, 'art', 'artmode.yml'), body, 'utf8');
};

it('reads the grouped art/artmode.yml', async () => {
  await writeGrouped('schedule:\n  - days: [tue]\n    start: "08:00"\n    end: "10:00"\n    preset: baroque\n');
  const cfg = await loadArtmodeConfig(householdPath);
  expect(cfg.schedule).toEqual([{ days: ['tue'], start: '08:00', end: '10:00', preset: 'baroque' }]);
});

it('prefers grouped over legacy when both exist', async () => {
  await writeGrouped('presets:\n  a: { collection: paintings }\n');
  await write('presets:\n  b: { collection: sketches }\n');
  const cfg = await loadArtmodeConfig(householdPath);
  expect(Object.keys(cfg.presets)).toEqual(['a']);
});
```

**Step 2: Run and watch the two new cases fail**

```
npx vitest run backend/tests/unit/adapters/art/artmodeConfig.schedule.test.mjs
```
Expected: 2 failed, 2 passed.

**Step 3: Implement**

At `artmodeConfig.mjs:26`, replace the single `path.join(householdDir, 'config', 'artmode.yml')`
with a grouped-first lookup:

```javascript
  const candidates = [
    path.join(householdDir, 'art', 'artmode.yml'),
    path.join(householdDir, 'config', 'artmode.yml'), // retiring — Phase E
  ];
  const target = candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
```

then read `target` as before, keeping the existing
`'artmode.config.read_failed'` logging.

**Step 4: Run and watch all four pass**

```
npx vitest run backend/tests/unit/adapters/art/artmodeConfig.schedule.test.mjs
```
Expected: PASS, 4 tests.

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/art/artmodeConfig.mjs \
        backend/tests/unit/adapters/art/artmodeConfig.schedule.test.mjs
git commit -m "feat(art): read artmode config from art/ with legacy fallback"
```

---

### Task 7: Teach the remaining backend literal-path sites both paths

No new tests — these are one-line path swaps in composition code with no unit
coverage. Verify by boot, in Task 10.

**Files and edits:**

1. `backend/src/5_composition/bootstrap.mjs:1482` — playback-hub. Replace the
   hardcoded join with the resolver so it follows the registry:
   ```javascript
   const yamlPath = configService.getHouseholdAppConfigPath(null, 'playback-hub');
   ```
   Update the doc comment at line 1445 (`<dataDir>/household/config/playback-hub.yml`).

2. `backend/src/5_composition/bootstrap.mjs:2836` — concierge. The call already
   goes through `reloadHouseholdAppConfig`, so only the stale comment changes:
   `// Reads data/household/agents/concierge.yml`.

3. `backend/src/4_api/v1/routers/device.mjs:150` and
   `backend/src/4_api/v1/routers/homeAutomation.mjs:275` — keyboard. Both call
   `loadFile('config/keyboard')`. Change to:
   ```javascript
   loadFile('triggers/bindings/keyboard') || loadFile('config/keyboard') || []
   ```

4. `backend/src/1_adapters/trigger/YamlTriggerConfigRepository.mjs:28-35` — add a
   resolver above `PATHS` and use it for all five constants:
   ```javascript
   // Grouped first, legacy second. This repository WRITES as well as reads, so
   // both sides must agree on which file won — resolve once, here.
   const TRIGGER_ROOT = 'triggers';
   const LEGACY_TRIGGER_ROOT = 'config/triggers';
   ```
   Thread both roots through `#saveFile`/load so a read falls back but a **write
   always targets `TRIGGER_ROOT`**. Read the file before editing — the write
   chain and the `bindings/nfc` directory form both need to follow.

5. `backend/src/1_adapters/content/media/files/FileAdapter.mjs:369` and
   `backend/src/1_adapters/content/media/media/MediaAdapter.mjs:281` — delete the
   `household/config/local-media.yml` block. That file does not exist anywhere in
   the data tree; the code is dead.

6. `backend/src/1_adapters/persistence/yaml/YamlHomeDashboardConfigRepository.mjs:13`
   — **the feature IS fully wired** (verified 2026-08-21: router mounted at
   `app.mjs:3079`, repository constructed at `modules/homeApi.mjs:92`). The data
   file `household/config/home-dashboard.yml` simply does not exist, so the read
   returns null and the dashboard runs on defaults today.

   It is read via `dataService.household.read()`, NOT through the app union, so
   it does **not** belong in `HOUSEHOLD_APP_CONFIGS`. Just move the literal:
   ```javascript
   const CONFIG_PATH = 'home/dashboard';   // was 'config/home-dashboard'
   ```
   Behavior is unchanged (the file is absent either way); this stops Phase E from
   leaving a reader pointed at a deleted directory. Do NOT delete the repository.

**Commit**

```bash
git add -A backend/src
git commit -m "feat(config): grouped-path-first reads across remaining literal sites"
```

---

### Task 8: Frontend admin paths derive from the same registry

The frontend holds the LAST hand-typed copy of these paths, and it is the one
most likely to drift, because it routes through
`/api/v1/admin/config/files/{path}` (`YamlConfigFileService`) — a DIFFERENT
allowlist from `APP_CONFIGS`, so it did not follow Task 4's change.

**Do NOT create a new frontend map.** An earlier draft of this plan proposed
exactly that, which is the anti-pattern this whole migration exists to kill.
The registry now lives in `shared/`, and the frontend already imports from
`shared/` via relative paths in production code (`Piano/PianoCheckers/moveSlide.js:13`,
`Piano/PianoKiosk/producer/presetManifest.js:14`) — so import the real thing.

**Files:**
- Modify: `frontend/src/modules/Admin/Apps/AppConfigEditor.jsx:16-21` (its `APP_CONFIG_PATHS` map — delete it)
- Modify: `frontend/src/modules/Admin/Apps/FinanceConfig.jsx:101`
- Modify: `frontend/src/modules/Admin/Apps/FitnessConfig.jsx:522`
- Modify: `frontend/src/modules/Admin/Apps/GratitudeConfig.jsx:103`
- Modify: `frontend/src/modules/Admin/Apps/ShoppingConfig.jsx:175`
- Modify: `frontend/src/modules/Admin/Art/ArtLibrary.jsx:23`
- Modify: `frontend/src/modules/Admin/Games/GamesIndex.jsx:51,55`

From `frontend/src/modules/Admin/<Section>/` the repo root is five levels up:

```javascript
import { HOUSEHOLD_APP_CONFIGS } from '../../../../../shared/contracts/householdConfig.mjs';

/** Admin YAML-browser path for a registered app. */
const configPath = (app) => `household/${HOUSEHOLD_APP_CONFIGS[app]}.yml`;
```

Then every literal becomes a call: `configPath('finance')`, `configPath('art')`,
`configPath('games')`, `configPath('media-app')`, and so on. Note the admin's
friendly IDs differ from app names in two places — `shopping` → `harvest` and
`media` → `media-app` — the same mapping `AppsConfigService.ADMIN_ID_TO_APP`
already encodes.

**Verification.** These paths 404 until the data move lands, so do NOT judge this
by loading the pages now. Judge it statically:

```bash
# must return NOTHING when this task is done
grep -rn "household/config/" frontend/src
```

Then add a test asserting the frontend and backend agree, so they cannot drift
again:

```javascript
// frontend/src/modules/Admin/Apps/adminConfigPaths.test.js
import { HOUSEHOLD_APP_CONFIGS } from '../../../../../shared/contracts/householdConfig.mjs';

it('every admin editor path is a registered app config', () => {
  const used = ['finance', 'fitness', 'gratitude', 'harvest', 'media-app', 'art', 'games'];
  const unregistered = used.filter((a) => !HOUSEHOLD_APP_CONFIGS[a]);
  expect(unregistered).toEqual([]);
});
```

After the data move, load each admin page and confirm it reads AND saves.

### Task 9: CLI literal-path sites

**Files:**
- Modify: `cli/school/omr.mjs:44`
- Modify: `cli/plex-sync.cli.mjs:117`
- Modify: `cli/school/certify.mjs:92,166`
- Modify: `cli/barcode-scan-sim.cli.mjs:307,310`

Each gets the same grouped-first-then-legacy shape. Follow the pattern already in
`cli/lib/fitness/backfillPrimaryMedia.mjs:51` — that file already does exactly
this for fitness and has a test at `backfillPrimaryMedia.test.mjs:69` proving the
legacy branch works. Copy its structure.

For `certify.mjs`, the default becomes `household/school/surfaces` (see Task 11).

**Commit**

```bash
git add cli/
git commit -m "feat(cli): grouped-path-first config reads with legacy fallback"
```

---

### Task 10: Deploy checkpoint 1 — prove the no-op

Nothing has moved. Every reader now prefers a path that does not exist yet and
falls back to the one that does. So a correct Phase A changes **no behavior**.

**Step 1: Full backend suite**

```
npm run test:backend
npm run test:refactor
```
Expected: PASS. Do not proceed on a red suite.

**Step 2: Restart the ALREADY-RUNNING dev server** (do not start a second one —
see the context note) and reload:

```bash
curl -s -X POST http://localhost:3111/api/v1/system/reload | jq
```
Expected: every app in `reloaded`, `failed: []`.

**Step 3: Compare the app union against the registry**

```bash
curl -s http://localhost:3111/api/v1/system/reload | jq -r '.reloaded[]' | sort > /tmp/before.txt
```
Keep `/tmp/before.txt` — Phase D compares against it. An app that disappears
between here and there is the silent-shrink failure this plan exists to avoid.

**Step 4: Deploy.** This is a real deploy to prod, and it must land before any
data moves.

---

## Phase B — The two live bugs

### Task 11: Decouple school surface profiles from `contentRoot`

**This fixes a bug firing in production right now.** `school.surfaces.profile.unresolved`
(`unknown surfaceId 'screen-browser'`, `screen: portal`) repeats every few minutes
because `schoolSurfaces.mjs:52` reads `<contentRoot>/surfaces` and `contentRoot`
resolves to `content/school/learning-catalog`, which does not exist.

The authored catalog being empty is **expected** — that tree is unfinished work
staged in `_inbox`. Do not change `contentRoot`. Surface profiles describe render
capability (what a paper sheet or a browser screen can do), which is household
policy, not curriculum — that coupling is the bug.

**Files:**
- Modify: `backend/src/5_composition/modules/schoolSurfaces.mjs:45-56`
- Test: `backend/tests/unit/composition/schoolSurfaces.profileRoot.test.mjs`

**Step 1: Write the failing test**

```javascript
// backend/tests/unit/composition/schoolSurfaces.profileRoot.test.mjs
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createSchoolSurfaces } from '#composition/modules/schoolSurfaces.mjs';

let dataDir;
beforeEach(async () => { dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'surf-')); });
afterEach(async () => { await fs.rm(dataDir, { recursive: true, force: true }); });

const schoolCatalog = () => ({
  wired: true, catalogs: {}, content: {}, lessonBundles: {},
  moduleRegistry: { list: () => [] },
  // Deliberately a path that does NOT exist — the production condition.
  diagnostics: { contentRoot: path.join(dataDir, 'content/school/learning-catalog') },
});

it('loads surface profiles from household/school/surfaces, not contentRoot', async () => {
  const dir = path.join(dataDir, 'household', 'school', 'surfaces');
  await fs.mkdir(dir, { recursive: true });
  await fs.copyFile(
    path.resolve('backend/tests/_fixtures/school/screen-browser.yml'),
    path.join(dir, 'screen-browser.yml'),
  );

  const surfaces = await createSchoolSurfaces({ schoolCatalog: schoolCatalog(), dataDir });
  // SurfaceRegistry exposes list()/get()/portFor()/codecBaselines() — there is
  // no has(). Verified at SurfaceRegistry.mjs:45-70.
  expect(surfaces.registry.get('screen-browser')).toBeTruthy();
});
```

Copy the real profile to the fixture path first:

```bash
mkdir -p backend/tests/_fixtures/school
cp "$DAYLIGHT_BASE_PATH/data/household/config/school/surfaces/screen-browser.yml" \
   backend/tests/_fixtures/school/screen-browser.yml
```

> API verified 2026-08-21. Also note `createSchoolSurfaces` currently takes
> `{ schoolCatalog, logger }` only (line 45) — adding `dataDir` IS the change.

**Step 2: Run it and watch it fail**

```
npx vitest run backend/tests/unit/composition/schoolSurfaces.profileRoot.test.mjs
```
Expected: FAIL — the registry resolves nothing.

**Step 3: Implement**

In `schoolSurfaces.mjs`, take `dataDir` as a dependency and replace line 52:

```javascript
  // Surface profiles are household RENDER POLICY (what a paper sheet or a
  // browser screen can do), not curriculum — so they do NOT live under the
  // catalog's contentRoot. They did until 2026-08-21, which is why the Portal
  // logged `school.surfaces.profile.unresolved` for 'screen-browser' every few
  // minutes: contentRoot pointed at a directory that does not exist.
  const surfacesDirectory = path.join(dataDir, 'household', 'school', 'surfaces');
```

Pass `dataDir` at the call site in `backend/src/app.mjs` (near line 3599) via
`configService.getDataDir()`.

**Step 4: Run it and watch it pass**

```
npx vitest run backend/tests/unit/composition/schoolSurfaces.profileRoot.test.mjs
```
Expected: PASS.

**Step 5: Move the data**

```bash
D="$DAYLIGHT_BASE_PATH/data/household"
mkdir -p "$D/school/surfaces"
mv "$D/config/school/surfaces/"*.yml "$D/school/surfaces/"
rmdir "$D/config/school/surfaces" "$D/config/school"
```

**Step 6: Verify the production warn stops**

Restart the running server, load the Portal school surface, then:

```bash
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query=_msg:school.surfaces.profile.unresolved AND _time:10m' -d 'limit=5'
```
Expected: **empty**. If rows still come back, the fix is not done — do not move on.

**Step 7: Commit**

```bash
git add backend/src/5_composition/modules/schoolSurfaces.mjs backend/src/app.mjs \
        backend/tests/unit/composition/schoolSurfaces.profileRoot.test.mjs \
        backend/tests/_fixtures/school/ cli/school/certify.mjs
git commit -m "fix(school): read surface profiles from household/school/surfaces

The Portal logged school.surfaces.profile.unresolved for 'screen-browser'
continuously in production because surface profiles were read from
<contentRoot>/surfaces and contentRoot resolves to a directory that does not
exist. Render capability is household policy, not curriculum."
```

---

### Task 12: `donow.approvalsToken` → `auth/`, and harden the transport

`routers/donow.mjs:42,50` — this token is the ONLY authentication on
`POST /approvals/:id/approve` and `/deny`. Whoever holds the string can approve a
parental-approval request. It is a secret, and it currently sits in a config file
and travels in a query string.

**Files:**
- Modify: `backend/src/5_composition/modules/donow.mjs:207`
- Modify: `backend/src/4_api/v1/routers/donow.mjs:60`
- Test: `backend/tests/unit/api/donow.approvalsAuth.test.mjs`

**Step 1: Write the failing test**

```javascript
// backend/tests/unit/api/donow.approvalsAuth.test.mjs
import express from 'express';
import request from 'supertest';
import { createDoNowRouter } from '#api/v1/routers/donow.mjs';

const approvals = { listPending: async () => [], approve: async () => ({ ok: true }), deny: async () => ({ ok: true }) };
const app = (logger = { warn() {}, debug() {} }) => {
  const a = express();
  a.use('/donow', createDoNowRouter({ service: {}, approvals, expectedToken: 'sekrit', logger }));
  return a;
};

describe('donow approvals auth', () => {
  it('accepts a bearer header', async () => {
    await request(app()).post('/donow/approvals/x/approve')
      .set('Authorization', 'Bearer sekrit').expect(200);
  });

  it('accepts the token in the body', async () => {
    await request(app()).post('/donow/approvals/x/approve')
      .send({ token: 'sekrit' }).expect(200);
  });

  it('still accepts ?token= during the HA migration, but warns', async () => {
    const warns = [];
    await request(app({ warn: (e) => warns.push(e), debug() {} }))
      .post('/donow/approvals/x/approve?token=sekrit').expect(200);
    expect(warns).toContain('donow.approvals.token.query_deprecated');
  });

  it('rejects a wrong token', async () => {
    await request(app()).post('/donow/approvals/x/approve')
      .set('Authorization', 'Bearer nope').expect(401);
  });
});
```

**Step 2: Run it and watch it fail**

```
npx vitest run backend/tests/unit/api/donow.approvalsAuth.test.mjs
```
Expected: FAIL — the bearer header is not read and no deprecation warn exists.

**Step 3: Implement**

`routers/donow.mjs`, replace `readToken` (line 60):

```javascript
/**
 * Prefer header, then body. `?token=` is still accepted so HA's existing
 * callbacks keep working, but it lands in access logs and in notification URLs
 * — it is removed once the HA automation has been updated and the deprecation
 * warn has gone quiet.
 */
function readToken(req, logger) {
  const header = req.get?.('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  if (req.body?.token) return req.body.token;
  if (req.query?.token) {
    logger?.warn?.('donow.approvals.token.query_deprecated', { path: req.path });
    return req.query.token;
  }
  return null;
}
```

Update both call sites (lines 42 and 50) to `readToken(req, logger)`.

**Step 4: Run it and watch it pass**

```
npx vitest run backend/tests/unit/api/donow.approvalsAuth.test.mjs
```
Expected: PASS, 4 tests.

**Step 5: Move the secret**

```bash
D="$DAYLIGHT_BASE_PATH/data/household"
TOKEN=$(grep '^approvalsToken:' "$D/config/donow.yml" | sed "s/.*: *'\{0,1\}//;s/'\{0,1\}$//")
printf 'approvalsToken: %s\n' "$TOKEN" > "$D/auth/donow.yml"
```
Then delete the `approvalsToken:` line from the donow config.

In `5_composition/modules/donow.mjs:207`:

```javascript
const approvalsAuth = configService.getHouseholdAuth('donow', householdId) || {};
const router = createDoNowRouter({
  service, approvals, expectedToken: approvalsAuth.approvalsToken ?? null, logger,
});
```

**Step 6: Deploy, then update the HA automation**

Change the DoNow approve/deny actions to send the token in the JSON body rather
than the query string. Then confirm it went quiet:

```bash
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query=_msg:donow.approvals.token.query_deprecated AND _time:24h' -d 'limit=5'
```
Expected: empty after a full day of approvals traffic.

**Step 7: Remove query support** — delete the `req.query?.token` branch and the
third test case. Separate commit, only after step 6 is clean.

**Step 8: Commit**

```bash
git add backend/src/4_api/v1/routers/donow.mjs \
        backend/src/5_composition/modules/donow.mjs \
        backend/tests/unit/api/donow.approvalsAuth.test.mjs
git commit -m "fix(donow): read approvals secret from auth/, prefer header over query token"
```

---

## Phase C — Rename the jamcorder domain

`jamcorder` is a vendor name and it reaches all the way down into
`2_domains/`. The concept is harvesting MIDI performance recordings from a
networked recorder. Domain and application become `midi`; the adapters keep the
vendor name, which is exactly what the adapter layer is for.

### Task 13: Rename domain and application

**Files:**
- Rename: `backend/src/2_domains/jamcorder/JamCorderStone.mjs` → `backend/src/2_domains/midi/MidiRecordingStone.mjs`
- Rename: `backend/src/3_applications/jamcorder/HarvestJamCorderRecordings.mjs` → `backend/src/3_applications/midi/HarvestMidiRecordings.mjs`
- Rename: ports `IJamCorderArchive` → `IMidiRecordingArchive`, `IJamCorderSource` → `IMidiRecordingSource`
- Modify: `backend/src/1_adapters/jamcorder/{HttpJamCorderSource,FsJamCorderArchive}.mjs` — imports only, class names unchanged
- Modify: `backend/src/5_composition/bootstrap.mjs:341-343,3508-3510`

Do the renames with `git mv` so history follows. Rename the class and every
identifier, then update imports. Keep log event names (`jamcorder.harvest.done`,
`jamcorder.saved`) **unchanged** in this task — they are queryable history in the
log store; renaming them silently breaks any saved query. Rename them in a
separate commit if wanted.

```
npm run test:backend && npm run audit:layers
```
Expected: PASS. `audit:layers` enforces the DDD import direction — a rename that
crosses layers wrongly fails here.

**Commit**

```bash
git commit -m "refactor(midi): rename jamcorder domain+application to midi

Jamcorder is a vendor name; it belongs in 1_adapters/, not in 2_domains/.
Adapters keep the vendor name."
```

### Task 14: Move the jamcorder host into the device registry

`config/jamcorder.yml` is one line — `host: 10.0.0.244`. That is a device
address, and `hardware/devices.yml` is the device registry.

Add to `hardware/devices.yml` under `devices:`:

```yaml
  midi-recorder:
    kind: midi-recorder
    vendor: jamcorder
    host: 10.0.0.244
```

At `bootstrap.mjs:3509`, replace
`configService.getHouseholdAppConfig?.(null, 'jamcorder')` with a device-registry
lookup for `midi-recorder`, keeping the `|| '10.0.0.244'` default. Register the
harvester as `'midi'`.

Do **not** add `jamcorder` to `HOUSEHOLD_APP_CONFIGS` — it stops being an app
config.

**Commit**

```bash
git commit -m "refactor(midi): read recorder host from the device registry"
```

---

## Phase D — Move the data

Only after Phase A is deployed. Every reader prefers the grouped path and falls
back to `config/`, so both trees work while Dropbox syncs.

### Task 15: Write and dry-run the move script

**Files:**
- Create: `scripts/migrate-household-config.mjs`

The script reads `HOUSEHOLD_APP_CONFIGS`, and for each entry moves
`household/config/<app>.yml` → `household/<relPath>.yml`, creating parent dirs.
It must:

- take `--dry-run` (default) and `--apply`
- **refuse to overwrite** an existing destination
- print every planned move before doing anything
- handle the four non-registry moves explicitly:
  - `config/triggers/**` → `triggers/**` (merge; existing `nfc.observed.yml` → `triggers/state/`)
  - `config/keyboard.yml` → `triggers/bindings/keyboard.yml`
  - `config/chatbots.yml` → `_deleteme/`
  - `config/jamcorder.yml` → `_deleteme/` (folded into devices.yml in Task 14)
- **the media swap — read this twice.** This is a semantic inversion, not a
  move. TODAY `apps.media` returns the SURFACE (`browse:`, `searchScopes:`) and
  `config/media-app.yml` holds the DOMAIN (`plex.host`, `infinity:` board ids).
  AFTER, `apps.media` means domain and `apps['media-app']` means surface — the
  opposite binding for the key `media`.

  Both files are valid YAML objects, so getting this wrong throws NOTHING: a
  consumer just reads the wrong file and silently returns `undefined` for every
  key it wants. The move and the consumer flip MUST land together:
  1. `media/config.yml` → `media/app.yml`  (surface to its new name)
  2. `config/media-app.yml` → `media/config.yml`  (domain to its new name)
  3. `routers/media.mjs:80` — `getHouseholdAppConfig(hid, 'media')` →
     `getHouseholdAppConfig(hid, 'media-app')`, because that endpoint serves
     `browse`/`searchScopes` to the MediaApp frontend.

  Verify immediately after: `GET /api/v1/media/config` must return a NON-EMPTY
  `browse` array. An empty array is the silent failure.
- handle the finance folder rename: `finances/` → `finance/` (and the three
  `YamlFinanceDatastore.mjs:50,113,123` references change with it)

```bash
node scripts/migrate-household-config.mjs --dry-run
```
Read every line of output before applying. This is the irreversible step.

### Task 16: Apply, restart, verify

```bash
node scripts/migrate-household-config.mjs --apply
```

Restart the running server, then:

```bash
curl -s -X POST http://localhost:3111/api/v1/system/reload | jq -r '.reloaded[]' | sort > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt
```
Expected: **no diff**, except `jamcorder` and `chatbots` leaving. Any other app
disappearing is the silent-shrink failure — stop and fix before continuing.

Then walk the surfaces that fail silently:

- Admin YAML browser: list, open, and save one file per domain folder.
- Admin per-app editor: finance, media, entropy, piano.
- `GET /api/v1/media/config` returns non-empty `browse` and `searchScopes`.
- NFC trigger write round-trip — scan a tag, confirm it lands in
  `triggers/bindings/nfc/`, not a recreated `config/`.
- `node cli/school/omr.mjs`, `node cli/plex-sync.cli.mjs`, `node cli/school/certify.mjs`.

---

## Phase E — Delete the fallbacks and the directory

Only after Phase D has run in production for long enough that every host has
synced. Do not collapse this into Phase D — that reintroduces exactly the
half-state that made task-13 hard to reason about.

### Task 17: Assert the registry is complete, THEN remove the legacy branches

The legacy fallback resolves `config/<anything>`, including apps the registry
forgot — so an omission stays invisible until the fallback goes away, and then
presents as an app config that vanished. (Task 1's verification caught exactly
one such omission before it shipped.)

Write this check FIRST and make it pass before deleting anything:

```javascript
// backend/tests/unit/system/config/registryCompleteness.test.mjs
import fs from 'fs';
import path from 'path';
import { HOUSEHOLD_APP_CONFIGS } from '#shared/contracts/householdConfig.mjs';

it('every registered app config exists on disk at its registered path', () => {
  const dataDir = process.env.DAYLIGHT_DATA_PATH
    || path.join(process.env.DAYLIGHT_BASE_PATH, 'data');
  const missing = Object.entries(HOUSEHOLD_APP_CONFIGS).filter(
    ([, rel]) => !['', '.yml', '.yaml'].some((ext) =>
      ext && fs.existsSync(path.join(dataDir, 'household', `${rel}${ext}`))),
  );
  expect(missing).toEqual([]);
});

// The retained config/ scan catches a forgotten FLAT file, but nothing catches
// a forgotten COLOCATED one: since Task 3, `household/foo/config.yml` with no
// registry entry silently does not load. Verified clean on 2026-08-21 (all 9
// colocated dirs are registered) — this keeps it that way.
it('no colocated <subdir>/config.yml exists outside the registry', () => {
  const dataDir = process.env.DAYLIGHT_DATA_PATH
    || path.join(process.env.DAYLIGHT_BASE_PATH, 'data');
  const root = path.join(dataDir, 'household');
  const registered = new Set(Object.values(HOUSEHOLD_APP_CONFIGS));
  const orphans = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => fs.existsSync(path.join(root, e.name, 'config.yml')))
    .map((e) => `${e.name}/config`)
    .filter((rel) => !registered.has(rel));
  expect(orphans).toEqual([]);
});

it('household/config/ holds no app config the registry does not know', () => {
  const dataDir = process.env.DAYLIGHT_DATA_PATH
    || path.join(process.env.DAYLIGHT_BASE_PATH, 'data');
  const dir = path.join(dataDir, 'household', 'config');
  const leftover = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.yml'))
    : [];
  expect(leftover).toEqual([]);
});
```

Then remove the legacy branches:

- `householdConfigRegistry.mjs` — delete `legacyAppConfigRelPath`.
- `ConfigService.mjs` — delete the legacy branch in `#resolveHouseholdAppConfigPath`.
- `configLoader.mjs` — delete the `config/` scan from `loadHouseholdApps`, and the
  legacy fallbacks in `loadHouseholdIntegrations` and `loadHouseholdDevices`.
  Note the scan derives its app name with `path.basename(file, '.yml')`, so a
  `config/foo.yaml` would have registered as an app literally named `foo.yaml`.
  Pre-existing quirk, no such file exists — it disappears with the scan.
- `artmodeConfig.mjs` — drop the second candidate.
- `device.mjs`, `homeAutomation.mjs` — drop the `|| loadFile('config/keyboard')`.
- `YamlTriggerConfigRepository.mjs` — drop `LEGACY_TRIGGER_ROOT`.
- `YamlConfigFileService.mjs` — remove `'household/config'` from `ALLOWED_DIRS`.
- All CLI sites — drop the fallback branch.

Update the tests that assert fallback behavior: they should now assert the legacy
path is **ignored**, not that it works.

```
npm run test:backend && npm run test:refactor && npm run audit:layers
```

### Task 18: Delete the directory

```bash
D="$DAYLIGHT_BASE_PATH/data/household"
ls -la "$D/config"          # expect: empty, or only files you deliberately left
mv "$D/config" "$DAYLIGHT_BASE_PATH/data/_deleteme/config-retired-$(date +%Y%m%d)"
```

Move, do not delete — `_deleteme/` is the project's convention and the user
empties it by hand.

### Task 19: Documentation

- `docs/reference/core/configuration.md` — replace the config/ description with
  the registry, and state that `householdConfigRegistry.mjs` is the only place an
  app's config path is declared.
- `docs/reference/core/layers-of-abstraction/system.md` — note the registry.
- Update the memory file `reference_household_app_config_path.md`: colocated-first
  is superseded by registry-only, and `config/` no longer exists.
- `git rev-parse HEAD > docs/docs-last-updated.txt`

**Commit**

```bash
git add -A
git commit -m "chore(config): retire data/household/config/"
```

---

## What "done" looks like

- `data/household/config/` does not exist.
- Adding a new app config requires exactly one edit: a line in
  `householdConfigRegistry.mjs`.
- `AppsConfigService.APP_CONFIGS` and `YamlConfigFileService.ALLOWED_FILES` are
  derived, not typed by hand.
- `school.surfaces.profile.unresolved` no longer appears in the log store.
- `donow.approvalsToken` lives in `auth/donow.yml` and never travels in a URL.
- `2_domains/` contains no vendor names.
