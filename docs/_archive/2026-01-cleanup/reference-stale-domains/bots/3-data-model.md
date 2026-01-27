# Lifelog Source Data Structures & Extraction Strategies

## Overview

This document catalogs every lifelog source file, its data structure, date field format, and extraction strategy for the Morning Debrief feature.

---

## Data Structure Analysis

### 1. GARMIN (`garmin.yml`) ⭐ PRIMARY HEALTH SOURCE

**Structure:** Date-keyed object with comprehensive daily health data  
**Priority:** HIGH - Best aggregated daily health data

```yaml
'2025-12-30':
  date: '2025-12-30'
  weight:
    lbs: 170
    fat_percent: 24.4
    lean_lbs: 128.5
    water_weight: 3.14
    trend: 0.07
  nutrition:
    calories: 1691
    protein: 100
    carbs: 227
    fat: 49
    food_count: 16
  steps:
    count: 74
    bmr: 798
    duration: 36.75
    calories: 0
    maxHr: 141
    avgHr: 113
  workouts:
    - source: strava+fitness
      title: Lunch Weight Training
      type: WeightTraining
      duration: 45.13
      calories: 255
      avgHr: 100.3
      maxHr: 156
  summary:
    total_workout_calories: 257
    total_workout_duration: 32.58
```

**Extraction Strategy:**
```javascript
export const garminExtractor = {
  source: 'garmin',
  category: 'health',
  filename: 'garmin',
  
  extractForDate(data, date) {
    const day = data?.[date];
    if (!day) return null;
    return {
      weight: day.weight,
      nutrition: day.nutrition,
      steps: day.steps,
      workouts: day.workouts || [],
      summary: day.summary
    };
  },

  summarize(entry) {
    if (!entry) return null;
    const lines = [];
    
    // Weight - full metrics
    if (entry.weight?.lbs) {
      lines.push(`WEIGHT: ${entry.weight.lbs}lbs, ${entry.weight.fat_percent}% body fat, ${entry.weight.lean_lbs}lbs lean mass`);
    }
    
    // Nutrition - full breakdown
    if (entry.nutrition?.calories) {
      lines.push(`NUTRITION: ${entry.nutrition.calories} calories consumed (${entry.nutrition.protein}g protein, ${entry.nutrition.carbs}g carbs, ${entry.nutrition.fat}g fat) from ${entry.nutrition.food_count} food entries`);
    }
    
    // Steps - full data
    if (entry.steps?.count) {
      lines.push(`STEPS: ${entry.steps.count} steps, avg HR ${entry.steps.avgHr}, max HR ${entry.steps.maxHr}`);
    }
    
    // Workouts - list ALL workouts with full details
    if (entry.workouts?.length) {
      lines.push(`WORKOUTS (${entry.workouts.length}):`);
      entry.workouts.forEach(w => {
        lines.push(`  - ${w.title}: ${Math.round(w.duration)} minutes, ${w.calories} calories burned, avg HR ${Math.round(w.avgHr)}, max HR ${w.maxHr}`);
      });
    }
    
    return lines.length ? lines.join('\n') : null;
  }
};
```

---

### 2. STRAVA (`strava.yml`) ⭐ WORKOUT DETAILS

**Structure:** Date-keyed object with array of activities  
**Priority:** HIGH - Detailed workout data with heart rate

```yaml
'2025-12-29':
  - id: 16877874026
    title: Lunch Weight Training
    type: WeightTraining
    startTime: 12:36 pm
    minutes: 45.13
    avgHeartrate: 100.3
    maxHeartrate: 156
    suffer_score: 9
    device_name: Garmin Forerunner 245 Music
```

**Extraction Strategy:**
```javascript
export const stravaExtractor = {
  source: 'strava',
  category: 'fitness',
  filename: 'strava',
  
  extractForDate(data, date) {
    const activities = data?.[date];
    if (!Array.isArray(activities) || !activities.length) return null;
    return activities.map(a => ({
      title: a.title,
      type: a.type,
      startTime: a.startTime,
      duration: Math.round(a.minutes),
      avgHR: Math.round(a.avgHeartrate),
      maxHR: a.maxHeartrate,
      sufferScore: a.suffer_score
    }));
  },

  summarize(entries) {
    if (!entries?.length) return null;
    const lines = [`STRAVA ACTIVITIES (${entries.length}):`];
    entries.forEach(e => {
      lines.push(`  - ${e.startTime}: ${e.title} (${e.type}) - ${e.duration} minutes, avg HR ${e.avgHR}, max HR ${e.maxHR}, suffer score ${e.sufferScore}`);
    });
    return lines.join('\n');
  }
};
```

---

### 3. FITNESS (`fitness.yml`)

**Structure:** Date-keyed object with steps and activities  
**Priority:** MEDIUM - May overlap with Garmin, use as fallback

```yaml
'2025-12-29':
  steps:
    steps_count: 148
    bmr: 1596
    duration: 73.5
    calories: 0
    maxHeartRate: 140
    avgHeartRate: 71
  activities:
    - title: Strength Training
      calories: 106
      distance: 0
      minutes: 41.78
      startTime: 06:01 am
      endTime: 06:42 am
      avgHeartrate: 77
```

**Extraction Strategy:**
```javascript
export const fitnessExtractor = {
  source: 'fitness',
  category: 'fitness',
  filename: 'fitness',
  
  extractForDate(data, date) {
    const day = data?.[date];
    if (!day) return null;
    return {
      steps: day.steps?.steps_count || 0,
      activities: (day.activities || []).map(a => ({
        title: a.title,
        startTime: a.startTime,
        endTime: a.endTime,
        duration: Math.round(a.minutes),
        calories: a.calories,
        avgHR: a.avgHeartrate
      }))
    };
  },

  summarize(entry) {
    if (!entry) return null;
    const lines = ['FITNESS DATA:'];
    if (entry.steps) lines.push(`  Steps: ${entry.steps}`);
    if (entry.activities?.length) {
      lines.push(`  Activities (${entry.activities.length}):`);
      entry.activities.forEach(a => {
        lines.push(`    - ${a.startTime}-${a.endTime}: ${a.title} - ${a.duration} minutes, ${a.calories} calories, avg HR ${a.avgHR}`);
      });
    }
    return lines.length > 1 ? lines.join('\n') : null;
  }
};
```

---

### 4. WEIGHT (`weight.yml`)

**Structure:** Date-keyed object with detailed weight metrics  
**Priority:** MEDIUM - Trends and averages

```yaml
'2025-12-30':
  time: 1767116144
  date: '2025-12-30'
  lbs: 170
  fat_lbs: 41.4
  fat_percent: 24.4
  lean_lbs: 128.5
  measurement: 170
  lbs_average: 171.31
  lbs_adjusted_average: 171.83
  lbs_adjusted_average_7day_trend: 0.07
  lbs_adjusted_average_14day_trend: 0.21
  calorie_balance: -105
  water_weight: 3.14
```

**Extraction Strategy:**
```javascript
export const weightExtractor = {
  source: 'weight',
  category: 'health',
  filename: 'weight',
  
  extractForDate(data, date) {
    const day = data?.[date];
    if (!day) return null;
    return {
      lbs: day.lbs,
      fatPercent: day.fat_percent,
      leanLbs: day.lean_lbs,
      trend7day: day.lbs_adjusted_average_7day_trend,
      trend14day: day.lbs_adjusted_average_14day_trend,
      calorieBalance: day.calorie_balance
    };
  },

  summarize(entry) {
    if (!entry) return null;
    const trend7 = entry.trend7day >= 0 ? `+${entry.trend7day}` : `${entry.trend7day}`;
    const trend14 = entry.trend14day >= 0 ? `+${entry.trend14day}` : `${entry.trend14day}`;
    return `WEIGHT METRICS:\n  Current: ${entry.lbs}lbs\n  Body fat: ${entry.fatPercent}%\n  Lean mass: ${entry.leanLbs}lbs\n  7-day trend: ${trend7}lbs\n  14-day trend: ${trend14}lbs\n  Calorie balance: ${entry.calorieBalance} calories`;
  }
};
```

---

### 5. EVENTS (`events.yml`) ⭐ CALENDAR

**Structure:** Array with ISO `start` datetime  
**Priority:** HIGH - What meetings/events happened

```yaml
- id: 6eh88r2gsfco9o1184ubip3mde_20251218T193000Z
  start: '2025-12-18T11:30:00-08:00'
  end: '2025-12-18T12:30:00-08:00'
  duration: 1
  summary: LDSPMA Third-Thursday Zoom Lunch
  type: calendar
  location: https://us02web.zoom.us/j/...
  calendarName: Family Calendar
  allday: false
```

**Extraction Strategy:**
```javascript
export const eventsExtractor = {
  source: 'events',
  category: 'calendar',
  filename: 'events',
  
  extractForDate(data, date) {
    if (!Array.isArray(data)) return null;
    const events = data.filter(e => {
      if (!e.start) return false;
      return moment(e.start).format('YYYY-MM-DD') === date;
    }).map(e => ({
      time: moment(e.start).format('h:mm A'),
      endTime: moment(e.end).format('h:mm A'),
      title: e.summary,
      duration: e.duration,
      location: e.location,
      calendar: e.calendarName,
      allDay: e.allday
    }));
    return events.length ? events : null;
  },

  summarize(entries) {
    if (!entries?.length) return null;
    const lines = [`CALENDAR EVENTS (${entries.length}):`];
    entries.forEach(e => {
      const duration = e.duration ? ` (${e.duration}h)` : '';
      const location = e.location ? ` at ${e.location}` : '';
      const calendar = e.calendar ? ` [${e.calendar}]` : '';
      lines.push(`  - ${e.time}-${e.endTime}: ${e.title}${duration}${location}${calendar}`);
    });
    return lines.join('\n');
  }
};
```

---

### 6. GITHUB (`github.yml`) ⭐ CODE ACTIVITY

**Structure:** Array with `date` string field  
**Priority:** HIGH - Development activity

```yaml
- id: e214e36af5ed424d801d11f18c71a1c74f28688a
  type: commit
  repo: kckern/DaylightStation
  sha: e214e36
  message: Remove unused variable declarations in backend libs
  fullMessage: |
    Remove unused variable declarations...
  createdAt: '2025-12-31T01:14:38Z'
  date: '2025-12-30'
  timestamp: 1767143678
  url: https://github.com/kckern/DaylightStation/commit/...
```

**Extraction Strategy:**
```javascript
export const githubExtractor = {
  source: 'github',
  category: 'work',
  filename: 'github',
  
  extractForDate(data, date) {
    if (!Array.isArray(data)) return null;
    const items = data.filter(e => e.date === date).map(e => ({
      type: e.type,
      repo: e.repo?.split('/')[1] || e.repo,  // Just repo name
      message: e.message,
      time: moment(e.createdAt).format('h:mm A'),
      url: e.url
    }));
    return items.length ? items : null;
  },

  summarize(entries) {
    if (!entries?.length) return null;
    const commits = entries.filter(e => e.type === 'commit');
    if (!commits.length) return null;
    const repos = [...new Set(commits.map(c => c.repo))];
    const lines = [`GITHUB COMMITS (${commits.length}) to ${repos.join(', ')}:`];
    commits.forEach(c => {
      lines.push(`  - ${c.time}: "${c.message}"`);
    });
    return lines.join('\n');
  }
};
```

---

### 7. CHECKINS (`checkins.yml`) ⭐ LOCATIONS

**Structure:** Array with `date` string field and `createdAt` ISO  
**Priority:** HIGH - Where you went

```yaml
- id: 69518f13cd81674690fa0ad1
  type: checkin
  createdAt: '2025-12-28T20:12:03.000Z'
  date: '2025-12-28'
  venue:
    id: 4e2c8304227197a112e50630
    name: The Church of Jesus Christ of Latter-day Saints
    category: Church
  location:
    address: 19714 106th Ave SE
    city: Renton
    state: WA
  shout: null
```

**Extraction Strategy:**
```javascript
export const checkinsExtractor = {
  source: 'checkins',
  category: 'locations',
  filename: 'checkins',
  
  extractForDate(data, date) {
    if (!Array.isArray(data)) return null;
    const items = data.filter(e => e.date === date).map(e => ({
      time: moment(e.createdAt).format('h:mm A'),
      venue: e.venue?.name,
      category: e.venue?.category,
      city: e.location?.city,
      shout: e.shout
    }));
    return items.length ? items : null;
  },

  summarize(entries) {
    if (!entries?.length) return null;
    const lines = [`LOCATION CHECK-INS (${entries.length}):`];
    entries.forEach(e => {
      const shout = e.shout ? ` - "${e.shout}"` : '';
      lines.push(`  - ${e.time}: ${e.venue} (${e.category}) in ${e.city}${shout}`);
    });
    return lines.join('\n');
  }
};
```

---

### 8. REDDIT (`reddit.yml`) ⭐ SOCIAL ACTIVITY

**Structure:** Array with `date` string field  
**Priority:** MEDIUM - Social/intellectual engagement

```yaml
- id: nw2v4s9
  type: comment
  subreddit: universe
  body: Rogue planets. Look it up, it's terrifying!
  url: https://reddit.com/r/universe/comments/.../nw2v4s9/
  score: 1
  linkTitle: What's in the space between galaxies?
  createdAt: '2025-12-26T20:30:54.000Z'
  date: '2025-12-26'
```

**Extraction Strategy:**
```javascript
export const redditExtractor = {
  source: 'reddit',
  category: 'social',
  filename: 'reddit',
  
  extractForDate(data, date) {
    if (!Array.isArray(data)) return null;
    const items = data.filter(e => e.date === date).map(e => ({
      type: e.type,
      subreddit: e.subreddit,
      body: e.body?.substring(0, 200),
      linkTitle: e.linkTitle,
      score: e.score,
      time: moment(e.createdAt).format('h:mm A')
    }));
    return items.length ? items : null;
  },

  summarize(entries) {
    if (!entries?.length) return null;
    const lines = [`REDDIT ACTIVITY (${entries.length}):`];
    entries.forEach(e => {
      const context = e.linkTitle ? ` on "${e.linkTitle}"` : '';
      lines.push(`  - ${e.time} in r/${e.subreddit}${context}:`);
      lines.push(`    "${e.body}"`);
    });
    return lines.join('\n');
  }
};
```

---

## Skipped Sources (No Date Data or Redundant)

### GMAIL (`gmail.yml`)
**Issue:** No date field in data structure. Cannot filter by date.
```yaml
- subject: Here is your login code!
  from: Foursquare <noreply@foursquare.com>
  to: kc@kckern.com
  snippet: Please use this code...
```
**Status:** SKIP - Need harvester update to include date field

---

### TODOIST (`todoist.yml`)
**Issue:** Only uncompleted tasks. No `completedAt` field.
```yaml
- id: '9106200118'
  content: Add Memos to Amazon Transactions
  isCompleted: false
  createdAt: '2025-04-27T00:16:11.892562Z'
```
**Status:** SKIP - Need harvester to track completed tasks

---

### CLICKUP (`clickup.yml`)
**Issue:** Task list only, no completion dates visible.
```yaml
- name: UI Improvements
  status: in progress
  date_created: '1764567191735'
```
**Status:** SKIP - Need to add `date_done` to harvester

---

### CALENDAR (`calendar.yml`)
**Issue:** Raw Google Calendar API format, redundant with `events.yml`
**Status:** SKIP - Use `events.yml` instead (cleaner format)

---

### WITHINGS (`withings.yml`) / HEALTH (`health.yml`)
**Issue:** Redundant with `weight.yml`
**Status:** SKIP - Use `weight.yml` instead (more metrics)

---

### ENTROPY (`entropy.yml`)
**Issue:** Recurring task/habit tracking, not daily activity
```yaml
- previous: '2022-11-25'
  category: Relationship
  days: 60
  task: Family Council
```
**Status:** SKIP - Not date-specific activity log

---

## Priority Implementation Order

### Tier 1: Must Have (Ship First)
| # | Source | Type | Date Field | Key Data |
|---|--------|------|------------|----------|
| 1 | **garmin** | Date-keyed | Key is date | Workouts, nutrition, steps, weight |
| 2 | **strava** | Date-keyed | Key is date | Detailed workouts with HR |
| 3 | **events** | Array | `start` ISO → format | Calendar events |
| 4 | **checkins** | Array | `date` string | Locations visited |
| 5 | **github** | Array | `date` string | Code commits |

### Tier 2: Nice to Have
| # | Source | Type | Date Field | Key Data |
|---|--------|------|------------|----------|
| 6 | **reddit** | Array | `date` string | Social engagement |
| 7 | **weight** | Date-keyed | Key is date | Weight trends |
| 8 | **fitness** | Date-keyed | Key is date | Steps (fallback) |

### Tier 3: Skip for MVP
| Source | Reason |
|--------|--------|
| gmail | No date field |
| todoist | No completion dates |
| clickup | No completion dates |
| calendar | Redundant |
| withings/health | Redundant |
| entropy | Not daily activity |

---

## File Structure

```
backend/lib/lifelog-extractors/
├── index.mjs           # Registry - exports all extractors
├── garmin.mjs          # Garmin extractor (health)
├── strava.mjs          # Strava extractor (fitness)
├── events.mjs          # Calendar extractor
├── checkins.mjs        # Foursquare/Swarm extractor (locations)
├── github.mjs          # GitHub extractor (work)
├── reddit.mjs          # Reddit extractor (social)
├── weight.mjs          # Weight extractor (health)
└── fitness.mjs         # Fitness sync extractor (fallback)
```

---

## Success Criteria

**Before (Broken):**
```
📦 Step 1: Aggregating lifelog data for 2025-12-29...
   ✓ Found 5 data sources  // LIE - no actual data extracted
   
🤖 AI Prompt: (empty)

📱 GENERATED SUMMARY:
   "It looks like you had a wonderfully balanced day..."  // GENERIC BS
```

**After (Working):**
```
📦 Step 1: Aggregating lifelog data for 2025-12-29...

WEIGHT METRICS:
  Current: 169.8lbs
  Body fat: 22.5%
  Lean mass: 131.6lbs
  7-day trend: +0.16lbs
  Calorie balance: -105 calories

NUTRITION: 1691 calories consumed (100g protein, 227g carbs, 49g fat) from 16 food entries

STRAVA ACTIVITIES (1):
  - 12:36 pm: Lunch Weight Training (WeightTraining) - 45 minutes, avg HR 100, max HR 156, suffer score 9

CALENDAR EVENTS (0): none

LOCATION CHECK-INS (0): none

GITHUB COMMITS (0): none

   Total: 2 sources with data

📱 GENERATED SUMMARY:
   "Yesterday you did a 45-minute Lunch Weight Training session at 12:36pm, 
    getting your heart rate up to an average of 100 bpm with a max of 156. 
    Strava gave it a suffer score of 9. Your nutrition was solid with 
    1,691 calories including 100g protein from 16 food entries. You're at 
    169.8 lbs with 22.5% body fat - trending up 0.16 lbs over the past week."
```

**Key Principle:** Summary = formatted & readable, NOT truncated. Every event, every commit, every checkin listed.

---

## Next Steps

1. Create `backend/lib/lifelog-extractors/` directory
2. Implement Tier 1 extractors (garmin, strava, events, checkins, github)
3. Create registry in `index.mjs`
4. Update `LifelogAggregator` to use extractors
5. Test with Dec 29 data
6. Verify AI gets real data in prompt
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
