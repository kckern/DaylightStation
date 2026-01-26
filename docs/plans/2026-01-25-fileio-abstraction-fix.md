# FileIO Abstraction Fix

## Problem

Adapters in `backend/src/2_adapters/persistence/yaml/` are violating DDD abstraction by:
- Importing `loadYamlFromPath`/`saveYamlToPath` (extension-aware functions)
- Manually manipulating `.yml`/`.yaml` extensions in path strings
- Knowing about file format details that belong in infrastructure layer

If storage format changes (JSON, SQLite, etc.), adapter code would need modification. Only `backend/src/0_infrastructure/` should know about file extensions.

## Solution

Use existing extension-agnostic FileIO functions (`loadYaml`, `saveYaml`) instead of extension-aware ones (`loadYamlFromPath`, `saveYamlToPath`).

## Implementation

### Step 1: Add `deleteYaml` to FileIO

**File:** `backend/src/0_infrastructure/utils/FileIO.mjs`

Add function:
```javascript
/**
 * Delete a YAML file (tries both .yml and .yaml)
 * @param {string} basePath - Path without extension
 * @returns {boolean} True if any file was deleted
 */
export function deleteYaml(basePath) {
  const ymlDeleted = deleteFile(`${basePath}.yml`);
  const yamlDeleted = deleteFile(`${basePath}.yaml`);
  return ymlDeleted || yamlDeleted;
}
```

### Step 2: Refactor Adapters

**Affected files (10 total):**
1. `YamlNutriListStore.mjs`
2. `YamlFinanceStore.mjs`
3. `YamlConversationStore.mjs`
4. `YamlFoodLogStore.mjs`
5. `YamlGratitudeStore.mjs`
6. `YamlNutriCoachStore.mjs`
7. `YamlWatchStateStore.mjs`
8. `YamlSessionStore.mjs`
9. `YamlJournalStore.mjs`
10. `YamlWeatherStore.mjs`

**Pattern for each adapter:**

| Change | Before | After |
|--------|--------|-------|
| Imports | `loadYamlFromPath, saveYamlToPath, resolveYamlPath` | `loadYaml, loadYamlSafe, saveYaml, deleteYaml` |
| Path builders | `path.join(..., 'file.yml')` | `path.join(..., 'file')` |
| Read | `basePath.replace(/\.yml$/, ''); resolveYamlPath(); loadYamlFromPath()` | `loadYamlSafe(basePath)` |
| Write | `saveYamlToPath(path)` | `saveYaml(basePath, data)` |
| Delete | `deleteFile(basePath + '.yml'); deleteFile(basePath + '.yaml')` | `deleteYaml(basePath)` |

### Step 3: Execution Order

1. `FileIO.mjs` - add `deleteYaml` helper
2. `YamlNutriListStore.mjs` - validate pattern works
3. Remaining 9 adapters

## Verification

After each adapter change, verify no regressions by:
- Running existing tests
- Manual smoke test of affected functionality

## Files NOT affected (clean)

These only mention `.yml` in doc comments:
- `YamlMessageQueueRepository.mjs`
- `YamlJournalEntryRepository.mjs`
- `YamlHealthStore.mjs`
