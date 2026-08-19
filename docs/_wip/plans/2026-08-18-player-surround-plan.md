# Player Surround Framework Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When the player plays a media item that has an authored sidecar, automatically shrink the video to a locked 16:9 box and frame it with playhead-synchronized modules (movement map, cue ticker, composer card) — with zero change to `Player.jsx` and byte-identical behavior for every un-enriched item.

**Architecture:** Three layers. A backend `SurroundStore` indexes YAML sidecars from `data/content/surround/` and attaches a resolved `surround` payload in the two playback projections (`PlayResponseService.toPlayResponse` and the queue handler). On the frontend, a `SurroundHost` wrapper at **two** mount seams (`ScreenPlayer` and `MenuStack`) reads that payload off the player's existing imperative handle, owns an independent 10 Hz media clock, and renders a declarative region layout. Every failure path collapses to rendering the bare player.

**Tech Stack:** Node/ESM backend (DDD layers), React 18 frontend, vitest + @testing-library, supertest, Playwright, js-yaml, SCSS.

**Source spec:** `docs/_wip/plans/2026-08-18-player-surround-spec.md` — read it before starting. It carries the assumption audit with file:line evidence for every claim below.

---

## Before you start: environment facts you will get wrong otherwise

**Running a backend colocated test.** `npm run test:backend` is **broken** — it points at `scripts/test-backend.mjs`, which does not exist. The isolated harness (`tests/_infrastructure/harnesses/isolated.harness.mjs:86`) walks only `frontend/src` for colocated specs, so the 334 colocated backend tests are gated by no npm script. Run them directly:

```bash
./frontend/node_modules/.bin/vitest run --config vitest.config.mjs <path/to/file.test.mjs>
```

Verified working against `backend/src/4_api/v1/routers/play.userlog.test.mjs` (3 tests pass). Do **not** pass `--reporter=basic`; that reporter does not exist in vitest 4.0.18 here and fails to load. Use the default reporter.

**Running a frontend colocated test.** Same binary and config:

```bash
./frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Surround/SurroundHost.test.jsx
```

**Do not "fix" the broken `test:backend` script as part of this work.** It is a pre-existing repo gap. Note it and move on.

**Data tree.** Sidecars and assets live under the data/media dirs resolved from `DAYLIGHT_BASE_PATH` in `.env` — **not** in the repo. They are Dropbox-synced. Never commit them; never put real household data in test fixtures (use temp dirs).

**Logging.** CLAUDE.md forbids raw `console.*` for diagnostics in new code. Backend uses the injected structured logger; frontend uses `getLogger().child({ component })`, with the lazy module-level pattern in hooks. Every event in the spec's logging tables is required, not optional.

**Commit discipline.** Commit after each task. Conventional commits. Do not push.

---

## Task 1: SurroundStore — index, inheritance, exact match

**Files:**
- Create: `backend/src/1_adapters/content/surround/SurroundStore.mjs`
- Test: `backend/src/1_adapters/content/surround/SurroundStore.test.mjs`

**Step 1: Write the failing test**

Build the fixture tree in a temp dir so no household data is touched.

```javascript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SurroundStore } from './SurroundStore.mjs';

let root;
const makeLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() });

function writeFixture() {
  mkdirSync(path.join(root, '_surrounds'), { recursive: true });
  mkdirSync(path.join(root, 'classical/beethoven'), { recursive: true });
  writeFileSync(path.join(root, '_surrounds/concert-hall.yml'),
    'id: concert-hall\nregions:\n  right: { width: 20%, module: composer-card }\n  bottom:\n    - { module: movement-map, height: 60 }\ncollapse: { footerFloor: 90 }\n');
  writeFileSync(path.join(root, 'classical/beethoven/_composer.yml'),
    'name: Ludwig van Beethoven\nborn: 1770\ndied: 1827\nbirthplace: Bonn\nportrait: beethoven/portrait.jpg\n');
  writeFileSync(path.join(root, 'classical/beethoven/symphony-3-eroica.yml'),
    'surround: concert-hall\nmatch:\n  contentId: plex:663134\n  title: "Beethoven: 3. Sinfonie"\npiece:\n  title: Symphony No. 3\n  opus: Op. 55\nmovements:\n  - { n: 1, name: Allegro con brio, start: 0 }\ncomposer:\n  birthplace: Bonn (Electorate of Cologne)\n');
}

beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'surround-')); writeFixture(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('SurroundStore exact lookup', () => {
  it('returns a resolved payload for an exact contentId match', () => {
    const store = new SurroundStore({ rootDir: root, logger: makeLogger() });
    const r = store.lookup('plex:663134', 'anything');
    expect(r).not.toBeNull();
    expect(r.id).toBe('concert-hall');
    expect(r.definition.regions.right.module).toBe('composer-card');
    expect(r.piece.title).toBe('Symphony No. 3');
    expect(r.movements).toHaveLength(1);
    expect(r.assetBase).toBe('surround/classical');
  });

  it('merges _composer.yml under the piece composer block, piece winning per key', () => {
    const store = new SurroundStore({ rootDir: root, logger: makeLogger() });
    const r = store.lookup('plex:663134', '');
    expect(r.composer.name).toBe('Ludwig van Beethoven');   // inherited
    expect(r.composer.born).toBe(1770);                      // inherited
    expect(r.composer.birthplace).toBe('Bonn (Electorate of Cologne)'); // piece override wins
  });

  it('returns exactly null for a miss', () => {
    const store = new SurroundStore({ rootDir: root, logger: makeLogger() });
    expect(store.lookup('plex:999999', 'Nothing')).toBeNull();
  });
});
```

**Step 2: Run it to verify it fails**

```bash
./frontend/node_modules/.bin/vitest run --config vitest.config.mjs backend/src/1_adapters/content/surround/SurroundStore.test.mjs
```
Expected: FAIL — cannot resolve `./SurroundStore.mjs`.

**Step 3: Write the minimal implementation**

Walk `<rootDir>/<domain>/<composer>/*.yml`, skipping `_`-prefixed files and folders as piece files. Load `_surrounds/{id}.yml` definitions. Deep-merge `_composer.yml` under the piece's `composer:` block. `assetBase` is `surround/<domain>` (`surround/classical`). Index by `match.contentId`. `lookup()` must never throw — wrap the whole body in try/catch returning `null`.

Use `js-yaml` (already a dependency) and `node:fs`. Emit `surround.index.built` (info) with `{ pieces, composers, definitions, ms }` after each build.

**Step 4: Run to verify it passes**

Same command. Expected: 3 passed.

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/surround/
git commit -m "feat(surround): add SurroundStore with sidecar indexing and composer inheritance"
```

---

## Task 2: SurroundStore — title rebind fallback

Live Plex titles carry orchestra suffixes (`Beethoven: 3. Sinfonie ∙ hr-Sinfonieorchester ∙ Andrés Orozco-Estrada`), so rebinding must be a **normalized substring** match, not equality. This is the ratingKey-churn safety net.

**Files:**
- Modify: `backend/src/1_adapters/content/surround/SurroundStore.mjs`
- Modify: `backend/src/1_adapters/content/surround/SurroundStore.test.mjs`

**Step 1: Write the failing test**

```javascript
describe('SurroundStore title rebind', () => {
  it('matches a real Plex title with an orchestra suffix when the contentId is stale', () => {
    const logger = makeLogger();
    const store = new SurroundStore({ rootDir: root, logger });
    const r = store.lookup('plex:999999', 'Beethoven: 3. Sinfonie (»Eroica«) ∙ hr-Sinfonieorchester ∙ Andrés Orozco-Estrada');
    expect(r).not.toBeNull();
    expect(r.piece.title).toBe('Symphony No. 3');
    const warned = logger.warn.mock.calls.find(c => c[0] === 'surround.match.rebound');
    expect(warned).toBeDefined();
    expect(warned[1].staleContentId).toBe('plex:999999');
  });

  it('does not rebind an unrelated title', () => {
    const store = new SurroundStore({ rootDir: root, logger: makeLogger() });
    expect(store.lookup('plex:999999', 'Vivaldi: Spring')).toBeNull();
  });
});
```

**Step 2: Run to verify it fails**

Expected: FAIL — rebind returns `null`.

**Step 3: Implement**

Normalize both sides: lowercase, strip punctuation including guillemets `»«` and interpuncts `∙`, collapse whitespace. Match when either normalized string contains the other (longer-contains-shorter). On a hit, log `surround.match.rebound` (warn) with `{ staleContentId, matchedTitle, file }`.

**Step 4: Run to verify it passes** — 5 passed.

**Step 5: Commit**

```bash
git commit -am "feat(surround): rebind sidecars by normalized title when ratingKey is stale"
```

---

## Task 3: SurroundStore — fail-soft on bad data

**Files:** modify store + test.

**Step 1: Write the failing tests**

```javascript
describe('SurroundStore fail-soft', () => {
  it('skips a malformed YAML file, warns, and still indexes the rest', () => {
    writeFileSync(path.join(root, 'classical/beethoven/broken.yml'), 'surround: [unclosed\n');
    const logger = makeLogger();
    const store = new SurroundStore({ rootDir: root, logger });
    expect(store.lookup('plex:663134', '')).not.toBeNull();   // sibling still works
    expect(logger.warn.mock.calls.some(c => c[0] === 'surround.sidecar.invalid')).toBe(true);
  });

  it('returns null when the named definition file is missing', () => {
    writeFileSync(path.join(root, 'classical/beethoven/symphony-3-eroica.yml'),
      'surround: does-not-exist\nmatch: { contentId: plex:663134 }\npiece: { title: X }\n');
    const logger = makeLogger();
    const store = new SurroundStore({ rootDir: root, logger });
    expect(store.lookup('plex:663134', '')).toBeNull();
    expect(logger.warn.mock.calls.some(c => c[0] === 'surround.definition.missing')).toBe(true);
  });

  it('skips a sidecar missing required keys', () => {
    writeFileSync(path.join(root, 'classical/beethoven/nokeys.yml'), 'piece: { title: Orphan }\n');
    const logger = makeLogger();
    const store = new SurroundStore({ rootDir: root, logger });
    expect(logger.warn.mock.calls.some(c => c[0] === 'surround.sidecar.invalid')).toBe(true);
  });
});
```

**Step 2: Run — FAIL.**

**Step 3: Implement** per-file try/catch during indexing; validate `surround:` and `match:` present; resolve the definition at lookup time and return `null` + warn when absent.

**Step 4: Run — 8 passed.**

**Step 5: Commit**

```bash
git commit -am "feat(surround): fail soft on malformed sidecars and missing definitions"
```

---

## Task 4: SurroundStore — mtime-guarded freshness

This replaces a reload endpoint. Without it, every authoring edit costs a backend restart — which will dominate the time you spend on Task 17.

**Files:** modify store + test.

**Step 1: Write the failing test**

```javascript
describe('SurroundStore freshness', () => {
  it('picks up an edited sidecar after the guard window without a restart', () => {
    vi.useFakeTimers();
    const store = new SurroundStore({ rootDir: root, logger: makeLogger() });
    expect(store.lookup('plex:663134', '').piece.title).toBe('Symphony No. 3');

    writeFileSync(path.join(root, 'classical/beethoven/symphony-3-eroica.yml'),
      'surround: concert-hall\nmatch: { contentId: plex:663134 }\npiece: { title: Edited Title }\n');
    vi.advanceTimersByTime(3000);   // past the 2s guard

    expect(store.lookup('plex:663134', '').piece.title).toBe('Edited Title');
    vi.useRealTimers();
  });
});
```

**Step 2: Run — FAIL** (stale index returns the old title).

**Step 3: Implement.** Track `lastCheckedAt` and `builtAt`. On lookup, if `Date.now() - lastCheckedAt > 2000`, stat the tree's directories and piece files; rebuild if any mtime exceeds `builtAt`. Use `Date.now()` so fake timers control it.

**Step 4: Run — 9 passed.**

**Step 5: Commit**

```bash
git commit -am "feat(surround): rebuild index on mtime change for live sidecar authoring"
```

---

## Task 5: Attach surround in the play projection

Covers all five play-route call sites at once.

**Files:**
- Modify: `backend/src/3_applications/content/services/PlayResponseService.mjs`
- Test: `backend/src/3_applications/content/services/PlayResponseService.surround.test.mjs`

**Step 1: Write the failing test**

Two cases: with a hit → `response.surround` present; with no store or a miss → key absent and the response otherwise identical (assert with `toEqual` against the no-store response).

**Step 2: Run — FAIL.**

**Step 3: Implement.** Add optional `surroundStore` to the constructor, following the existing optional `progressSyncService` pattern (`PlayResponseService.mjs:34-38`). At the end of `toPlayResponse`:

```javascript
try {
  const s = this.#surroundStore?.lookup(item.id, item.title);
  if (s) response.surround = s;
} catch (err) {
  this.#logger?.warn?.('surround.attach.failed', { contentId: item.id, error: err?.message });
}
```

Log `surround.attach` (debug) with `{ contentId, surroundId, path: 'play' }` on success.

**Step 4: Run — pass.**

**Step 5: Commit**

```bash
git commit -am "feat(surround): attach surround payload in play projection"
```

---

## Task 6: Attach surround in the queue projection

`toQueueItem` stays pure and sync — enrichment is a handler concern.

**Files:**
- Modify: `backend/src/4_api/v1/routers/queue.mjs`
- Test: `backend/src/4_api/v1/routers/queue.surround.test.mjs`

**Step 1: Write the failing tests** (supertest, following `play.userlog.test.mjs`):

1. Store hit → the item carries the `surround` payload verbatim.
2. Store miss → the response **deep-equals** the response from a router built with no store at all. This is the byte-identical fail-soft claim, asserted rather than assumed.
3. Store throws → handler still returns 200 without `surround`.

**Step 2: Run — FAIL.**

**Step 3: Implement.** `createQueueRouter(config)` gains optional `surroundStore`. After `items.map(toQueueItem)` (`queue.mjs:149`), wrap enrichment in try/catch and attach per item.

**Step 4: Run — pass.**

**Step 5: Commit**

```bash
git commit -am "feat(surround): attach surround payload in queue projection"
```

---

## Task 7: Compose the store

**Files:** Modify `backend/src/5_composition/modules/contentApi.mjs`

**Step 1:** Construct `new SurroundStore({ rootDir: path.join(dataPath, 'content/surround'), logger })`.

**Step 2:** Inject into `new PlayResponseService({ ..., surroundStore })` (`:121`) and `createQueueRouter({ ..., surroundStore })` (`:139`).

**Step 3: Verify the layer gate still passes**

```bash
npm run audit:layers
```
Expected: no new violations.

**Step 4: Commit**

```bash
git commit -am "feat(surround): compose SurroundStore into content API"
```

---

## Task 8: `useMediaClock` — independent playhead subscriber

**Do not** extract the driver out of `useContentFilter.js`. The audit found it entangled with skip-card timers that have deliberately asymmetric cleanup; extraction would destabilize a production content filter. `requestVideoFrameCallback` supports multiple concurrent callbacks, so run a parallel one.

**Files:**
- Create: `frontend/src/lib/Player/useMediaClock.js`
- Test: `frontend/src/lib/Player/useMediaClock.test.js`

**Step 1: Write the failing test.** Fake media element (an `EventTarget` with `currentTime` / `duration` / `paused`). Assert: position updates after `timeupdate`; `seeking` sets the flag and `seeked` clears it with the new position; a null element yields zeros and never throws; listeners are removed on unmount.

**Step 2: Run — FAIL.**

**Step 3: Implement.** Model on `useContentFilter.js:250-285`: rVFC loop when available, always-on listeners for `timeupdate, seeked, ratechange, playing, waiting, pause, ended`, `seeking` flag from the `seeking` event. Expose `{ subscribe, getState }` plus `useMediaClockState({ hz = 10 })`.

**10 Hz is the default for React props, not the raw ~40 Hz frame rate.** Kiosk pages in this house have degraded to 10 fps, and re-rendering every module 40×/sec is the likeliest way to reproduce that. A cursor on a 54-minute piece moves under 0.04%/second — sub-frame precision buys nothing visible.

Emit `surround.clock.driver` (debug) once per element and `surround.clock.stalled` (warn) when `playing` is true with no tick for 5 s.

**Step 4: Run — pass.**

**Step 5: Commit**

```bash
git add frontend/src/lib/Player/useMediaClock.*
git commit -m "feat(surround): add independent 10Hz media clock subscriber"
```

---

## Task 9: Module registry

**Files:**
- Create: `frontend/src/modules/Surround/registry.js`
- Create: `frontend/src/modules/Surround/builtins.js`

Reuse the `WidgetRegistry` **class** from `screen-framework/widgets/registry.js` (it is UI-framework-agnostic) as a **separate instance** — do not share the screen widget registry, and do not use `PanelRenderer` (static props only, no per-tick channel).

Export `registerSurroundModule(name, Component)` and `getSurroundRegistry()`. `builtins.js` registers `movement-map`, `cue-ticker`, `composer-card` and is imported by `SurroundHost`, so neither seam needs a registration call.

Commit: `feat(surround): add surround module registry`

---

## Task 10: `SurroundFrame` — layout, 16:9 lock, region resolution, collapse

**Files:**
- Create: `frontend/src/modules/Surround/SurroundFrame.jsx`
- Create: `frontend/src/modules/Surround/SurroundFrame.scss`
- Test: `frontend/src/modules/Surround/SurroundFrame.test.jsx`

Structure copies `FitnessPlayerFrame` (verified pure layout with the right slot geometry) into a new `surround-frame__*` namespace. **Build a copy — do not import across the module boundary.**

- Grid: main column + right rail (`width` from `definition.regions.right.width`, default 20%), rail full height.
- Main column: media box (flex-grow, centering an inner `aspect-ratio: 16/9; max-width: 100%; max-height: 100%` box that `children` fill — letterbox, never distort), then the footer stack spanning exactly the media-box width.
- Collapse: `ResizeObserver` on the footer; below `collapse.footerFloor` (default 90 px), unmount regions marked `collapse: first` and log `surround.collapse` (debug).
- Region → module via `surroundRegistry.get(name)`; unknown module → empty region + `surround.module.missing` (warn).
- `overlay` slot reserved (absolute, `pointer-events: none`), unused in the PoC.

**Tests:** renders declared regions; unknown module leaves an empty region and warns; media box holds a 16:9 ratio; footer below the floor drops the `collapse: first` region.

Commit: `feat(surround): add SurroundFrame with aspect-locked media box`

---

## Task 11: `MovementMap`

**Files:** create `frontend/src/modules/Surround/modules/MovementMap.jsx` + `.test.jsx`

Proportional bars from `data.movements` and `duration`. Movement *i* spans `[start_i, start_{i+1} ?? duration)`. Active-movement highlight plus a position cursor. No SVG templates in the PoC.

**Tests:** 4 movements over 3223 s → segment widths proportional; `position=917` → movement 2 active; a position jump moves the cursor in the same render.

Commit: `feat(surround): add MovementMap module`

---

## Task 12: `CueTicker`

**Files:** create `frontend/src/modules/Surround/modules/CueTicker.jsx` + `.test.jsx`

Timed `data.cues` (`render: docked`, or unknown → treated as docked) fire while `at ≤ position < at + dwell` (dwell default 12 s). When no cue is active, cycle `data.facts` on a 20 s timer. **A timed cue always preempts a fact.** Seeks re-evaluate naturally off `position`. Log `surround.cue.shown` (debug) with `{ kind: 'cue'|'fact', at }`.

**Tests (fake timers):** facts cycle; a cue at 917 preempts the fact at `position=917`; the cue expires after dwell; no cues and no facts renders empty without throwing.

Commit: `feat(surround): add CueTicker module`

---

## Task 13: `ComposerCard`

**Files:** create `frontend/src/modules/Surround/modules/ComposerCard.jsx` + `.test.jsx`

Static identity from `data.composer` and `data.piece`: portrait, name, dates, piece/opus, composed/premiered. Position-independent (receives the contract, ignores it). Asset URLs via `DaylightMediaPath('media/img/' + data.assetBase + '/' + ref)`. Every `<img>` hides itself `onError` and logs `surround.asset.missing` (warn, sampled ≤5/min).

**Test:** renders inherited composer fields; a broken image hides without breaking layout.

Commit: `feat(surround): add ComposerCard module`

---

## Task 14: Setting context

**Files:**
- Create: `frontend/src/modules/Surround/SurroundSettingContext.js` (default `'auto'`)
- Modify: `frontend/src/screen-framework/ScreenRenderer.jsx` — wrap the rendered tree in `<SurroundSettingContext.Provider value={config.surround ?? 'auto'}>` alongside the existing providers (~`:421-429`)

Screen YAML is unvalidated pass-through, so no schema work is needed. No screen YAML edits are required for the PoC — `auto` is the default, and authoring the sidecar is the opt-in.

Commit: `feat(surround): thread surround setting from screen config`

---

## Task 15: `SurroundHost`

**Files:**
- Create: `frontend/src/modules/Surround/SurroundHost.jsx`
- Test: `frontend/src/modules/Surround/SurroundHost.test.jsx`

**Step 1: Write the failing tests** — these encode the fail-soft contract, so write them first:

1. No `surround` on now-playing → renders children with **no wrapper element** (snapshot the container: identical to bare children).
2. `surround` present, mode `auto` → `surround-frame` root present, video children inside the media box.
3. Mode `off` → bare children even when enriched.
4. A module throws in render → the error boundary logs `surround.render.error` and children still mount.
5. Queue advance to an un-enriched item (poll tick with changed `getNowPlaying`) → frame unmounts, children remain.

**Step 2: Run — FAIL.**

**Step 3: Implement.**

- Read `mode` from `SurroundSettingContext` (default `auto`); `off` → always bare.
- Poll `getPlayerHandle()?.getNowPlaying()?.item` at 1 Hz for a `surround` field (the established pattern — `usePlayerSessionBinding.js` polls the same handle). Track the current contentId so queue advances swap or drop the frame.
- Own the clock: `useMediaClock({ getMediaEl: () => getPlayerHandle()?.getMediaElement?.() ?? null })`.
- Active → `<SurroundErrorBoundary><SurroundFrame …>{children}</SurroundFrame></SurroundErrorBoundary>`; otherwise render `children` **directly, with no wrapper div** — DOM-identical to today.
- Forced mode (`<id>`) only forces rendering when the item already carries `surround`; forcing a definition onto un-enriched items is deferred.
- Log `surround.mount` / `surround.unmount` / `surround.item-change` / `surround.disabled` per the spec table.

**Step 4: Run — pass.**

**Step 5: Commit**

```bash
git commit -am "feat(surround): add SurroundHost seam wrapper with error boundary"
```

---

## Task 16: Wire both seams

**This is the task the original design got wrong.** WebSocket and URL playback converge on `ScreenPlayer`, but **menu-selected playback does not** — `MenuStack.jsx:12` lazy-imports raw `Player` and mounts it at `:250` and `:257`, and MenuStack is reached both from `menu:open` and from the living-room's primary `menu` layout widget. Both seams must be wrapped or menu playback silently never frames.

**Files:**
- Modify: `frontend/src/screen-framework/publishers/ScreenPlayer.jsx`
- Modify: `frontend/src/modules/Menu/MenuStack.jsx`

**Step 1: ScreenPlayer**

```jsx
return (
  <SurroundHost getPlayerHandle={() => playerRef.current}>
    <Player {...props} ref={playerRef} />
  </SurroundHost>
);
```

**Step 2: MenuStack** — wrap the `case 'player'` (`:250`) and `case 'composite'` (`:257`) renders the same way, using the already-forwarded `playerRef`: `getPlayerHandle={() => playerRef?.current}`. When no ref was forwarded, the getter returns `null` and `SurroundHost` renders bare children.

**Step 3: Confirm nothing else is touched.** Player-embedding apps outside the screen framework (Fitness, Piano, School, Feed, Media, Admin) are deliberately unchanged and never framed. `Player.jsx` is **not** modified — if you find yourself editing it, stop and re-read the spec's architecture table.

**Step 4: Run the frontend colocated suite**

```bash
./frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Surround frontend/src/screen-framework
```
Expected: all pass, including the pre-existing screen-framework tests.

**Step 5: Commit**

```bash
git commit -am "feat(surround): wrap Player at both playback seams"
```

---

## Task 17: Author the two PoC pieces

**Files (in the data tree, NOT the repo — never commit these):**
- `data/content/surround/_surrounds/concert-hall.yml`
- `data/content/surround/classical/vivaldi/_composer.yml` + `four-seasons-spring.yml`
- `data/content/surround/classical/beethoven/_composer.yml` + `symphony-3-eroica.yml`
- `media/img/surround/classical/{vivaldi,beethoven}/portrait.jpg` (+ city images)

Verified live: `plex:663146` = Vivaldi "Spring" (628 s), `plex:663134` = Eroica (3223 s). Eroica movement starts: 0 / 917 / 1810 / 2158.

**Spring's movement start times are not in the spec** — take them from the actual video during authoring. Three movements over 628 s.

Portraits from Wikimedia Commons (public domain; the repo has a `wikimedia-commons-images` skill). Note the `feedback_progressive_jpeg_avatars` gotcha if these ever render in the garage Firefox kiosk — re-encode baseline.

**Verify the store sees them:**

```bash
curl -s "http://localhost:{backend_port}/api/v1/play/plex:663146" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('surround:', j.surround ? j.surround.id : 'ABSENT')})"
```
Expected: `surround: concert-hall`. If `ABSENT`, the store did not index — check the `surround.sidecar.invalid` warnings in the log store before touching code.

No commit (data tree is not in git). Record in the plan's completion notes that the sidecars exist.

---

## Task 18: Runtime gate

**Files:** Create `tests/live/flow/surround/surround-poc.runtime.test.mjs`

Preconditions in `beforeAll` that **fail, never skip** (CLAUDE.md test discipline): backend healthy; `GET /api/v1/play/plex:663146` returns a `surround` field.

1. Navigate with `?play=plex:663146` (URL autoplay path): `.surround-frame` appears, a `video`/`dash-video` element is inside the media box, and the media box ratio is 16:9 ±1%.
2. Seek: the MovementMap cursor offset changes consistently with the new `currentTime`.
3. Ticker: the cue-ticker region's text changes within the fact-cycle window (use a cue near the start of "Spring" rather than fake timers).
4. Regression: `?play=` an un-enriched item from the same library → `.surround-frame` absent, player still mounts.
5. **Menu-path parity** — open a menu (`menu:open`), select an enriched item, assert `.surround-frame` appears. This is the test that would have caught the design's seam error; do not drop it.

Port/URL discipline via `tests/_lib/configHelper.mjs` and `tests/_fixtures/runtime/urls.mjs`. Never hardcode ports.

```bash
npx playwright test tests/live/flow/surround/ --reporter=line
```

Commit: `test(surround): add PoC runtime gate with menu-path parity`

---

## Definition of done

- Both pieces surround-play through **all three** trigger paths: WS command, URL `?play=`, and a menu selection.
- Video locked 16:9 throughout; movement cursor tracks across seeks; ticker cycles.
- Every un-enriched item plays byte-identically — **asserted** by the queue deep-equal test, not eyeballed.
- No raw `console.*` in new code; every spec logging event emitted.
- `npm run audit:layers` clean.

**Measure on hardware, do not assume:** kiosk framerate with the 10 Hz clock on the 54-minute Eroica page, and that the rebind warning actually fires after a deliberate test rescan.

## Out of scope

Backfill pipeline; chapter-marker extraction; `render: overlay` pop-ups (schema already carries `render:`, frame already reserves the slot); audio cues; SVG structure templates; forcing a definition onto un-enriched items.
