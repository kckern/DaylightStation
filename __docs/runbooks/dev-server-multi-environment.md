# Dev Server & Multi-Environment Configuration

## Overview

DaylightStation uses hostname-based configuration to run dev servers alongside Docker production on the same machine without port conflicts.

## Port Assignments

| Environment | Primary Port | Secondary Port | Config File |
|-------------|--------------|----------------|-------------|
| Docker (production) | 3111 | 3119 | `system-local.docker.yml` |
| {env.prod_host} (dev) | 3112 | 3120 | `system-local.{env.prod_host}.yml` |
| {env.dev_host} | 3111 | 3119 | `system-local.{env.dev_host}.yml` |

## Config Detection Order

The system auto-detects which config to load:

1. **DAYLIGHT_ENV** - Explicit override via environment variable
2. **Docker** - Detects `/.dockerenv` file, uses `system-local.docker.yml`
3. **Hostname** - Uses `system-local.{hostname}.yml`
4. **Legacy fallback** - Uses `system-local.yml` if no match

Config files location: `data/system/`

## Starting the Dev Server

### Quick Start (on {env.prod_host})

```bash
# From project root
node __backend/index.js

# Or with npm (uses nodemon for auto-restart)
npm run backend:dev
```

### Verify It's Running

```bash
# Check ports
ss -tlnp | grep -E '311[12]|312[0]'

# Expected output on {env.prod_host}:
# 3111 - docker-proxy (production)
# 3112 - node (dev primary)
# 3120 - node (dev secondary)

# Test endpoint
curl http://localhost:3112/api/ping
```

### Background Mode

```bash
nohup node __backend/index.js > /tmp/backend-dev.log 2>&1 &
```

## Stopping the Dev Server

```bash
# Find and kill the process
pkill -f 'node __backend/index.js'

# Or find PID and kill
ps aux | grep 'node __backend/index'
kill <PID>
```

## Troubleshooting

### EADDRINUSE Error

**Symptom**: `Error: listen EADDRINUSE: address already in use 0.0.0.0:3111`

**Cause**: Dev server trying to use Docker's port (wrong config loaded)

**Fix**:
1. Check hostname matches config file: `hostname` should return `{env.prod_host}`
2. Verify config file exists: `ls data/system/system-local.{env.prod_host}.yml`
3. Check PORT value in config: `grep PORT data/system/system-local.{env.prod_host}.yml`

### Wrong Config Loaded

**Debug**: Add to `__backend/index.js` temporarily:
```javascript
console.log('[DEBUG] PORT:', process.env.PORT);
console.log('[DEBUG] Hostname:', require('os').hostname());
```

### Config Not Taking Effect

The config loads in two places:
1. `hydrateProcessEnvFromConfigs()` - Early load for logging
2. `loadAllConfig()` - Full config merge

Both use the same hostname detection. If issues persist, check `__backend/src/0_system/logging/config.js` and `__backend/_legacy/lib/config/loader.mjs`.

## Config File Format

Machine-specific configs use uppercase keys for ports:

```yaml
# system-local.{env.prod_host}.yml
PORT: 3112
SECONDARY_PORT: 3120

path:
  data: /media/{user}/DockerDrive/Dropbox/Apps/DaylightStation/data
  media: /media/{user}/DockerDrive/Dropbox/Apps/DaylightStation/media

home_assistant:
  host: http://172.18.0.22:8123

plex:
  host: http://10.0.0.10:32400

mqtt:
  host: 10.0.0.10
  port: 1883
```

## Service-Specific Configuration

### MQTT (Mosquitto)

MQTT is optional and typically only available on production/server environments.

**Disable on dev machines** by setting `mqtt: null` in your machine-specific config:

```yaml
# system-local.{env.dev_host}.yml
mqtt: null  # Mosquitto not available on dev machine
```

The system will skip MQTT initialization if `mqtt` is `null` or `mqtt.host` is not configured.

## Adding a New Environment

1. Get the hostname: `hostname`
2. Create config file: `data/system/system-local.{hostname}.yml`
3. Set appropriate ports to avoid conflicts
4. Include paths, service URLs as needed

## Related Files

- `__backend/index.js` - Main entry point, reads PORT config
- `__backend/_legacy/lib/config/loader.mjs` - Config loading with `getMachineConfigFile()`
- `__backend/src/0_system/logging/config.js` - Early config hydration
- `data/system/system-local.*.yml` - Machine-specific configs
