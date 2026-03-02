# Data Permission Guardrails Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent file ownership mismatches from silently breaking the app by adding entrypoint auto-fix, startup health check, and actionable EACCES logging.

**Architecture:** Three layers — Docker entrypoint fixes ownership at container start and drops privileges; a boot-time health check validates critical directories are writable; FileIO/DataService write functions detect EACCES and log actionable diagnostics.

**Tech Stack:** Shell (entrypoint), Node.js (health check + logging), Alpine `su-exec` (privilege drop)

---

### Task 1: Entrypoint — Root Start + Privilege Drop

**Files:**
- Modify: `docker/Dockerfile:8` (add su-exec to apk install)
- Modify: `docker/Dockerfile:58` (remove USER node)
- Modify: `docker/entrypoint.sh` (add ownership fix + su-exec)

**Step 1: Add `su-exec` to Dockerfile apk install**

In `docker/Dockerfile`, line 8, add `su-exec` to the apk install:

```dockerfile
RUN apk add --no-cache openssh-client git curl ffmpeg tzdata yq android-tools su-exec
```

**Step 2: Remove `USER node` from Dockerfile**

In `docker/Dockerfile`, line 58, remove the `USER node` line entirely. The entrypoint will handle privilege drop.

**Step 3: Rewrite entrypoint.sh with ownership fix and privilege drop**

Replace `docker/entrypoint.sh` with:

```sh
#!/bin/sh

# Configure DaylightStation environment
# PWD is set by Dockerfile WORKDIR directive (/usr/src/app)
export DAYLIGHT_BASE_PATH="${PWD}"
export DAYLIGHT_ENV="docker"

# Set Timezone from system.yml if not overriden by env
if [ -f "/usr/src/app/config/system.yml" ]; then
    FILE_TZ=$(yq '.timezone' /usr/src/app/config/system.yml)
    if [ ! -z "$FILE_TZ" ] && [ "$FILE_TZ" != "null" ]; then
        export TZ="$FILE_TZ"
        echo "Timezone configured from system.yml: $TZ"
    fi
fi

cd /usr/src/app/
chown node:node host_private_key known_hosts
chmod 400 host_private_key

# Provision ADB keys from persistent data mount (survives container rebuilds)
ADB_KEY_SRC="/usr/src/app/data/system/adb-keys"
ADB_KEY_DST="/home/node/.android"
if [ -f "$ADB_KEY_SRC/adbkey" ]; then
    mkdir -p "$ADB_KEY_DST"
    cp "$ADB_KEY_SRC/adbkey" "$ADB_KEY_DST/adbkey"
    cp "$ADB_KEY_SRC/adbkey.pub" "$ADB_KEY_DST/adbkey.pub"
    chown node:node "$ADB_KEY_DST/adbkey" "$ADB_KEY_DST/adbkey.pub"
    chmod 600 "$ADB_KEY_DST/adbkey"
    echo "ADB keys provisioned from data mount"
fi

# Fix data volume ownership (handles Dropbox drift, manual edits)
if [ -d "/usr/src/app/data" ]; then
    BAD_FILES=$(find /usr/src/app/data -not -user node 2>/dev/null | head -1)
    if [ -n "$BAD_FILES" ]; then
        echo "[Entrypoint] Fixing data directory ownership..."
        find /usr/src/app/data -not -user node -exec chown node:node {} +
        echo "[Entrypoint] Ownership fix complete"
    else
        echo "[Entrypoint] Data directory ownership OK"
    fi
fi

# Drop privileges and start app
cd backend
exec su-exec node forever index.js
```

**Step 4: Commit**

```
feat(docker): auto-fix data volume ownership at container start

Entrypoint now runs as root, fixes any non-node-owned files in the
data volume (handles Dropbox drift), then drops to node via su-exec.
```

---

### Task 2: Boot Health Check — Validate Data Permissions

**Files:**
- Create: `backend/src/0_system/boot/validateDataPermissions.mjs`
- Modify: `backend/index.js:130` (add health check call)

**Step 1: Create validateDataPermissions.mjs**

Create `backend/src/0_system/boot/validateDataPermissions.mjs`:

```javascript
import fs from 'fs';
import path from 'path';

const CRITICAL_DIRS = [
  'system/state',
  'system/config',
  'household',
  'users',
];

/**
 * Validate that the app can write to critical data directories.
 * Logs warnings for any unwritable paths. Does not block startup.
 *
 * @param {object} options
 * @param {string} options.dataDir - Absolute path to data directory
 * @param {object} [options.logger] - Structured logger (falls back to console)
 */
export function validateDataPermissions({ dataDir, logger }) {
  const log = logger || console;
  const failures = [];

  for (const rel of CRITICAL_DIRS) {
    const dir = path.join(dataDir, rel);
    if (!fs.existsSync(dir)) continue;

    const testFile = path.join(dir, '.write-test');
    try {
      fs.writeFileSync(testFile, '', 'utf8');
      fs.unlinkSync(testFile);
    } catch (err) {
      const stat = safeStat(dir);
      failures.push({
        path: dir,
        error: err.code,
        owner: stat ? stat.uid : 'unknown',
        mode: stat ? '0' + (stat.mode & 0o777).toString(8) : 'unknown',
      });
    }
  }

  if (failures.length > 0) {
    const logFn = log.warn || log.error || console.error;
    const event = 'bootstrap.permission_warnings';
    const data = {
      message: `${failures.length} critical director${failures.length === 1 ? 'y is' : 'ies are'} not writable`,
      failures,
      runningAs: process.getuid?.() ?? 'unknown',
      fix: 'Run: docker exec <container> chown -R node:node /usr/src/app/data',
    };

    if (typeof logFn === 'function' && log !== console) {
      logFn.call(log, event, data);
    } else {
      console.error(`[Bootstrap] ${data.message}`, JSON.stringify(failures, null, 2));
    }
  } else {
    if (log.info) {
      log.info('bootstrap.permissions_ok', { dataDir });
    } else {
      console.log('[Bootstrap] Data directory permissions OK');
    }
  }
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}
```

**Step 2: Wire into bootstrap sequence**

In `backend/index.js`, after the logger is created (after line 129), add:

```javascript
  // Validate data directory permissions
  const { validateDataPermissions } = await import('./src/0_system/boot/validateDataPermissions.mjs');
  validateDataPermissions({ dataDir, logger });
```

Insert this between the logger creation (line 129) and the HTTP server section (line 131).

**Step 3: Commit**

```
feat(boot): validate data directory permissions at startup

Checks that critical directories (system/state, household, users)
are writable at boot. Logs structured warnings with owner/mode
details and a suggested fix command.
```

---

### Task 3: DataService — EACCES Logging

**Files:**
- Modify: `backend/src/0_system/config/DataService.mjs:49-61`

**Step 1: Add EACCES detection to writeYamlFile**

Replace the `writeYamlFile` function (lines 49-61) in `backend/src/0_system/config/DataService.mjs` with:

```javascript
const writeYamlFile = (absolutePath, data) => {
  try {
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const content = yaml.dump(data, { lineWidth: -1, quotingType: '"' });
    fs.writeFileSync(absolutePath, content, 'utf8');
    return true;
  } catch (err) {
    if (err.code === 'EACCES') {
      const stat = safeStatSync(absolutePath) || safeStatSync(path.dirname(absolutePath));
      console.error(
        `[DataService] EACCES writing ${absolutePath} — ` +
        `file owner uid=${stat?.uid ?? '?'}, ` +
        `running as uid=${process.getuid?.() ?? '?'}. ` +
        `Fix: chown node:node "${absolutePath}"`
      );
    }
    return false;
  }
};

const safeStatSync = (p) => { try { return fs.statSync(p); } catch { return null; } };
```

**Step 2: Commit**

```
fix(data): log actionable diagnostics on EACCES write failures

DataService writeYamlFile now detects permission errors and logs
the file owner uid, running uid, and a chown fix command.
```

---

### Task 4: FileIO — EACCES Logging

**Files:**
- Modify: `backend/src/0_system/utils/FileIO.mjs:116-128` (saveYaml)
- Modify: `backend/src/0_system/utils/FileIO.mjs:268-272` (writeFile)
- Modify: `backend/src/0_system/utils/FileIO.mjs:295-299` (saveYamlToPath)
- Modify: `backend/src/0_system/utils/FileIO.mjs:335-338` (writeBinary)

**Step 1: Add a shared EACCES helper at top of FileIO.mjs**

After the existing imports (line 5), add:

```javascript
/**
 * Log actionable diagnostics for EACCES errors
 */
function logPermissionError(filePath, err) {
  if (err.code !== 'EACCES') return;
  let stat;
  try { stat = fs.statSync(filePath) || fs.statSync(path.dirname(filePath)); } catch { /* ignore */ }
  if (!stat) try { stat = fs.statSync(path.dirname(filePath)); } catch { /* ignore */ }
  console.error(
    `[FileIO] EACCES writing ${filePath} — ` +
    `owner uid=${stat?.uid ?? '?'}, ` +
    `running as uid=${process.getuid?.() ?? '?'}. ` +
    `Fix: chown node:node "${filePath}"`
  );
}
```

**Step 2: Add EACCES logging to saveYaml**

Replace `saveYaml` (lines 116-128) with:

```javascript
export function saveYaml(basePath, content, options = {}) {
  const filePath = basePath.endsWith('.yml') || basePath.endsWith('.yaml')
    ? basePath
    : `${basePath}.yml`;

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  try {
    const yamlContent = yaml.dump(content, { lineWidth: -1, ...options });
    fs.writeFileSync(filePath, yamlContent, 'utf8');
  } catch (err) {
    logPermissionError(filePath, err);
    throw err;
  }
}
```

**Step 3: Add EACCES logging to writeFile**

Replace `writeFile` (lines 268-272) with:

```javascript
export function writeFile(filePath, content) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  try {
    fs.writeFileSync(filePath, content, 'utf8');
  } catch (err) {
    logPermissionError(filePath, err);
    throw err;
  }
}
```

**Step 4: Add EACCES logging to saveYamlToPath**

Replace `saveYamlToPath` (lines 295-300) with:

```javascript
export function saveYamlToPath(filePath, content, options = {}) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  try {
    const yamlContent = yaml.dump(content, { lineWidth: -1, ...options });
    fs.writeFileSync(filePath, yamlContent, 'utf8');
  } catch (err) {
    logPermissionError(filePath, err);
    throw err;
  }
}
```

**Step 5: Add EACCES logging to writeBinary**

Replace `writeBinary` (lines 335-339) with:

```javascript
export function writeBinary(filePath, buffer) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  try {
    fs.writeFileSync(filePath, buffer);
  } catch (err) {
    logPermissionError(filePath, err);
    throw err;
  }
}
```

**Step 6: Commit**

```
fix(fileio): log actionable diagnostics on EACCES write failures

All FileIO write functions (saveYaml, writeFile, saveYamlToPath,
writeBinary) now detect EACCES and log owner uid, running uid,
and a chown fix command before re-throwing.
```

---

### Task 5: Fix Current Production Issue

**This is a manual step — run the chown to unblock production now.**

```bash
docker exec -u root daylight-station chown -R node:node /usr/src/app/data
```

This fixes the immediate issue. The guardrails from Tasks 1-4 prevent recurrence.

---

### Task 6: Verify

**Step 1: Build Docker image locally and verify entrypoint**

```bash
docker build -f docker/Dockerfile -t daylight-station:test .
```

**Step 2: Verify su-exec is installed**

```bash
docker run --rm daylight-station:test which su-exec
```

Expected: `/usr/bin/su-exec`

**Step 3: Verify entrypoint runs ownership fix**

```bash
docker run --rm -v /tmp/test-data:/usr/src/app/data daylight-station:test sh -c "
  touch /usr/src/app/data/test-file
  ls -la /usr/src/app/data/test-file
"
```

**Step 4: Commit all changes together if not already committed per-task**

Final commit message:
```
feat(docker): data permission guardrails

Three-layer defense against file ownership mismatches:
1. Entrypoint auto-fixes non-node-owned files + privilege drop via su-exec
2. Boot health check validates critical directories are writable
3. FileIO/DataService log actionable EACCES diagnostics
```
