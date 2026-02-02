# Field Naming Standardization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Standardize all field naming to camelCase, remove legacy snake_case aliases, remove `toJSON()` from domain entities, and have adapters resolve thumbnails before constructing domain objects.

**Architecture:** Domain layer becomes pure (no serialization knowledge). Adapters resolve "best available" thumbnails before constructing entities. API layer shapes responses directly from entity properties. Frontend consumes clean camelCase fields.

**Tech Stack:** Node.js/Express backend, React frontend, DDD architecture

---

## Summary of Changes

### Renames (snake_case → camelCase)
| Current | New |
|---------|-----|
| `media_url` | `mediaUrl` |
| `media_key` | `assetId` |
| `thumb_id` | `thumbId` |
| `skip_after` | `skipAfter` |
| `wait_until` | `waitUntil` |
| `folder_color` | `folderColor` |

### Removals
- `toJSON()` methods from domain entities (Playable, Listable, MediaProgress, ItemId)
- Plex hierarchy fields from metadata: `seasonThumbUrl`, `showThumbUrl`, `parentThumb`, `grandparentThumb`
- Snake_case aliases from API responses

### Adapter Changes
- PlexAdapter resolves best thumbnail at construction time
- All adapters use camelCase for all fields

---

## Task 1: Update Item.mjs - Rename media_key to assetId

**Files:**
- Modify: `backend/src/2_domains/content/entities/Item.mjs:25,55,123-124`

**Step 1: Update JSDoc**

Change line 25 from:
```javascript
 * @property {string} [media_key] - Optional override for media key (defaults to id)
```
to:
```javascript
 * @property {string} [assetId] - Optional override for asset identifier (defaults to id)
```

**Step 2: Update constructor**

Change line 55 from:
```javascript
    this._media_key = props.media_key ?? null;
```
to:
```javascript
    this._assetId = props.assetId ?? null;
```

**Step 3: Update getter**

Change lines 123-124 from:
```javascript
  get media_key() {
    return this._media_key ?? this.id;
  }
```
to:
```javascript
  get assetId() {
    return this._assetId ?? this.id;
  }
```

**Step 4: Run tests**

Run: `npm test -- --grep "Item"`
Expected: Tests should fail if they reference `media_key`

**Step 5: Commit**

```bash
git add backend/src/2_domains/content/entities/Item.mjs
git commit -m "refactor(domain): rename media_key to assetId in Item entity

Breaking change: Item.media_key is now Item.assetId

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Remove toJSON() from Playable.mjs

**Files:**
- Modify: `backend/src/2_domains/content/capabilities/Playable.mjs:93-106`

**Step 1: Delete toJSON method**

Remove lines 93-106 entirely:
```javascript
  /**
   * Custom JSON serialization with snake_case aliases for legacy compatibility
   */
  toJSON() {
    return {
      ...this,
      // Legacy field aliases for frontend compatibility
      media_url: this.mediaUrl,
      media_type: this.mediaType,
      media_key: this.media_key,
      image: this.thumbnail,
      // Alias resumePosition as seconds for AudioPlayer
      seconds: this.resumePosition ?? 0
    };
  }
```

**Step 2: Run tests**

Run: `npm test -- --grep "Playable"`
Expected: Tests may fail if they expect snake_case fields

**Step 3: Commit**

```bash
git add backend/src/2_domains/content/capabilities/Playable.mjs
git commit -m "refactor(domain): remove toJSON from PlayableItem

Domain entities should not know about serialization. API layer
will shape responses directly from entity properties.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Remove toJSON() from Listable.mjs

**Files:**
- Modify: `backend/src/2_domains/content/capabilities/Listable.mjs:45-56`

**Step 1: Delete toJSON method**

Remove lines 45-56:
```javascript
  /**
   * Serialize to JSON with 'items' instead of 'children' for frontend compatibility
   */
  toJSON() {
    const obj = { ...this };
    // Rename children to items for frontend compatibility
    if (obj.children) {
      obj.items = obj.children;
      delete obj.children;
    }
    return obj;
  }
```

**Step 2: Commit**

```bash
git add backend/src/2_domains/content/capabilities/Listable.mjs
git commit -m "refactor(domain): remove toJSON from ListableItem

API layer will rename children→items when shaping responses.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Remove toJSON() from MediaProgress.mjs

**Files:**
- Modify: `backend/src/2_domains/content/entities/MediaProgress.mjs:59-72`

**Step 1: Delete toJSON method**

Remove lines 59-72:
```javascript
  /**
   * Convert to plain object for persistence
   * @returns {Object}
   */
  toJSON() {
    return {
      itemId: this.itemId,
      playhead: this.playhead,
      duration: this.duration,
      percent: this.percent,
      playCount: this.playCount,
      lastPlayed: this.lastPlayed,
      watchTime: this.watchTime
    };
  }
```

**Step 2: Commit**

```bash
git add backend/src/2_domains/content/entities/MediaProgress.mjs
git commit -m "refactor(domain): remove toJSON from MediaProgress

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Keep toJSON() in ItemId.mjs (it's valid)

**Note:** ItemId.toJSON() returns `this.toString()` which is a valid value object pattern. Value objects can define their serialization format. **No changes needed.**

---

## Task 6: Update QueueService.mjs - Rename skip_after/wait_until

**Files:**
- Modify: `backend/src/2_domains/content/services/QueueService.mjs:29,34,89-153`

**Step 1: Update constants comments**

Change line 29 from:
```javascript
 * Number of days before skip_after to mark as urgent
```
to:
```javascript
 * Number of days before skipAfter to mark as urgent
```

Change line 34 from:
```javascript
 * Number of days to look ahead for wait_until filtering
```
to:
```javascript
 * Number of days to look ahead for waitUntil filtering
```

**Step 2: Update filterBySkipAfter method**

Change JSDoc and code (lines 88-105):
```javascript
  /**
   * Filter items that are past their skipAfter deadline.
   * Items without skipAfter are always included.
   *
   * @param {Array} items - Items with optional skipAfter field
   * @param {Date} now - Current date (required, from application layer)
   * @returns {Array} Filtered items (new array, original unchanged)
   */
  static filterBySkipAfter(items, now) {
    if (!now || !(now instanceof Date)) {
      throw new Error('now date required for filterBySkipAfter');
    }
    return items.filter(item => {
      if (!item.skipAfter) return true;
      const deadline = new Date(item.skipAfter);
      return deadline >= now;
    });
  }
```

**Step 3: Update applyUrgency method**

Change JSDoc and code (lines 107-130):
```javascript
  /**
   * Mark items as urgent if skipAfter is within URGENCY_DAYS.
   * Does not upgrade in_progress items (they already have top priority).
   *
   * @param {Array} items - Items with optional skipAfter and priority fields
   * @param {Date} now - Current date (required, from application layer)
   * @returns {Array} Items with updated priority (new array, original unchanged)
   */
  static applyUrgency(items, now) {
    if (!now || !(now instanceof Date)) {
      throw new Error('now date required for applyUrgency');
    }
    const urgencyThreshold = new Date(now);
    urgencyThreshold.setDate(urgencyThreshold.getDate() + URGENCY_DAYS);

    return items.map(item => {
      if (!item.skipAfter) return item;
      const deadline = new Date(item.skipAfter);
      if (deadline <= urgencyThreshold && item.priority !== 'in_progress') {
        return { ...item, priority: 'urgent' };
      }
      return item;
    });
  }
```

**Step 4: Update filterByWaitUntil method**

Change JSDoc and code (lines 132-153):
```javascript
  /**
   * Filter items that have waitUntil more than WAIT_LOOKAHEAD_DAYS in future.
   * Items without waitUntil are always included.
   * Items with waitUntil in the past or within lookahead window are included.
   *
   * @param {Array} items - Items with optional waitUntil field
   * @param {Date} now - Current date (required, from application layer)
   * @returns {Array} Filtered items (new array, original unchanged)
   */
  static filterByWaitUntil(items, now) {
    if (!now || !(now instanceof Date)) {
      throw new Error('now date required for filterByWaitUntil');
    }
    const lookaheadDate = new Date(now);
    lookaheadDate.setDate(lookaheadDate.getDate() + WAIT_LOOKAHEAD_DAYS);

    return items.filter(item => {
      if (!item.waitUntil) return true;
      const waitDate = new Date(item.waitUntil);
      return waitDate <= lookaheadDate;
    });
  }
```

**Step 5: Run tests**

Run: `npm test -- --grep "QueueService"`
Expected: Tests should fail - update test assertions to use camelCase

**Step 6: Commit**

```bash
git add backend/src/2_domains/content/services/QueueService.mjs
git commit -m "refactor(domain): rename skip_after/wait_until to camelCase in QueueService

- skip_after → skipAfter
- wait_until → waitUntil

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Update PlexAdapter - Resolve thumbnails, remove hierarchy fields

**Files:**
- Modify: `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs:453,479-491,508`

**Step 1: Rename thumb_id to thumbId**

Change line 453 from:
```javascript
      thumb_id: item.Media?.[0]?.Part?.[0]?.id ?? parseInt(item.ratingKey, 10),
```
to:
```javascript
      thumbId: item.Media?.[0]?.Part?.[0]?.id ?? parseInt(item.ratingKey, 10),
```

**Step 2: Remove hierarchy thumbnail fields from metadata**

Remove lines 479-491 (the entire block that adds seasonThumbUrl, parentThumb, showThumbUrl, grandparentThumb):
```javascript
      if (item.parentThumb) {
        metadata.seasonThumbUrl = `${this.proxyPath}${item.parentThumb}`;
        metadata.parentThumb = `${this.proxyPath}${item.parentThumb}`;
      }
      // Show (grandparent) info
      if (item.grandparentRatingKey) {
        metadata.showId = item.grandparentRatingKey;
        metadata.grandparent = item.grandparentRatingKey;
      }
      if (item.grandparentThumb) {
        metadata.showThumbUrl = `${this.proxyPath}${item.grandparentThumb}`;
        metadata.grandparentThumb = `${this.proxyPath}${item.grandparentThumb}`;
      }
```

Keep only:
```javascript
      // Show (grandparent) info
      if (item.grandparentRatingKey) {
        metadata.showId = item.grandparentRatingKey;
        metadata.grandparent = item.grandparentRatingKey;
      }
```

**Step 3: Update thumbnail resolution to use fallback chain**

Change line 508 from:
```javascript
    const thumbnail = item.thumb ? `${this.proxyPath}${item.thumb}` : null;
```
to:
```javascript
    // Resolve best available thumbnail (item → season → show)
    const thumbPath = item.thumb || item.parentThumb || item.grandparentThumb;
    const thumbnail = thumbPath ? `${this.proxyPath}${thumbPath}` : null;
```

**Step 4: Run tests**

Run: `npm test -- --grep "PlexAdapter"`
Expected: Tests may fail if they expect hierarchy fields

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/media/plex/PlexAdapter.mjs
git commit -m "refactor(adapter): resolve thumbnails at construction, remove hierarchy fields

PlexAdapter now:
- Resolves best thumbnail (item→season→show) before domain construction
- Removes seasonThumbUrl, showThumbUrl, parentThumb, grandparentThumb from metadata
- Renames thumb_id → thumbId

Domain no longer knows about Plex hierarchy concepts.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Update FolderAdapter - Rename snake_case fields

**Files:**
- Modify: `backend/src/1_adapters/content/folder/FolderAdapter.mjs:156-196,362-376,388-390`

**Step 1: Update urgency check (lines 156-158)**

Change from:
```javascript
    if (item.skip_after) {
      const skipDate = new Date(item.skip_after);
```
to:
```javascript
    if (item.skipAfter) {
      const skipDate = new Date(item.skipAfter);
```

**Step 2: Update skip filter (lines 188-196)**

Change from:
```javascript
    if (meta.skip_after) {
      const skipDate = new Date(meta.skip_after);
      if (skipDate < now) return false;
    }
    // Skip if wait_until is more than 2 days away
    if (meta.wait_until) {
      const waitDate = new Date(meta.wait_until);
```
to:
```javascript
    if (meta.skipAfter) {
      const skipDate = new Date(meta.skipAfter);
      if (skipDate < now) return false;
    }
    // Skip if waitUntil is more than 2 days away
    if (meta.waitUntil) {
      const waitDate = new Date(meta.waitUntil);
```

**Step 3: Update metadata construction (lines 362-376)**

Change from:
```javascript
          skip_after: item.skip_after || null,
          wait_until: item.wait_until || null,
          ...
          media_key: mediaKey,
          ...
          folder_color: item.folder_color || null
```
to:
```javascript
          skipAfter: item.skipAfter || null,
          waitUntil: item.waitUntil || null,
          ...
          assetId: mediaKey,
          ...
          folderColor: item.folderColor || null
```

**Step 4: Update fixed order check (lines 388-390)**

Change from:
```javascript
    const hasFixedOrder = children.some(item => item.metadata?.folder_color);
```
to:
```javascript
    const hasFixedOrder = children.some(item => item.metadata?.folderColor);
```

**Step 5: Update line 264**

Change from:
```javascript
      const mediaKey = item.media_key || parsed.id;
```
to:
```javascript
      const mediaKey = item.assetId || parsed.id;
```

**Step 6: Run tests**

Run: `npm test -- --grep "FolderAdapter"`

**Step 7: Commit**

```bash
git add backend/src/1_adapters/content/folder/FolderAdapter.mjs
git commit -m "refactor(adapter): rename snake_case fields to camelCase in FolderAdapter

- skip_after → skipAfter
- wait_until → waitUntil
- media_key → assetId
- folder_color → folderColor

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Update API list.mjs - Remove hierarchy field flattening

**Files:**
- Modify: `backend/src/4_api/v1/routers/list.mjs:119-176,188-189,426,443`

**Step 1: Remove hierarchy fields from destructuring (lines 119-127)**

Change from:
```javascript
    const {
      key, seasonId, seasonName, seasonNumber, seasonThumbUrl,
      episodeNumber, index, summary, tagline, studio, thumb_id, type,
      ...
      parent, parentTitle, parentIndex, parentThumb,
      ...
      showId, grandparent, showThumbUrl, grandparentThumb,
```
to:
```javascript
    const {
      key, seasonId, seasonName, seasonNumber,
      episodeNumber, index, summary, tagline, studio, thumbId, type,
      ...
      parent, parentTitle, parentIndex,
      ...
      showId, grandparent,
```

**Step 2: Remove hierarchy field assignments (lines 146, 171, 175-176)**

Remove these lines:
```javascript
    if (seasonThumbUrl !== undefined) base.seasonThumbUrl = seasonThumbUrl;
    ...
    if (parentThumb !== undefined) base.parentThumb = parentThumb;
    ...
    if (showThumbUrl !== undefined) base.showThumbUrl = showThumbUrl;
    if (grandparentThumb !== undefined) base.grandparentThumb = grandparentThumb;
```

**Step 3: Update thumb_id to thumbId (line 155)**

Change from:
```javascript
    if (thumb_id !== undefined) base.thumb_id = thumb_id;
```
to:
```javascript
    if (thumbId !== undefined) base.thumbId = thumbId;
```

**Step 4: Update skip_after/wait_until (lines 188-189)**

Change from:
```javascript
    if (skip_after !== undefined) base.skip_after = skip_after;
    if (wait_until !== undefined) base.wait_until = wait_until;
```
to:
```javascript
    if (skipAfter !== undefined) base.skipAfter = skipAfter;
    if (waitUntil !== undefined) base.waitUntil = waitUntil;
```

**Step 5: Update folder_color (around line 200)**

Change from:
```javascript
    if (folder_color !== undefined) base.folder_color = folder_color;
```
to:
```javascript
    if (folderColor !== undefined) base.folderColor = folderColor;
```

**Step 6: Update seasons map fallback chain (line 426)**

Change from:
```javascript
              img: item.metadata?.seasonThumbUrl || item.metadata?.parentThumb || item.metadata?.showThumbUrl || item.metadata?.grandparentThumb
```
to:
```javascript
              img: item.thumbnail
```

**Step 7: Update media_key (line 443)**

Change from:
```javascript
        media_key: localId,
```
to:
```javascript
        assetId: localId,
```

**Step 8: Commit**

```bash
git add backend/src/4_api/v1/routers/list.mjs
git commit -m "refactor(api): update list router to camelCase, remove hierarchy fields

- thumb_id → thumbId
- skip_after → skipAfter
- wait_until → waitUntil
- folder_color → folderColor
- media_key → assetId
- Removed seasonThumbUrl, showThumbUrl, parentThumb, grandparentThumb
- Seasons map now uses resolved item.thumbnail

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 10: Update API fitness.mjs - Remove hierarchy fallback

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs:196`

**Step 1: Update fallback chain**

Change from:
```javascript
              img: item.metadata?.seasonThumbUrl || item.metadata?.parentThumb || item.metadata?.showThumbUrl || item.metadata?.grandparentThumb
```
to:
```javascript
              img: item.thumbnail
```

**Step 2: Commit**

```bash
git add backend/src/4_api/v1/routers/fitness.mjs
git commit -m "refactor(api): use resolved thumbnail in fitness router

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 11: Update API item.mjs - Remove hierarchy fallback

**Files:**
- Modify: `backend/src/4_api/v1/routers/item.mjs:203`

**Step 1: Update fallback chain**

Change from:
```javascript
              img: childItem.metadata?.seasonThumbUrl || childItem.metadata?.parentThumb || childItem.metadata?.showThumbUrl || childItem.metadata?.grandparentThumb
```
to:
```javascript
              img: childItem.thumbnail
```

**Step 2: Commit**

```bash
git add backend/src/4_api/v1/routers/item.mjs
git commit -m "refactor(api): use resolved thumbnail in item router

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 12: Update Frontend - FitnessApp.jsx

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx:638,654-655`

**Step 1: Update thumb_id references**

Change line 638 from:
```javascript
          thumb_id: episodeId,
```
to:
```javascript
          thumbId: episodeId,
```

Change lines 654-655 from:
```javascript
        videoUrl: response.media_url || DaylightMediaPath(`api/v1/play/plex/mpd/${episodeId}`),
        thumb_id: response.thumb_id || episodeId,
```
to:
```javascript
        videoUrl: response.mediaUrl || DaylightMediaPath(`api/v1/play/plex/mpd/${episodeId}`),
        thumbId: response.thumbId || episodeId,
```

**Step 2: Commit**

```bash
git add frontend/src/Apps/FitnessApp.jsx
git commit -m "refactor(frontend): update FitnessApp to camelCase

- media_url → mediaUrl
- thumb_id → thumbId

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 13: Update Frontend - FitnessPlayer.jsx

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx` (multiple lines)

**Step 1: Update all thumb_id references**

Global replace in file:
- `thumb_id` → `thumbId`
- `media_url` → `mediaUrl`
- `media_key` → `assetId`

Key lines to change:
- Line 36: `let thumbId = plexObj.thumbId || null;`
- Line 42-44: Update comments to reference `thumbId`
- Line 319: `const mediaId = currentItem.assetId || currentItem.id || ...`
- Line 499, 502, 507: Update object properties
- Lines 946-947, 961-962: Update `media_url` → `mediaUrl`
- Line 1006, 1013: Update `media_url` → `mediaUrl`
- Line 1108: Update `thumb_id` → `thumbId`
- Line 1145, 1147: Update `media_url` → `mediaUrl`

**Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayer.jsx
git commit -m "refactor(frontend): update FitnessPlayer to camelCase

- thumb_id → thumbId
- media_url → mediaUrl
- media_key → assetId

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 14: Update Frontend - FitnessShow.jsx

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessShow.jsx` (multiple lines)

**Step 1: Update references**

Key changes:
- Line 108: Remove `seasonThumbUrl` from fallback, use resolved thumbnail
- Line 112: `thumb_id` → `thumbId`
- Lines 534, 554, 556-557: Update `media_url` → `mediaUrl`, `thumb_id` → `thumbId`
- Lines 559, 688, 692: Remove `seasonThumbUrl` references
- Lines 936, 956, 958-959, 961: Same updates

**Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessShow.jsx
git commit -m "refactor(frontend): update FitnessShow to camelCase

- thumb_id → thumbId
- media_url → mediaUrl
- Removed seasonThumbUrl references (use resolved thumbnail)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 15: Update Frontend - VideoPlayer.jsx

**Files:**
- Modify: `frontend/src/modules/Player/components/VideoPlayer.jsx:139,145,178,270,273,279,283`

**Step 1: Update media_url references**

Global replace: `media_url` → `mediaUrl`

**Step 2: Commit**

```bash
git add frontend/src/modules/Player/components/VideoPlayer.jsx
git commit -m "refactor(frontend): update VideoPlayer to use mediaUrl

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 16: Update Frontend - AudioPlayer.jsx

**Files:**
- Modify: `frontend/src/modules/Player/components/AudioPlayer.jsx:33,42-43,255`

**Step 1: Update references**

- Line 33: `const { mediaUrl, title, artist, ... } = media || {};`
- Lines 42-43: Update dependency array
- Line 255: `src={mediaUrl}`

**Step 2: Commit**

```bash
git add frontend/src/modules/Player/components/AudioPlayer.jsx
git commit -m "refactor(frontend): update AudioPlayer to use mediaUrl

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 17: Update Frontend - Player hooks and utils

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js:48`
- Modify: `frontend/src/modules/Player/hooks/usePlayheadStallDetection.js:103`
- Modify: `frontend/src/modules/Player/utils/mediaIdentity.js:9`

**Step 1: Update media_key and media_url references**

In each file, replace:
- `media_key` → `assetId`
- `media_url` → `mediaUrl`

**Step 2: Commit**

```bash
git add frontend/src/modules/Player/hooks/useCommonMediaController.js
git add frontend/src/modules/Player/hooks/usePlayheadStallDetection.js
git add frontend/src/modules/Player/utils/mediaIdentity.js
git commit -m "refactor(frontend): update Player hooks/utils to camelCase

- media_key → assetId
- media_url → mediaUrl

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 18: Update Frontend - Remaining files

**Files:**
- Modify: `frontend/src/modules/Menu/SeasonView.jsx:87`
- Modify: `frontend/src/modules/Player/components/VisualRenderer.jsx:167,194`
- Modify: `frontend/src/modules/Player/components/CompositePlayer.jsx:57`
- Modify: `frontend/src/modules/Player/components/SinglePlayer.jsx:135,142,224-225`
- Modify: `frontend/src/modules/Fitness/FitnessMenu.jsx:316`
- Modify: `frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnails.jsx:242-243,407`

**Step 1: Update all snake_case references**

In each file:
- `media_url` → `mediaUrl`
- `thumb_id` → `thumbId`
- `media_key` → `assetId`
- Remove `parentThumb` reference in SeasonView (use resolved thumbnail)

**Step 2: Commit**

```bash
git add frontend/src/modules/Menu/SeasonView.jsx
git add frontend/src/modules/Player/components/VisualRenderer.jsx
git add frontend/src/modules/Player/components/CompositePlayer.jsx
git add frontend/src/modules/Player/components/SinglePlayer.jsx
git add frontend/src/modules/Fitness/FitnessMenu.jsx
git add frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnails.jsx
git commit -m "refactor(frontend): update remaining components to camelCase

- media_url → mediaUrl
- thumb_id → thumbId
- media_key → assetId
- Removed parentThumb reference

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 19: Update YAML data files (if any use snake_case)

**Files:**
- Check: `data/` folder for any YAML files with `skip_after`, `wait_until`, `folder_color`, `media_key`

**Step 1: Search for snake_case in YAML**

Run: `grep -r "skip_after\|wait_until\|folder_color\|media_key" data/`

**Step 2: Update any found files**

Change:
- `skip_after` → `skipAfter`
- `wait_until` → `waitUntil`
- `folder_color` → `folderColor`
- `media_key` → `assetId`

**Step 3: Commit**

```bash
git add data/
git commit -m "refactor(data): update YAML files to camelCase field names

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 20: Run full test suite and fix any remaining issues

**Step 1: Run all tests**

Run: `npm test`

**Step 2: Fix any failing tests**

Update test assertions to use new field names.

**Step 3: Run frontend in dev mode**

Run: `npm run dev`

Test key flows:
- Playing a video (check mediaUrl works)
- Viewing episode list (check thumbnails resolve)
- Queue filtering (check skipAfter/waitUntil work)

**Step 4: Final commit**

```bash
git add -A
git commit -m "test: update tests for camelCase field naming

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary

This plan standardizes field naming across the codebase:

| Layer | Changes |
|-------|---------|
| Domain | Remove `toJSON()`, rename `media_key`→`assetId`, `skip_after`→`skipAfter`, `wait_until`→`waitUntil` |
| Adapters | Plex resolves thumbnails, removes hierarchy fields; FolderAdapter uses camelCase |
| API | Removes hierarchy field flattening, uses camelCase |
| Frontend | All `media_url`→`mediaUrl`, `thumb_id`→`thumbId`, `media_key`→`assetId` |
| Data | YAML files use camelCase |

Total: ~20 tasks, ~30 files modified
