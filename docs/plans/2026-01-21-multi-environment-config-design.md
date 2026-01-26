# Multi-Environment Configuration Design

**Date:** 2026-01-21
**Status:** Approved
**Problem:** `system-local.yml` is synced via Dropbox, causing conflicts between laptop, server, and Docker environments

---

## Overview

Enable automatic environment detection so each machine uses its own config without manual switching or port conflicts.

### Environments

| Environment | Hostname | Ports | Use Case |
|-------------|----------|-------|----------|
| Docker | (detected via `/.dockerenv`) | 3111, 3119 | Production |
| Server (Linux) | `kckern-server` | 3112, 3120 | Dev alongside Docker |
| Laptop (macOS) | `kckern-macbook` | 3111, 3119 | Dev |

---

## Config File Structure

```
data/system/
├── system.yml                      # Base config (shared)
├── system-local.docker.yml         # Docker overrides
├── system-local.kckern-server.yml  # Server overrides
├── system-local.kckern-macbook.yml # Laptop overrides
├── system-local.yml                # DEPRECATED (legacy fallback)
└── secrets.yml                     # Secrets (shared)
```

### Loading Precedence (highest wins)

1. Environment variables (`PORT`, `DAYLIGHT_ENV`, etc.)
2. Machine-specific file (`system-local.{hostname}.yml` or `system-local.docker.yml`)
3. Legacy `system-local.yml` (backwards compatibility)
4. `secrets.yml`
5. `apps/*.yml`
6. `system.yml`

---

## Detection Logic

```javascript
function getMachineConfigFile(configDir, isDocker) {
  // 1. Explicit override via env var
  if (process.env.DAYLIGHT_ENV) {
    const envFile = `system-local.${process.env.DAYLIGHT_ENV}.yml`;
    if (fs.existsSync(path.join(configDir, envFile))) {
      return envFile;
    }
    console.warn(`[Config] DAYLIGHT_ENV=${process.env.DAYLIGHT_ENV} but ${envFile} not found`);
  }

  // 2. Docker auto-detect
  if (isDocker) {
    const dockerFile = 'system-local.docker.yml';
    if (fs.existsSync(path.join(configDir, dockerFile))) {
      return dockerFile;
    }
  }

  // 3. Hostname-based
  const hostname = os.hostname();
  const hostFile = `system-local.${hostname}.yml`;
  if (fs.existsSync(path.join(configDir, hostFile))) {
    return hostFile;
  }

  // 4. Legacy fallback
  if (fs.existsSync(path.join(configDir, 'system-local.yml'))) {
    return 'system-local.yml';
  }

  return null;
}
```

---

## Machine-Specific Config Files

### `system-local.docker.yml`

```yaml
# Docker container - uses internal service names
path:
  data: /usr/src/app/data
  media: /usr/src/app/media

port: 3111
secondary_port: 3119

home_assistant:
  host: http://homeassistant:8123

plex:
  host: http://plex:32400
```

### `system-local.kckern-server.yml`

```yaml
# Linux server - dev ports to avoid Docker conflict
path:
  data: /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data
  media: /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media

port: 3112
secondary_port: 3120

home_assistant:
  host: http://172.18.0.22:8123

plex:
  host: http://10.0.0.10:32400

mqtt:
  host: 10.0.0.10
  port: 1883
```

### `system-local.kckern-macbook.yml`

```yaml
# macOS laptop
path:
  data: /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data
  media: /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/media

port: 3111
secondary_port: 3119

home_assistant:
  host: https://home.kckern.net

plex:
  host: http://10.0.0.10:32400

mqtt:
  host: 10.0.0.10
  port: 1883
```

---

## Code Changes Required

### 1. `backend/_legacy/lib/config/loader.mjs`

- Add `import os from 'os'`
- Add `getMachineConfigFile()` helper function
- Replace local config loading logic (lines 177-187)
- Remove `isDev && !isDocker` condition

### 2. `backend/src/server.mjs`

- Read `port` from config: `process.env.PORT || configResult.config.port || 3111`
- Read `secondary_port` from config similarly

### 3. `backend/index.js`

- Same port config changes as server.mjs

---

## Migration Plan

1. **Create config files** - Add the three machine-specific YAML files
2. **Update loader.mjs** - Add detection logic
3. **Update server startup** - Read ports from config
4. **Test each environment**:
   - Docker: `docker restart daylight-station` → port 3111
   - Server: `npm run backend:dev` → port 3112
   - Laptop: `npm run backend:dev` → port 3111
5. **Cleanup** - Delete legacy `system-local.yml` after confirming

---

## Usage

```bash
# Auto-detect (default)
npm run backend:dev

# Force specific environment
DAYLIGHT_ENV=docker npm run backend:dev
DAYLIGHT_ENV=kckern-macbook npm run backend:dev

# Override port even further
PORT=3200 npm run backend:dev
```

---

## Success Criteria

- [ ] Server dev runs on port 3112 automatically
- [ ] Docker continues on port 3111 unchanged
- [ ] Laptop works without changes
- [ ] `DAYLIGHT_ENV=x` can force any config
- [ ] Startup logs show which config file was loaded
