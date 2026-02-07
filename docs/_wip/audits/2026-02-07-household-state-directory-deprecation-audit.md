# Household State Directory Deprecation Audit

**Date:** 2026-02-07  
**Status:** 🔴 CRITICAL - Active violations in production code  
**Scope:** References to deprecated `data/household/state/*` path structure

---

## Executive Summary

**✅ RESOLVED** - All deprecated `data/household/state/*` references have been migrated to the new architecture:

- `state/lists.yml` → Removed (lists now managed in `config/lists/` by ListAdapter)
- `state/nutribot/conversations/` → `users/{username}/conversations/nutribot/` (per-user storage)
- `state/journalist/conversations/` → `users/{username}/conversations/journalist/` (per-user storage)
- `state/homebot/conversations/` → `users/{username}/conversations/homebot/` (per-user storage)
- Infinity harvester: `state/` → `common/infinity/` (household-shared harvested data)

---

## Critical Production Code Violations

### 1. **app.mjs** - Watchlist Path Configuration
**File:** [backend/src/app.mjs](backend/src/app.mjs#L329)  
**Line:** 329  
**Severity:** 🔴 HIGH

```javascript
const watchlistPath = `${householdDir}/state/lists.yml`;
```

**Issue:** Still pointing to deprecated `state/lists.yml` instead of new `config/lists/` structure.

**Recommended Fix:**
```javascript
// Remove this line - watchlistPath should come from configService or use config/lists/ directly
// const watchlistPath = configService.getHouseholdPath('config/lists'); // if needed
```

**Impact:** Lists/watchlists functionality may be reading stale data or writing to deprecated location.

---

### 2. **app.mjs** - Bot Conversation Paths
**File:** [backend/src/app.mjs](backend/src/app.mjs#L924)  
**Lines:** 924, 963, 998  
**Severity:** 🔴 HIGH

```javascript
// Line 924
basePath: configService.getHouseholdPath('state/nutribot/conversations')

// Line 963
basePath: configService.getHouseholdPath('state/journalist/conversations')

// Line 998
basePath: configService.getHouseholdPath('state/homebot/conversations')
```

**Issue:** Bot conversation state still stored in deprecated `state/` directory.

**Recommended Fix:**
```javascript
// Option A: Move to common/ (if household-shared data)
basePath: configService.getHouseholdPath('common/nutribot/conversations')
basePath: configService.getHouseholdPath('common/journalist/conversations')
basePath: configService.getHouseholdPath('common/homebot/conversations')

// Option B: Move to conversations/ at household root (cleaner)
basePath: configService.getHouseholdPath('conversations/nutribot')
basePath: configService.getHouseholdPath('conversations/journalist')
basePath: configService.getHouseholdPath('conversations/homebot')
```

**Impact:** Bot conversation history stored in deprecated location; may conflict with new directory structure.

---

### 3. **InfinityHarvester.mjs** - State File Writing
**File:** [backend/src/1_adapters/harvester/other/InfinityHarvester.mjs](backend/src/1_adapters/harvester/other/InfinityHarvester.mjs#L182)  
**Lines:** 179-182  
**Severity:** 🔴 HIGH

```javascript
// Save to household state file (Infinity data is household-level, not user-level)
// This matches legacy behavior: saveFile('state/lists') -> household/state/lists
if (this.#io?.householdSaveFile) {
  await this.#io.householdSaveFile(`state/${this.#tableKey}`, finalItems);
}
```

**Issue:** InfinityHarvester still writing to `state/` directory for harvested data.

**Recommended Fix:**
```javascript
// Option A: Write to config/lists/ if this is list data
if (this.#io?.householdSaveFile && this.#tableKey === 'lists') {
  // Migrate to config/lists/ structure or deprecate Infinity harvesting
  await this.#io.householdSaveFile(`config/harvested/${this.#tableKey}`, finalItems);
}

// Option B: Stop harvesting lists entirely (if manually managed now)
// Remove this code block if Infinity harvesting is deprecated
```

**Impact:** Infinity harvester continues populating deprecated directory; may overwrite or conflict with new config structure.

---

### 4. **UserDataService.mjs** - Directory Structure Creation
**File:** [backend/src/0_system/config/UserDataService.mjs](backend/src/0_system/config/UserDataService.mjs#L393)  
**Lines:** 393-399  
**Severity:** 🔴 HIGH

```javascript
const subdirs = [
  '',                        // household root
  'common',                  // common data stores
  'common/gratitude',        // gratitude bank/options
  'state',                   // runtime state data
  'state/nutribot/conversations',  // nutribot conversation state
  'state/journalist/conversations', // journalist conversation state
  'state/homebot/conversations',   // homebot conversation state
  // Note: apps/ directory removed - configs now in config/, state in state/, finances in common/
];
```

**Issue:** `ensureHouseholdDirectoryStructure()` still creates deprecated `state/` subdirectories.

**Recommended Fix:**
```javascript
const subdirs = [
  '',                        // household root
  'common',                  // common data stores
  'common/gratitude',        // gratitude bank/options
  'conversations/nutribot',  // nutribot conversation state
  'conversations/journalist', // journalist conversation state
  'conversations/homebot',   // homebot conversation state
  'config',                  // configuration (lists, watchlists, etc.)
  'config/lists',            // list definitions
];
```

**Impact:** New household directories created with deprecated structure; perpetuates technical debt.

---

### 5. **UserDataService.mjs** - Legacy Compatibility Methods
**File:** [backend/src/0_system/config/UserDataService.mjs](backend/src/0_system/config/UserDataService.mjs#L413)  
**Lines:** 413, 427  
**Severity:** 🟡 MEDIUM

```javascript
/**
 * Get a direct path within a household directory (no 'common/' prefix)
 * Used for legacy compatibility with saveFile('state/lists') pattern
 */
getHouseholdDataPath(householdId, ...segments) { ... }

/**
 * Save data file directly to household directory (matches legacy io.householdSaveFile)
 * Used for Infinity harvester state files like 'state/lists.yml'
 */
saveHouseholdData(householdId, dataPath, data) { ... }
```

**Issue:** Methods explicitly designed to support deprecated `state/` pattern.

**Recommended Fix:**
- Add deprecation warnings when paths contain `state/`
- Update method documentation to reflect new patterns
- Consider adding path translation layer (state/* → new location)

**Impact:** Methods enable continued use of deprecated patterns; should be phased out.

---

## Test Infrastructure Violations

### 6. **testServer.mjs** - Test Watchlist Path
**File:** [tests/_lib/api-test-utils/testServer.mjs](tests/_lib/api-test-utils/testServer.mjs#L105)  
**Line:** 105  
**Severity:** 🟡 MEDIUM

```javascript
const watchlistPath = path.join(householdDir, 'state', 'lists.yml');
```

**Recommended Fix:**
```javascript
// Option A: Use config/lists/ directory
const watchlistDir = path.join(householdDir, 'config', 'lists');

// Option B: Remove if not needed (depend on ConfigService)
// const watchlistPath = configService.getHouseholdPath('config/lists');
```

---

### 7. **fixture-loader.mjs** - Hardcoded Lists Path
**File:** [tests/_lib/fixture-loader.mjs](tests/_lib/fixture-loader.mjs#L9)  
**Line:** 9  
**Severity:** 🟡 MEDIUM

```javascript
const LISTS_PATH = path.join(DATA_PATH, 'household/state/lists.yml');
```

**Recommended Fix:**
```javascript
// Load from new config/lists/ structure or make configurable
const LISTS_DIR = path.join(DATA_PATH, 'household/config/lists');
```

---

### 8. **setup-household-demo.mjs** - Demo Directory Structure
**File:** [tests/_infrastructure/generators/setup-household-demo.mjs](tests/_infrastructure/generators/setup-household-demo.mjs#L214)  
**Line:** 214  
**Severity:** 🟡 MEDIUM

```javascript
ensureDir(path.join(OUTPUT_DIR, 'state/nutribot/conversations'));
```

**Recommended Fix:**
```javascript
ensureDir(path.join(OUTPUT_DIR, 'conversations/nutribot'));
ensureDir(path.join(OUTPUT_DIR, 'conversations/journalist'));
ensureDir(path.join(OUTPUT_DIR, 'conversations/homebot'));
```

---

## Migration Script (Expected References)

### 9. **migrate-lists-to-watchlists.mjs**
**File:** [scripts/migrate-lists-to-watchlists.mjs](scripts/migrate-lists-to-watchlists.mjs)  
**Lines:** 3, 235, 250, 358  
**Severity:** ✅ ACCEPTABLE

This script's purpose is to migrate from the old structure, so references are intentional. No action needed.

---

## Documentation Violations

### Stale Documentation References

**Active WIP Plans:**
- `docs/_wip/plans/2026-02-01-admin-app-design.md` (lines 11, 636, 656, 805, 886, 907)
- `docs/_wip/plans/2026-02-01-admin-app-implementation.md` (lines 2071, 2230, 2247)
- `docs/_wip/audits/2026-02-06-apps-to-config-directory-restructure-audit.md` (lines 163, 229-231)

**Recommendation:** Update or archive these documents to reflect current architecture.

**Archived Documentation:**
- Multiple references in `docs/_archive/` - acceptable as historical context

---

## Recommended Migration Path

### Phase 1: Stop Creating Deprecated Directories (Immediate)
1. Update `UserDataService.ensureHouseholdDirectoryStructure()` to use new paths
2. Update test infrastructure to use new paths
3. Add deprecation warnings when deprecated paths are accessed

### Phase 2: Migrate Active Data (Within 1 Week)
1. Migrate bot conversations: `state/*/conversations/` → `conversations/*/`
2. Stop InfinityHarvester from writing to `state/lists.yml` OR migrate to `config/harvested/`
3. Update app.mjs to use new paths

### Phase 3: Remove Legacy Compatibility (Within 2 Weeks)
1. Remove `getHouseholdDataPath()` and `saveHouseholdData()` state/ support
2. Remove all references to deprecated paths
3. Add prevention: Throw errors if `state/` paths are accessed

### Phase 4: Data Directory Cleanup (Manual)
1. Move existing production data from `state/` to new locations
2. Archive old `state/` directories
3. Update runbooks with new path structure

---

## Migration Checklist

- [ ] Update UserDataService directory structure creation
- [ ] Migrate bot conversation paths in app.mjs (3 locations)
- [ ] Update or remove watchlistPath in app.mjs
- [ ] Update InfinityHarvester target path or remove harvesting
- [ ] Update test infrastructure (3 files)
- [ ] Add deprecation warnings for state/ path access
- [ ] Update runbook documentation
- [ ] Migrate production data (manual step)
- [ ] Remove legacy compatibility methods
- [ ] Add validation to prevent future state/ usage

---

## Resolution Summary

**Date:** 2026-02-07  
**Status:** ✅ RESOLVED

### Changes Implemented

1. **Bot Conversation State** → Per-user storage
   - Changed from `household/state/{bot}/conversations/` to `users/{username}/conversations/{bot}/`
   - Updated `YamlConversationStateDatastore` to use UserDataService + UserResolver
   - Each bot's state now isolated per-user, not shared at household level

2. **Telegram conversationId** → Use platform user ID
   - Updated `TelegramWebhookParser.#buildConversationId()` to accept `fromId` parameter
   - Now uses `from.id` (user ID) instead of `chat.id` for all message types
   - Ensures per-user state even in group chats

3. **Watchlist Path** → Removed
   - Deleted `watchlistPath` from app.mjs (line 329, 361)
   - Lists now managed exclusively in `config/lists/` by ListAdapter
   - No longer needs legacy `state/lists.yml` path

4. **Infinity Harvester** → Moved to `common/infinity/`
   - Changed from `state/{tableKey}` to `common/infinity/{tableKey}`
   - Infinity-harvested data treated as household-shared common data
   - Example: `common/infinity/lists.yml`, `common/infinity/watchlist.yml`

5. **UserDataService Directory Structure** → Updated
   - Removed: `state/`, `state/nutribot/conversations/`, `state/journalist/conversations/`, `state/homebot/conversations/`
   - Added: `common/infinity/`, `config/`, `config/lists/`, `history/`
   - Deprecated methods: `getHouseholdDataPath()`, `saveHouseholdData()`

6. **Test Infrastructure** → Fixed
   - `testServer.mjs`: Removed `watchlistPath`
   - `fixture-loader.mjs`: Changed `LISTS_PATH` to `LISTS_DIR`
   - `setup-household-demo.mjs`: Updated directory structure and file paths

### New Directory Structure

```
data/
├── household/
│   ├── common/
│   │   ├── gratitude/
│   │   └── infinity/          # Infinity-harvested data
│   ├── config/
│   │   └── lists/             # List definitions
│   ├── history/               # Time-series data
│   └── users/
│       └── {username}/
│           ├── lifelog/
│           └── conversations/  # Per-user bot conversations
│               ├── nutribot/
│               ├── journalist/
│               └── homebot/
```

### Breaking Changes

- **ConversationId format changed**: `telegram:{botId}_{userId}` now uses user ID instead of chat ID
- **State files relocated**: Existing bot conversation state in `state/` will not be automatically migrated
- **UserDataService paths**: Code using `state/` paths will need updating

### Migration Notes

- Production data should be manually migrated from old paths to new structure
- Existing conversation state files will be orphaned in `state/` directory
- Consider running data migration script before deploying to production

---

## Related Work

- **Migration Script:** [scripts/migrate-lists-to-watchlists.mjs](scripts/migrate-lists-to-watchlists.mjs)
- **Related Audit:** [2026-02-06-apps-to-config-directory-restructure-audit.md](2026-02-06-apps-to-config-directory-restructure-audit.md)
- **Planning Docs:** `docs/_wip/plans/2026-02-01-admin-app-*.md`

---

## Notes

- The `state/` directory was deprecated to clarify separation of concerns:
  - **config/** = User-editable configuration (lists, watchlists, menus)
  - **common/** = Household-shared data (finances, gratitude)
  - **history/** = Time-series data (watch history, sessions)
  - **conversations/** = Bot conversation state (new location for chat history)
  - **users/** = User-specific data (lifelogs, auth tokens)

- Current `state/` usage mixes configuration (lists.yml) with runtime state (bot conversations), which should be in separate directories.

- InfinityHarvester may need special consideration - determine if Infinity integration is still active or should be deprecated entirely.
