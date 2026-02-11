# Playable Contract Registry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract the implicit Playable Contract from SinglePlayer and PlayableAppShell into an explicit `lib/playable/` module with a format registry and lifecycle hook.

**Architecture:** Create `frontend/src/lib/playable/` as a sibling to Player that owns the format→component registry and provides a `usePlayableLifecycle` hook for non-media renderers. SinglePlayer becomes a consumer of the registry instead of owning the format map. PlayableAppShell replaces its three manual `useEffect` hooks with a single `usePlayableLifecycle` call. No behavior changes — this is a pure structural refactor.

**Tech Stack:** React, Vitest (with happy-dom), existing Playwright flow tests for integration verification.

---

## Context

### What exists today

- `SinglePlayer.jsx` (lines 19-26) owns a hardcoded `CONTENT_FORMAT_COMPONENTS` map and `MEDIA_PLAYBACK_FORMATS` array. Adding a new playable content type requires modifying this 400+ line orchestrator.
- `PlayableAppShell.jsx` manually wires three `useEffect` hooks to satisfy the Playable Contract for non-media content (startup signal, resolved metadata, media access registration). Any future non-media playable type would copy-paste this pattern.
- The Playable Contract is documented in `docs/reference/content/content-model.md` and `content-playback.md` but has no code-level representation.

### What this creates

```
frontend/src/lib/playable/
├── index.js                    # Barrel export
├── registry.js                 # Format → component map + lookup functions
├── registry.test.js            # Unit tests for registry
└── usePlayableLifecycle.js     # Hook for non-media playable types
```

### Key file locations (read before implementing)

| File | Purpose | Key lines |
|------|---------|-----------|
| `frontend/src/modules/Player/components/SinglePlayer.jsx` | Format dispatch orchestrator | L17 (`MEDIA_PLAYBACK_FORMATS`), L19-26 (`CONTENT_FORMAT_COMPONENTS`), L383-431 (`renderByFormat`) |
| `frontend/src/modules/Player/components/PlayableAppShell.jsx` | App→Player bridge | L24-38 (three lifecycle `useEffect` hooks) |
| `frontend/src/modules/ContentScroller/SingalongScroller.jsx` | Singalong renderer | L19-33 (Playable Contract props) |
| `frontend/src/modules/ContentScroller/ReadalongScroller.jsx` | Readalong renderer | L19-33 (Playable Contract props) |
| `frontend/src/modules/Player/components/PagedReader.jsx` | Paged reader (stub) | imported by SinglePlayer |
| `frontend/src/modules/Player/components/FlowReader.jsx` | Flow reader (stub) | imported by SinglePlayer |
| `frontend/src/screen-framework/widgets/registry.test.js` | Existing registry test pattern | Follow this vitest style |
| `docs/reference/content/content-playback.md` | Playable Contract docs | Update after refactor |

---

## Task 1: Create the playable format registry

**Files:**
- Create: `frontend/src/lib/playable/registry.js`
- Test: `frontend/src/lib/playable/registry.test.js`

### Step 1: Write the failing test

Create `frontend/src/lib/playable/registry.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { getRenderer, isMediaFormat, getRegisteredFormats } from './registry.js';

describe('playable format registry', () => {
  describe('getRenderer', () => {
    it('should return a component for registered content formats', () => {
      const renderer = getRenderer('singalong');
      expect(renderer).toBeTruthy();
    });

    it('should return null for unregistered formats', () => {
      expect(getRenderer('nonexistent')).toBe(null);
    });

    it('should return null for media formats (handled separately)', () => {
      expect(getRenderer('video')).toBe(null);
      expect(getRenderer('audio')).toBe(null);
    });

    it('should return distinct components for each format', () => {
      const singalong = getRenderer('singalong');
      const readalong = getRenderer('readalong');
      expect(singalong).not.toBe(readalong);
    });
  });

  describe('isMediaFormat', () => {
    it('should return true for video', () => {
      expect(isMediaFormat('video')).toBe(true);
    });

    it('should return true for dash_video', () => {
      expect(isMediaFormat('dash_video')).toBe(true);
    });

    it('should return true for audio', () => {
      expect(isMediaFormat('audio')).toBe(true);
    });

    it('should return false for content formats', () => {
      expect(isMediaFormat('singalong')).toBe(false);
      expect(isMediaFormat('readalong')).toBe(false);
      expect(isMediaFormat('app')).toBe(false);
    });

    it('should return false for unknown formats', () => {
      expect(isMediaFormat('nonexistent')).toBe(false);
    });
  });

  describe('getRegisteredFormats', () => {
    it('should return all registered format names', () => {
      const formats = getRegisteredFormats();
      expect(formats).toContain('singalong');
      expect(formats).toContain('readalong');
      expect(formats).toContain('app');
      expect(formats).toContain('readable_paged');
      expect(formats).toContain('readable_flow');
      expect(formats.length).toBe(5);
    });
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation/frontend && npx vitest run src/lib/playable/registry.test.js`

Expected: FAIL — `registry.js` does not exist yet.

### Step 3: Write the registry implementation

Create `frontend/src/lib/playable/registry.js`:

```javascript
// frontend/src/lib/playable/registry.js

/**
 * Playable Content Format Registry
 *
 * Maps content formats to their renderer components.
 * SinglePlayer consumes this registry for format-based dispatch.
 *
 * To add a new playable content type:
 * 1. Create the renderer component implementing the Playable Contract
 *    (see docs/reference/content/content-playback.md)
 * 2. Import and register it here
 * 3. No changes needed in SinglePlayer
 */
import { SingalongScroller } from '../../modules/ContentScroller/SingalongScroller.jsx';
import { ReadalongScroller } from '../../modules/ContentScroller/ReadalongScroller.jsx';
import PlayableAppShell from '../../modules/Player/components/PlayableAppShell.jsx';
import PagedReader from '../../modules/Player/components/PagedReader.jsx';
import FlowReader from '../../modules/Player/components/FlowReader.jsx';

/**
 * Content format → renderer component.
 * Media formats (video, audio, dash_video) are NOT in this map —
 * they use AudioPlayer/VideoPlayer via separate dispatch in SinglePlayer.
 */
const CONTENT_FORMAT_COMPONENTS = {
  singalong: SingalongScroller,
  readalong: ReadalongScroller,
  app: PlayableAppShell,
  readable_paged: PagedReader,
  readable_flow: FlowReader,
};

const MEDIA_PLAYBACK_FORMATS = new Set(['video', 'dash_video', 'audio']);

/**
 * Get the renderer component for a content format.
 * @param {string} format - Content format string from Play API
 * @returns {React.ComponentType | null} The renderer component, or null if not registered
 */
export function getRenderer(format) {
  return CONTENT_FORMAT_COMPONENTS[format] || null;
}

/**
 * Check if a format is a media playback format (video/audio).
 * Media formats use AudioPlayer/VideoPlayer, not the content format registry.
 * @param {string} format
 * @returns {boolean}
 */
export function isMediaFormat(format) {
  return MEDIA_PLAYBACK_FORMATS.has(format);
}

/**
 * Get all registered content format names.
 * @returns {string[]}
 */
export function getRegisteredFormats() {
  return Object.keys(CONTENT_FORMAT_COMPONENTS);
}
```

### Step 4: Run test to verify it passes

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation/frontend && npx vitest run src/lib/playable/registry.test.js`

Expected: All 8 tests PASS.

### Step 5: Commit

```bash
git add frontend/src/lib/playable/registry.js frontend/src/lib/playable/registry.test.js
git commit -m "feat: create playable format registry with tests

Extract CONTENT_FORMAT_COMPONENTS and MEDIA_PLAYBACK_FORMATS from
SinglePlayer into a dedicated registry module at lib/playable/.
SinglePlayer will consume this in the next commit.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Create usePlayableLifecycle hook

**Files:**
- Create: `frontend/src/lib/playable/usePlayableLifecycle.js`
- Create: `frontend/src/lib/playable/index.js`

### Step 1: Create the lifecycle hook

Create `frontend/src/lib/playable/usePlayableLifecycle.js`:

```javascript
// frontend/src/lib/playable/usePlayableLifecycle.js

/**
 * Hook for non-media playable content types.
 *
 * Handles the three Playable Contract lifecycle signals that non-media
 * renderers (apps, future slideshow/pageturner) need:
 *   1. Startup signal on mount
 *   2. Resolved metadata reporting when meta changes
 *   3. Media access registration (defaults to no media element)
 *
 * Media renderers (VideoPlayer, AudioPlayer) use useCommonMediaController instead.
 * Scroller renderers (Singalong, Readalong) use useMediaReporter instead.
 *
 * @param {Object} options
 * @param {Function} [options.onStartupSignal] - Called once on mount
 * @param {Function} [options.onResolvedMeta] - Called when meta changes (pass memoized meta)
 * @param {Function} [options.onRegisterMediaAccess] - Called once on mount with accessors
 * @param {Object|null} [options.meta] - Metadata to report (memoize to avoid re-fires)
 * @param {Object|null} [options.mediaAccess] - Media accessors (default: null element)
 */
import { useEffect } from 'react';

const NO_MEDIA_ACCESS = { getMediaEl: () => null, hardReset: null };

export function usePlayableLifecycle({
  onStartupSignal,
  onResolvedMeta,
  onRegisterMediaAccess,
  meta = null,
  mediaAccess = null
} = {}) {
  // Signal startup on mount
  useEffect(() => {
    onStartupSignal?.();
  }, []);

  // Report resolved metadata when meta changes
  useEffect(() => {
    if (meta) {
      onResolvedMeta?.(meta);
    }
  }, [meta]);

  // Register media access on mount
  useEffect(() => {
    onRegisterMediaAccess?.(mediaAccess || NO_MEDIA_ACCESS);
  }, []);
}
```

### Step 2: Create the barrel export

Create `frontend/src/lib/playable/index.js`:

```javascript
// frontend/src/lib/playable/index.js

export { getRenderer, isMediaFormat, getRegisteredFormats } from './registry.js';
export { usePlayableLifecycle } from './usePlayableLifecycle.js';
```

### Step 3: Verify build resolves imports

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation/frontend && npx vitest run src/lib/playable/registry.test.js`

Expected: All 8 tests still PASS (no import resolution issues introduced).

### Step 4: Commit

```bash
git add frontend/src/lib/playable/usePlayableLifecycle.js frontend/src/lib/playable/index.js
git commit -m "feat: add usePlayableLifecycle hook and barrel export

Hook encapsulates the three Playable Contract lifecycle signals
(startup, metadata, media access) for non-media renderers.
PlayableAppShell will consume this in the next commit.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Wire SinglePlayer to use the registry

**Files:**
- Modify: `frontend/src/modules/Player/components/SinglePlayer.jsx`

### Step 1: Update SinglePlayer imports

In `SinglePlayer.jsx`, replace the direct component imports and inline constants with registry imports.

**Remove these imports** (lines 3-6 approximately):
```javascript
import { SingalongScroller } from '../../ContentScroller/SingalongScroller.jsx';
import { ReadalongScroller } from '../../ContentScroller/ReadalongScroller.jsx';
import PlayableAppShell from './PlayableAppShell.jsx';
import PagedReader from './PagedReader.jsx';
import FlowReader from './FlowReader.jsx';
```

**Add this import:**
```javascript
import { getRenderer, isMediaFormat } from '../../../lib/playable/index.js';
```

### Step 2: Remove inline constants

**Remove** the `MEDIA_PLAYBACK_FORMATS` constant (line 17):
```javascript
const MEDIA_PLAYBACK_FORMATS = ['video', 'dash_video', 'audio'];
```

**Remove** the `CONTENT_FORMAT_COMPONENTS` constant (lines 19-26):
```javascript
const CONTENT_FORMAT_COMPONENTS = {
  singalong: SingalongScroller,
  readalong: ReadalongScroller,
  app: PlayableAppShell,
  readable_paged: PagedReader,
  readable_flow: FlowReader,
};
```

### Step 3: Update renderByFormat dispatch

In the `renderByFormat` function (around line 383), replace:

```javascript
if (MEDIA_PLAYBACK_FORMATS.includes(format)) {
```

With:

```javascript
if (isMediaFormat(format)) {
```

And replace:

```javascript
const ContentComponent = CONTENT_FORMAT_COMPONENTS[format];
```

With:

```javascript
const ContentComponent = getRenderer(format);
```

The rest of the dispatch logic stays identical — the `if (ContentComponent)` check and prop spreading are unchanged.

### Step 4: Run registry tests to verify no breakage

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation/frontend && npx vitest run src/lib/playable/registry.test.js`

Expected: All 8 tests PASS.

### Step 5: Run build check

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation/frontend && npx vite build 2>&1 | tail -5`

Expected: Build succeeds with no errors.

### Step 6: Commit

```bash
git add frontend/src/modules/Player/components/SinglePlayer.jsx
git commit -m "refactor: wire SinglePlayer to use playable format registry

SinglePlayer now imports getRenderer() and isMediaFormat() from
lib/playable/ instead of owning CONTENT_FORMAT_COMPONENTS and
MEDIA_PLAYBACK_FORMATS inline. No behavior change — adding new
playable content types no longer requires editing SinglePlayer.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Refactor PlayableAppShell to use usePlayableLifecycle

**Files:**
- Modify: `frontend/src/modules/Player/components/PlayableAppShell.jsx`

### Step 1: Rewrite PlayableAppShell

Replace the entire contents of `PlayableAppShell.jsx` with:

```javascript
// frontend/src/modules/Player/components/PlayableAppShell.jsx

/**
 * Bridges between SinglePlayer's format-based dispatch and AppContainer.
 *
 * When the Play API returns format: 'app', SinglePlayer renders this component.
 * It extracts the appId and param from the contentId and delegates to AppContainer.
 */
import { useMemo } from 'react';
import AppContainer from '../../AppContainer/AppContainer.jsx';
import { usePlayableLifecycle } from '../../../lib/playable/index.js';

export default function PlayableAppShell({
  contentId,
  clear,
  advance,
  onStartupSignal,
  onPlaybackMetrics,
  onResolvedMeta,
  onRegisterMediaAccess
}) {
  const localId = contentId?.replace(/^app:/, '') || '';

  const meta = useMemo(
    () => localId ? { title: localId, contentId } : null,
    [localId, contentId]
  );

  usePlayableLifecycle({
    onStartupSignal,
    onResolvedMeta,
    onRegisterMediaAccess,
    meta
  });

  return <AppContainer open={localId} clear={clear || advance || (() => {})} />;
}
```

**What changed:**
- Replaced `import { useEffect } from 'react'` → `import { useMemo } from 'react'`
- Added `import { usePlayableLifecycle } from '../../../lib/playable/index.js'`
- Replaced three manual `useEffect` hooks with one `usePlayableLifecycle` call
- Added `useMemo` for stable meta object reference
- Same props accepted, same JSX returned — zero behavior change

### Step 2: Run build check

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation/frontend && npx vite build 2>&1 | tail -5`

Expected: Build succeeds.

### Step 3: Commit

```bash
git add frontend/src/modules/Player/components/PlayableAppShell.jsx
git commit -m "refactor: use usePlayableLifecycle in PlayableAppShell

Replace three manual useEffect hooks with a single usePlayableLifecycle
call. Same lifecycle signals, same behavior — less boilerplate.
Future non-media playable types can use the same hook.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Integration verification

### Step 1: Run all unit tests

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation/frontend && npx vitest run`

Expected: All tests pass, including the new registry tests.

### Step 2: Run Playwright flow tests (if dev server available)

Check dev server: `lsof -i :3111`

If running, execute: `cd /Users/kckern/Documents/GitHub/DaylightStation && npx playwright test tests/live/flow/ --reporter=line 2>&1 | tail -20`

If not running, start it first: `cd /Users/kckern/Documents/GitHub/DaylightStation && npm run dev &` then wait 10 seconds and run the tests.

Expected: No regressions — all previously passing tests still pass.

### Step 3: Spot-check app format dispatch

If dev server is running, open browser to the app port and verify:
- A singalong content item renders SingalongScroller (unchanged)
- An `app:` content item renders PlayableAppShell → AppContainer (unchanged)

This is a manual check — no new Playwright test needed since behavior is identical.

---

## Task 6: Update documentation

**Files:**
- Modify: `docs/reference/content/content-playback.md`

### Step 1: Add registry section to content-playback.md

After the existing "Player Component Hierarchy" section (around line 159), add:

```markdown
### Playable Format Registry

The format→component mapping lives in `frontend/src/lib/playable/registry.js`, not in SinglePlayer. To add a new playable content type:

1. Create the renderer component implementing the Playable Contract (see below)
2. Import and register it in `frontend/src/lib/playable/registry.js`
3. No changes needed in SinglePlayer

**Registry API:**

| Export | Purpose |
|--------|---------|
| `getRenderer(format)` | Returns the component for a content format, or `null` |
| `isMediaFormat(format)` | Returns `true` for video/audio/dash_video |
| `getRegisteredFormats()` | Returns array of registered format names |

**For non-media renderers** (apps, future slideshow/pageturner), use the `usePlayableLifecycle` hook from `frontend/src/lib/playable/usePlayableLifecycle.js` to handle startup signal, metadata reporting, and media access registration in one call instead of manual `useEffect` wiring.
```

### Step 2: Update the Implementations table

In the existing "Implementations" table in content-playback.md (around line 203), update the PlayableAppShell row from:

```markdown
| PlayableAppShell | app | None (app-defined) | Minimal stub — delegates to AppContainer |
```

To:

```markdown
| PlayableAppShell | app | None (app-defined) | Via `usePlayableLifecycle` hook — delegates to AppContainer |
```

### Step 3: Commit

```bash
git add docs/reference/content/content-playback.md
git commit -m "docs: document playable format registry and lifecycle hook

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Summary

| Task | What changes | Risk |
|------|-------------|------|
| 1. Create registry | New files only | None — no existing code modified |
| 2. Create hook + barrel | New files only | None — no existing code modified |
| 3. Wire SinglePlayer | Remove inline constants, import registry | Low — pure extraction, same dispatch logic |
| 4. Refactor PlayableAppShell | Replace 3 effects with 1 hook call | Low — same lifecycle signals fired |
| 5. Integration verification | Nothing — just testing | None |
| 6. Update docs | Documentation only | None |

Every commit leaves the codebase in a working state. Tasks 1-2 are additive (new files only). Tasks 3-4 are substitutive (same behavior, different code path). No behavior changes anywhere.
