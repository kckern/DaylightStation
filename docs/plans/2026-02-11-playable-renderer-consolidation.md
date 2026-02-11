# Playable Renderer Consolidation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate all playable format renderers into `modules/Player/renderers/`, move registry infrastructure into the Player module, and delete the now-redundant `lib/playable/` and `modules/ContentScroller/` directories.

**Architecture:** All playable content renderers (video, audio, scroller, composite, reader) move to a dedicated `renderers/` folder inside the Player module. The format registry moves to `Player/lib/`, the lifecycle hook moves to `Player/hooks/`. PlayableAppShell stays in `components/` — it's an adapter, not a renderer. Each task produces a buildable state and gets its own commit.

**Tech Stack:** React, Vitest, ES modules with relative imports (no path aliases)

---

## Current → Target Structure

```
BEFORE:
├── lib/playable/                         ← DELETE
│   ├── index.js
│   ├── registry.js
│   ├── registry.test.js
│   └── usePlayableLifecycle.js
├── modules/ContentScroller/              ← DELETE
│   ├── ContentScroller.jsx
│   ├── ContentScroller.scss
│   ├── SingalongScroller.jsx
│   ├── ReadalongScroller.jsx
│   └── ContentScrollers/Scriptures.jsx   (empty)
└── modules/Player/
    ├── components/
    │   ├── AudioPlayer.jsx
    │   ├── VideoPlayer.jsx
    │   ├── CompositePlayer.jsx
    │   ├── CompositeContext.jsx
    │   ├── PagedReader.jsx
    │   ├── FlowReader.jsx
    │   └── PlayableAppShell.jsx
    └── ...

AFTER:
└── modules/Player/
    ├── components/
    │   ├── SinglePlayer.jsx             (dispatcher)
    │   ├── PlayableAppShell.jsx         (adapter — stays here)
    │   ├── CompositeControllerContext.jsx (coordination — stays here)
    │   ├── VisualRenderer.jsx           (visual track dispatch — stays here)
    │   ├── ImageCarousel.jsx + .scss    (visual component — stays here)
    │   ├── PlayerOverlay*.jsx           (chrome — stays here)
    │   ├── ProgressBar.jsx, DebugInfo.jsx
    │   └── visuals/
    ├── renderers/                        ← NEW
    │   ├── VideoPlayer.jsx
    │   ├── AudioPlayer.jsx
    │   ├── CompositePlayer.jsx
    │   ├── CompositeContext.jsx
    │   ├── PagedReader.jsx
    │   ├── FlowReader.jsx
    │   ├── SingalongScroller.jsx
    │   ├── ReadalongScroller.jsx
    │   ├── ContentScroller.jsx
    │   └── ContentScroller.scss
    ├── hooks/
    │   ├── usePlayableLifecycle.js       ← moved from lib/playable/
    │   └── ... (existing hooks unchanged)
    └── lib/
        ├── registry.js                   ← moved from lib/playable/
        ├── registry.test.js
        └── ... (existing lib files unchanged)
```

---

## Import Change Reference

All paths below are relative to `frontend/src/`.

### Files that move — internal import path changes

| File (new location) | Old import | New import |
|---------------------|-----------|------------|
| `Player/lib/registry.js` | `../../modules/ContentScroller/SingalongScroller.jsx` | `../renderers/SingalongScroller.jsx` |
| `Player/lib/registry.js` | `../../modules/ContentScroller/ReadalongScroller.jsx` | `../renderers/ReadalongScroller.jsx` |
| `Player/lib/registry.js` | `../../modules/Player/components/PlayableAppShell.jsx` | `../components/PlayableAppShell.jsx` |
| `Player/lib/registry.js` | `../../modules/Player/components/PagedReader.jsx` | `../renderers/PagedReader.jsx` |
| `Player/lib/registry.js` | `../../modules/Player/components/FlowReader.jsx` | `../renderers/FlowReader.jsx` |
| `Player/renderers/ContentScroller.jsx` | `../../lib/api.mjs` | `../../../lib/api.mjs` |
| `Player/renderers/ContentScroller.jsx` | `../../lib/Player/useCenterByWidest.js` | `../../../lib/Player/useCenterByWidest.js` |
| `Player/renderers/ContentScroller.jsx` | `../../assets/backgrounds/paper.jpg` | `../../../assets/backgrounds/paper.jpg` |
| `Player/renderers/ContentScroller.jsx` | `../../lib/scripture-guide.jsx` | `../../../lib/scripture-guide.jsx` |
| `Player/renderers/ContentScroller.jsx` | `../../lib/Player/useMediaKeyboardHandler.js` | `../../../lib/Player/useMediaKeyboardHandler.js` |
| `Player/renderers/ContentScroller.jsx` | `../../lib/Player/useDynamicDimensions.js` | `../../../lib/Player/useDynamicDimensions.js` |
| `Player/renderers/ContentScroller.jsx` | `../Player/hooks/useMediaReporter.js` | `../hooks/useMediaReporter.js` |
| `Player/renderers/SingalongScroller.jsx` | `../../lib/api.mjs` | `../../../lib/api.mjs` |
| `Player/renderers/SingalongScroller.jsx` | `../../lib/Player/useCenterByWidest.js` | `../../../lib/Player/useCenterByWidest.js` |
| `Player/renderers/SingalongScroller.jsx` | `../../lib/contentRenderers.jsx` | `../../../lib/contentRenderers.jsx` |
| `Player/renderers/ReadalongScroller.jsx` | `../../lib/api.mjs` | `../../../lib/api.mjs` |
| `Player/renderers/ReadalongScroller.jsx` | `../../lib/contentRenderers.jsx` | `../../../lib/contentRenderers.jsx` |
| `Player/renderers/CompositePlayer.jsx` | `./CompositeControllerContext.jsx` | `../components/CompositeControllerContext.jsx` |
| `Player/renderers/CompositePlayer.jsx` | `./VisualRenderer.jsx` | `../components/VisualRenderer.jsx` |

### Files that stay — import path changes to moved files

| File (stays put) | Old import | New import |
|-----------------|-----------|------------|
| `Player/components/SinglePlayer.jsx` | `../../../lib/playable/index.js` | `../lib/registry.js` |
| `Player/components/SinglePlayer.jsx` | `./AudioPlayer.jsx` | `../renderers/AudioPlayer.jsx` |
| `Player/components/SinglePlayer.jsx` | `./VideoPlayer.jsx` | `../renderers/VideoPlayer.jsx` |
| `Player/components/PlayableAppShell.jsx` | `../../../lib/playable/index.js` | `../hooks/usePlayableLifecycle.js` |
| `Player/Player.jsx` | `./components/CompositePlayer.jsx` | `./renderers/CompositePlayer.jsx` |
| `Player/components/VisualRenderer.jsx` | `./VideoPlayer.jsx` | `../renderers/VideoPlayer.jsx` |

### Unchanged imports (same relative path after move)

These imports are the same depth from `renderers/` as they were from `components/` or `ContentScroller/`:

| File | Import | Why unchanged |
|------|--------|--------------|
| `renderers/CompositePlayer.jsx` | `../hooks/useAdvanceController.js` | Same depth |
| `renderers/CompositePlayer.jsx` | `../lib/helpers.js` | Same depth |
| `renderers/CompositePlayer.jsx` | `./CompositeContext.jsx` | Moves together |
| `renderers/SingalongScroller.jsx` | `./ContentScroller.jsx` | Moves together |
| `renderers/ReadalongScroller.jsx` | `./ContentScroller.jsx` | Moves together |
| `renderers/ContentScroller.jsx` | `./ContentScroller.scss` | Moves together |

---

## Task 1: Move Registry Infrastructure into Player Module

Move `registry.js`, `registry.test.js`, and `usePlayableLifecycle.js` out of `lib/playable/` into the Player module. Delete the barrel export `index.js` and the `lib/playable/` directory.

**Files:**
- Move: `frontend/src/lib/playable/registry.js` → `frontend/src/modules/Player/lib/registry.js`
- Move: `frontend/src/lib/playable/registry.test.js` → `frontend/src/modules/Player/lib/registry.test.js`
- Move: `frontend/src/lib/playable/usePlayableLifecycle.js` → `frontend/src/modules/Player/hooks/usePlayableLifecycle.js`
- Delete: `frontend/src/lib/playable/index.js`
- Delete: `frontend/src/lib/playable/` (directory)
- Modify: `frontend/src/modules/Player/components/SinglePlayer.jsx` (import path)
- Modify: `frontend/src/modules/Player/components/PlayableAppShell.jsx` (import path)

**Step 1: Move the three files**

```bash
cd frontend/src
git mv lib/playable/registry.js modules/Player/lib/registry.js
git mv lib/playable/registry.test.js modules/Player/lib/registry.test.js
git mv lib/playable/usePlayableLifecycle.js modules/Player/hooks/usePlayableLifecycle.js
```

**Step 2: Delete the barrel export and directory**

```bash
rm lib/playable/index.js
rmdir lib/playable
```

**Step 3: Update SinglePlayer.jsx import**

In `frontend/src/modules/Player/components/SinglePlayer.jsx`, change:

```javascript
// OLD
import { getRenderer, isMediaFormat } from '../../../lib/playable/index.js';
// NEW
import { getRenderer, isMediaFormat } from '../lib/registry.js';
```

**Step 4: Update PlayableAppShell.jsx import**

In `frontend/src/modules/Player/components/PlayableAppShell.jsx`, change:

```javascript
// OLD
import { usePlayableLifecycle } from '../../../lib/playable/index.js';
// NEW
import { usePlayableLifecycle } from '../hooks/usePlayableLifecycle.js';
```

**Step 5: Update registry.js internal imports**

The registry still imports from `../../modules/ContentScroller/` and `../../modules/Player/components/` — these paths are now wrong since the registry moved. But the ContentScroller files haven't moved yet (Task 2), and PlayableAppShell/PagedReader/FlowReader haven't moved yet (Task 3). So update only the paths that changed due to THIS move:

In `frontend/src/modules/Player/lib/registry.js`, change:

```javascript
// OLD
import { SingalongScroller } from '../../modules/ContentScroller/SingalongScroller.jsx';
import { ReadalongScroller } from '../../modules/ContentScroller/ReadalongScroller.jsx';
import PlayableAppShell from '../../modules/Player/components/PlayableAppShell.jsx';
import PagedReader from '../../modules/Player/components/PagedReader.jsx';
import FlowReader from '../../modules/Player/components/FlowReader.jsx';
// NEW (temporary paths — Task 2 & 3 will update scroller and reader paths again)
import { SingalongScroller } from '../../ContentScroller/SingalongScroller.jsx';
import { ReadalongScroller } from '../../ContentScroller/ReadalongScroller.jsx';
import PlayableAppShell from '../components/PlayableAppShell.jsx';
import PagedReader from '../components/PagedReader.jsx';
import FlowReader from '../components/FlowReader.jsx';
```

Wait — `registry.js` is now at `modules/Player/lib/registry.js`. The `../../` from there goes to `modules/`. So `../../ContentScroller/SingalongScroller.jsx` = `modules/ContentScroller/SingalongScroller.jsx`. That's still correct temporarily until Task 2 moves the scrollers.

Actually, let me recompute. From `modules/Player/lib/registry.js`:
- `../` = `modules/Player/`
- `../../` = `modules/`
- `../../ContentScroller/` = `modules/ContentScroller/` ✓
- `../components/` = `modules/Player/components/` ✓

Yes, those temporary paths are correct.

**Step 6: Update registry.test.js import**

The test file imports from `./registry.js` — this stays the same since both files moved together. No change needed.

**Step 7: Run tests to verify**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
npx vitest run frontend/src/modules/Player/lib/registry.test.js
```

Expected: All 10 tests pass.

```bash
npx vite build --config frontend/vite.config.js
```

Expected: Build succeeds with no import errors.

**Step 8: Commit**

```bash
git add -A
git commit -m "refactor: move playable registry + hook into Player module

Relocate registry.js and registry.test.js to Player/lib/,
usePlayableLifecycle.js to Player/hooks/. Delete lib/playable/ barrel."
```

---

## Task 2: Move Scroller Renderers to Player/renderers/

Move the entire ContentScroller module into `Player/renderers/`. This includes ContentScroller.jsx (shared base), its scss, SingalongScroller, and ReadalongScroller. Delete the now-empty `modules/ContentScroller/` directory.

**Files:**
- Create: `frontend/src/modules/Player/renderers/` (directory)
- Move: `frontend/src/modules/ContentScroller/ContentScroller.jsx` → `frontend/src/modules/Player/renderers/ContentScroller.jsx`
- Move: `frontend/src/modules/ContentScroller/ContentScroller.scss` → `frontend/src/modules/Player/renderers/ContentScroller.scss`
- Move: `frontend/src/modules/ContentScroller/SingalongScroller.jsx` → `frontend/src/modules/Player/renderers/SingalongScroller.jsx`
- Move: `frontend/src/modules/ContentScroller/ReadalongScroller.jsx` → `frontend/src/modules/Player/renderers/ReadalongScroller.jsx`
- Delete: `frontend/src/modules/ContentScroller/ContentScrollers/Scriptures.jsx` (empty file)
- Delete: `frontend/src/modules/ContentScroller/ContentScrollers/` (directory)
- Delete: `frontend/src/modules/ContentScroller/` (directory)
- Modify: `frontend/src/modules/Player/lib/registry.js` (update scroller import paths)

**Step 1: Create renderers/ and move files**

```bash
cd frontend/src
mkdir -p modules/Player/renderers
git mv modules/ContentScroller/ContentScroller.jsx modules/Player/renderers/ContentScroller.jsx
git mv modules/ContentScroller/ContentScroller.scss modules/Player/renderers/ContentScroller.scss
git mv modules/ContentScroller/SingalongScroller.jsx modules/Player/renderers/SingalongScroller.jsx
git mv modules/ContentScroller/ReadalongScroller.jsx modules/Player/renderers/ReadalongScroller.jsx
```

**Step 2: Delete empty ContentScroller directory**

```bash
rm modules/ContentScroller/ContentScrollers/Scriptures.jsx
rmdir modules/ContentScroller/ContentScrollers
rmdir modules/ContentScroller
```

**Step 3: Update ContentScroller.jsx imports**

The file moved from `modules/ContentScroller/` to `modules/Player/renderers/` (one level deeper into `src/`). All `../../` paths become `../../../`:

In `frontend/src/modules/Player/renderers/ContentScroller.jsx`, change:

```javascript
// OLD
import { DaylightAPI, DaylightMediaPath } from "../../lib/api.mjs";
import { useCenterByWidest } from '../../lib/Player/useCenterByWidest.js';
import paperBackground from "../../assets/backgrounds/paper.jpg";
import { convertVersesToScriptureData, scriptureDataToJSX } from "../../lib/scripture-guide.jsx";
import { useMediaKeyboardHandler } from '../../lib/Player/useMediaKeyboardHandler.js';
import { useDynamicDimensions } from '../../lib/Player/useDynamicDimensions.js';
import { useMediaReporter } from '../Player/hooks/useMediaReporter.js';

// NEW
import { DaylightAPI, DaylightMediaPath } from "../../../lib/api.mjs";
import { useCenterByWidest } from '../../../lib/Player/useCenterByWidest.js';
import paperBackground from "../../../assets/backgrounds/paper.jpg";
import { convertVersesToScriptureData, scriptureDataToJSX } from "../../../lib/scripture-guide.jsx";
import { useMediaKeyboardHandler } from '../../../lib/Player/useMediaKeyboardHandler.js';
import { useDynamicDimensions } from '../../../lib/Player/useDynamicDimensions.js';
import { useMediaReporter } from '../hooks/useMediaReporter.js';
```

Note: `./ContentScroller.scss` stays unchanged (co-located).

**Step 4: Update SingalongScroller.jsx imports**

In `frontend/src/modules/Player/renderers/SingalongScroller.jsx`, change:

```javascript
// OLD
import { DaylightAPI } from '../../lib/api.mjs';
import { useCenterByWidest } from '../../lib/Player/useCenterByWidest.js';
import { getSingalongRenderer } from '../../lib/contentRenderers.jsx';

// NEW
import { DaylightAPI } from '../../../lib/api.mjs';
import { useCenterByWidest } from '../../../lib/Player/useCenterByWidest.js';
import { getSingalongRenderer } from '../../../lib/contentRenderers.jsx';
```

Note: `./ContentScroller.jsx` stays unchanged (co-located).

**Step 5: Update ReadalongScroller.jsx imports**

In `frontend/src/modules/Player/renderers/ReadalongScroller.jsx`, change:

```javascript
// OLD
import { DaylightAPI } from '../../lib/api.mjs';
import { getReadalongRenderer } from '../../lib/contentRenderers.jsx';

// NEW
import { DaylightAPI } from '../../../lib/api.mjs';
import { getReadalongRenderer } from '../../../lib/contentRenderers.jsx';
```

Note: `./ContentScroller.jsx` stays unchanged (co-located).

**Step 6: Update registry.js scroller imports**

In `frontend/src/modules/Player/lib/registry.js`, change:

```javascript
// OLD (temporary from Task 1)
import { SingalongScroller } from '../../ContentScroller/SingalongScroller.jsx';
import { ReadalongScroller } from '../../ContentScroller/ReadalongScroller.jsx';

// NEW
import { SingalongScroller } from '../renderers/SingalongScroller.jsx';
import { ReadalongScroller } from '../renderers/ReadalongScroller.jsx';
```

**Step 7: Run tests and build**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
npx vitest run frontend/src/modules/Player/lib/registry.test.js
npx vite build --config frontend/vite.config.js
```

Expected: Tests pass, build succeeds.

**Step 8: Commit**

```bash
git add -A
git commit -m "refactor: move scroller renderers to Player/renderers/

Relocate ContentScroller, SingalongScroller, ReadalongScroller from
modules/ContentScroller/ to modules/Player/renderers/. Delete the
now-empty ContentScroller module."
```

---

## Task 3: Move Remaining Renderers to Player/renderers/

Move VideoPlayer, AudioPlayer, CompositePlayer, CompositeContext, PagedReader, and FlowReader from `components/` to `renderers/`. Update all consumers.

**Files:**
- Move: `frontend/src/modules/Player/components/VideoPlayer.jsx` → `frontend/src/modules/Player/renderers/VideoPlayer.jsx`
- Move: `frontend/src/modules/Player/components/AudioPlayer.jsx` → `frontend/src/modules/Player/renderers/AudioPlayer.jsx`
- Move: `frontend/src/modules/Player/components/CompositePlayer.jsx` → `frontend/src/modules/Player/renderers/CompositePlayer.jsx`
- Move: `frontend/src/modules/Player/components/CompositeContext.jsx` → `frontend/src/modules/Player/renderers/CompositeContext.jsx`
- Move: `frontend/src/modules/Player/components/PagedReader.jsx` → `frontend/src/modules/Player/renderers/PagedReader.jsx`
- Move: `frontend/src/modules/Player/components/FlowReader.jsx` → `frontend/src/modules/Player/renderers/FlowReader.jsx`
- Modify: `frontend/src/modules/Player/components/SinglePlayer.jsx` (VideoPlayer, AudioPlayer imports)
- Modify: `frontend/src/modules/Player/components/VisualRenderer.jsx` (VideoPlayer import)
- Modify: `frontend/src/modules/Player/Player.jsx` (CompositePlayer import)
- Modify: `frontend/src/modules/Player/renderers/CompositePlayer.jsx` (VisualRenderer, CompositeControllerContext imports)
- Modify: `frontend/src/modules/Player/lib/registry.js` (PagedReader, FlowReader imports)

**Step 1: Move files**

```bash
cd frontend/src/modules/Player
git mv components/VideoPlayer.jsx renderers/VideoPlayer.jsx
git mv components/AudioPlayer.jsx renderers/AudioPlayer.jsx
git mv components/CompositePlayer.jsx renderers/CompositePlayer.jsx
git mv components/CompositeContext.jsx renderers/CompositeContext.jsx
git mv components/PagedReader.jsx renderers/PagedReader.jsx
git mv components/FlowReader.jsx renderers/FlowReader.jsx
```

**Step 2: Update SinglePlayer.jsx imports**

In `frontend/src/modules/Player/components/SinglePlayer.jsx`, change:

```javascript
// OLD
import { AudioPlayer } from './AudioPlayer.jsx';
import { VideoPlayer } from './VideoPlayer.jsx';

// NEW
import { AudioPlayer } from '../renderers/AudioPlayer.jsx';
import { VideoPlayer } from '../renderers/VideoPlayer.jsx';
```

**Step 3: Update VisualRenderer.jsx import**

In `frontend/src/modules/Player/components/VisualRenderer.jsx`, change:

```javascript
// OLD
import { VideoPlayer } from './VideoPlayer.jsx';

// NEW
import { VideoPlayer } from '../renderers/VideoPlayer.jsx';
```

Note: `import { ImageCarousel } from './ImageCarousel.jsx';` stays — ImageCarousel remains in `components/`.

**Step 4: Update Player.jsx import**

In `frontend/src/modules/Player/Player.jsx`, change:

```javascript
// OLD
import { CompositePlayer } from './components/CompositePlayer.jsx';

// NEW
import { CompositePlayer } from './renderers/CompositePlayer.jsx';
```

Note: `import { useCompositeControllerChannel } from './components/CompositeControllerContext.jsx';` stays — CompositeControllerContext remains in `components/`.

**Step 5: Update CompositePlayer.jsx imports (it moved to renderers/)**

In `frontend/src/modules/Player/renderers/CompositePlayer.jsx`, change:

```javascript
// OLD (these were sibling imports in components/)
import { CompositeControllerProvider } from './CompositeControllerContext.jsx';
import { VisualRenderer } from './VisualRenderer.jsx';

// NEW (now cross-referencing back to components/)
import { CompositeControllerProvider } from '../components/CompositeControllerContext.jsx';
import { VisualRenderer } from '../components/VisualRenderer.jsx';
```

Note: `./CompositeContext.jsx` import stays unchanged — CompositeContext moved alongside CompositePlayer.
Note: `../hooks/useAdvanceController.js` and `../lib/helpers.js` stay unchanged — same relative depth.

**Step 6: Update registry.js reader imports**

In `frontend/src/modules/Player/lib/registry.js`, change:

```javascript
// OLD (temporary from Task 1)
import PagedReader from '../components/PagedReader.jsx';
import FlowReader from '../components/FlowReader.jsx';

// NEW
import PagedReader from '../renderers/PagedReader.jsx';
import FlowReader from '../renderers/FlowReader.jsx';
```

Note: `import PlayableAppShell from '../components/PlayableAppShell.jsx';` stays — PlayableAppShell remains in `components/`.

**Step 7: Run tests and build**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
npx vitest run frontend/src/modules/Player/lib/registry.test.js
npx vite build --config frontend/vite.config.js
```

Expected: Tests pass, build succeeds.

**Step 8: Commit**

```bash
git add -A
git commit -m "refactor: move all format renderers to Player/renderers/

Relocate VideoPlayer, AudioPlayer, CompositePlayer, CompositeContext,
PagedReader, FlowReader from components/ to renderers/. Components/
now contains only infrastructure (SinglePlayer, PlayableAppShell,
overlays, VisualRenderer)."
```

---

## Task 4: Final Verification and Documentation

Run full test suite, update documentation to reflect new file locations.

**Files:**
- Modify: `docs/reference/content/content-playback.md` (file path references)

**Step 1: Run full unit test suite**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
npx vitest run
```

Expected: All existing tests pass (same count as before refactor).

**Step 2: Run build**

```bash
npx vite build --config frontend/vite.config.js
```

Expected: Clean build, no warnings about missing modules.

**Step 3: Update content-playback.md**

In `docs/reference/content/content-playback.md`, update the Playable Format Registry section to reflect new paths:

```markdown
### Playable Format Registry

The format→component mapping lives in `frontend/src/modules/Player/lib/registry.js`, not in SinglePlayer. To add a new playable content type:

1. Create the renderer component implementing the Playable Contract (see below)
2. Add it to `frontend/src/modules/Player/renderers/`
3. Import and register it in `frontend/src/modules/Player/lib/registry.js`
4. No changes needed in SinglePlayer
```

Also update the `usePlayableLifecycle` path reference:

```markdown
**For non-media renderers** (apps, future slideshow/pageturner), use the `usePlayableLifecycle` hook from `frontend/src/modules/Player/hooks/usePlayableLifecycle.js`...
```

**Step 4: Commit**

```bash
git add -A
git commit -m "docs: update content-playback.md with new renderer file paths"
```

---

## Verification Checklist

After all tasks are complete, confirm:

- [ ] `frontend/src/lib/playable/` directory no longer exists
- [ ] `frontend/src/modules/ContentScroller/` directory no longer exists
- [ ] `frontend/src/modules/Player/renderers/` contains exactly 10 files:
  - `VideoPlayer.jsx`, `AudioPlayer.jsx`
  - `CompositePlayer.jsx`, `CompositeContext.jsx`
  - `SingalongScroller.jsx`, `ReadalongScroller.jsx`
  - `ContentScroller.jsx`, `ContentScroller.scss`
  - `PagedReader.jsx`, `FlowReader.jsx`
- [ ] `frontend/src/modules/Player/components/` still contains `PlayableAppShell.jsx`
- [ ] `frontend/src/modules/Player/lib/registry.js` imports from `../renderers/` and `../components/`
- [ ] `frontend/src/modules/Player/hooks/usePlayableLifecycle.js` exists
- [ ] `npx vitest run` passes
- [ ] `npx vite build` succeeds
- [ ] No remaining imports referencing `lib/playable/` or `modules/ContentScroller/`
