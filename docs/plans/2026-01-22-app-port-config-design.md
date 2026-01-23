# App Port Configuration Design

**Created:** 2026-01-22
**Status:** Ready for implementation

## Problem

Port configuration was confusing:
- `server.port` ambiguous (backend? whole app?)
- `vite.port` added incorrectly as separate config
- Dev and prod had different topology (confusing for tests)

## Design

### Single Port Per Environment

Each environment defines ONE port - the **public-facing app port**:

| Environment | `app.port` | User hits | Backend listens |
|-------------|------------|-----------|-----------------|
| Docker (prod) | 3111 | 3111 | 3111 (serves static + API) |
| kckern-macbook (dev) | 3111 | 3111 (Vite) | 3112 (hidden) |
| kckern-server (dev) | 3112 | 3112 (Vite) | 3113 (hidden) |

### Key Principle

**Same surface topology everywhere.** Users and tests only know about `app.port`. In dev, the backend port (`app.port + 1`) is an implementation detail only Vite knows about.

### Detection Logic

```javascript
const isDocker = existsSync('/.dockerenv');
const backendPort = isDocker ? appPort : appPort + 1;
```

- Docker → prod mode → backend serves everything on `app.port`
- No Docker → dev mode → Vite on `app.port`, backend on `app.port + 1`

## Config Changes

### system.yml (base/prod)
```yaml
app:
  port: 3111

webhook:
  port: 3119
```

### system-local.kckern-server.yml
```yaml
app:
  port: 3112

webhook:
  port: 3120

services_host: localhost
```

### system-local.kckern-macbook.yml
```yaml
app:
  port: 3111

webhook:
  port: 3119

services_host: localhost
```

**Removed:** `server.port` (replaced by `app.port`), `vite.port` (no longer needed)

## Code Changes

### 1. ConfigService.mjs

```javascript
getAppPort() {
  return this.#config.system?.app?.port ?? 3111;
}

getBackendPort() {
  const appPort = this.getAppPort();
  const isDocker = existsSync('/.dockerenv');
  return isDocker ? appPort : appPort + 1;
}
```

Remove: `getPort()` (replaced by `getAppPort()`)

### 2. backend/index.js

```javascript
const port = configService.getBackendPort();
server.listen(port, '0.0.0.0', () => { ... });
```

### 3. vite.config.js

```javascript
function getPortsFromConfig(env) {
  // ... load config ...
  const appPort = config.app?.port ?? 3111;
  return {
    app: appPort,
    backend: appPort + 1  // Always +1 in dev (Vite only runs in dev)
  };
}

// In server config:
server: {
  port: ports.app,
  proxy: {
    '/api': `http://localhost:${ports.backend}`,
    '/ws': { target: `ws://localhost:${ports.backend}`, ws: true }
  }
}
```

### 4. tests/lib/configHelper.mjs

```javascript
export function getAppPort() {
  const config = loadSystemConfig();
  return config?.app?.port ?? 3111;
}

export function getTestUrls() {
  const appPort = getAppPort();
  return {
    frontend: `http://localhost:${appPort}`,
    backend: `http://localhost:${appPort}`,  // Same! Through proxy
    ws: `ws://localhost:${appPort}/ws`
  };
}
```

Remove: Separate backend port logic - tests don't need it.

### 5. tests/_fixtures/runtime/urls.mjs

Uses `getAppPort()` for all URLs - no distinction between frontend/backend from test perspective.

## Migration

1. Update YAML files (`server.port` → `app.port`, remove `vite.port`)
2. Update ConfigService with new methods
3. Update backend/index.js to use `getBackendPort()`
4. Update vite.config.js to calculate backend as +1
5. Simplify configHelper and test URLs
6. Update docs/reference/core/configuration.md
