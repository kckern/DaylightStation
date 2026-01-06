# safeReadYaml Consolidation Analysis

**Date:** 2026-01-06
**Status:** Analysis complete, awaiting decision

## Problem Statement

The codebase has 4 separate implementations of `safeReadYaml` across different files. This raises questions about:
- Code duplication and maintenance burden
- Inconsistent behavior between implementations
- Whether consolidation is possible and beneficial

## Current Implementations

### 1. `backend/lib/logging/config.js` (lines 13-24)

```javascript
const safeReadYaml = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return parse(raw) || {};
    }
  } catch (err) {
    process.stderr.write(`[logging-config] failed to read ${filePath} ${err?.message || err}\n`);
  }
  return {};
};
```

**Characteristics:**
- YAML library: `yaml` package (`parse`)
- On missing file: Returns `{}`
- On parse error: Returns `{}`
- Error handling: Writes to stderr (cannot use logger - circular dependency)
- Null byte handling: None

**Used by:**
- `hydrateProcessEnvFromConfigs()` - loads system.yml, secrets.yml, system-local.yml
- `loadLoggingConfig()` - loads config/logging.yml

**Timing:** Bootstrap (before `process.env.path.data` exists)

---

### 2. `backend/lib/config/ConfigService.mjs` (lines 30-40)

```javascript
const safeReadYaml = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return parse(raw) || {};
    }
  } catch (err) {
    console.error(`[ConfigService] Failed to read ${filePath}:`, err?.message || err);
  }
  return null;
};
```

**Characteristics:**
- YAML library: `yaml` package (`parse`)
- On missing file: Returns `null`
- On parse error: Returns `null`
- Error handling: console.error
- Null byte handling: None

**Used by:**
- `#loadConfigFile()` - loads system.yml, secrets.yml
- `#loadSystemConfig()` - loads system.yml
- `#loadAppConfigs()` - loads apps/*.yml
- `getHouseholdAuth()` - loads households/{hid}/auth/*.yml
- `getUserAuth()` - loads users/{user}/auth/*.yml
- `getUserProfile()` - loads users/{user}/profile.yml
- `getHouseholdConfig()` - loads households/{hid}/household.yml
- `getState()` - loads system and household state files
- `getMergedHouseholdAppConfig()` - loads app defaults and household overrides

**Timing:** Bootstrap AND Runtime

---

### 3. `backend/lib/config/UserDataService.mjs` (lines 29-46)

```javascript
const safeReadYaml = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      let raw = fs.readFileSync(filePath, 'utf8').trim();
      raw = raw.replace(/\u0000/g, '');  // Remove null bytes
      const data = yaml.load(raw);
      if (data && typeof data === 'object' && Object.keys(data).length === 0) {
        return null;
      }
      return data || null;
    }
  } catch (err) {
    logger.error('user-data.read-failed', { path: filePath, message: err?.message });
  }
  return null;
};
```

**Characteristics:**
- YAML library: `js-yaml` package (`yaml.load`)
- On missing file: Returns `null`
- On parse error: Returns `null`
- On empty object: Returns `null`
- Error handling: Structured logger
- Null byte handling: Yes

**Also has `safeWriteYaml`:**
```javascript
const safeWriteYaml = (filePath, data) => {
  // Creates directory, yaml.dump with basic options
  fs.writeFileSync(filePath, yamlStr, 'utf8');
};
```

**Used by:**
- `readHouseholdSharedData()` - reads household shared data
- `readHouseholdAppData()` - reads household app data
- `readUserData()` - reads user data files
- `readLegacyData()` - reads legacy paths with fallback

**Timing:** Runtime only (depends on `configService.getDataDir()`)

---

### 4. `backend/lib/config/UserService.mjs` (lines 19-29)

```javascript
const safeReadYaml = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return parse(raw) || {};
    }
  } catch (err) {
    console.error(`[UserService] Failed to read ${filePath}:`, err?.message || err);
  }
  return null;
};
```

**Status:** DEAD CODE - defined but never called

---

### Reference: `backend/lib/io.mjs` loadFile (lines 183-250)

```javascript
const loadFile = (path) => {
  path = translatePath(path);  // Path translation
  // Skip macOS resource forks
  // Deprecation warnings for legacy paths
  // Try .yml, then .yaml
  let fileData = fs.readFileSync(fileToLoad, 'utf8').toString().trim();
  fileData = fileData.replace(/\u0000/g, '');  // Null byte removal
  const object = yaml.load(fileData);
  if (object && Object.keys(object).length === 0) return null;
  return object || null;
};
```

### Reference: `backend/lib/io.mjs` saveFile (lines 315-357)

```javascript
const saveFile = (path, data) => {
  path = translatePath(path);
  // Deprecation warnings
  const queue = getQueue(yamlFile);  // Write queue for concurrency
  const cloned = JSON.parse(JSON.stringify(removeCircularReferences(data)));
  queue.pending.push({ normalizedPath, yamlFile, data: cloned });
  processQueue(yamlFile);  // Async queue processing
};
```

**Key features in io.mjs that others lack:**
- Write queue (concurrency protection)
- Flow sequence handling (prettier YAML arrays)
- Circular reference removal
- Path translation
- Deprecation warnings

---

## Comparison Matrix

| Feature | logging/config | ConfigService | UserDataService | io.mjs |
|---------|---------------|---------------|-----------------|--------|
| YAML library | `yaml` (parse) | `yaml` (parse) | `js-yaml` (load) | `js-yaml` (load) |
| On missing | `{}` | `null` | `null` | `null` |
| On error | `{}` | `null` | `null` | `null` |
| Null bytes | No | No | Yes | Yes |
| Empty → null | No | No | Yes | Yes |
| Path translation | No | No | No | Yes |
| Deprecation warnings | No | No | Yes (partial) | Yes |
| **Write queue** | N/A | No | No | **Yes** |
| **Flow sequences** | N/A | No | No | **Yes** |
| **Circular refs** | N/A | No | No | **Yes** |

---

## Evaluation

### logging/config.js - JUSTIFIED

**Reasons:**
1. **Bootstrap timing**: Runs before `process.env.path.data` is set
2. **Circular dependency**: Cannot import io.mjs (io.mjs imports logger.js which imports this)
3. **Return value semantics**: Returns `{}` which is correct for config merging with spread
4. **Error handling**: Cannot use logger (would create circular dependency)

**Verdict:** Keep as-is. This is truly bootstrap code.

---

### ConfigService.mjs - PARTIALLY JUSTIFIED

**Reasons for keeping separate:**
1. **Bootstrap methods**: `init()`, `#loadConfigs()`, `#loadSystemConfig()`, `#loadAppConfigs()` run at bootstrap
2. **Return value semantics**: Mixed (`{}` on parse success, `null` on missing) - but this is actually a bug

**Issues:**
1. **Inconsistent return values**: Returns `parse(raw) || {}` but file not found returns `null`
2. **Runtime methods could use io.mjs**: `getUserProfile()`, `getHouseholdConfig()`, `getState()`, `getUserAuth()`, `getHouseholdAuth()` all run after bootstrap
3. **Different YAML library**: Uses `yaml` package vs `js-yaml` in io.mjs (minor, both work)

**Verdict:** Bootstrap methods justified. Runtime methods should consider using io.mjs.

---

### UserDataService.mjs - NOT JUSTIFIED

**Issues:**
1. **Runtime only**: Depends on `configService.getDataDir()` which requires bootstrap complete
2. **Missing write queue**: `safeWriteYaml()` writes directly without concurrency protection
3. **Missing flow sequences**: YAML output is less pretty
4. **Missing circular reference handling**: Could fail on circular data structures
5. **Duplicates io.mjs functionality**: Both handle null bytes, empty objects, .yml/.yaml fallback

**Risk:** Concurrent writes from multiple routers could cause data corruption or race conditions.

**Evidence of runtime usage:**
```
backend/routers/gratitude.mjs:138 → userDataService.readHouseholdSharedData()
backend/routers/fitness.mjs:473 → userDataService.readHouseholdAppData()
backend/routers/media.mjs → userDataService
```

**Verdict:** Should wrap io.mjs internally or use io.mjs functions directly.

---

### UserService.mjs - DEAD CODE

**Status:** `safeReadYaml` is defined but never called. All methods delegate to `configService`:
- `getProfile()` → `configService.getUserProfile()`
- `getAllProfiles()` → `configService.getAllUserProfiles()`
- `resolveFromPlatform()` → `configService.resolveUsername()`

**Verdict:** Delete the dead `safeReadYaml` function (lines 19-29).

---

## Recommendations

### Option A: Minimal Cleanup (Low Risk)

1. **Delete dead code** in UserService.mjs (lines 10-12 imports, lines 19-29 function)
2. **Document** the intentional separation for bootstrap vs runtime
3. **Accept** the duplication as architectural necessity

**Pros:** Low risk, quick win
**Cons:** UserDataService still has concurrency risk

---

### Option B: Consolidate Runtime Layer (Medium Risk)

1. Delete dead code in UserService.mjs
2. **Refactor UserDataService** to use io.mjs internally:
   ```javascript
   import { loadFile, saveFile } from '../io.mjs';

   readHouseholdSharedData(householdId, dataPath) {
     const relativePath = `households/${householdId}/shared/${dataPath}`;
     return loadFile(relativePath);
   }
   ```
3. Keep logging/config.js and ConfigService.mjs bootstrap code unchanged

**Pros:** Eliminates concurrency risk, gains write queue protection
**Cons:** Requires testing all UserDataService consumers

---

### Option C: Extract Shared Bootstrap Utility (Higher Risk)

1. Create `backend/lib/yaml-utils.mjs` with:
   - `bootstrapReadYaml()` - returns `{}`, no logger
   - Export for logging/config.js and ConfigService.mjs
2. Refactor UserDataService to use io.mjs
3. Delete UserService dead code

**Pros:** Single source of truth for bootstrap YAML reading
**Cons:** More refactoring, potential import order issues

---

## Architectural Considerations

### Why io.mjs Can't Be Used for Bootstrap

```
backend/index.js
  └── imports logging/config.js
        └── hydrateProcessEnvFromConfigs() sets process.env.path.data
              └── THEN io.mjs can work (needs process.env.path.data)
```

io.mjs depends on `process.env.path.data` being set:
```javascript
// io.mjs:225
const ymlPath = `${process.env.path.data}/${path}.yml`;
```

### Import Chain That Prevents Consolidation

```
io.mjs
  └── imports logging/logger.js
        └── imports logging/config.js
              └── CANNOT import io.mjs (circular)
```

### UserDataService Could Use io.mjs Because

```
UserDataService.mjs
  └── imports configService from ConfigService.mjs
        └── configService.getDataDir() requires process.env.path.data
              └── Therefore UserDataService runs AFTER bootstrap
                    └── Therefore io.mjs is available
```

---

## Questions for Decision

1. **Is the concurrency risk in UserDataService acceptable?**
   - If multiple requests write to the same household data file simultaneously, the last write wins
   - io.mjs has a queue to serialize writes per-file

2. **Is the inconsistent YAML output acceptable?**
   - io.mjs produces flow-style arrays for integer arrays: `[1, 2, 3]`
   - UserDataService produces block-style: `- 1\n- 2\n- 3`

3. **Is maintaining 3 implementations (after deleting UserService dead code) acceptable?**
   - logging/config.js - bootstrap
   - ConfigService.mjs - bootstrap + some runtime
   - UserDataService.mjs - runtime (should use io.mjs?)

---

## Appendix: File Locations

- `backend/lib/logging/config.js:13-24` - safeReadYaml
- `backend/lib/config/ConfigService.mjs:30-40` - safeReadYaml
- `backend/lib/config/UserDataService.mjs:29-46` - safeReadYaml
- `backend/lib/config/UserDataService.mjs:51-70` - safeWriteYaml
- `backend/lib/config/UserService.mjs:19-29` - safeReadYaml (DEAD CODE)
- `backend/lib/io.mjs:183-250` - loadFile
- `backend/lib/io.mjs:315-357` - saveFile
