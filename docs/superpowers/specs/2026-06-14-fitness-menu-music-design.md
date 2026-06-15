# Fitness Menu Background Music

**Date:** 2026-06-14  
**Status:** Approved

## Overview

Ambient background music plays while the user navigates the Fitness app's menu, show browser, and home screen. Music stops when a video player or interactive module opens, and resumes/changes on return to browsing.

## Behavior

| State | Music |
|-------|-------|
| `currentView` ∈ {menu, show, screen} AND queue empty AND no active module | Playing |
| FitnessPlayer opens (queue.length > 0) | Fade out, stop |
| Active module opens (`activeModule != null`) | Fade out, stop |
| Player/module closes, returning to browse | Fade in (same random track) |
| `activeCollection` changes (menu nav) | Crossfade to new random track |
| Entering FitnessShow from menu | No track change — plays through |

**Track change key:** `activeCollection`. Stable when navigating menu → show, so music plays through without interruption.

## Crossfade

- **Duration:** 500ms linear fade
- **Track change:** fade out current → start new at 0 → fade in to target volume
- **Stop:** fade out → pause (don't destroy element)
- **Resume:** fade in from current position (or pick new random if track ended)
- **Repeat avoidance:** never pick the same track twice in a row

## Audio Source

- **Directory:** `media/apps/fitness/ux/menus/` (currently 20 MP3 files: 001–020)
- **Backend route:** `GET /api/v1/fitness/menu-music` returns `{ tracks: string[], volume: number }`
  - Scans directory dynamically so adding/removing files is automatic
  - Returns configured volume from `fitness.yml`
- **Frontend constructs audio URLs** via `DaylightMediaPath`

## Volume

- Source: `fitness.yml` → `menu_music.volume` (default `0.15`)
- Not user-adjustable via UI
- Applied to both audio elements (A and B)

## Implementation

### New files

**`frontend/src/modules/Fitness/nav/useMenuMusic.js`**  
Hook. Accepts `{ isActive, trackChangeKey, volume, trackUrls }`. Manages two `<audio>` refs (A/B pattern). Handles crossfade, random pick, repeat avoidance. No JSX, no renders — pure side-effect.

### Modified files

**`frontend/src/Apps/FitnessApp.jsx`**  
- Fetch track list from `/api/v1/fitness/menu-music` after config loads
- Derive `isActive` and `trackChangeKey` from existing state
- Call `useMenuMusic({ isActive, trackChangeKey, volume, trackUrls })`

**`backend/src/4_api/v1/routers/fitness.mjs`** (or equivalent)  
- Add `GET /api/v1/fitness/menu-music` route
- Scan `media/apps/fitness/ux/menus/` for audio files
- Return `{ tracks: [...DaylightMediaPath urls], volume: config.menu_music?.volume ?? 0.15 }`

**`data/household/config/fitness.yml`**  
```yaml
menu_music:
  volume: 0.15
```

## Non-goals

- No UI volume control
- No track skip / manual control
- No crossfade beyond 500ms
- No persistence of "which track was playing" across reloads
