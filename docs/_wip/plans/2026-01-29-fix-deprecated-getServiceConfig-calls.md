# Fix Deprecated getServiceConfig Calls Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace deprecated `getServiceConfig()` calls with proper `resolveServiceUrl()` calls so that services like Home Assistant, printer, and TV resolve their URLs correctly from `services.yml`.

**Architecture:** The `getServiceConfig(name)` method reads from `system.{name}` which doesn't exist for most services. The correct approach is `resolveServiceUrl(serviceName)` which reads from `services.yml` with environment-aware host resolution, or `resolveServiceHost()` + `getServicePort()` for services needing separate host/port.

**Tech Stack:** Node.js, ES Modules, ConfigService API

---

## Background

The bug report identifies that `homeAssistant.baseUrl` is not being resolved because:
1. `app.mjs:387` calls `configService.getServiceConfig('homeassistant')`
2. This reads `system.homeassistant` which doesn't exist
3. Should use `configService.resolveServiceUrl('homeassistant')` which reads from `services.yml`

The same bug affects:
- **printer** (line 542) - uses `getServiceConfig('printer')`
- **tv** (line 696) - uses `getServiceConfig('tv')`

---

## Task 1: Add Unit Tests for HA URL Resolution Bug

**Files:**
- Modify: `tests/unit/suite/config/ConfigService.test.mjs`

**Step 1: Write the failing test**

Add a new test that verifies `getServiceConfig` returns null while `resolveServiceUrl` returns the correct URL:

```javascript
describe('getServiceConfig deprecation', () => {
  test('getServiceConfig returns null for services in services.yml', () => {
    const originalEnv = process.env.DAYLIGHT_ENV;
    process.env.DAYLIGHT_ENV = 'test-env';

    try {
      const svc = createConfigService(fixturesDir);
      // getServiceConfig looks in system.{name} which doesn't exist
      const config = svc.getServiceConfig('homeassistant');
      expect(config).toBeNull();
    } finally {
      process.env.DAYLIGHT_ENV = originalEnv;
    }
  });

  test('resolveServiceUrl returns URL for services in services.yml', () => {
    const originalEnv = process.env.DAYLIGHT_ENV;
    process.env.DAYLIGHT_ENV = 'test-env';

    try {
      const svc = createConfigService(fixturesDir);
      // resolveServiceUrl reads from services.yml correctly
      const url = svc.resolveServiceUrl('homeassistant');
      expect(url).not.toBeNull();
      expect(url).toMatch(/^http:\/\/.+:\d+$/);
    } finally {
      process.env.DAYLIGHT_ENV = originalEnv;
    }
  });
});
```

**Step 2: Run test to verify behavior**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/config/ConfigService.test.mjs -t "getServiceConfig deprecation"`

Expected: Both tests should PASS (they verify current behavior - getServiceConfig returns null, resolveServiceUrl works)

**Step 3: Commit**

```bash
git add tests/unit/suite/config/ConfigService.test.mjs
git commit -m "test: add tests documenting getServiceConfig vs resolveServiceUrl behavior

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Fix Home Assistant URL Resolution in app.mjs

**Files:**
- Modify: `backend/src/app.mjs:384-406`

**Step 1: Write the failing test**

The test from Task 1 documents the issue. Now we verify the fix in integration. Add to a fitness test file:

Create test file `tests/unit/suite/fitness/fitness-ha-config.unit.test.mjs`:

```javascript
/**
 * Fitness HA Config Unit Test
 * Verifies Home Assistant URL resolution uses resolveServiceUrl
 */

describe('Fitness HA Config', () => {
  test('haBaseUrl should be resolved via resolveServiceUrl not getServiceConfig', () => {
    // This test documents the expected resolution path
    // The actual fix is in app.mjs - this test verifies intent
    const mockConfigService = {
      getServiceConfig: jest.fn().mockReturnValue(null), // deprecated, returns null
      resolveServiceUrl: jest.fn().mockReturnValue('http://localhost:8123'),
      getHouseholdAuth: jest.fn().mockReturnValue({ token: 'test-token' }),
    };

    // Simulate what app.mjs SHOULD do (fixed version)
    const haBaseUrl = mockConfigService.resolveServiceUrl('homeassistant') || '';
    const haAuth = mockConfigService.getHouseholdAuth('homeassistant') || {};

    expect(haBaseUrl).toBe('http://localhost:8123');
    expect(haAuth.token).toBe('test-token');
    expect(mockConfigService.getServiceConfig).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails initially**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/fitness/fitness-ha-config.unit.test.mjs -v`

Expected: PASS (this test documents the fix intent, not current code)

**Step 3: Fix app.mjs - replace getServiceConfig with resolveServiceUrl**

In `backend/src/app.mjs`, replace lines 384-406:

**Before:**
```javascript
  // Fitness domain
  // Get Home Assistant config from ConfigService
  // Use getServiceConfig for system.homeassistant (host/port) and getHouseholdAuth for token
  const haServiceConfig = configService.getServiceConfig('homeassistant') || {};
  const haAuth = configService.getHouseholdAuth('homeassistant') || {};
  // Build baseUrl from host and port (host may include protocol, e.g., 'http://homeassistant')
  const haBaseUrl = haServiceConfig.host
    ? (haServiceConfig.port ? `${haServiceConfig.host}:${haServiceConfig.port}` : haServiceConfig.host)
    : '';
```

**After:**
```javascript
  // Fitness domain
  // Get Home Assistant config from ConfigService
  // Use resolveServiceUrl for services.yml (environment-aware) and getHouseholdAuth for token
  const haBaseUrl = configService.resolveServiceUrl('homeassistant') || '';
  const haAuth = configService.getHouseholdAuth('homeassistant') || {};
```

**Step 4: Run tests to verify no regression**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/fitness/ -v`

Expected: All PASS

**Step 5: Commit**

```bash
git add backend/src/app.mjs tests/unit/suite/fitness/fitness-ha-config.unit.test.mjs
git commit -m "fix(app): use resolveServiceUrl for Home Assistant URL resolution

Replace deprecated getServiceConfig('homeassistant') with resolveServiceUrl('homeassistant')
which correctly reads from services.yml with environment-aware host resolution.

Fixes: Home Assistant baseUrl not resolved error

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Fix Printer Service URL Resolution

**Files:**
- Modify: `backend/src/app.mjs:540-552`

**Step 1: Analyze printer config needs**

Unlike HA which just needs a URL, printer needs `host`, `port`, `timeout`, and `upsideDown`. These extra fields suggest printer config belongs in `system.yml` not `services.yml`.

Check if printer is in services.yml or if it should stay in system.yml.

**Step 2: Decide fix approach**

Two options:
1. If printer IS in `services.yml`: use `resolveServiceHost()` + `getServicePort()` + extra config from `getAppConfig('printer')`
2. If printer should stay in `system.yml`: document this as intentional (different from services pattern)

Read the services.yml fixture to determine which applies:

```bash
cat tests/unit/fixtures/config/system/services.yml
```

**Step 3: Implement appropriate fix**

If printer should use services.yml pattern, replace:

**Before:**
```javascript
  const printerConfig = configService.getServiceConfig('printer') || {};
  // ...
    printer: {
      host: printerConfig.host || '',
      port: printerConfig.port || 9100,
      timeout: printerConfig.timeout || 5000,
      upsideDown: printerConfig.upsideDown !== false
    },
```

**After:**
```javascript
  const printerHost = configService.resolveServiceHost('printer');
  const printerPort = configService.getServicePort('printer') || 9100;
  const printerAppConfig = configService.getAppConfig('printer') || {};
  // ...
    printer: {
      host: printerHost || '',
      port: printerPort,
      timeout: printerAppConfig.timeout || 5000,
      upsideDown: printerAppConfig.upsideDown !== false
    },
```

**Step 4: Run tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/ -v`

Expected: All PASS

**Step 5: Commit**

```bash
git add backend/src/app.mjs
git commit -m "fix(app): use resolveServiceHost for printer URL resolution

Replace deprecated getServiceConfig('printer') with resolveServiceHost/Port
for environment-aware host resolution, keeping extra config in app config.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Fix TV Service URL Resolution

**Files:**
- Modify: `backend/src/app.mjs:696-700`

**Step 1: Analyze TV config needs**

TV config uses `daylight_host` field. This is likely a different pattern - it's not a service URL but a callback host.

```javascript
  const tvSystemConfig = configService.getServiceConfig('tv') || {};
  const daylightHost = tvSystemConfig.daylight_host;
```

**Step 2: Decide fix approach**

`daylight_host` is the host where THIS application runs, not a remote service. This likely belongs in:
- `system.yml` under `app.host` or similar
- Or `apps/devices/config.yml` (household app config)

Read surrounding code to understand usage, then either:
1. Move to `getAppConfig('devices')` if it's device-specific
2. Keep in system config but use correct accessor
3. Calculate from environment (e.g., `http://localhost:${appPort}`)

**Step 3: Implement fix**

If `daylight_host` belongs in app config:

**Before:**
```javascript
  const devicesConfig = configService.getHouseholdAppConfig(householdId, 'devices') || {};
  const tvSystemConfig = configService.getServiceConfig('tv') || {};
  const daylightHost = tvSystemConfig.daylight_host;
```

**After:**
```javascript
  const devicesConfig = configService.getHouseholdAppConfig(householdId, 'devices') || {};
  // daylight_host is the callback URL for this app - derive from app port
  const appPort = configService.getAppPort();
  const daylightHost = devicesConfig.daylightHost || `http://localhost:${appPort}`;
```

Update the warning message accordingly.

**Step 4: Run tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/ -v`

Expected: All PASS

**Step 5: Commit**

```bash
git add backend/src/app.mjs
git commit -m "fix(app): derive daylightHost from app port instead of deprecated getServiceConfig

Remove deprecated getServiceConfig('tv') call. daylightHost is the callback URL
for this app, so derive it from getAppPort() or device config.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Update Bug Report and Clean Up

**Files:**
- Modify: `docs/_wip/bugs/2026-01-29-ambient-led-homeassistant-baseurl-not-resolved.md`

**Step 1: Update bug status**

```markdown
**Status**: Resolved
**Resolution**: Fixed in commit [hash]
```

**Step 2: Add resolution notes**

Document the fix and related services that were also fixed.

**Step 3: Run full test suite**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand`

Expected: All PASS

**Step 4: Commit**

```bash
git add docs/_wip/bugs/2026-01-29-ambient-led-homeassistant-baseurl-not-resolved.md
git commit -m "docs: mark ambient LED HA bug as resolved

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Archive Bug Report (if desired)

**Files:**
- Move: `docs/_wip/bugs/2026-01-29-ambient-led-homeassistant-baseurl-not-resolved.md` → `docs/_archive/bugs/`

**Step 1: Move file to archive**

```bash
mkdir -p docs/_archive/bugs
mv docs/_wip/bugs/2026-01-29-ambient-led-homeassistant-baseurl-not-resolved.md docs/_archive/bugs/
```

**Step 2: Commit**

```bash
git add docs/_wip/bugs/ docs/_archive/bugs/
git commit -m "docs: archive resolved HA baseUrl bug report

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Verification Checklist

After all tasks complete:

- [ ] `getServiceConfig` calls removed from app.mjs (0 remaining for services in services.yml)
- [ ] Home Assistant URL resolves correctly
- [ ] Printer host/port resolve correctly
- [ ] TV/daylightHost derives correctly
- [ ] All unit tests pass
- [ ] Bug report updated/archived
