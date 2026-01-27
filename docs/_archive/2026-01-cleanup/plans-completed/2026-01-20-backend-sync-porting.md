# Backend Sync Porting Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port meaningful changes from synced _legacy files to the refactored backend/src structure.

**Architecture:** The backend has been refactored into a clean architecture with domains (1_domains), adapters (2_adapters), applications (3_applications), and API layer (4_api). Changes synced from main to _legacy need to be evaluated and ported where a corresponding src/ implementation exists.

**Tech Stack:** Node.js ESM, Express routers, YAML persistence, Plex API

---

## Triage: Changes to Port

| _legacy File | Change Summary | src/ Target | Action |
|--------------|----------------|-------------|--------|
| `lib/plex.mjs` | Show-level labels for episodes | `2_adapters/content/media/plex/PlexAdapter.mjs` | **PORT** |
| `lib/health.mjs` | Removed Garmin integration | `1_domains/health/` | **PORT** |
| `lib/strava.mjs` | OAuth refresh improvements | `2_adapters/harvester/` | **REVIEW** |
| `routers/fitness.mjs` | Simulation API endpoints | `4_api/routers/` | **DEFER** (new feature) |
| `lib/homeassistant.mjs` | Sampled logging fix | `2_adapters/home-automation/` | **PORT** |
| `lib/logging/*` | Logger utils | `0_infrastructure/logging/` | **REVIEW** |
| `lib/cron/TaskRegistry.mjs` | Cron registry updates | `2_adapters/scheduling/` | **REVIEW** |
| `chatbots/nutribot/*` | Usecase updates | `1_domains/nutrition/` | **DEFER** |
| `lib/io.mjs` | IO utility changes | Core infrastructure | **SKIP** (shared) |
| `lib/fitsync.mjs` | FitSync changes | N/A | **SKIP** (legacy only) |
| `lib/garmin.mjs` | Garmin removal | N/A | **VERIFY REMOVED** |
| `lib/withings.mjs` | Withings updates | N/A | **SKIP** (no src adapter) |
| `lib/thermalprint.mjs` | Printer updates | `2_adapters/hardware/` | **SKIP** (no src adapter) |
| `routers/harvest.mjs` | Harvester router | `4_api/routers/` | **REVIEW** |
| `routers/cron.mjs` | Cron router | `4_api/routers/` | **REVIEW** |
| `routers/exe.mjs` | Exe router | `4_api/routers/` | **SKIP** |
| `routers/fetch.mjs` | Fetch router | `4_api/routers/` | **SKIP** |

---

## Task 1: Port Plex Show-Level Labels

**Files:**
- Modify: `backend/src/2_adapters/content/media/plex/PlexAdapter.mjs:712-760`

**Context:** When loading episode metadata, also fetch the parent show's labels (governance labels are typically on the show, not individual episodes).

**Step 1: Read current getContainerInfo implementation**

Review `PlexAdapter.mjs` lines 712-760 to understand current label handling.

**Step 2: Add show-level label fetching**

In `getMetadata()` method (around line 127), after extracting item labels, add logic to fetch show-level labels for episodes:

```javascript
// After line 744 where labels are extracted:

// For episodes, also fetch show-level labels (governance labels are typically on the show)
let allLabels = [...labels];
if (item.type === 'episode' && item.grandparentRatingKey) {
  try {
    const showMeta = await this.getMetadata(item.grandparentRatingKey);
    if (showMeta?.labels && Array.isArray(showMeta.labels)) {
      allLabels = [...new Set([...allLabels, ...showMeta.labels])];
    }
  } catch (err) {
    // Silently continue if show metadata fails
  }
}
// Then use allLabels instead of labels in the return object
```

**Step 3: Test manually**

```bash
# Start backend and test via API
curl http://localhost:3119/api/content/plex:12345 | jq '.labels'
```

**Step 4: Commit**

```bash
git add backend/src/2_adapters/content/media/plex/PlexAdapter.mjs
git commit -m "feat(plex): fetch show-level labels for episode metadata"
```

---

## Task 2: Port Garmin Removal from Health Domain

**Files:**
- Modify: `backend/src/1_domains/health/services/HealthService.mjs` (if exists)
- Modify: `backend/src/2_adapters/persistence/yaml/YamlHealthStore.mjs`

**Context:** Garmin integration has been removed from main. Ensure src/ health domain doesn't reference Garmin.

**Step 1: Search for Garmin references in src/**

```bash
grep -r "garmin\|Garmin" backend/src/
```

**Step 2: Remove any Garmin references found**

If any Garmin references exist, remove them to match the updated _legacy behavior.

**Step 3: Commit**

```bash
git add -A backend/src/
git commit -m "chore(health): remove Garmin integration references"
```

---

## Task 3: Port HomeAssistant Sampled Logging

**Files:**
- Modify: `backend/src/2_adapters/home-automation/HomeAssistantAdapter.mjs` (if exists)

**Context:** HA scene activation now uses sampled logging to reduce log spam.

**Step 1: Check if HomeAssistant adapter exists**

```bash
ls backend/src/2_adapters/home-automation/
```

**Step 2: If exists, add sampled logging**

Look for scene activation logging and change from regular log to sampled:

```javascript
// Before:
logger.debug('ha.scene.activated', { scene });

// After:
logger.sampled('ha.scene.activated', { scene }, { maxPerMinute: 2 });
```

**Step 3: Commit**

```bash
git add backend/src/2_adapters/home-automation/
git commit -m "fix(ha): use sampled logging for scene activation"
```

---

## Task 4: Review Strava OAuth Changes

**Files:**
- Review: `backend/_legacy/lib/strava.mjs`
- Check: `backend/src/2_adapters/harvester/` for Strava adapter

**Context:** OAuth token refresh logic was improved. Need to verify if src/ has a Strava adapter that needs updating.

**Step 1: Check for Strava adapter in src/**

```bash
find backend/src -name "*strava*" -o -name "*Strava*"
```

**Step 2: If exists, compare token refresh logic**

Review the diff in _legacy and port if applicable.

**Step 3: Commit if changes made**

```bash
git commit -m "feat(strava): improve OAuth token refresh handling"
```

---

## Task 5: Review Logging Infrastructure

**Files:**
- Review: `backend/_legacy/lib/logging/logger.js`
- Review: `backend/_legacy/lib/logging/utils.js`
- Check: `backend/src/0_infrastructure/logging/`

**Step 1: Compare logging implementations**

```bash
diff backend/_legacy/lib/logging/logger.js backend/src/0_infrastructure/logging/logger.js 2>/dev/null || echo "No src logger"
```

**Step 2: Port any meaningful changes**

Focus on bug fixes or new utility functions, not structural changes.

---

## Deferred Tasks

These require more design work or are new features:

1. **Fitness Simulation API** (`routers/fitness.mjs`) - New feature, needs design for where it fits in src/ structure
2. **Nutribot Usecases** - Chatbot domain not fully migrated to src/
3. **Cron/Harvest Routers** - Need to evaluate if src/ routing layer is ready

---

## Verification Checklist

After porting:

- [ ] `npm run lint` passes in backend/
- [ ] Backend starts without errors
- [ ] Plex episodes return show-level labels
- [ ] No Garmin references in src/
- [ ] HA logging is sampled

---

## Notes

- _legacy remains the running code (`backend/index.js` proxies to `_legacy/index.js`)
- src/ changes are preparation for future migration
- Don't break _legacy while porting to src/
