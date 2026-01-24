# Dev Server Manager Design

## Problem

Port conflicts when running dev server or tests:
- Stale processes hold ports after crashes or nodemon restarts
- Multiple servers (app, backend, webhook) on different ports
- No way to check if server is already running
- Tests fail due to infrastructure issues, not code issues

## Solution

A `./dev` script that manages the dev server lifecycle:

```bash
./dev              # Kill stale → start server (foreground)
./dev --kill       # Just kill processes on dev ports
./dev --status     # Check if running (exit 0=yes, 1=no)
./dev --background # Start in background, wait for ready
```

## Ports Managed

From `system-local.kckern-server.yml`:
- 3112 (Vite/frontend)
- 3113 (backend = app port + 1)
- 3120 (webhook)

## Key Behaviors

1. **Idempotent** - Always safe to run, kills stale processes first
2. **Health check** - `--background` waits for `/api/v1/health` before returning
3. **30s timeout** - Fails fast if server won't start
4. **Clean exit codes** - Scripts can depend on return values

## Test Integration

```javascript
// playwright.config.js or globalSetup.js
import { execSync } from 'child_process';

execSync('./dev --background', { stdio: 'inherit' });
```

## Related Files

- `./dev` - The script
- `data/system/system-local.kckern-server.yml` - Port configuration
- `/tmp/daylight-dev.log` - Background mode logs
