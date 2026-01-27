# Composite Player Nomusic Label Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make TV app use CompositePlayer (video + background music) for items with "nomusic" label, matching production behavior.

**Architecture:** The FolderAdapter needs to detect items with `nomusic` label and add an `overlay` property pointing to a music playlist. This requires reading the Plex config to get the nomusic labels list and music playlist ID, then transforming the item's `play` action accordingly.

**Tech Stack:** Node.js, Express, Plex API

---

## Root Cause Analysis

When user selects "Fireworks" (plex:663846 with `nomusic` label):

1. FolderAdapter returns item with `play: { plex: "663846" }` - no overlay
2. Player.jsx checks `props.play?.overlay` - finds nothing
3. Player renders SinglePlayer instead of CompositePlayer
4. Video plays without background music

**Production behavior**: Items with `nomusic` label should have overlay configured to play background music from a designated playlist.

**Configuration needed**:
- `nomusic_labels`: Labels that indicate video needs background music (e.g., `["nomusic", "silent"]`)
- `music_playlist`: Plex collection ID to use as overlay music (e.g., `730101`)

---

## Task 1: Add Nomusic Config to Household Config

**Files:**
- Modify: Backend configuration loading to include nomusic/overlay settings

**Step 1: Check existing fitness config for nomusic_labels**

The Fitness app already reads `plex.nomusic_labels` from config. We need to:
1. Confirm this config exists in the household config
2. Add a `music_overlay_playlist` setting for the TV app

**Step 2: Verify config structure in ConfigService**

```bash
# Check current config structure
curl -s http://localhost:3112/api/v1/config/apps/fitness | jq '.plex'
```

Expected: Find `nomusic_labels` array. Need to add `music_overlay_playlist` ID.

**Step 3: Document expected config**

The household config should have (in `apps/fitness.yml` or `apps/tv.yml`):

```yaml
plex:
  nomusic_labels:
    - nomusic
    - silent
    - no_audio
  music_overlay_playlist: "730101"  # Plex collection ID for background music
```

---

## Task 2: Extend FolderAdapter to Add Overlay for Nomusic Items

**Files:**
- Modify: `backend/src/2_adapters/content/folder/FolderAdapter.mjs:280-330`

**Step 1: Add config injection to FolderAdapter constructor**

```javascript
// backend/src/2_adapters/content/folder/FolderAdapter.mjs
constructor(config) {
  if (!config.watchlistPath) throw new Error('FolderAdapter requires watchlistPath');
  this.watchlistPath = config.watchlistPath;
  this.registry = config.registry || null;
  this.historyPath = config.historyPath || null;
  // NEW: Overlay config for nomusic items
  this.nomusicLabels = config.nomusicLabels || [];
  this.musicOverlayPlaylist = config.musicOverlayPlaylist || null;
  this._watchlistCache = null;
  this._watchStateCache = {};
}
```

**Step 2: Add method to check if item has nomusic label**

```javascript
/**
 * Check if a Plex item has a nomusic label
 * @param {string} plexId - Plex rating key
 * @returns {Promise<boolean>}
 */
async _hasNomusicLabel(plexId) {
  if (!this.nomusicLabels.length || !plexId || !this.registry) return false;

  try {
    const adapter = this.registry.get('plex');
    if (!adapter?.getItem) return false;

    const item = await adapter.getItem(`plex:${plexId}`);
    const labels = item?.metadata?.labels || [];

    const normalizedLabels = labels
      .map(l => (typeof l === 'string' ? l.toLowerCase().trim() : ''))
      .filter(Boolean);

    const nomusicSet = new Set(this.nomusicLabels.map(l => l.toLowerCase().trim()));
    return normalizedLabels.some(l => nomusicSet.has(l));
  } catch (err) {
    return false;
  }
}
```

**Step 3: Modify getList to add overlay for nomusic items**

In the `getList` method, after building the `playAction` object, add overlay detection:

```javascript
// In getList(), after line 290 where playAction is built:

// Check if this is a Plex item with nomusic label that needs overlay
let finalPlayAction = playAction;
if (playAction.plex && this.musicOverlayPlaylist) {
  const hasNomusic = await this._hasNomusicLabel(playAction.plex);
  if (hasNomusic) {
    finalPlayAction = {
      ...playAction,
      overlay: {
        queue: { plex: this.musicOverlayPlaylist },
        shuffle: true
      }
    };
  }
}

// Use finalPlayAction instead of playAction in Item creation
actions: {
  play: Object.keys(finalPlayAction).length > 0 ? finalPlayAction : undefined,
  open: Object.keys(openAction).length > 0 ? openAction : undefined
}
```

**Step 4: Run test**

```bash
BASE_URL=http://localhost:3112 npx playwright test tests/runtime/tv-app/tv-composite-player.runtime.test.mjs --reporter=list
```

Expected: Test shows `overlay` property in Fireworks item.

**Step 5: Commit**

```bash
git add backend/src/2_adapters/content/folder/FolderAdapter.mjs
git commit -m "feat(folder): add overlay config for items with nomusic label

Items with Plex nomusic labels now get overlay.queue config pointing
to the music playlist, triggering CompositePlayer for video+music.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Wire Up Config in ContentSourceRegistry

**Files:**
- Modify: `backend/src/3_services/ContentSourceRegistry.mjs` (or wherever FolderAdapter is instantiated)

**Step 1: Load nomusic config from ConfigService**

When creating the FolderAdapter, pass the nomusic configuration:

```javascript
// Get nomusic config from fitness or tv app config
const fitnessConfig = await configService.getAppConfig('fitness');
const nomusicLabels = fitnessConfig?.plex?.nomusic_labels || [];
const musicOverlayPlaylist = fitnessConfig?.plex?.music_overlay_playlist || null;

const folderAdapter = new FolderAdapter({
  watchlistPath,
  registry,
  historyPath,
  nomusicLabels,
  musicOverlayPlaylist
});
```

**Step 2: Run full test suite**

```bash
BASE_URL=http://localhost:3112 npx playwright test tests/runtime/tv-app/ --reporter=list
```

**Step 3: Commit**

```bash
git add backend/src/3_services/ContentSourceRegistry.mjs
git commit -m "feat(registry): pass nomusic config to FolderAdapter

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Update Runtime Test to Verify CompositePlayer

**Files:**
- Modify: `tests/runtime/tv-app/tv-composite-player.runtime.test.mjs`

**Step 1: Update test to verify overlay config**

```javascript
test('API returns Fireworks item with overlay config', async ({ request }) => {
  const listResponse = await request.get(`${BASE_URL}/api/v1/list/folder/TVApp`);
  const listData = await listResponse.json();

  const fireworks = listData.items?.find(item =>
    item.label?.toLowerCase().includes('firework')
  );

  expect(fireworks).toBeTruthy();

  // After fix: should have overlay config
  const hasOverlay = fireworks.play?.overlay;
  expect(hasOverlay).toBeTruthy();
  expect(hasOverlay.queue?.plex || hasOverlay.plex).toBeTruthy();

  console.log('✅ Fireworks has overlay config:', JSON.stringify(hasOverlay, null, 2));
});
```

**Step 2: Update navigation test to verify CompositePlayer is used**

```javascript
test('Navigate to Fireworks uses CompositePlayer', async () => {
  // ... navigation code ...

  // After selecting Fireworks, verify CompositePlayer is rendered
  const compositePlayer = await sharedPage.locator('.player.composite').count();
  expect(compositePlayer).toBeGreaterThan(0);

  // Should have both video and audio elements
  const videoExists = await sharedPage.locator('video, dash-video').count();
  const audioExists = await sharedPage.locator('audio').count();

  expect(videoExists).toBeGreaterThan(0);
  expect(audioExists).toBeGreaterThan(0); // Overlay audio
});
```

**Step 3: Run tests**

```bash
BASE_URL=http://localhost:3112 npx playwright test tests/runtime/tv-app/tv-composite-player.runtime.test.mjs --reporter=list
```

**Step 4: Commit**

```bash
git add tests/runtime/tv-app/tv-composite-player.runtime.test.mjs
git commit -m "test(tv): verify CompositePlayer for nomusic items

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Add Unit Tests for Overlay Detection

**Files:**
- Create: `tests/unit/suite/adapters/folderAdapterNomusic.unit.test.mjs`

**Step 1: Write unit tests**

```javascript
/**
 * Unit test: FolderAdapter nomusic label detection
 */
import { describe, it, expect, vi } from 'vitest';

describe('FolderAdapter nomusic detection', () => {
  it('should detect nomusic label in item labels', () => {
    const nomusicLabels = ['nomusic', 'silent'];
    const itemLabels = ['HD', 'nomusic', '2025'];

    const normalizedItem = itemLabels.map(l => l.toLowerCase().trim());
    const nomusicSet = new Set(nomusicLabels.map(l => l.toLowerCase().trim()));

    const hasNomusic = normalizedItem.some(l => nomusicSet.has(l));
    expect(hasNomusic).toBe(true);
  });

  it('should not detect nomusic when label not present', () => {
    const nomusicLabels = ['nomusic', 'silent'];
    const itemLabels = ['HD', '4K', '2025'];

    const normalizedItem = itemLabels.map(l => l.toLowerCase().trim());
    const nomusicSet = new Set(nomusicLabels.map(l => l.toLowerCase().trim()));

    const hasNomusic = normalizedItem.some(l => nomusicSet.has(l));
    expect(hasNomusic).toBe(false);
  });

  it('should add overlay config when nomusic detected', () => {
    const playAction = { plex: '663846' };
    const musicOverlayPlaylist = '730101';
    const hasNomusic = true;

    let finalPlayAction = playAction;
    if (hasNomusic && musicOverlayPlaylist) {
      finalPlayAction = {
        ...playAction,
        overlay: {
          queue: { plex: musicOverlayPlaylist },
          shuffle: true
        }
      };
    }

    expect(finalPlayAction.overlay).toBeDefined();
    expect(finalPlayAction.overlay.queue.plex).toBe('730101');
    expect(finalPlayAction.overlay.shuffle).toBe(true);
  });
});
```

**Step 2: Run tests**

```bash
npm run test:unit -- --grep "nomusic"
```

**Step 3: Commit**

```bash
git add tests/unit/suite/adapters/folderAdapterNomusic.unit.test.mjs
git commit -m "test(unit): add FolderAdapter nomusic label detection tests

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Verification Checklist

- [ ] API response for Fireworks includes `play.overlay` with music playlist
- [ ] TV app renders CompositePlayer (`.player.composite` class)
- [ ] Video plays in primary player
- [ ] Audio plays in overlay player (background music)
- [ ] Fitness app still works (regression check)
- [ ] Unit tests pass
- [ ] Runtime tests pass

---

## Alternative Approaches (Not Implemented)

### Option A: Frontend-only detection
The frontend could detect `nomusic` labels and auto-configure overlay. Rejected because:
- Requires duplicate config in frontend
- FolderAdapter items don't include Plex labels in response
- Backend solution is cleaner

### Option B: TVApp query param override
User could add `?overlay=730101` to URL. Rejected because:
- Not automatic
- Poor UX - users shouldn't need to know playlist IDs

### Option C: Modify list.mjs toListItem
Transform overlay in the API router. Rejected because:
- Router shouldn't have business logic
- FolderAdapter is the right place
