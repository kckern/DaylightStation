# ArtMode Menu-Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch an ArtMode preset from a "Gallery" menu — selecting a period engages the ArtMode scene on the current screen.

**Architecture:** Menu items use `action: Display, input: art:<preset>` (the backend list normalizer already maps this to `{ display: { contentId } }`). `MenuStack` routes a `display` selection whose id is an `art:` preset to the `display:content` action (the central scene handler from sub-project 3b) instead of the generic Displayer. Backed by silent period presets in `artmode.yml` and a hand-authored Gallery menu.

**Tech Stack:** React, Vitest, YAML config.

**Test runner:** `./node_modules/.bin/vitest run --config vitest.config.mjs <file>`.

---

## File Structure

- `frontend/src/modules/Menu/displaySelection.js` (new, pure) — `artSceneIdFromDisplay`.
- `frontend/src/modules/Menu/MenuStack.jsx` (modify) — route `art:` display selections to `display:content`.
- `data/household/config/artmode.yml` (modify, data volume) — add 7 silent period presets.
- `data/household/config/lists/menus/gallery.yml` (new, data volume) — the Gallery menu.
- `data/household/config/lists/menus/tvapp.yml` (modify, data volume) — top-level Gallery entry.
- Test: `frontend/src/modules/Menu/displaySelection.test.js`.

---

### Task 1: MenuStack routes `art:` display selections to the scene

**Files:**
- Create: `frontend/src/modules/Menu/displaySelection.js`
- Modify: `frontend/src/modules/Menu/MenuStack.jsx`
- Test: `frontend/src/modules/Menu/displaySelection.test.js`

- [ ] **Step 1: Write the failing test** — create `frontend/src/modules/Menu/displaySelection.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { artSceneIdFromDisplay } from './displaySelection.js';

describe('artSceneIdFromDisplay', () => {
  it('returns the id for an art: contentId', () => {
    expect(artSceneIdFromDisplay({ contentId: 'art:baroque' })).toBe('art:baroque');
  });
  it('accepts an id field too', () => {
    expect(artSceneIdFromDisplay({ id: 'art:modern' })).toBe('art:modern');
  });
  it('returns null for non-art display content', () => {
    expect(artSceneIdFromDisplay({ contentId: 'immich:abc' })).toBeNull();
    expect(artSceneIdFromDisplay({ contentId: 'canvas:photos' })).toBeNull();
  });
  it('returns null for empty/missing', () => {
    expect(artSceneIdFromDisplay(null)).toBeNull();
    expect(artSceneIdFromDisplay({})).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm FAIL** — `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Menu/displaySelection.test.js` (cannot resolve module).

- [ ] **Step 3: Create `frontend/src/modules/Menu/displaySelection.js`:**

```js
// Decide whether a menu `display` selection targets the ArtMode scene
// (an `art:<preset>` id) vs the generic Displayer overlay.
// Returns the art scene id, or null for ordinary display content.
export function artSceneIdFromDisplay(display) {
  const id = display?.contentId || display?.id;
  return (id && String(id).startsWith('art:')) ? id : null;
}

export default artSceneIdFromDisplay;
```

- [ ] **Step 4: Run to confirm PASS** — same command → 4 green.

- [ ] **Step 5: Wire it into `frontend/src/modules/Menu/MenuStack.jsx`.**

(a) Add two imports (after the existing `import { getLogger } ...` line near the top):
```jsx
import { getActionBus } from '../../screen-framework/input/ActionBus.js';
import { artSceneIdFromDisplay } from './displaySelection.js';
```

(b) Replace the existing `else if (selection.display)` branch in `handleSelect`:
```jsx
    } else if (selection.display) {
      // Map contentId to id for the Displayer component
      const display = { ...selection.display, id: selection.display.contentId || selection.display.id };
      push({ type: 'display', props: { ...selection, display } });
    } else if (selection.open) {
```
with:
```jsx
    } else if (selection.display) {
      const sceneId = artSceneIdFromDisplay(selection.display);
      if (sceneId) {
        // ArtMode scene — hand off to the central display:content handler.
        getActionBus().emit('display:content', { id: sceneId });
      } else {
        // Generic content — map contentId to id for the Displayer component.
        const display = { ...selection.display, id: selection.display.contentId || selection.display.id };
        push({ type: 'display', props: { ...selection, display } });
      }
    } else if (selection.open) {
```

- [ ] **Step 6: Confirm the helper tests pass and MenuStack still parses** — run the displaySelection test again (green) and a quick import-resolve check by running the existing Menu test:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Menu/displaySelection.test.js frontend/src/modules/Menu/RetryImg.test.jsx
```
Expected: green (the RetryImg test transitively imports nothing broken; if MenuStack has a syntax error it surfaces when the test bundles the Menu module — if RetryImg doesn't import MenuStack, additionally run `node -e "require('esbuild')" 2>/dev/null` is NOT needed; instead rely on the Task 3 full suite + the live build to catch any JSX issue).

- [ ] **Step 7: Commit**
```bash
git add frontend/src/modules/Menu/displaySelection.js frontend/src/modules/Menu/displaySelection.test.js frontend/src/modules/Menu/MenuStack.jsx
git commit -m "feat(artmode): menu-launch — route art: display selections to the scene"
```

---

### Task 2: Config — period presets, Gallery menu, TVApp entry

**Files (container data volume — not the git repo):**
- Modify: `data/household/config/artmode.yml`
- Create: `data/household/config/lists/menus/gallery.yml`
- Modify: `data/household/config/lists/menus/tvapp.yml`

- [ ] **Step 1: Rewrite `artmode.yml`** with the existing two presets plus seven silent period presets (heredoc inside `sh -c`, never sed):

```bash
sudo docker exec daylight-station sh -c "cat > data/household/config/artmode.yml << 'YAML'
# ArtMode presets — named presentation bundles (collection + music + display).
presets:
  gallery-silent:
    collection: all
    music: null
    placard: true
    matMargin: 4
    cropMaxPerSide: 8
    frame: { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 }
    ambient:
      defaultLux: 80
      curve: [ { lux: 0, dim: 0.92 }, { lux: 5, dim: 0.85 }, { lux: 40, dim: 0.55 }, { lux: 150, dim: 0.32 }, { lux: 400, dim: 0.15 } ]

  classical-evening:
    collection: all
    music: { queue: \"plex:622894\", shuffle: true, volume: 0.25 }
    placard: true
    matMargin: 4
    cropMaxPerSide: 8
    frame: { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 }
    ambient:
      defaultLux: 80
      curve: [ { lux: 0, dim: 0.92 }, { lux: 5, dim: 0.85 }, { lux: 40, dim: 0.55 }, { lux: 150, dim: 0.32 }, { lux: 400, dim: 0.15 } ]

  renaissance:   { collection: renaissance,   music: null, placard: true, matMargin: 4, cropMaxPerSide: 8, frame: { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 }, ambient: { defaultLux: 80, curve: [ { lux: 0, dim: 0.92 }, { lux: 5, dim: 0.85 }, { lux: 40, dim: 0.55 }, { lux: 150, dim: 0.32 }, { lux: 400, dim: 0.15 } ] } }
  baroque:       { collection: baroque,        music: null, placard: true, matMargin: 4, cropMaxPerSide: 8, frame: { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 }, ambient: { defaultLux: 80, curve: [ { lux: 0, dim: 0.92 }, { lux: 5, dim: 0.85 }, { lux: 40, dim: 0.55 }, { lux: 150, dim: 0.32 }, { lux: 400, dim: 0.15 } ] } }
  rococo:        { collection: rococo,         music: null, placard: true, matMargin: 4, cropMaxPerSide: 8, frame: { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 }, ambient: { defaultLux: 80, curve: [ { lux: 0, dim: 0.92 }, { lux: 5, dim: 0.85 }, { lux: 40, dim: 0.55 }, { lux: 150, dim: 0.32 }, { lux: 400, dim: 0.15 } ] } }
  romantic:      { collection: romantic,       music: null, placard: true, matMargin: 4, cropMaxPerSide: 8, frame: { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 }, ambient: { defaultLux: 80, curve: [ { lux: 0, dim: 0.92 }, { lux: 5, dim: 0.85 }, { lux: 40, dim: 0.55 }, { lux: 150, dim: 0.32 }, { lux: 400, dim: 0.15 } ] } }
  realism:       { collection: realism,        music: null, placard: true, matMargin: 4, cropMaxPerSide: 8, frame: { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 }, ambient: { defaultLux: 80, curve: [ { lux: 0, dim: 0.92 }, { lux: 5, dim: 0.85 }, { lux: 40, dim: 0.55 }, { lux: 150, dim: 0.32 }, { lux: 400, dim: 0.15 } ] } }
  impressionism: { collection: impressionism,  music: null, placard: true, matMargin: 4, cropMaxPerSide: 8, frame: { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 }, ambient: { defaultLux: 80, curve: [ { lux: 0, dim: 0.92 }, { lux: 5, dim: 0.85 }, { lux: 40, dim: 0.55 }, { lux: 150, dim: 0.32 }, { lux: 400, dim: 0.15 } ] } }
  modern:        { collection: modern,         music: null, placard: true, matMargin: 4, cropMaxPerSide: 8, frame: { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 }, ambient: { defaultLux: 80, curve: [ { lux: 0, dim: 0.92 }, { lux: 5, dim: 0.85 }, { lux: 40, dim: 0.55 }, { lux: 150, dim: 0.32 }, { lux: 400, dim: 0.15 } ] } }
YAML"
sudo docker exec daylight-station node -e "const y=require('js-yaml');const p=y.load(require('fs').readFileSync('data/household/config/artmode.yml','utf8')).presets;console.log('presets:', Object.keys(p).join(', ')); console.log('baroque collection:', p.baroque.collection, '| baroque music:', p.baroque.music);"
```
Expected: prints all 9 preset keys and `baroque collection: baroque | baroque music: null`.

- [ ] **Step 2: Create `gallery.yml`:**

```bash
sudo docker exec daylight-station sh -c "cat > data/household/config/lists/menus/gallery.yml << 'YAML'
title: Gallery
items:
  - { label: Renaissance,   action: Display, input: art:renaissance }
  - { label: Baroque,       action: Display, input: art:baroque }
  - { label: Rococo,        action: Display, input: art:rococo }
  - { label: Romantic,      action: Display, input: art:romantic }
  - { label: Realism,       action: Display, input: art:realism }
  - { label: Impressionism, action: Display, input: art:impressionism }
  - { label: Modern,        action: Display, input: art:modern }
YAML"
sudo docker exec daylight-station node -e "const y=require('js-yaml');const m=y.load(require('fs').readFileSync('data/household/config/lists/menus/gallery.yml','utf8'));console.log('gallery items:', m.items.length, '| first:', m.items[0].label, m.items[0].action, m.items[0].input);"
```
Expected: `gallery items: 7 | first: Renaissance Display art:renaissance`.

- [ ] **Step 3: Add a Gallery entry to `tvapp.yml`.** Read the current file, add ONE item (mirroring the Music entry) in the same items list, and write the complete file back:
```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/lists/menus/tvapp.yml'   # READ first
```
Then rewrite the whole file with a new item added next to the `Music` entry:
```yaml
      - input: menu:gallery
        action: List
        label: Gallery
```
(Use a heredoc to write the COMPLETE file with that block inserted — preserve everything else byte-for-byte. Do NOT sed.)

- [ ] **Step 4: Validate tvapp.yml parses and has the Gallery entry:**
```bash
sudo docker exec daylight-station node -e "const y=require('js-yaml');const m=y.load(require('fs').readFileSync('data/household/config/lists/menus/tvapp.yml','utf8'));const flat=JSON.stringify(m);console.log('has menu:gallery:', flat.includes('menu:gallery'));"
```
Expected: `has menu:gallery: true`.

- [ ] **Step 5: No git commit** (data-volume files aren't tracked).

---

### Task 3: Full suite + deploy + live verification

**Files:** none.

- [ ] **Step 1: Run the full art + menu + screensaver suite**
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Menu/displaySelection.test.js \
  tests/unit/art/ \
  frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx \
  frontend/src/screen-framework/widgets/ArtMode.test.jsx
```
Expected: all green.

- [ ] **Step 2: Build + deploy** (stash unrelated WIP first, restore after — per prior plans).

- [ ] **Step 3: Verify the period presets resolve over HTTP**
```bash
for p in renaissance baroque modern; do
  curl -s "http://localhost:3111/api/v1/art/preset/$p" | python3 -c "import sys,json;d=json.load(sys.stdin);print('$p ->','collection:',d.get('collection'),'music:',d.get('music'))"
done
```
Expected: each prints its own collection and `music: None`.

- [ ] **Step 4: Verify the Gallery menu resolves**
```bash
curl -s "http://localhost:3111/api/v1/list/menu:gallery" 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);items=d.get('items') or d.get('list') or [];print('gallery items:',len(items))" 2>/dev/null || echo "(check the actual list endpoint shape; the menu config is validated in Task 2 regardless)"
```

- [ ] **Step 5: Reload the living-room kiosk + manual QA note.** After reload, on the living-room TV: open the menu → Gallery → pick **Baroque** → ArtMode engages showing Baroque-era art (silent), exit returns to the menu. (Operator check on the physical screen.)

(Deploy is the operator's call; the plan ends at green tests + the preset/menu resolution checks.)

---

## Notes for the implementer
- Run specs with `./node_modules/.bin/vitest run --config vitest.config.mjs <file>` (NOT `npm test`).
- The whole menu-launch reduces to one routing branch — the backend (`action: Display` → `display` field) and the scene handler (`display:content` → ArtMode) already exist from earlier sub-projects.
- Task 2 edits the container data volume; use `sudo docker exec daylight-station sh -c "cat > ... << 'YAML' ... YAML"` (heredoc, never `sed`). For `tvapp.yml`, read the full file first and rewrite it complete with the one new item — preserve all other content exactly.
- `displaySelection.js` is intentionally tiny and pure so the routing decision is unit-tested without mocking MenuStack's full provider tree; the emit-vs-push wiring in `MenuStack` is a two-branch inline that the full suite + live build exercise.
