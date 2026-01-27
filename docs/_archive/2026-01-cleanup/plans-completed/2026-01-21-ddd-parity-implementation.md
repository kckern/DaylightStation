# DDD-Legacy API Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Achieve full API parity between DDD and legacy endpoints so the frontend can safely cutover.

**Architecture:** Fix three categories of issues: (1) List endpoint `open` action handling, (2) Plex content endpoint missing fields, (3) Local content endpoints not implemented. Changes are localized to adapters and routers.

**Tech Stack:** Node.js/Express, ES modules, YAML fixtures for testing

---

## Task 1: Fix `open` vs `play` Action Handling in FolderAdapter

**Problem:** Items with `open` action (app launches) are incorrectly being placed in `play` object. Legacy uses separate `open` field.

**Files:**
- Modify: `backend/src/2_adapters/content/folder/FolderAdapter.mjs:271-315`

**Step 1: Read the watchlist YAML to understand `open` patterns**

Run: `cat /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/lists/lists.yml | grep -A5 "open:" | head -30`

Understand: Items with `action: Open` should produce `open` field, not `play`.

**Step 2: Modify FolderAdapter to handle `open` action separately**

In `getList()` method, around line 271-315, change the action building logic:

```javascript
// Build play/open actions from source type (for legacy frontend compatibility)
// Frontend uses: ...item.play for media, item.open for apps
const playAction = {};
const openAction = {};

if (item.play) {
  // Raw YAML already has play object - use it
  Object.assign(playAction, item.play);
} else if (item.open) {
  // Raw YAML has open object - use it for app launches
  Object.assign(openAction, item.open);
} else if (item.action === 'Open' || parsed.source === 'app') {
  // Build open action for app sources
  openAction.app = mediaKey;
} else {
  // Build play action for media sources
  const src = item.src || parsed.source;
  playAction[src] = mediaKey;
}

children.push(new Item({
  // ... existing fields ...
  actions: {
    play: Object.keys(playAction).length > 0 ? playAction : undefined,
    open: Object.keys(openAction).length > 0 ? openAction : undefined
  }
}));
```

**Step 3: Verify list.mjs already handles `open` action**

Check line 32-33 in `backend/src/4_api/routers/list.mjs`:
```javascript
if (item.actions?.list) base.list = item.actions.list;
if (item.actions?.open) base.open = item.actions.open;
```

Already correct - `open` is passed through from `item.actions.open`.

**Step 4: Restart server and test**

Run: `pkill -f 'node backend/index.js' && nohup node backend/index.js > /tmp/backend-dev.log 2>&1 &`
Wait: `sleep 5`

**Step 5: Verify fix**

Run: `curl -s http://localhost:3112/data/list/FHE | jq '.items[] | select(.open != null) | {label, open}'`
Run: `curl -s http://localhost:3112/api/v1/list/folder/FHE | jq '.items[] | select(.open != null) | {label, open}'`

Expected: Both return same items with `open` action (Spotlight, Soren, Gratitude and Hope)

**Step 6: Commit**

```bash
git add backend/src/2_adapters/content/folder/FolderAdapter.mjs
git commit -m "fix(FolderAdapter): separate open and play actions for legacy compat

Items with action=Open or source=app now produce 'open' field instead of 'play'.
Frontend expects open actions for app launches to be in separate field.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Add Missing Fields to Plex Content Endpoint

**Problem:** DDD `/api/v1/content/plex/info/{id}` is missing critical fields that legacy `/media/plex/info/{id}` returns: `media_url`, `media_type`, `image`, `listkey`, `percent`, `seconds`.

**Files:**
- Modify: `backend/src/4_api/routers/content.mjs:221-248`
- Reference: `backend/src/2_adapters/content/media/plex/PlexAdapter.mjs`

**Step 1: Compare legacy vs DDD response structure**

Run: `curl -s http://localhost:3112/media/plex/info/663035 | jq 'keys'`
Run: `curl -s http://localhost:3112/api/v1/content/plex/info/663035 | jq 'keys'`

Legacy has: `image`, `key`, `labels`, `listType`, `listkey`, `media_type`, `media_url`, `percent`, `season`, `seconds`, `show`, `thumb_id`, `title`, `type`
DDD has: `duration`, `id`, `mediaType`, `metadata`, `thumbnail`, `title`

**Step 2: Update plex/info route to add missing fields**

In `backend/src/4_api/routers/content.mjs`, modify the `/plex/info/:id` handler (around line 221):

```javascript
router.get('/plex/info/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const plexAdapter = registry.get('plex');

    if (!plexAdapter) {
      return res.status(503).json({ error: 'Plex adapter not configured' });
    }

    const item = await plexAdapter.getItem(`plex:${id}`);
    if (!item) {
      return res.status(404).json({ error: 'Item not found', id });
    }

    // Generate streaming URL for video playback
    let media_url = null;
    let media_type = null;
    if (item.mediaType === 'video' || item.mediaType === 'audio') {
      media_url = await plexAdapter.loadMediaUrl(id);
      media_type = item.mediaType === 'video' ? 'dash_video' : 'audio';
    }

    // Load watch state for resume position
    let percent = 0;
    let seconds = 0;
    if (plexAdapter._historyLoader) {
      const history = plexAdapter._loadViewingHistory();
      const entry = history[id];
      if (entry) {
        seconds = entry.playhead || entry.seconds || 0;
        const duration = entry.mediaDuration || item.duration || 0;
        percent = duration > 0 ? Math.round((seconds / duration) * 100) : 0;
      }
    }

    // Build legacy-compatible response
    res.json({
      // Legacy identifiers
      listkey: id,
      listType: item.metadata?.type,
      key: id,
      // Core fields
      title: item.title,
      type: item.metadata?.type,
      // Media playback
      media_url,
      media_type,
      // Thumbnail
      image: item.thumbnail,
      thumb_id: item.metadata?.thumb_id || id,
      // Watch state
      percent,
      seconds,
      // Show/season info (for episodes)
      show: item.metadata?.show,
      season: item.metadata?.season,
      // Labels for governance
      labels: item.metadata?.labels || [],
      // Preserve new fields too
      id: item.id,
      duration: item.duration,
      metadata: item.metadata
    });
  } catch (error) {
    logger.error?.('content.plex.info.error', { id: req.params.id, error: error.message });
    res.status(500).json({ error: error.message });
  }
});
```

**Step 3: Restart server and test**

Run: `pkill -f 'node backend/index.js' && nohup node backend/index.js > /tmp/backend-dev.log 2>&1 &`
Wait: `sleep 5`

**Step 4: Verify fix**

Run: `curl -s http://localhost:3112/api/v1/content/plex/info/663035 | jq '{title, type, media_url, media_type, image, listkey, percent, seconds}'`

Expected: All fields populated (media_url should be a `/plex_proxy/...` URL)

**Step 5: Compare with legacy**

Run: `curl -s http://localhost:3112/media/plex/info/663035 | jq '{title, type, media_url, media_type, image, listkey}'`
Run: `curl -s http://localhost:3112/api/v1/content/plex/info/663035 | jq '{title, type, media_url, media_type, image, listkey}'`

Expected: Both have same structure (media_url format may differ slightly)

**Step 6: Commit**

```bash
git add backend/src/4_api/routers/content.mjs
git commit -m "feat(content): add legacy-compat fields to plex/info endpoint

Add media_url, media_type, image, listkey, percent, seconds to match
legacy /media/plex/info response structure. Frontend needs these fields
for video playback and resume position.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Implement Local Content Hymn Endpoint

**Problem:** DDD `/api/v1/local-content/hymn/{num}` returns 404. Legacy `/data/hymn/{num}` works.

**Files:**
- Modify: `backend/src/4_api/routers/localContent.mjs` (or create if missing)
- Reference: `backend/_legacy/routers/data.mjs` for legacy implementation

**Step 1: Check if localContent router exists and what it handles**

Run: `ls -la backend/src/4_api/routers/localContent.mjs`
Run: `grep -n "hymn" backend/src/4_api/routers/localContent.mjs 2>/dev/null || echo "No hymn route"`

**Step 2: Check legacy hymn implementation**

Run: `grep -A30 "'/hymn/" backend/_legacy/routers/data.mjs | head -40`

Understand: Legacy loads hymn data from YAML files in data directory.

**Step 3: Read localContent router to understand current structure**

Read: `backend/src/4_api/routers/localContent.mjs`

**Step 4: Add hymn route to localContent router**

Add route that:
1. Takes hymn number from path
2. Loads hymn data from YAML
3. Returns legacy-compatible response with title, lyrics, audio URL

```javascript
router.get('/hymn/:num', async (req, res) => {
  try {
    const { num } = req.params;
    // Load hymn data (implementation depends on existing infrastructure)
    // Return legacy-compatible response
    res.json({
      id: `hymn:${num}`,
      title: `Hymn ${num}`,
      type: 'hymn',
      // ... other fields from legacy
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

**Step 5: Test hymn endpoint**

Run: `curl -s http://localhost:3112/api/v1/local-content/hymn/304 | jq .`
Run: `curl -s http://localhost:3112/data/hymn/304 | jq .`

Expected: Both return hymn data

**Step 6: Commit**

```bash
git add backend/src/4_api/routers/localContent.mjs
git commit -m "feat(localContent): implement hymn endpoint for DDD parity

Add /api/v1/local-content/hymn/:num endpoint matching legacy /data/hymn/:num.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Implement Local Content Primary Endpoint

**Problem:** DDD `/api/v1/local-content/primary/{num}` returns 404.

**Files:**
- Modify: `backend/src/4_api/routers/localContent.mjs`

**Step 1: Check legacy primary implementation**

Run: `grep -A30 "'/primary/" backend/_legacy/routers/data.mjs | head -40`

**Step 2: Add primary route to localContent router**

Similar pattern to hymn - loads primary song data and returns legacy-compatible response.

**Step 3: Test and commit**

---

## Task 5: Run Full Parity Test Suite

**Files:**
- Test: `tests/parity-cli.mjs`

**Step 1: Run parity tests for list type**

Run: `node tests/parity-cli.mjs --live --type=list`

Expected: Pass rate improved (open action fix should resolve most list failures)

**Step 2: Run parity tests for plex type**

Run: `node tests/parity-cli.mjs --live --type=plex`

Expected: Fewer failures now that media_url and other fields are populated

**Step 3: Run full parity test**

Run: `node tests/parity-cli.mjs --live`

Document: Remaining failures and their causes

**Step 4: Update parity status report**

Update `docs/plans/2026-01-21-parity-status-report.md` with new results.

---

## Summary of Changes

| Task | File | Change |
|------|------|--------|
| 1 | FolderAdapter.mjs | Separate `open` and `play` actions |
| 2 | content.mjs | Add legacy fields to plex/info |
| 3 | localContent.mjs | Add hymn endpoint |
| 4 | localContent.mjs | Add primary endpoint |
| 5 | - | Verify with parity tests |

## Verification Commands

After all tasks complete:

```bash
# List endpoint - verify open actions
curl -s http://localhost:3112/api/v1/list/folder/FHE | jq '.items[] | select(.open) | {label, open}'

# Plex content - verify media_url
curl -s http://localhost:3112/api/v1/content/plex/info/663035 | jq '{media_url, media_type, image}'

# Run parity tests
node tests/parity-cli.mjs --live --type=list
node tests/parity-cli.mjs --live --type=plex
```
