# Bug Report: TV Player Missing Background Music for Nomusic Videos

**Date Discovered:** 2026-01-22
**Severity:** Medium
**Status:** Open
**Component:** Backend - FolderAdapter / TV App

---

## Summary

When selecting videos with `nomusic` label from the TV app menu (e.g., "Fireworks"), the video plays correctly but background music is missing. Production uses CompositePlayer (video + audio overlay), but dev uses SinglePlayer (video only).

---

## Steps to Reproduce

### Method 1: Manual Testing
1. Navigate to http://localhost:3112/tv
2. Select "Fireworks" from the menu
3. Observe video plays

**Expected:** Video plays with background music (CompositePlayer)
**Actual:** Video plays without music (SinglePlayer)

### Method 2: Automated Test
```bash
BASE_URL=http://localhost:3112 npx playwright test tests/runtime/tv-app/tv-composite-player.runtime.test.mjs --reporter=list
```

---

## Technical Analysis

### Root Cause

The FolderAdapter returns items without `overlay` configuration, even when the Plex item has `nomusic` label.

**API Response (current):**
```json
{
  "label": "Fireworks",
  "play": {
    "plex": "663846"
  }
}
```

**Expected API Response:**
```json
{
  "label": "Fireworks",
  "play": {
    "plex": "663846",
    "overlay": {
      "queue": { "plex": "730101" },
      "shuffle": true
    }
  }
}
```

### Why Production Works

Production may have:
1. Overlay config hardcoded in the watchlist YAML
2. A transformation layer adding overlay based on labels
3. Different FolderAdapter implementation

### Code Path

1. **FolderAdapter.getList()** - Creates items from watchlist YAML
2. **list.mjs toListItem()** - Transforms for API response
3. **Player.jsx:70** - Checks `props.play?.overlay` to decide player type
4. If no overlay → SinglePlayer, with overlay → CompositePlayer

---

## Evidence

### Test Output

```
🎬 Has overlay property: false
⚠️  No overlay property - will use SinglePlayer instead of CompositePlayer

📺 Plex content labels: ["nomusic"]
Has 'nomusic' label: true

⚠️  BUG: Item has nomusic label but no overlay config
Expected: play.overlay should be set for items with nomusic label

🎬 Player state:
  - Composite players: 0
  - Single players (non-composite): 1
```

### Plex Item Labels

```bash
curl -s "http://localhost:3112/api/v1/content/plex/info/663846" | jq '.labels'
# Output: ["nomusic"]
```

---

## Affected Files

| File | Issue |
|------|-------|
| `backend/src/2_adapters/content/folder/FolderAdapter.mjs` | Missing overlay transformation |
| `backend/src/3_services/ContentSourceRegistry.mjs` | Needs to pass nomusic config |

---

## Proposed Fix

See implementation plan: `docs/plans/2026-01-22-composite-player-nomusic-fix.md`

1. Add `nomusicLabels` and `musicOverlayPlaylist` config to FolderAdapter
2. When building play actions, check if Plex item has nomusic label
3. If yes, add overlay config pointing to music playlist
4. Player will detect overlay and use CompositePlayer

---

## Workaround

Use URL query params to force overlay:
```
http://localhost:3112/tv?plex=663846&overlay=730101
```

---

## Related

- Implementation plan: `docs/plans/2026-01-22-composite-player-nomusic-fix.md`
- Test file: `tests/runtime/tv-app/tv-composite-player.runtime.test.mjs`
- Similar fix: `docs/plans/2026-01-22-tv-player-folder-metadata-fix.md` (collection expansion)
