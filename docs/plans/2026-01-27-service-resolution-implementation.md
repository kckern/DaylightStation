# Service Resolution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement service resolution that maps logical service names to physical hosts per environment, with per-household integration config.

**Architecture:** ConfigLoader loads `services.yml` (host mappings) and `integrations.yml` (per-household service config). ConfigService exposes `resolveServiceUrl()` and `getHouseholdIntegration()`. Adapters use resolved URLs instead of hardcoded hosts. The legacy `services_host` hack is removed.

**Tech Stack:** Node.js, js-yaml, Jest for testing

---

## Task 1: Create services.yml Data File

**Files:**
- Create: `data/system/services.yml`

**Step 1: Create the services.yml file**

```yaml
# Service name → host resolution per environment
# Shared services use base names, household-specific use suffixes

# Shared services (all households)
mqtt:
  docker: mosquitto
  kckern-server: localhost
  kckern-macbook: 10.0.0.10

thermal_printer:
  docker: 10.0.0.50
  kckern-server: 10.0.0.50
  kckern-macbook: 10.0.0.50

# Default household services (base names)
plex:
  docker: plex
  kckern-server: localhost
  kckern-macbook: 10.0.0.10

homeassistant:
  docker: homeassistant
  kckern-server: localhost
  kckern-macbook: 10.0.0.10

immich:
  docker: immich
  kckern-server: localhost
  kckern-macbook: 10.0.0.10

freshrss:
  docker: freshrss
  kckern-server: localhost
  kckern-macbook: 10.0.0.10

audiobookshelf:
  docker: audiobookshelf
  kckern-server: localhost
  kckern-macbook: 10.0.0.10
```

**Step 2: Verify file is valid YAML**

Run: `node -e "console.log(require('js-yaml').load(require('fs').readFileSync('{dataDir}/system/services.yml', 'utf8')))"`

Expected: Object printed without error

**Step 3: Commit**

```bash
git add data/system/services.yml
git commit -m "feat(config): add services.yml for service host resolution"
```

---

## Task 2: Create integrations.yml for Default Household

**Files:**
- Create: `data/household/integrations.yml`

**Step 1: Create the integrations.yml file**

```yaml
# Per-household service configuration
# References logical service names resolved via system/services.yml

plex:
  service: plex
  port: 32400
  protocol: dash
  platform: Chrome

homeassistant:
  service: homeassistant
  port: 8123

immich:
  service: immich
  port: 2283

freshrss:
  service: freshrss
  port: 8080

audiobookshelf:
  service: audiobookshelf
  port: 13378
```

**Step 2: Verify file is valid YAML**

Run: `node -e "console.log(require('js-yaml').load(require('fs').readFileSync('{dataDir}/household/integrations.yml', 'utf8')))"`

Expected: Object printed without error

**Step 3: Commit**

```bash
git add data/household/integrations.yml
git commit -m "feat(config): add integrations.yml for default household"
```

---

## Task 3: Create Test Fixtures

**Files:**
- Create: `tests/unit/suite/config/fixtures/system/services.yml`
- Create: `tests/unit/suite/config/fixtures/household-test-household/integrations.yml`

**Step 1: Create test fixtures services.yml**

```yaml
# Test fixture for service resolution
plex:
  docker: plex
  test-env: localhost

homeassistant:
  docker: homeassistant
  test-env: localhost

mqtt:
  docker: mosquitto
  test-env: localhost
```

**Step 2: Create test fixtures integrations.yml**

```yaml
# Test fixture for household integrations
plex:
  service: plex
  port: 32400
  protocol: dash

homeassistant:
  service: homeassistant
  port: 8123
```

**Step 3: Commit**

```bash
git add tests/unit/suite/config/fixtures/
git commit -m "test(config): add fixtures for service resolution"
```

---

## Task 4: Add loadServices() to configLoader.mjs

**Files:**
- Modify: `backend/src/0_system/config/configLoader.mjs:19-35` (loadConfig function)
- Modify: `backend/src/0_system/config/configLoader.mjs:151-156` (add new function after loadAdapters)

**Step 1: Write the failing test**

Add to `tests/unit/suite/config/ConfigService.test.mjs`:

```javascript
describe('services', () => {
  test('loads services from services.yml', () => {
    const svc = createConfigService(fixturesDir);
    const services = svc.getAllServices();
    expect(services.plex).toBeDefined();
    expect(services.plex.docker).toBe('plex');
    expect(services.plex['test-env']).toBe('localhost');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/config/ConfigService.test.mjs -t "loads services" -v`

Expected: FAIL with "getAllServices is not a function"

**Step 3: Add loadServices function to configLoader.mjs**

After line 156 (after loadAdapters function), add:

```javascript
// ─── Services ─────────────────────────────────────────────────

function loadServices(dataDir) {
  const servicesPath = path.join(dataDir, 'system', 'services.yml');
  return readYaml(servicesPath) ?? {};
}
```

**Step 4: Update loadConfig to include services**

Modify loadConfig function (lines 19-35) to include services:

```javascript
export function loadConfig(dataDir) {
  const config = {
    system: loadSystemConfig(dataDir),
    secrets: loadSecrets(dataDir),
    services: loadServices(dataDir),  // ADD THIS LINE
    households: loadAllHouseholds(dataDir),
    users: loadAllUsers(dataDir),
    auth: loadAllAuth(dataDir),
    apps: loadAllApps(dataDir),
    adapters: loadAdapters(dataDir),
    identityMappings: {},
  };

  // Build identity mappings from user profiles
  config.identityMappings = buildIdentityMappings(config.users);

  return config;
}
```

**Step 5: Add getAllServices to ConfigService.mjs**

Add after line 199 (after getAllAdapterConfigs):

```javascript
  /**
   * Get all service host mappings
   * @returns {object}
   */
  getAllServices() {
    return this.#config.services ?? {};
  }
```

**Step 6: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/config/ConfigService.test.mjs -t "loads services" -v`

Expected: PASS

**Step 7: Commit**

```bash
git add backend/src/0_system/config/configLoader.mjs backend/src/0_system/config/ConfigService.mjs tests/unit/suite/config/ConfigService.test.mjs
git commit -m "feat(config): add loadServices and getAllServices"
```

---

## Task 5: Add loadHouseholdIntegrations() to configLoader.mjs

**Files:**
- Modify: `backend/src/0_system/config/configLoader.mjs:167-204` (loadAllHouseholds function)

**Step 1: Write the failing test**

Add to `tests/unit/suite/config/ConfigService.test.mjs` in the households describe block:

```javascript
  test('loads household integrations', () => {
    const svc = createConfigService(fixturesDir);
    const integrations = svc.getHouseholdIntegrations('test-household');
    expect(integrations).toBeDefined();
    expect(integrations.plex.service).toBe('plex');
    expect(integrations.plex.port).toBe(32400);
  });
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/config/ConfigService.test.mjs -t "loads household integrations" -v`

Expected: FAIL with "getHouseholdIntegrations is not a function"

**Step 3: Add loadHouseholdIntegrations helper function**

After loadHouseholdAppsFlat function (around line 250), add:

```javascript
/**
 * Load integrations for flat household structure.
 */
function loadHouseholdIntegrationsFlat(dataDir, folderName) {
  const integrationsPath = path.join(dataDir, folderName, 'integrations.yml');
  return readYaml(integrationsPath) ?? {};
}

/**
 * Load integrations for legacy nested household structure.
 */
function loadHouseholdIntegrationsLegacy(householdsDir, hid) {
  const integrationsPath = path.join(householdsDir, hid, 'integrations.yml');
  return readYaml(integrationsPath) ?? {};
}
```

**Step 4: Update loadAllHouseholds to include integrations**

In loadAllHouseholds (around line 179), update the flat structure branch:

```javascript
      if (config) {
        households[householdId] = {
          ...config,
          _folderName: dir,
          integrations: loadHouseholdIntegrationsFlat(dataDir, dir),  // ADD THIS LINE
          apps: loadHouseholdAppsFlat(dataDir, dir),
        };
      }
```

And the legacy structure branch (around line 197):

```javascript
        households[hid] = {
          ...config,
          _folderName: hid,
          _legacyPath: true,
          integrations: loadHouseholdIntegrationsLegacy(householdsDir, hid),  // ADD THIS LINE
          apps: loadHouseholdAppsLegacy(householdsDir, hid),
        };
```

**Step 5: Add getHouseholdIntegrations to ConfigService.mjs**

Add after getHouseholdAppConfig method (around line 91):

```javascript
  /**
   * Get all integrations for a household
   * @param {string|null} householdId - Household ID, defaults to default household
   * @returns {object}
   */
  getHouseholdIntegrations(householdId = null) {
    const hid = householdId ?? this.getDefaultHouseholdId();
    return this.#config.households?.[hid]?.integrations ?? {};
  }

  /**
   * Get specific integration config for a household
   * @param {string|null} householdId - Household ID, defaults to default household
   * @param {string} serviceName - Service name (plex, homeassistant, etc.)
   * @returns {object|null}
   */
  getHouseholdIntegration(householdId, serviceName) {
    const hid = householdId ?? this.getDefaultHouseholdId();
    return this.#config.households?.[hid]?.integrations?.[serviceName] ?? null;
  }
```

**Step 6: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/config/ConfigService.test.mjs -t "loads household integrations" -v`

Expected: PASS

**Step 7: Commit**

```bash
git add backend/src/0_system/config/configLoader.mjs backend/src/0_system/config/ConfigService.mjs tests/unit/suite/config/ConfigService.test.mjs
git commit -m "feat(config): add loadHouseholdIntegrations and getHouseholdIntegration"
```

---

## Task 6: Add resolveServiceHost() to ConfigService.mjs

**Files:**
- Modify: `backend/src/0_system/config/ConfigService.mjs`

**Step 1: Write the failing test**

Add to `tests/unit/suite/config/ConfigService.test.mjs`:

```javascript
describe('service resolution', () => {
  test('resolves service host for current environment', () => {
    // Set env for test
    const originalEnv = process.env.DAYLIGHT_ENV;
    process.env.DAYLIGHT_ENV = 'test-env';

    try {
      const svc = createConfigService(fixturesDir);
      const host = svc.resolveServiceHost('plex');
      expect(host).toBe('localhost');
    } finally {
      process.env.DAYLIGHT_ENV = originalEnv;
    }
  });

  test('returns null for unknown service', () => {
    const svc = createConfigService(fixturesDir);
    const host = svc.resolveServiceHost('unknown-service');
    expect(host).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/config/ConfigService.test.mjs -t "resolves service host" -v`

Expected: FAIL with "resolveServiceHost is not a function"

**Step 3: Add resolveServiceHost method**

Add to ConfigService.mjs after getAllServices (around line 205):

```javascript
  /**
   * Resolve service name to host for current environment
   * @param {string} serviceName - Logical service name (plex, homeassistant, mqtt, etc.)
   * @returns {string|null} Host for current environment or null if not found
   */
  resolveServiceHost(serviceName) {
    const serviceMapping = this.#config.services?.[serviceName];
    if (!serviceMapping) return null;

    const env = this.getEnv();
    return serviceMapping[env] ?? null;
  }
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/config/ConfigService.test.mjs -t "resolves service host" -v`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/0_system/config/ConfigService.mjs tests/unit/suite/config/ConfigService.test.mjs
git commit -m "feat(config): add resolveServiceHost method"
```

---

## Task 7: Add resolveServiceUrl() to ConfigService.mjs

**Files:**
- Modify: `backend/src/0_system/config/ConfigService.mjs`

**Step 1: Write the failing test**

Add to the service resolution describe block in `tests/unit/suite/config/ConfigService.test.mjs`:

```javascript
  test('resolves full service URL for household', () => {
    const originalEnv = process.env.DAYLIGHT_ENV;
    process.env.DAYLIGHT_ENV = 'test-env';

    try {
      const svc = createConfigService(fixturesDir);
      const url = svc.resolveServiceUrl('test-household', 'plex');
      expect(url).toBe('http://localhost:32400');
    } finally {
      process.env.DAYLIGHT_ENV = originalEnv;
    }
  });

  test('returns null if service not in household integrations', () => {
    const svc = createConfigService(fixturesDir);
    const url = svc.resolveServiceUrl('test-household', 'unknown-service');
    expect(url).toBeNull();
  });

  test('returns null if service host not found', () => {
    const originalEnv = process.env.DAYLIGHT_ENV;
    process.env.DAYLIGHT_ENV = 'nonexistent-env';

    try {
      const svc = createConfigService(fixturesDir);
      const url = svc.resolveServiceUrl('test-household', 'plex');
      expect(url).toBeNull();
    } finally {
      process.env.DAYLIGHT_ENV = originalEnv;
    }
  });
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/config/ConfigService.test.mjs -t "resolves full service URL" -v`

Expected: FAIL with "resolveServiceUrl is not a function"

**Step 3: Add resolveServiceUrl method**

Add to ConfigService.mjs after resolveServiceHost:

```javascript
  /**
   * Resolve full service URL for a household
   * Combines household integration config (service name, port) with services.yml host resolution
   * @param {string|null} householdId - Household ID, defaults to default household
   * @param {string} serviceName - Service type (plex, homeassistant, etc.)
   * @returns {string|null} Full URL like "http://localhost:32400" or null if not resolvable
   */
  resolveServiceUrl(householdId, serviceName) {
    const hid = householdId ?? this.getDefaultHouseholdId();

    // Get integration config from household
    const integration = this.getHouseholdIntegration(hid, serviceName);
    if (!integration) return null;

    // Resolve the service name to a host
    const logicalServiceName = integration.service ?? serviceName;
    const host = this.resolveServiceHost(logicalServiceName);
    if (!host) return null;

    // Build URL
    const port = integration.port;
    const protocol = integration.protocol === 'https' ? 'https' : 'http';

    return port ? `${protocol}://${host}:${port}` : `${protocol}://${host}`;
  }
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/config/ConfigService.test.mjs -t "resolves full service URL" -v`

Expected: PASS

**Step 5: Run all service resolution tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/config/ConfigService.test.mjs -t "service resolution" -v`

Expected: All PASS

**Step 6: Commit**

```bash
git add backend/src/0_system/config/ConfigService.mjs tests/unit/suite/config/ConfigService.test.mjs
git commit -m "feat(config): add resolveServiceUrl method"
```

---

## Task 8: Update adapters.yml to Use Service Names

**Files:**
- Modify: `data/system/adapters.yml`

**Step 1: Update adapters.yml to reference service names instead of hardcoded hosts**

Replace the proxy adapters section (lines 8-30):

```yaml
# -----------------------------------------------------------------------------
# Proxy Adapters
# -----------------------------------------------------------------------------
# Services that DaylightStation proxies requests to
# Hosts resolved via services.yml, tokens via household auth

plex:
  service: plex
  protocol: dash
  platform: Chrome
  # host resolved via services.yml + household integrations
  # token: via household auth

immich:
  service: immich
  # host resolved via services.yml + household integrations
  # apiKey: use configService.getSecret('IMMICH_API_KEY')

freshrss:
  service: freshrss
  # host resolved via services.yml + household integrations
  # username/password/apiKey: use household auth

audiobookshelf:
  service: audiobookshelf
  # host resolved via services.yml + household integrations
  # token: use household auth
```

Replace the hardware adapters section (lines 32-48):

```yaml
# -----------------------------------------------------------------------------
# Hardware Adapters
# -----------------------------------------------------------------------------
# Physical devices and local services

mqtt:
  service: mqtt
  port: 1883

thermal_printer:
  service: thermal_printer
  port: 9100

tts:
  model: tts-1
  default_voice: alloy
  # apiKey: use configService.getSecret('OPENAI_API_KEY')
```

**Step 2: Verify file is valid YAML**

Run: `node -e "console.log(require('js-yaml').load(require('fs').readFileSync('/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/system/adapters.yml', 'utf8')))"`

Expected: Object printed without error

**Step 3: Commit**

```bash
git add data/system/adapters.yml
git commit -m "refactor(config): update adapters.yml to use service names"
```

---

## Task 9: Remove services_host Hack from configLoader.mjs

**Files:**
- Modify: `backend/src/0_system/config/configLoader.mjs:51-106`

**Step 1: Run existing tests to establish baseline**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/config/ -v`

Expected: All tests pass

**Step 2: Remove services_host processing block**

Delete lines 51-106 (the entire `if (localOverrides.services_host)` block):

```javascript
  // DELETE THIS ENTIRE BLOCK (lines 51-106):
  // Process services_host: Apply to services that don't have explicit host in local config
  // ... (all the way to the closing brace before "// Merge base config")
```

**Step 3: Run tests to verify nothing breaks**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/config/ -v`

Expected: All tests still pass (services_host was not tested directly)

**Step 4: Commit**

```bash
git add backend/src/0_system/config/configLoader.mjs
git commit -m "refactor(config): remove services_host hack from configLoader"
```

---

## Task 10: Remove services_host from ConfigService.getServiceConfig()

**Files:**
- Modify: `backend/src/0_system/config/ConfigService.mjs:212-237`

**Step 1: Simplify getServiceConfig to remove services_host logic**

Replace the getServiceConfig method (lines 212-237) with:

```javascript
  /**
   * Get service configuration from system config
   * @param {string} serviceName - Service identifier (home_assistant, plex, mqtt, etc.)
   * @returns {object|null} Service config
   * @deprecated Use resolveServiceUrl() for host resolution
   */
  getServiceConfig(serviceName) {
    return this.#config.system?.[serviceName] ?? null;
  }
```

**Step 2: Run all config tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/config/ -v`

Expected: All tests pass

**Step 3: Commit**

```bash
git add backend/src/0_system/config/ConfigService.mjs
git commit -m "refactor(config): simplify getServiceConfig, remove services_host"
```

---

## Task 11: Update system-local Files to Remove services_host

**Files:**
- Modify: `data/system/system-local.kckern-server.yml`
- Modify: `data/system/system-local.kckern-macbook.yml`

**Step 1: Update kckern-server local config**

Remove `services_host` line, keep only port config:

```yaml
# Linux server - dev ports to avoid Docker conflict
app:
  port: 3112

webhook:
  port: 3120
```

**Step 2: Update kckern-macbook local config (if it has services_host)**

Check and remove `services_host` if present.

**Step 3: Commit**

```bash
git add data/system/system-local.*.yml
git commit -m "refactor(config): remove services_host from local config files"
```

---

## Task 12: Run Full Test Suite

**Files:**
- None (verification only)

**Step 1: Run all unit tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/ -v`

Expected: All tests pass

**Step 2: Run config-specific tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/config/ -v`

Expected: All tests pass, including new service resolution tests

**Step 3: Verify dev server starts**

Run: `cd /root/Code/DaylightStation && timeout 10 node backend/index.js || true`

Expected: Server starts without config errors (may timeout, that's OK)

---

## Summary

After completing all tasks:

1. **services.yml** maps logical service names to hosts per environment
2. **integrations.yml** per household defines service names and ports
3. **resolveServiceUrl()** combines both to produce full URLs
4. **Legacy services_host hack removed** from configLoader and ConfigService
5. **All tests pass** including new service resolution tests

Next steps (not in this plan):
- Update app.mjs adapter creation to use resolveServiceUrl()
- Migrate from legacy `households/{id}/` to flat `household[-{id}]/` structure
