# Bug Report: Nutribot YAML File Extension Mismatch

**Date:** 2026-01-25  
**Severity:** High  
**Module:** `YamlNutriListStore` (backend/src/2_adapters/persistence/yaml/)  
**Status:** ✅ Remediated  

---

## Executive Summary

A file path handling bug in the Nutribot persistence layer caused nutrition data files to be written without the `.yml` extension, while the read operations expected files with the extension. This resulted in data appearing to be "lost" - it was written to disk but couldn't be found when generating reports.

---

## Bug Description

### Symptoms
- Daily nutrition reports showed 0 calories and 0 items despite food being logged
- The Telegram bot user (`telegram:b6898194425_c575596036`) had no readable nutrition history
- Primary user (`kckern`) was partially affected but had legacy data that masked the issue

### Root Cause

The `YamlNutriListStore` class had an asymmetry between its read and write operations:

| Operation | Path Used | Result |
|-----------|-----------|--------|
| **Write** (`#writeFile`) | `lifelog/nutrition/nutrilist` | Creates file named `nutrilist` (no extension) |
| **Read** (`#readFile`) | Uses `resolveYamlPath()` which appends `.yml` | Looks for `nutrilist.yml` (not found) |

**Code before fix:**
```javascript
#writeFile(filePath, data) {
  ensureDir(path.dirname(filePath));
  saveYamlToPath(filePath, data);  // ❌ Writes to path as-is
}
```

The `#getPath()` method returns paths without the `.yml` extension (e.g., `lifelog/nutrition/nutrilist`), expecting the I/O functions to normalize. However, `#writeFile` passed the path directly to `saveYamlToPath`, which wrote files without extensions.

**FileIO Design:**

The `FileIO.mjs` module provides paired read/write functions for YAML:
- `loadYamlSafe(basePath)` → calls `resolveYamlPath()` which tries `.yml` then `.yaml`
- `saveYaml(basePath, data)` → automatically appends `.yml` if no extension

The bug occurred because `#writeFile` was calling `saveYamlToPath` (which writes to exact path) instead of `saveYaml` (which normalizes extension). This broke the symmetry with `#readFile` which uses `loadYamlSafe`.

### Affected Files
- `nutrilist` (should be `nutrilist.yml`) - Food item storage
- `nutriday` (should be `nutriday.yml`) - Daily summary cache

---

## Impact Analysis

### Data Affected

| User | Files Affected | Data Status |
|------|---------------|-------------|
| `telegram:b6898194425_c575596036` | `nutrilist`, `nutriday` | ✅ Recovered |
| `kckern` | Empty folders created | ✅ Cleaned up |

### Scope
- **New users**: All data written since bug introduction was unreadable
- **Existing users**: Legacy `.yml` files continued to work; new writes created duplicate extension-less files

### User Experience Impact
- Users saw "0 cal" reports despite logging food
- Report generation completed without errors (no crash), masking the issue

---

## Remediation

### Code Fix

**Commit:** `5417c6a269d7b9a96c0da0d5468f6461668063cc`
**File:** `backend/src/2_adapters/persistence/yaml/YamlNutriListStore.mjs`

```javascript
// BEFORE (buggy)
import { loadYamlFromPath, saveYamlToPath, resolveYamlPath } from '../../../0_infrastructure/utils/FileIO.mjs';

#writeFile(filePath, data) {
  ensureDir(path.dirname(filePath));
  saveYamlToPath(filePath, data);  // Writes path as-is, no extension normalization
}

// AFTER (fixed)
import { loadYamlSafe, saveYaml } from '../../../0_infrastructure/utils/FileIO.mjs';

#writeFile(basePath, data) {
  ensureDir(path.dirname(basePath));
  saveYaml(basePath, data);  // saveYaml handles extension normalization via FileIO
}
```

**Why this works:** The `saveYaml` function in `FileIO.mjs` normalizes file paths before writing, ensuring the `.yml` extension is present. By switching from `saveYamlToPath` (which writes to the exact path given) to `saveYaml` (which normalizes extensions), the write operations now correctly create files with the `.yml` extension that the read operations expect.

### Data Remediation

The following manual corrections were applied:

```bash
# Telegram user - rename files to add extension
cd data/users/telegram:b6898194425_c575596036/lifelog/nutrition
mv nutrilist nutrilist.yml
mv nutriday nutriday.yml

# Primary user - remove bogus empty folders
cd data/users/kckern/lifelog/nutrition
rm -rf nutrilist nutriday
```

### Verification

Post-fix directory structure:

```
# Correct (telegram user)
data/users/telegram:*/lifelog/nutrition/
├── nutriday.yml   ✅
└── nutrilist.yml  ✅

# Correct (primary user)  
data/users/kckern/lifelog/nutrition/
├── nutriday.yml   ✅
├── nutrilist.yml  ✅
└── nutrilog.yml   ✅
```

---

## Prevention Measures

### Immediate
- [x] Code fix deployed
- [x] Affected user data corrected

### Recommended Follow-ups

1. **Unit Test Coverage**: Add tests that verify file extensions are correctly applied:
   ```javascript
   test('writeFile should ensure .yml extension', async () => {
     await store.saveMany([testItem]);
     expect(fs.existsSync('path/to/nutrilist.yml')).toBe(true);
     expect(fs.existsSync('path/to/nutrilist')).toBe(false);
   });
   ```

2. **Audit Similar Stores**: Review `YamlFoodLogStore`, `YamlNutriCoachStore`, and `YamlConversationStateStore` for similar patterns. (Initial review: `YamlFoodLogStore` includes `.yml` in `#getPath()`, so it's not affected.)

3. **Defensive Reading**: Consider updating `#readFile` to also check for extension-less files as a fallback, to auto-recover future similar issues.

---

## Timeline

| Time | Event |
|------|-------|
| Unknown | Bug introduced (likely during DDD refactor) |
| 2026-01-25 15:49 | User reports 0-calorie report issue |
| 2026-01-25 15:55 | Root cause identified via file system inspection |
| 2026-01-25 15:57 | Code fix applied |
| 2026-01-25 15:57 | Data remediation completed |

---

## Appendix: Diagnostic Evidence

### Before Fix
```
# Wrong user path - files without extension
data/users/telegram:*/lifelog/nutrition/
├── nutriday      # File, no extension ❌
└── nutrilist     # File, no extension ❌
```

### Dev Log Snippet
```json
{"event":"logText.complete","data":{"itemCount":1,"logUuid":"9PmEfXQQBX"}}
// Data was saved but to wrong filename
```

### Report Output (before fix)
```
Sun, Jan 25, 2026
0 cal (0% of goal)
```

---

**Report Prepared By:** Claude
**Reviewed By:** Claude Opus 4.5
**Date:** 2026-01-25
