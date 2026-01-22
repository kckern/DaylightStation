# Frontend API Migration to DDD Endpoints

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate all frontend DaylightAPI and DaylightMediaPath calls from legacy endpoints to v1/DDD endpoints.

**Architecture:** Update frontend consumers to use `/api/v1/*` endpoints instead of legacy paths (`/data/*`, `/media/*`, `/api/fitness`, etc.). The backend DDD endpoints already have parity with legacy - this is purely a frontend path update.

**Tech Stack:** React, JavaScript/JSX, DaylightAPI helper function

---

## Consumer Inventory

### Summary by Category

| Category | Legacy Pattern | DDD Pattern | Files | Status |
|----------|---------------|-------------|-------|--------|
| Fitness Config | `/api/fitness` | `/api/v1/fitness` | 4 | Ready |
| Fitness Zone LED | `api/fitness/zone_led` | `api/v1/fitness/zone_led` | 1 | Ready |
| Fitness Voice Memo | `api/fitness/voice_memo` | `api/v1/fitness/voice_memo` | 1 | Ready |
| Plex Info | `media/plex/info/:id` | `api/v1/content/plex/info/:id` | 2 | Ready |
| Plex List | `/media/plex/list/:id` | `/api/v1/content/plex/list/:id` | 5 | Partial |
| Plex Image | `media/plex/img/:id` | `api/v1/content/plex/image/:id` | 15+ | Ready |
| Plex URL | `media/plex/url/:id` | `api/v1/play/plex/mpd/:id` | 3 | Ready |
| Media Log | `media/log` | `api/v1/play/log` | 4 | Ready |
| Lists | `data/list/:key` | `api/v1/list/folder/:key` | 5 | Ready |
| Scripture | `data/scripture/:path` | `api/v1/local-content/scripture/:path` | 1 | Ready |
| Talk | `data/talk/:path` | `api/v1/local-content/talk/:path` | 1 | Ready |
| Poetry | `data/poetry/:path` | `api/v1/local-content/poem/:path` | 1 | Ready |
| Gratitude | `/api/gratitude/*` | `/api/v1/gratitude/*` | 2 | Ready |
| Health | `/api/health/*` | `/api/v1/health/*` | 3 | Ready |
| Lifelog | `/api/lifelog` | `/api/v1/lifelog` | 2 | Ready |
| Finance | `/data/budget/*` | `/api/v1/finance/*` | 1 | Ready |
| Home | `/home/*` | `/api/v1/home/*` | 3 | Ready |
| Static Images | `/media/img/*` | `/api/v1/static/img/*` | 25+ | Needs DDD |
| HA Script | `exe/ha/script/:id` | TBD | 2 | Needs DDD |
| Watchlist | `harvest/watchlist` | TBD | 1 | Needs DDD |
| Weather | `/data/weather` | TBD | 1 | Needs DDD |
| Events | `/data/events` | TBD | 1 | Needs DDD |
| Keyboard | `/data/keyboard/*` | TBD | 1 | Needs DDD |

---

## Task 1: Fitness Module Migration

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx`
- Modify: `frontend/src/modules/Fitness/FitnessMenu.jsx`
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/FitnessPluginMenu.jsx`
- Modify: `frontend/src/hooks/fitness/useZoneLedSync.js`
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder.js`

**Step 1: Update FitnessApp.jsx API calls**

```jsx
// Line 591: Change from
const response = await DaylightAPI(`media/plex/info/${episodeId}`);
// To
const response = await DaylightAPI(`api/v1/content/plex/info/${episodeId}`);

// Line 730: Change from
const response = await DaylightAPI('/api/fitness');
// To
const response = await DaylightAPI('/api/v1/fitness');
```

**Step 2: Update FitnessMenu.jsx API calls**

```jsx
// Line 126: Change from
const configResponse = await DaylightAPI('/api/fitness');
// To
const configResponse = await DaylightAPI('/api/v1/fitness');

// Line 183: Change from
const response = await DaylightAPI(`/media/plex/list/${collectionId}`);
// To
const response = await DaylightAPI(`/api/v1/content/plex/list/${collectionId}`);
```

**Step 3: Update FitnessPluginMenu.jsx**

```jsx
// Line 32: Change from
const config = await DaylightAPI('/api/fitness');
// To
const config = await DaylightAPI('/api/v1/fitness');
```

**Step 4: Update useZoneLedSync.js**

```jsx
// Line 92: Change from
DaylightAPI('api/fitness/zone_led', payload, 'POST')
// To
DaylightAPI('api/v1/fitness/zone_led', payload, 'POST')
```

**Step 5: Update useVoiceMemoRecorder.js**

```jsx
// Line 366: Change from
DaylightAPI('api/fitness/voice_memo', payload, 'POST')
// To
DaylightAPI('api/v1/fitness/voice_memo', payload, 'POST')
```

**Step 6: Test fitness app loads correctly**

Run: Open fitness app in browser, verify config loads, collections load, zone LED syncs

**Step 7: Commit**

```bash
git add frontend/src/Apps/FitnessApp.jsx frontend/src/modules/Fitness/FitnessMenu.jsx \
  frontend/src/modules/Fitness/FitnessPlugins/FitnessPluginMenu.jsx \
  frontend/src/hooks/fitness/useZoneLedSync.js \
  frontend/src/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder.js
git commit -m "refactor(fitness): migrate API calls to v1/DDD endpoints"
```

---

## Task 2: FitnessShow and Player Migration

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessShow.jsx`
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx`
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/FitnessMusicPlayer.jsx`

**Step 1: Update FitnessShow.jsx**

```jsx
// Line 248: Change from
const response = await DaylightAPI(`/media/plex/list/${showId}/playable`);
// To
const response = await DaylightAPI(`/api/v1/content/plex/list/${showId}/playable`);
```

**Step 2: Update FitnessPlayer.jsx**

```jsx
// Line 823: Change from
await DaylightAPI('media/log', {...});
// To
await DaylightAPI('api/v1/play/log', {...});
```

**Step 3: Update FitnessMusicPlayer.jsx**

```jsx
// Line 193: Change from
const response = await DaylightAPI(`/media/plex/list/${selectedPlaylistId}/playable,shuffle`);
// To
const response = await DaylightAPI(`/api/v1/content/plex/list/${selectedPlaylistId}/playable,shuffle`);
```

**Step 4: Test video and music playback**

Run: Play a fitness video, verify playback works and logs are sent

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessShow.jsx \
  frontend/src/modules/Fitness/FitnessPlayer.jsx \
  frontend/src/modules/Fitness/FitnessSidebar/FitnessMusicPlayer.jsx
git commit -m "refactor(fitness): migrate player API calls to v1/DDD endpoints"
```

---

## Task 3: Menu and List Migration

**Files:**
- Modify: `frontend/src/modules/Menu/Menu.jsx`
- Modify: `frontend/src/modules/Menu/PlexMenuRouter.jsx`
- Modify: `frontend/src/modules/Menu/hooks/useFetchPlexData.js`

**Step 1: Update Menu.jsx**

```jsx
// Line 27: Change from
await DaylightAPI("data/menu_log", { media_key: selectedKey });
// To
await DaylightAPI("api/v1/play/log", { media_key: selectedKey });

// Line 258: Check what endpoint is used and update accordingly
```

**Step 2: Update PlexMenuRouter.jsx**

```jsx
// Line 109: Change from
const data = await DaylightAPI(`data/list/${plexId}`);
// To
const data = await DaylightAPI(`api/v1/list/folder/${plexId}`);
```

**Step 3: Update useFetchPlexData.js**

```jsx
// Line 29: Change from
const response = await DaylightAPI(`media/plex/list/${plexId}`);
// To
const response = await DaylightAPI(`api/v1/content/plex/list/${plexId}`);
```

**Step 4: Test menu navigation**

Run: Navigate through TV app menus, verify lists load correctly

**Step 5: Commit**

```bash
git add frontend/src/modules/Menu/Menu.jsx \
  frontend/src/modules/Menu/PlexMenuRouter.jsx \
  frontend/src/modules/Menu/hooks/useFetchPlexData.js
git commit -m "refactor(menu): migrate API calls to v1/DDD endpoints"
```

---

## Task 4: Player Library Migration

**Files:**
- Modify: `frontend/src/modules/Player/lib/api.js`
- Modify: `frontend/src/modules/Player/hooks/useQueueController.js`
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js`
- Modify: `frontend/src/lib/Player/useMediaKeyboardHandler.js`

**Step 1: Update Player/lib/api.js**

```jsx
// Line 18: Change from
const { items: nestedItems } = await DaylightAPI(`data/list/${queueKey}/playable${shuffle ? ',shuffle' : ''}`);
// To
const { items: nestedItems } = await DaylightAPI(`api/v1/list/folder/${queueKey}/playable${shuffle ? ',shuffle' : ''}`);

// Line 22: Change from
const { items: plexItems } = await DaylightAPI(`media/plex/list/${item.queue.plex}/playable${shuffle ? ',shuffle' : ''}`);
// To
const { items: plexItems } = await DaylightAPI(`api/v1/content/plex/list/${item.queue.plex}/playable${shuffle ? ',shuffle' : ''}`);

// Lines 72, 76: Update plex info endpoints
// Line 99: Update list endpoint
```

**Step 2: Update useQueueController.js**

```jsx
// Line 96: Change from
const { items } = await DaylightAPI(`data/list/${queue_media_key}/playable${isShuffle ? ',shuffle' : ''}`);
// To
const { items } = await DaylightAPI(`api/v1/list/folder/${queue_media_key}/playable${isShuffle ? ',shuffle' : ''}`);

// Line 101: Change from
const { items } = await DaylightAPI(`media/plex/list/${plexId}/playable${isShuffle ? ',shuffle' : ''}`);
// To
const { items } = await DaylightAPI(`api/v1/content/plex/list/${plexId}/playable${isShuffle ? ',shuffle' : ''}`);
```

**Step 3: Update useCommonMediaController.js**

```jsx
// Line 763: Change from
await DaylightAPI(`media/log`, {...});
// To
await DaylightAPI(`api/v1/play/log`, {...});
```

**Step 4: Update useMediaKeyboardHandler.js**

```jsx
// Line 140: Change from
DaylightAPI('media/log', {...});
// To
DaylightAPI('api/v1/play/log', {...});

// Line 141: Change from
DaylightAPI('harvest/watchlist');
// To - NOTE: Need to check if DDD endpoint exists
DaylightAPI('api/v1/harvest/watchlist');
```

**Step 5: Test queue playback**

Run: Play a queue/playlist, verify tracks load and progress logs

**Step 6: Commit**

```bash
git add frontend/src/modules/Player/lib/api.js \
  frontend/src/modules/Player/hooks/useQueueController.js \
  frontend/src/modules/Player/hooks/useCommonMediaController.js \
  frontend/src/lib/Player/useMediaKeyboardHandler.js
git commit -m "refactor(player): migrate API calls to v1/DDD endpoints"
```

---

## Task 5: ContentScroller Migration

**Files:**
- Modify: `frontend/src/modules/ContentScroller/ContentScroller.jsx`

**Step 1: Update scripture endpoint**

```jsx
// Line 447: Change from
DaylightAPI(`data/scripture/${scripture}`)
// To
DaylightAPI(`api/v1/local-content/scripture/${scripture}`)
```

**Step 2: Update talk endpoint**

```jsx
// Line 777: Change from
DaylightAPI(`data/talk/${talk}`)
// To
DaylightAPI(`api/v1/local-content/talk/${talk}`)
```

**Step 3: Update poetry endpoint**

```jsx
// Line 911: Change from
DaylightAPI(`data/poetry/${poem_id}`)
// To
DaylightAPI(`api/v1/local-content/poem/${poem_id}`)
```

**Step 4: Update media log endpoint**

```jsx
// Line 151: Change from
await DaylightAPI(`media/log`, {...});
// To
await DaylightAPI(`api/v1/play/log`, {...});
```

**Step 5: Test content scroller**

Run: View scripture, talk, and poetry content in scroller

**Step 6: Commit**

```bash
git add frontend/src/modules/ContentScroller/ContentScroller.jsx
git commit -m "refactor(content-scroller): migrate API calls to v1/DDD endpoints"
```

---

## Task 6: Gratitude App Migration

**Files:**
- Modify: `frontend/src/modules/AppContainer/Apps/Gratitude/Gratitude.jsx`
- Modify: `frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx`

**Step 1: Update Gratitude.jsx**

```jsx
// Line 445: Change from
DaylightAPI(`/api/gratitude/selections/${itemCategory}`, {...}, 'POST')
// To
DaylightAPI(`/api/v1/gratitude/selections/${itemCategory}`, {...}, 'POST')

// Line 511: Change from
const response = await DaylightAPI(`/api/gratitude/selections/${category}`, {...}, 'POST');
// To
const response = await DaylightAPI(`/api/v1/gratitude/selections/${category}`, {...}, 'POST');

// Line 561: Change from
await DaylightAPI(`/api/gratitude/discarded/${category}`, {...}, 'POST');
// To
await DaylightAPI(`/api/v1/gratitude/discarded/${category}`, {...}, 'POST');

// Line 619: Change from
await DaylightAPI(`/api/gratitude/selections/${category}/${selection.id}`, {}, 'DELETE');
// To
await DaylightAPI(`/api/v1/gratitude/selections/${category}/${selection.id}`, {}, 'DELETE');

// Line 1011: Change from
const data = await DaylightAPI('/api/gratitude/bootstrap');
// To
const data = await DaylightAPI('/api/v1/gratitude/bootstrap');
```

**Step 2: Update FamilySelector.jsx**

```jsx
// Line 390: Change from
const data = await DaylightAPI('/api/gratitude/bootstrap');
// To
const data = await DaylightAPI('/api/v1/gratitude/bootstrap');
```

**Step 3: Test gratitude app**

Run: Open gratitude app, add/remove selections, verify persistence

**Step 4: Commit**

```bash
git add frontend/src/modules/AppContainer/Apps/Gratitude/Gratitude.jsx \
  frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx
git commit -m "refactor(gratitude): migrate API calls to v1/DDD endpoints"
```

---

## Task 7: Health Module Migration

**Files:**
- Modify: `frontend/src/Apps/HealthApp.jsx`
- Modify: `frontend/src/modules/Health/Health.jsx`
- Modify: `frontend/src/modules/Health/Nutrition.jsx`
- Modify: `frontend/src/modules/Health/NutritionDay.jsx`

**Step 1: Update HealthApp.jsx**

```jsx
// Line 17: Change from
const response = await DaylightAPI('/api/health/status');
// To
const response = await DaylightAPI('/api/v1/health/status');
```

**Step 2: Update Health.jsx**

```jsx
// Line 16: Change from
DaylightAPI('/data/lifelog/weight')
// To
DaylightAPI('/api/v1/lifelog/weight')
```

**Step 3: Update Nutrition.jsx**

```jsx
// Lines 46, 81, 261: Change from
DaylightAPI(`api/health/nutrilist/${date}`)
// To
DaylightAPI(`api/v1/health/nutrilist/${date}`)
```

**Step 4: Update NutritionDay.jsx**

```jsx
// Line 73: Change from
const response = await DaylightAPI(`health/nutrilist/${uuid}`, {}, 'DELETE');
// To
const response = await DaylightAPI(`api/v1/health/nutrilist/${uuid}`, {}, 'DELETE');

// Line 145: Change from
const response = await DaylightAPI(`health/nutrilist/${uuid}`, updateData, 'PUT');
// To
const response = await DaylightAPI(`api/v1/health/nutrilist/${uuid}`, updateData, 'PUT');
```

**Step 5: Test health app**

Run: Open health app, verify data loads, test nutrition tracking

**Step 6: Commit**

```bash
git add frontend/src/Apps/HealthApp.jsx \
  frontend/src/modules/Health/Health.jsx \
  frontend/src/modules/Health/Nutrition.jsx \
  frontend/src/modules/Health/NutritionDay.jsx
git commit -m "refactor(health): migrate API calls to v1/DDD endpoints"
```

---

## Task 8: Finance Module Migration

**Files:**
- Modify: `frontend/src/modules/Finance/Finance.jsx`

**Step 1: Update Finance.jsx**

```jsx
// Line 18: Change from
DaylightAPI('/data/budget/daytoday')
// To
DaylightAPI('/api/v1/finance/data/daytoday')
```

**Step 2: Test finance module**

Run: Open finance widget, verify budget data loads

**Step 3: Commit**

```bash
git add frontend/src/modules/Finance/Finance.jsx
git commit -m "refactor(finance): migrate API calls to v1/DDD endpoints"
```

---

## Task 9: TV App Migration

**Files:**
- Modify: `frontend/src/Apps/TVApp.jsx`

**Step 1: Update TVApp.jsx**

```jsx
// Line 70: Change from
const data = await DaylightAPI("data/list/TVApp/recent_on_top");
// To
const data = await DaylightAPI("api/v1/list/folder/TVApp/recent_on_top");
```

**Step 2: Test TV app**

Run: Open TV app, verify recent items list loads

**Step 3: Commit**

```bash
git add frontend/src/Apps/TVApp.jsx
git commit -m "refactor(tv): migrate API calls to v1/DDD endpoints"
```

---

## Task 10: Lifelog App Migration

**Files:**
- Modify: `frontend/src/Apps/LifelogApp.jsx`

**Step 1: Update LifelogApp.jsx**

```jsx
// Line 17: Change from
const response = await DaylightAPI('/api/lifelog');
// To
const response = await DaylightAPI('/api/v1/lifelog');
```

**Step 2: Test lifelog app**

Run: Open lifelog app, verify data loads

**Step 3: Commit**

```bash
git add frontend/src/Apps/LifelogApp.jsx
git commit -m "refactor(lifelog): migrate API calls to v1/DDD endpoints"
```

---

## Task 11: Home Automation Migration

**Files:**
- Modify: `frontend/src/modules/Entropy/EntropyPanel.jsx`
- Modify: `frontend/src/modules/Calendar/Calendar.jsx`
- Modify: `frontend/src/modules/Upcoming/Upcoming.jsx`

**Step 1: Update EntropyPanel.jsx**

```jsx
// Line 11: Change from
const data = await DaylightAPI('/home/entropy');
// To
const data = await DaylightAPI('/api/v1/home/entropy');
```

**Step 2: Update Calendar.jsx**

```jsx
// Line 7: Change from
DaylightAPI('/home/calendar')
// To
DaylightAPI('/api/v1/home/calendar')
```

**Step 3: Update Upcoming.jsx**

```jsx
// Line 39: Change from
DaylightAPI("/data/events")
// To
DaylightAPI("/api/v1/home/events")
```

**Step 4: Test home widgets**

Run: Verify entropy, calendar, and upcoming widgets load

**Step 5: Commit**

```bash
git add frontend/src/modules/Entropy/EntropyPanel.jsx \
  frontend/src/modules/Calendar/Calendar.jsx \
  frontend/src/modules/Upcoming/Upcoming.jsx
git commit -m "refactor(home): migrate API calls to v1/DDD endpoints"
```

---

## Task 12: Office App Migration

**Files:**
- Modify: `frontend/src/Apps/OfficeApp.jsx`
- Modify: `frontend/src/lib/OfficeApp/keyboardHandler.js`
- Modify: `frontend/src/modules/AppContainer/Apps/WrapUp/WrapUp.jsx`
- Modify: `frontend/src/modules/AppContainer/Apps/OfficeOff/OfficeOff.jsx`

**Step 1: Update OfficeApp.jsx**

```jsx
// Line 126: Change from
DaylightAPI('/data/keyboard/officekeypad')
// To
DaylightAPI('/api/v1/home/keyboard/officekeypad')

// Line 153: Change from
DaylightAPI('/data/weather')
// To
DaylightAPI('/api/v1/home/weather')
```

**Step 2: Update keyboardHandler.js**

```jsx
// Line 142: Check endpoint and update to v1 equivalent
```

**Step 3: Update WrapUp.jsx and OfficeOff.jsx**

```jsx
// These use exe/tv/off and exe/office_tv/off
// Need to verify DDD endpoints exist or create them
```

**Step 4: Test office app**

Run: Open office app, verify keyboard and weather load

**Step 5: Commit**

```bash
git add frontend/src/Apps/OfficeApp.jsx \
  frontend/src/lib/OfficeApp/keyboardHandler.js
git commit -m "refactor(office): migrate API calls to v1/DDD endpoints"
```

---

## Task 13: Piano Module Migration

**Files:**
- Modify: `frontend/src/modules/Piano/PianoVisualizer.jsx`

**Step 1: Update PianoVisualizer.jsx**

```jsx
// Line 44: Change from
const config = await DaylightAPI('data/households/default/apps/piano/config');
// To - NOTE: Need to create DDD endpoint or use config service
const config = await DaylightAPI('api/v1/apps/piano/config');

// Lines 49, 63: exe/ha/script endpoints need DDD equivalents
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Piano/PianoVisualizer.jsx
git commit -m "refactor(piano): migrate API calls to v1/DDD endpoints"
```

---

## Task 14: DaylightMediaPath Static Image Migration

**Files:** Multiple files using `/media/img/*` paths

This is a large task affecting 25+ files. The pattern is:
- Current: `DaylightMediaPath('/media/img/users/...')`
- Target: `DaylightMediaPath('/api/v1/static/img/users/...')`

**Step 1: Create static image serving endpoint in DDD if not exists**

Check: `backend/src/4_api/routers/` for static file serving

**Step 2: Update all DaylightMediaPath calls for images**

Use find-and-replace:
- `/media/img/` → `/api/v1/static/img/`

**Step 3: Test all user avatars and equipment images display**

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor(static): migrate image paths to v1/DDD endpoints"
```

---

## Task 15: Plex Proxy Migration

**Files:** Multiple files using `/plex_proxy/*` paths

**Step 1: Update FitnessPlayer.jsx plex_proxy calls**

```jsx
// Lines 45, 50: Change from
DaylightMediaPath(`/plex_proxy/photo/:/transcode?...`)
// To
DaylightMediaPath(`/api/v1/proxy/plex/photo?...`)
```

**Step 2: Verify DDD proxy endpoint handles these requests**

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayer.jsx
git commit -m "refactor(plex): migrate proxy paths to v1/DDD endpoints"
```

---

## Task 16: Debug Info Migration

**Files:**
- Modify: `frontend/src/modules/Player/components/DebugInfo.jsx`

**Step 1: Update DebugInfo.jsx**

```jsx
// Lines 31-34: Update all check functions to use v1 endpoints
const checkDaylightServer = () => checkUrlStatus(DaylightMediaPath('/api/v1/ping'));
const checkDaylightAPI    = () => checkUrlStatus(DaylightMediaPath('/api/v1/status'));
const checkMediaInfoURL   = (plexId) => checkUrlStatus(DaylightMediaPath(`/api/v1/content/plex/info/${plexId}`));
const checkMediaURL       = (plexId) => checkUrlStatus(DaylightMediaPath(`/api/v1/play/plex/mpd/${plexId}`));
```

**Step 2: Test debug panel**

**Step 3: Commit**

```bash
git add frontend/src/modules/Player/components/DebugInfo.jsx
git commit -m "refactor(debug): migrate API checks to v1/DDD endpoints"
```

---

## Gaps Identified (Need Backend Work)

These legacy endpoints need DDD equivalents before frontend can migrate:

| Legacy Endpoint | Proposed DDD | Used By |
|-----------------|--------------|---------|
| `exe/ha/script/:id` | `/api/v1/home/script/:id` | PianoVisualizer |
| `exe/tv/off` | `/api/v1/home/tv/off` | WrapUp |
| `exe/office_tv/off` | `/api/v1/home/office/tv/off` | OfficeOff |
| `harvest/watchlist` | `/api/v1/harvest/watchlist` | useMediaKeyboardHandler |
| `/data/weather` | `/api/v1/home/weather` | OfficeApp |
| `/data/events` | `/api/v1/home/events` | Upcoming |
| `/data/keyboard/:id` | `/api/v1/home/keyboard/:id` | OfficeApp |
| `data/households/default/apps/:app/config` | `/api/v1/apps/:app/config` | PianoVisualizer |
| `/media/img/*` (static) | `/api/v1/static/img/*` | 25+ files |
| `/plex_proxy/*` | `/api/v1/proxy/plex/*` | FitnessPlayer |

---

## Verification Checklist

After all tasks complete:

- [ ] Fitness app loads config and collections
- [ ] Video playback works with progress logging
- [ ] Music playback works
- [ ] Gratitude selections persist
- [ ] Health/nutrition data displays
- [ ] Finance budget loads
- [ ] TV app recent list loads
- [ ] Scripture/talk/poetry content displays
- [ ] All user avatars display
- [ ] All equipment images display
- [ ] Calendar and upcoming widgets load
- [ ] Debug panel checks work

---

## Related Documentation

- [API Endpoint Mapping](../reference/core/api-endpoint-mapping.md)
- [Parity Test Results](../_wip/audits/2026-01-21-parity-audit-results.md)
