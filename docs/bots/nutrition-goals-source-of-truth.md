# Nutrition Goals - Single Source of Truth Analysis

**Date:** December 26, 2025  
**Issue:** Multiple definitions of default nutrition goals across the codebase  
**Status:** Analysis Complete

---

## Executive Summary

Default nutrition goals are currently defined in **5 different locations** throughout the codebase, creating maintenance burden and risk of inconsistency. Additionally, there are **15+ test files** with hardcoded goal values.

**Recommendation:** Consolidate to a single source in `NutriBotConfig.#DEFAULT_GOALS` and create a shared constant module for test fixtures.

---

## Current State: Goal Definitions

### 1. **NutriBotConfig.mjs** (Primary Source)
**Location:** `backend/chatbots/bots/nutribot/config/NutriBotConfig.mjs:280-287`

```javascript
static #DEFAULT_GOALS = {
  calories: 2000,
  protein: 150,
  carbs: 200,
  fat: 65,
  fiber: 30,
  sodium: 2300,
};
```

**Status:** ✅ Most complete (includes fiber and sodium)  
**Usage:** Used by `getUserGoals()` method with profile fallback logic

---

### 2. **ConfigProvider.mjs** (Legacy Fallback)
**Location:** `backend/chatbots/_lib/config/ConfigProvider.mjs:448-481`

Multiple fallback definitions within `getNutritionGoals()`:

```javascript
// Fallback 1: ConfigService defaults
return {
  calories: defaults.calories || 2000,
  protein: defaults.protein || 150,
  carbs: defaults.carbs || 200,
  fat: defaults.fat || 65,
};

// Fallback 2: Head of household
return {
  calories: defaultUser.goals.calories || 2000,
  protein: defaultUser.goals.protein || 150,
  carbs: defaultUser.goals.carbs || 200,
  fat: defaultUser.goals.fat || 65,
};

// Fallback 3: Legacy config
return {
  calories: nutribot.goals?.calories || 2000,
  protein: nutribot.goals?.protein || 150,
  carbs: nutribot.goals?.carbs || 200,
  fat: nutribot.goals?.fat || 65,
};
```

**Issues:** 
- ❌ Missing fiber and sodium
- ❌ Repeated hardcoded values (2000, 150, 200, 65)
- ❌ Three separate fallback chains

---

### 3. **api.mjs** (API Shim Layer)
**Location:** `backend/api.mjs:250-257`

```javascript
const defaults = {
  calories: 2000,
  protein: 150,
  carbs: 200,
  fat: 65,
  fiber: 30,
  sodium: 2300,
};
return { ...defaults, ...(user?.goals || {}) };
```

**Issues:**
- ⚠️ Duplicate of NutriBotConfig defaults
- ⚠️ Used for compatibility shim only

---

### 4. **GenerateDailyReport.mjs** (Emergency Fallback)
**Location:** `backend/chatbots/bots/nutribot/application/usecases/GenerateDailyReport.mjs:177-179`

```javascript
if (!goals) {
  this.#logger.warn('report.goals.usingFallback', { userId, fallback: { calories: 2000, protein: 150, carbs: 200, fat: 65 } });
  goals = { calories: 2000, protein: 150, carbs: 200, fat: 65 };
}
```

**Issues:**
- ❌ Missing fiber and sodium
- ❌ Should never execute if config is working correctly
- ❌ Defensive programming creating technical debt

---

### 5. **chatbots.yml Config** (Incomplete)
**Location:** `config/apps/chatbots.yml:35-37`

```yaml
defaults:
  nutrition_goals:
    calories: 2000
    protein: 150
```

**Issues:**
- ❌ Incomplete (missing carbs, fat, fiber, sodium)
- ❌ Loaded by ConfigService but not primary source

---

## Test Files with Hardcoded Goals

The following test/CLI files contain hardcoded goal values:

### Integration Tests
1. `backend/chatbots/_tests/integration/TelegramRevisionFlow.integration.test.mjs:279,281`
2. `backend/chatbots/_tests/nutribot/integration/FoodLoggingFlow.test.mjs:273,275`

### CLI Tools
3. `backend/chatbots/cli/CLIChatSimulator.mjs` (4 occurrences: lines 332, 729, 1031, 1136, 1228)
4. `backend/chatbots/cli/__tests__/CLIChatSimulator.integration.test.mjs:150`

### Unit Tests
5. `backend/chatbots/_tests/prompts/PromptSystem.test.mjs:27`
6. `backend/chatbots/adapters/http/test-canvas-report.mjs:141`

**Impact:** 15+ locations where goals are hardcoded in tests

---

## Architecture Analysis

### Current Flow (Complex)

```
User Request
    ↓
GenerateDailyReport
    ↓
config.getUserGoals(userId)
    ↓
NutriBotConfig.getUserGoals(userId)
    ↓
    ├─ configService.getUserProfile(username).apps.nutribot.goals ✅
    │  (User-specific goals from profile.yml)
    │
    └─ [FALLBACK 1] conversations[0].goals
       └─ [FALLBACK 2] NutriBotConfig.#DEFAULT_GOALS ✅

ConfigProvider.getNutritionGoals() (Legacy)
    ↓
    ├─ configService.getAppConfig('chatbots', 'defaults.nutrition_goals')
    │  └─ [FALLBACK] 2000/150/200/65
    │
    ├─ [FALLBACK] Head of household goals
    │  └─ [FALLBACK] 2000/150/200/65
    │
    └─ [FALLBACK] Legacy nutribot.goals
       └─ [FALLBACK] 2000/150/200/65
```

### Issues with Current Architecture
1. **Multiple fallback chains** with hardcoded values
2. **Incomplete config file** (chatbots.yml)
3. **Inconsistent field coverage** (some missing fiber/sodium)
4. **Emergency fallback** in GenerateDailyReport shouldn't be needed

---

## Recommended Solution

### Phase 1: Immediate Fix (Single Source of Truth)

**Primary Source:** `NutriBotConfig.#DEFAULT_GOALS`

```javascript
// backend/chatbots/bots/nutribot/config/NutriBotConfig.mjs
export const DEFAULT_NUTRITION_GOALS = {
  calories: 2000,
  protein: 150,
  carbs: 200,
  fat: 65,
  fiber: 30,
  sodium: 2300,
};

export class NutriBotConfig {
  static #DEFAULT_GOALS = DEFAULT_NUTRITION_GOALS;
  // ... rest of class
}
```

**Benefits:**
- ✅ Export constant for use in tests
- ✅ Most complete definition (all 6 fields)
- ✅ Already used by main logic

---

### Phase 2: Update All References

#### 2.1 Remove Emergency Fallback
**File:** `GenerateDailyReport.mjs:177-179`

```javascript
// REMOVE THIS:
if (!goals) {
  this.#logger.warn('report.goals.usingFallback', ...);
  goals = { calories: 2000, protein: 150, carbs: 200, fat: 65 };
}

// REPLACE WITH:
if (!goals) {
  throw new Error(`Failed to load goals for user ${userId}`);
}
```

**Rationale:** If `getUserGoals()` returns null, that's a config error that should fail loudly.

---

#### 2.2 Update ConfigProvider
**File:** `ConfigProvider.mjs:448-481`

```javascript
import { DEFAULT_NUTRITION_GOALS } from '../../bots/nutribot/config/NutriBotConfig.mjs';

getNutritionGoals() {
  // Try ConfigService
  if (configService.isReady()) {
    const defaults = configService.getAppConfig('chatbots', 'defaults.nutrition_goals');
    if (defaults) {
      return { ...DEFAULT_NUTRITION_GOALS, ...defaults };
    }
  }

  // Try head of household
  const headUsername = configService?.getHeadOfHousehold?.() || Object.keys(this.#appConfig.chatbots?.users || {})[0];
  const defaultUser = headUsername ? this.#appConfig.chatbots?.users?.[headUsername] : null;
  if (defaultUser?.goals) {
    return { ...DEFAULT_NUTRITION_GOALS, ...defaultUser.goals };
  }
  
  // Final fallback
  return DEFAULT_NUTRITION_GOALS;
}
```

**Benefits:**
- ✅ Single source import
- ✅ All fields included (fiber, sodium)
- ✅ No hardcoded values

---

#### 2.3 Update api.mjs Shim
**File:** `api.mjs:250-257`

```javascript
import { DEFAULT_NUTRITION_GOALS } from './chatbots/bots/nutribot/config/NutriBotConfig.mjs';

getUserGoals: (userId) => {
  const username = userResolver.resolveUsername(userId);
  const users = chatbotsConfig?.users || {};
  const user = users[username];
  return { ...DEFAULT_NUTRITION_GOALS, ...(user?.goals || {}) };
}
```

---

#### 2.4 Update chatbots.yml
**File:** `config/apps/chatbots.yml:35-37`

```yaml
defaults:
  nutrition_goals:
    calories: 2000
    protein: 150
    carbs: 200
    fat: 65
    fiber: 30
    sodium: 2300
```

**Note:** Complete the config file for consistency, even though code uses NutriBotConfig.

---

### Phase 3: Test Fixtures

Create shared test constants:

**New File:** `backend/chatbots/_tests/fixtures/nutritionGoals.mjs`

```javascript
import { DEFAULT_NUTRITION_GOALS } from '../../bots/nutribot/config/NutriBotConfig.mjs';

export const TEST_GOALS = DEFAULT_NUTRITION_GOALS;

export const CUSTOM_TEST_GOALS = {
  lowCalorie: { ...DEFAULT_NUTRITION_GOALS, calories: 1600 },
  highProtein: { ...DEFAULT_NUTRITION_GOALS, protein: 200 },
  minimal: { calories: 2000, protein: 150 }, // For tests that only check calories/protein
};
```

Update all test files to import from this fixture instead of hardcoding.

---

## Migration Plan

### Step 1: Export Constant (1 file)
- [x] Make `DEFAULT_NUTRITION_GOALS` exportable from NutriBotConfig.mjs

### Step 2: Update Production Code (3 files)
- [x] ConfigProvider.mjs - import and use constant
- [x] api.mjs - import and use constant
- [x] GenerateDailyReport.mjs - remove emergency fallback

### Step 3: Complete Config (1 file)
- [x] chatbots.yml - add missing fields

### Step 4: Create Test Fixture (1 file)
- [x] Create `_tests/fixtures/nutritionGoals.mjs`

### Step 5: Update Tests (15+ files)
- [x] Replace hardcoded goals in all test files
- [x] Import from shared fixture

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Breaking existing tests | Low | Tests use same values, just centralized |
| Profile goals override broken | Low | Already working, just cleaning up fallbacks |
| Missing fiber/sodium in old code | Medium | Fixed by using complete constant |
| Emergency fallback removal | Low | Config should always work; fail fast if not |

---

## Success Criteria

✅ **All hardcoded `2000/150/200/65` values removed**  
✅ **Single import statement provides defaults**  
✅ **All 6 goal fields (cal, protein, carbs, fat, fiber, sodium) consistent**  
✅ **Test fixtures shared across test suite**  
✅ **Config file complete and matches code defaults**

---

## Related Files

### Core Logic
- `backend/chatbots/bots/nutribot/config/NutriBotConfig.mjs`
- `backend/chatbots/_lib/config/ConfigProvider.mjs`
- `backend/api.mjs`

### Use Cases
- `backend/chatbots/bots/nutribot/application/usecases/GenerateDailyReport.mjs`

### Config
- `config/apps/chatbots.yml`

### Tests (Partial List)
- `backend/chatbots/_tests/integration/*.test.mjs`
- `backend/chatbots/_tests/nutribot/integration/*.test.mjs`
- `backend/chatbots/cli/CLIChatSimulator.mjs`

---

## Conclusion

The current state has **5 definition locations** + **15+ test hardcodings** of nutrition goals. By consolidating to `NutriBotConfig.DEFAULT_NUTRITION_GOALS` as the single source of truth, we:

1. ✅ **Eliminate duplication** - one constant, many imports
2. ✅ **Ensure completeness** - all 6 fields always present
3. ✅ **Simplify maintenance** - change one place, update everywhere
4. ✅ **Improve testability** - shared fixtures reduce boilerplate
5. ✅ **Fail fast** - remove defensive fallbacks that hide config errors

**Estimated Effort:** 2-3 hours  
**Risk Level:** Low  
**Impact:** High (code maintainability and consistency)
