# Player Surround Framework — Implementation Spec

> Status: spec, 2026-08-18. Derived from `docs/roadmap/2026-08-18-player-surround-framework.md`,
> verified against the codebase. Scope: two-piece PoC (Vivaldi "Spring" `plex:663146`,
> Beethoven "Eroica" `plex:663134`). The 100-piece backfill pipeline is out of scope.

---

## Assumption audit

Every load-bearing claim in the design doc, checked against real code.

| # | Design claim | Verdict | Evidence & correction |
|---|---|---|---|
| 1 | "ScreenPlayer is the single seam every screen-framework playback path goes through." | **CORRECTED** | `ScreenPlayer.jsx` (32 lines, renders `<Player {...props} ref>` at `frontend/src/screen-framework/publishers/ScreenPlayer.jsx:29`) is the mount for ActionBus playback only: `media:play` / `media:queue` / `media:queue-op` / playback-secondary at `ScreenActionHandler.jsx:154,163,188,215,217`. **Menu-selected playback bypasses it entirely**: `MenuStack.jsx:12` lazy-imports raw `Player`, and mounts it at `MenuStack.jsx:250` (`case 'player'`) and `:257` (`case 'composite'`). MenuStack is reached from both the `menu:open` overlay (`ScreenActionHandler.jsx:133`) and — critically — the living-room's primary UI, the layout `menu` widget (`MenuWidget.jsx:43`). So remote-driven menu picks, the most common TV playback path, never touch ScreenPlayer. WS commands (`useScreenCommands.js:99-106`) and URL autoplay (`ScreenRenderer.jsx:122-135`) do converge on ScreenPlayer via the ActionBus. **Corrected seam: two mount points, one shared wrapper** — a `SurroundHost` wraps `<Player>` in both `ScreenPlayer.jsx` and MenuStack's `player`/`composite` cases (§ Render layer). `PipManager.jsx` does NOT mount Player (no import). Other Player mounts (Fitness ×3, Piano ×2, School, Feed `PersistentPlayer`, Media-app `PlayerBridge`, Admin preview) are separate app surfaces, deliberately out of scope. |
| 2 | "`toQueueItem()` in `queue.mjs` is the single projection every played item flows through." | **CORRECTED** | `toQueueItem` (`backend/src/4_api/v1/routers/queue.mjs:7`) is used only by the queue route (`queue.mjs:149`) and already attaches optional `slideshow`/`titlecard`/`segment` (`queue.mjs:58-60`) — that half is confirmed. But the single-item path is a **second, independent projection**: `Player.jsx:1222` and `modules/Player/lib/api.js:149` fetch `/api/v1/play/<id>`, served by `play.mjs`, which builds its DTO via `PlayResponseService.toPlayResponse()` (`backend/src/3_applications/content/services/PlayResponseService.mjs:56`), called at five sites (`play.mjs:360,403,417,473,486`). `list.mjs`'s `toListItem` (`list.mjs:71`) is a menu projection, not a playback payload — items selected from lists are re-fetched through play/queue, so it needs no change. **Both** projections must attach `surround`: once in `toPlayResponse` (covers all five play call sites), once in the queue handler. |
| 3 | "`DataService.content` scope exists with read/resolvePath/resolveDir." | **CONFIRMED** (with pattern correction) | `DataService.mjs:113` (`this.content = this.#createContentScope()`), scope at `DataService.mjs:292-345` with `resolvePath`/`resolveDir`/`read`/`write`. However the "adapter + manifest pair" framing is wrong for this feature: `manifest.mjs` files (`readalong/manifest.mjs:3-27`) are **content-source registration descriptors** for `ContentSourceRegistry` (`bootstrap.mjs:753-777`); adapters registered there serve playable IDs (`resolvePlayables`). A surround is enrichment, not a playable source — nothing plays `surround:x` — so registering it in the source registry would be wrong. **Corrected: a plain store class** (`YamlSurroundStore`), composed in `contentApi.mjs` and injected into the two projections. On caching: SingalongAdapter reads YAML per request (`SingalongAdapter.mjs:141-143` → `loadContainedYaml`, `FileIO.mjs:212`, no cache); ReadalongAdapter caches manifests for process lifetime with no invalidation (`ReadalongAdapter.mjs:242-253`); the content-filter router — the closest precedent — reads per request (`contentFilter.mjs:29-43`). **The design's "cache reload hook" risk dissolves**: follow the per-request/mtime-guarded pattern and authoring edits are live without a restart (§ YamlSurroundStore). |
| 4 | "useContentFilter's rVFC ticker can be extracted into a shared useMediaClock." | **CORRECTED** | The driver exists exactly as described: rVFC per displayed frame with `timeupdate`/`seeked`/`ratechange`/`playing`/`waiting` re-evaluation and `seeking` release (`useContentFilter.js:250-285`). But it is not extractable at low risk: `tick` is a 110-line closure owning cue enter/exit lifecycle, skip-card pause/resume timers whose cleanup is deliberately asymmetric (`useContentFilter.js:276-283` — "do NOT clear the skip-card timer here"), overlay fade state, and session logging. Restructuring a production content filter to share a driver is exactly the destabilization the filter's comments warn about. **Corrected: a parallel, independent subscriber.** `requestVideoFrameCallback` supports multiple concurrent callbacks per element and event listeners are additive, so a new `useMediaClock` hook attaches its own listeners to the same element, modeled on lines 250-285, and never touches the filter. Cost is one extra rVFC callback — negligible. The media element is reachable without touching Player: the imperative handle exposes `getMediaElement` (`Player.jsx:1191`), `getCurrentTime`/`getDuration` (`Player.jsx:1175-1186`), and `getNowPlaying` (`Player.jsx:1194`); `ScreenPlayer` already holds that ref (`ScreenPlayer.jsx:14`), MenuStack receives one as a prop (`MenuStack.jsx:252`). |
| 5 | "FitnessPlayerFrame can be generalized into SurroundFrame." | **CONFIRMED** as a model, not a reuse | `FitnessPlayerFrame.jsx:29-114` is genuinely pure layout — sidebar/footer/overlay slots, zero fitness domain knowledge; the SCSS geometry (`FitnessPlayerFrame.scss:14-91`) already matches the surround design: footer inside `__main` so it spans the main column only, sidebar full height, absolutely-positioned overlay. Fitness-specific: class namespace (`fitness-player-frame__*`), module location (`modules/Fitness/player/frames/`), fullscreen-mode semantics, no aspect lock. The 16:9 aspect-locked media box is achievable in this layout model: an inner `aspect-ratio: 16/9; max-width:100%; max-height:100%; margin:auto` box inside the content slot letterboxes cleanly. **Build a new `SurroundFrame` copied from this structure**; do not import or subclass the fitness component across module boundaries. |
| 6 | "The widget registry + PanelRenderer can resolve region→module declarations." | **CORRECTED** | `WidgetRegistry` (`registry.js:1-47`) is a trivial name→component map and is worth reusing **as a class** — instantiate a *separate* registry for surround modules (mixing them into the shared screen widget registry would let a screen YAML mount `movement-map` as a dashboard panel with no playhead, and pollutes `list()`). `PanelRenderer` is only superficially similar: it renders a static screen-config layout tree, resolves widgets from the global registry with **static YAML props only** (`PanelRenderer.jsx:61` — `<Component {...(node.props || {})} />`), and is coupled to `useScreen()`/`usePip()` (`PanelRenderer.jsx:85`), which throw or misbehave outside their providers. It has no channel for per-tick `position` props. `GridLayout.jsx` (53 lines) is an unrelated static grid. **Corrected: reuse the WidgetRegistry class in a new `surroundRegistry`; region rendering is a small purpose-built map inside SurroundFrame, not PanelRenderer.** |
| 7 | "`media/img` is already served as a static route (`app.mjs:1631`)." | **CORRECTED** (detail) | `app.mjs:1631` defines `imgBasePath` for the *harvester's saveImage*, not a route. Serving happens via the static API router created at `app.mjs:1698` with that same `imgBasePath`: `GET /api/v1/static/img/*` (`static.mjs:253`), with resize support (`sendImageMaybeResized`). The frontend builds URLs through `DaylightMediaPath` (`frontend/src/lib/api.mjs:162-171`), which rewrites `media/img/…` → `api/v1/static/img/…`. **Exact URL for the example asset:** `DaylightMediaPath('media/img/surround/classical/beethoven/portrait.jpg')` → `/api/v1/static/img/surround/classical/beethoven/portrait.jpg`. Net claim survives: assets need no new backend serving code. |
| 8 | Screen config: `surround: auto\|off\|<id>` key location + validation. | **CONFIRMED** (with plumbing correction) | Screen YAML lives at `data/household/screens/{screen}.yml` (living-room.yml, office.yml both present), served raw by `screens.mjs:90-137` (`GET /api/v1/screens/:screenId`). **Validation is minimal**: only the `screen` field is checked (`screens.mjs:110-117`); everything else passes through unvalidated, so a new top-level `surround:` key needs no backend change. Plumbing correction: the frontend does NOT hand the whole config to a context — `ScreenRenderer.jsx:285` fetches it, then passes only slices (`config.actions` → ScreenActionHandler at `:421`, `config.layout` → ScreenProvider at `:427`). A `surround` key must be threaded explicitly: a new `SurroundSettingContext` provided by ScreenRenderer (§ Config). Default when absent = `auto`. |
| 9 | "`chrome` is taken by ScreenOverlayProvider; no existing use of 'surround'." | **CONFIRMED** | `chrome` option with default `'back'` at `ScreenOverlayProvider.jsx:163`, consumed by TouchShell at `:232`; player overlays pass `{ chrome: 'media' }` (`ScreenActionHandler.jsx:157` etc.). Tree-wide grep for `surround`: every hit is the English word "surrounding" in comments (SessionSourceContext.jsx:5, GovernanceEngine.js:2203 etc.). No collision. |
| 10 | Sidecar precedent: `content-filter/overrides/{ratingKey}.yml`. | **CONFIRMED** | `data/household/content-filter/overrides/662170.yml` exists (contentId echo + `sync` + `addCues`). Loaded per-request, fail-soft, by `createContentFilterRouter` (`contentFilter.mjs:29-43`): sanitized key, `readYaml` returns null on parse error with a `content-filter.read.error` warn, missing override degrades to `null` in the response. The surround store copies this exact fail-soft read discipline — but keys files by slug with a `match:` block instead of by ratingKey, per the design's rescan-churn argument (valid: ratingKeys are minted per library build). |

**PoC content verified live against Plex** (adjusts the design's `match.title` values):

| Piece | ratingKey | Actual Plex title | Duration |
|---|---|---|---|
| Vivaldi "Spring" | 663146 | `Violin Concerto No. 1 in E Major, RV 269 Spring` (show: Vivaldi) | 628 s |
| Beethoven "Eroica" | 663134 | `Beethoven: 3. Sinfonie (»Eroica«) ∙ hr-Sinfonieorchester ∙ Andrés Orozco-Estrada` (show: Beethoven) | 3223 s |

The design's fallback `title: "Beethoven: 3. Sinfonie"` is a prefix, not the full title —
title matching must therefore be **normalized-substring**, not equality (§ Matching).

**Blocker-level finding:** none that changes feasibility. `Player.jsx` genuinely does not
need modification — the imperative handle already exposes everything the surround needs,
and both mount seams are outside it. The one structural correction that changes the work's
shape is #1: there are **two** mount seams, not one, and MenuStack is the one the
living-room actually uses most.

---

## Architecture (corrected)

| Layer | What | Anchor (verified) |
|---|---|---|
| Data | `data/content/surround/` sidecars + `_surrounds/` definitions | `DataService.content` scope (`DataService.mjs:292`); read discipline from `contentFilter.mjs:29-43` |
| Delivery | `surround` block attached in **both** projections | `PlayResponseService.toPlayResponse` (all 5 play sites) + queue handler enrichment (`queue.mjs:149`) |
| Render | `SurroundHost` wraps `<Player>` at **both** seams | `ScreenPlayer.jsx:29` and `MenuStack.jsx:250,257` |

`modules/Player/Player.jsx` is **not modified**. Verified possible: the wrapper reads
`getNowPlaying()` / `getMediaElement()` from the existing imperative handle
(`Player.jsx:1139-1209`) and both play-path and queue-path metadata pass unknown fields
through to it (`Player.jsx:324,332-337`; queue items spread at `useQueueController.js:190`;
single-play info spread at `SinglePlayer.jsx` mediaInfo → `resolvedMeta` via
`handleResolvedMeta`, `Player.jsx:451-456`). So `qi.surround` arrives at
`getNowPlaying().item.surround` with zero Player changes.

Fail-soft is structural: no sidecar → no `surround` key → SurroundHost renders children
unchanged (identical DOM). Every failure inside the surround collapses to that same path
(§ Fail-soft assertions).

---

## Data layer

### Directory shape

```text
data/content/surround/
  _surrounds/
    concert-hall.yml           # surround definition (region layout)
  classical/
    beethoven/
      _composer.yml            # shared composer identity
      symphony-3-eroica.yml
    vivaldi/
      _composer.yml
      four-seasons-spring.yml
```

Folder names under the domain (`classical/`) are composer slugs; `_`-prefixed folders and
files are never treated as composer folders / piece files.

### Piece sidecar schema

```yaml
# classical/beethoven/symphony-3-eroica.yml
surround: concert-hall          # definition id in _surrounds/ (required)
match:                          # (required)
  contentId: plex:663134        # fast path (exact)
  title: "Beethoven: 3. Sinfonie"   # rebind fallback: normalized substring
piece:                          # (required: title; rest optional)
  title: Symphony No. 3 in E-flat major, "Eroica"
  opus: Op. 55
  composed: 1803-1804
  city: Vienna
  premiered: 1805, Theater an der Wien
movements:                      # (optional; MovementMap renders bars from these)
  - { n: 1, name: Allegro con brio, start: 0 }
  - { n: 2, name: "Marcia funebre: Adagio assai", start: 917 }
  - { n: 3, name: "Scherzo: Allegro vivace", start: 1810 }
  - { n: 4, name: "Finale: Allegro molto", start: 2158 }
cues:                           # (optional; timed, docked-only in PoC)
  - at: 917
    render: docked              # 'overlay' reserved for phase 2; unknown → treated as docked
    text: "Second movement — the funeral march."
facts:                          # (optional; untimed pool the ticker cycles)
  - "Beethoven originally dedicated it to Napoleon — then scratched the name out so hard he tore the page."
composer: {}                    # (optional; deep-merged OVER _composer.yml)
```

### Composer file schema

```yaml
# classical/beethoven/_composer.yml
name: Ludwig van Beethoven
born: 1770
died: 1827
birthplace: Bonn
portrait: beethoven/portrait.jpg      # relative to the domain asset base
city_image: beethoven/vienna.jpg
map: { base: _maps/europe-1800.svg, x: 0.52, y: 0.42 }
```

Inheritance: resolved composer = deep-merge of `_composer.yml` under the piece file's
`composer:` block (piece wins per key). Two composers in the PoC makes this real on day one.

### Surround definition schema

```yaml
# _surrounds/concert-hall.yml
id: concert-hall
regions:
  right:
    width: 20%                  # rail width (CSS length or %)
    module: composer-card
  bottom:                       # ordered stack under the video, video-width
    - { module: movement-map, height: 60 }
    - { module: cue-ticker, height: fill, collapse: first }
collapse:
  footerFloor: 90               # px; below this, drop collapse:first regions
```

`collapse: first` marks the region dropped first when the footer's vertical remainder
falls below `footerFloor` — the design's "collapse order is a design decision" requirement.

### Matching and index (YamlSurroundStore)

- Index: `contentId → resolved sidecar`, plus a parallel list of
  `{ normalizedTitle, file }` for rebind.
- Fast path: exact `match.contentId`.
- Fallback: normalize both sides (lowercase, strip punctuation/guillemets/interpuncts,
  collapse whitespace) and match when the sidecar's `match.title` is a **substring** of the
  item title (or vice versa, longer-contains-shorter). Required because live Plex titles
  carry orchestra suffixes (see audit table). On a fallback hit, log
  `surround.match.rebound` (warn) naming the stale contentId and the file — the design's
  "actionable warning" on rescan churn.
- **Freshness (replaces the design's reload-hook risk):** on each lookup, if
  more than 2 s have elapsed since the last check, stat the sidecar tree's directories;
  if any mtime is newer than the index build time, rebuild. ~100 files makes rebuild
  milliseconds; the PoC has 3. Authoring edits are live with no restart and no endpoint —
  same operational behavior as the content-filter precedent, plus an index.
- Fail-soft: unreadable/malformed YAML → file skipped, `surround.sidecar.invalid` (warn)
  with the path; a missing `surround:` or `match:` key → skipped with the same warn;
  lookup miss → `null`, and the caller attaches nothing.

The resolved payload the store returns (and the API attaches verbatim as the `surround`
field, so the frontend needs no second fetch):

```js
{
  id: 'concert-hall',                    // definition id
  definition: { regions, collapse },     // from _surrounds/{id}.yml
  piece: {...}, movements: [...], cues: [...], facts: [...],
  composer: {...},                       // merged _composer.yml + piece override
  assetBase: 'surround/classical',       // for DaylightMediaPath asset URLs
}
```

If the named definition file is missing, the lookup returns `null` (and warns
`surround.definition.missing`) — an enriched piece with a broken definition must not break
playback or ship a half-payload.

## Asset companion tree

```text
media/img/surround/classical/
  beethoven/  portrait.jpg  vienna.jpg
  vivaldi/    portrait.jpg  venice.jpg
  _maps/      europe-1800.svg
```

Served today by `GET /api/v1/static/img/*` (`static.mjs:253`) — no backend change. Modules
build URLs as `DaylightMediaPath('media/img/' + assetBase + '/' + relativeRef)`. A missing
asset renders an empty slot: every `<img>` in surround modules hides itself `onError` and
logs `surround.asset.missing` (warn, sampled). Portraits/city images from Wikimedia Commons
(repo has the `wikimedia-commons-images` skill); SVG structure templates are deferred —
the PoC MovementMap uses plain proportional bars.

---

## Delivery layer (backend)

### New: `backend/src/1_adapters/content/surround/YamlSurroundStore.mjs`

Class `YamlSurroundStore({ rootDir, logger })` — `rootDir` =
`path.join(dataPath, 'content/surround')` at composition. Public API:

```js
lookup(contentId, title) -> resolvedPayload | null   // never throws
```

No `manifest.mjs`, no ContentSourceRegistry registration (audit #3 correction).

### Modified: `backend/src/3_applications/content/services/PlayResponseService.mjs`

- Constructor gains optional `surroundStore` (pattern: existing optional
  `progressSyncService`, `PlayResponseService.mjs:34-38`).
- At the end of `toPlayResponse` (`:56`):
  `const s = this.#surroundStore?.lookup(item.id, item.title); if (s) response.surround = s;`
- Covers all five play-route call sites at once.

### Modified: `backend/src/4_api/v1/routers/queue.mjs`

- `createQueueRouter(config)` gains optional `surroundStore`.
- After `items.map(toQueueItem)` (`queue.mjs:149`), enrich:
  `if (surroundStore) for (const qi of queueItems) { const s = surroundStore.lookup(qi.contentId, qi.title); if (s) qi.surround = s; }`
- `toQueueItem` itself stays pure/sync — the enrichment is a handler concern, matching how
  the handler already owns resolution and logging.

### Modified: `backend/src/5_composition/modules/contentApi.mjs`

- Construct `const surroundStore = new YamlSurroundStore({ rootDir: path.join(dataPath, 'content/surround'), logger })`.
- Pass into `new PlayResponseService({ ..., surroundStore })` (`contentApi.mjs:121`) and
  `createQueueRouter({ ..., surroundStore })` (`contentApi.mjs:139`).

No other backend files change. `list.mjs`, `content.mjs`, `item.mjs`, `media.mjs` are
untouched (audit #2: they are not playback projections).

---

## Render layer (frontend)

All new UI lives in a new module, `frontend/src/modules/Surround/` — importable from both
seams (screen-framework and modules/Menu) without cross-app coupling.

### The two seam edits

1. **`frontend/src/screen-framework/publishers/ScreenPlayer.jsx`** — wrap the return:
   ```jsx
   return (
     <SurroundHost getPlayerHandle={() => playerRef.current}>
       <Player {...props} ref={playerRef} />
     </SurroundHost>
   );
   ```
2. **`frontend/src/modules/Menu/MenuStack.jsx`** — wrap the `case 'player'` (`:250`) and
   `case 'composite'` (`:257`) renders the same way, using the existing forwarded
   `playerRef` (`getPlayerHandle={() => playerRef?.current}`). When no ref was forwarded,
   SurroundHost's getter returns null and it renders bare children — fail-soft.

These are the only two mount-site edits. Player-embedding apps outside the screen
framework (Fitness, Piano, School, Feed, Media, Admin) are unchanged and never framed.

### `SurroundHost.jsx` (new)

Renderless-when-inactive wrapper. Responsibilities:

- Read `mode` from `SurroundSettingContext` (default `'auto'`). `off` → always bare.
- Poll `getPlayerHandle()?.getNowPlaying()?.item` at 1 Hz (the established pattern —
  `usePlayerSessionBinding.js` bridge polls the same handle) for a `surround` field;
  track the current item's contentId so queue advances swap or drop the frame.
- `mode === '<id>'` (forced): fetch nothing extra in the PoC — forced mode only forces
  rendering when the item already carries `surround`; forcing a definition onto
  un-enriched items is deferred with the note that it would need a definition endpoint.
- **Constant depth (revised).** `SurroundFrame` is mounted for EVERY item, active or
  not, and `children` always sit in the same slot inside it. The host learns an item is
  enriched only from a poll — i.e. after the player is mounted — so the original design
  (bare `children`, then re-parented into the frame) remounted the player one second in,
  and remounting a `<video>` reloads it. When inactive, every shell element on the path
  down to `children` carries `display: contents`, no class and no attributes: no box, no
  semantics, layout-identical to a bare player. The contract is therefore "a wrapper that
  generates no box", not "no wrapper element".
- **Module error boundaries**: each module renders inside its own boundary. React tears
  down the whole subtree under a boundary that catches, so a boundary wrapping the player
  would reload the video on any module error. A catch logs `surround.render.error` (error)
  and switches the frame to its inactive shell — bare `children`, reached without moving
  them. The surround can never be the reason something won't play.
- Owns the clock: `useMediaClock({ getMediaEl: () => getPlayerHandle()?.getMediaElement?.() ?? null })`.

### `useMediaClock.js` (new, `frontend/src/lib/Player/useMediaClock.js`)

Independent parallel subscriber (audit #4 correction), modeled on
`useContentFilter.js:250-285`:

- Drivers: `requestVideoFrameCallback` loop when available; listeners on
  `timeupdate, seeked, ratechange, playing, waiting, pause, ended` always; `seeking` sets
  a `seeking` flag (cleared on `seeked`).
- Exposes `{ subscribe(cb), getState() }` where state =
  `{ position, duration, playing, seeking }` — plus a React hook
  `useMediaClockState({ hz = 10 })` that samples into state at the given rate.
  **10 Hz default for React props**, not the raw ~40 Hz frame rate: kiosk pages in this
  house have degraded to 10 fps (design risk #1), and a 40 Hz React re-render of every
  module is the likeliest way to cause exactly that. Sub-frame precision is not needed —
  the cursor on a 54-minute piece moves < 0.04%/s.
- Media element identity is re-checked each tick registration; a null element (audio-only
  transport, pre-mount) yields state zeros and no listeners — never throws.
- Emits `surround.clock.driver` (debug) once per element: `{ driver: 'rvfc'|'timeupdate' }`.

### `SurroundFrame.jsx` + `SurroundFrame.scss` (new)

Structure copied from `FitnessPlayerFrame` (audit #5), new namespace `surround-frame__*`:

- Grid: main column + right rail (`width` from `definition.regions.right.width`,
  default 20%). Rail is full height.
- Main column stacks: **media box** (flex-grow, centers an inner
  `aspect-ratio: 16/9; max-width: 100%; max-height: 100%` box that `children` fill —
  letterbox, never distort) then the **footer stack** (the `bottom` regions, in order,
  spanning exactly the media-box width).
- Collapse: a `ResizeObserver` on the footer; when its height < `collapse.footerFloor`
  (default 90), regions with `collapse: first` unmount (log `surround.collapse`, debug).
- `overlay` slot reserved (absolute, pointer-events: none) for phase-2 cues; unused in PoC.
- Region → module resolution: for each declared region, `surroundRegistry.get(module)`;
  unknown module → empty region + `surround.module.missing` (warn). Purpose-built loop,
  not PanelRenderer (audit #6).

### Module registry (new)

- `frontend/src/modules/Surround/registry.js` — instantiates a **separate**
  `WidgetRegistry` (imports the class from `screen-framework/widgets/registry.js`, which
  is UI-framework-agnostic): `registerSurroundModule(name, Component)`,
  `getSurroundRegistry()`.
- `frontend/src/modules/Surround/builtins.js` — registers `movement-map`, `cue-ticker`,
  `composer-card`; imported by `SurroundHost` (self-registering on first use, so neither
  seam needs a registration call).

### Module contract (precise)

Every surround module is a React component receiving exactly:

```js
{
  position: number,    // seconds, sampled at ≤10 Hz
  duration: number,    // seconds; 0 until known
  playing: boolean,
  seeking: boolean,
  data: object,        // the full resolved qi.surround payload
  region: object,      // this module's region declaration (height, width, …)
}
```

No player handle, no transport, no DOM access to the media element, no children. Modules
render; they cannot drive playback. (Enforced by construction: SurroundFrame simply never
passes anything else.)

### PoC modules (new)

| File | Purpose |
|---|---|
| `modules/MovementMap.jsx` | Proportional bars from `data.movements` + `duration`; active-movement highlight; position cursor. Movement *i* spans `[start_i, start_{i+1} ?? duration)`. No SVG templates in PoC. |
| `modules/CueTicker.jsx` | Docked text line. Timed `data.cues` (render `docked` or unknown) fire at `at ≤ position < at + dwell` (dwell default 12 s); when none active, cycles `data.facts` on a 20 s timer. A timed cue always preempts a fact. Seeks re-evaluate naturally off `position`. |
| `modules/ComposerCard.jsx` | Static identity from `data.composer` + `data.piece`: portrait (`DaylightMediaPath` asset URL), name, dates, piece/opus, composed/premiered lines. Position-independent (still receives the contract; ignores it). |

### Config

Screen YAML (unvalidated pass-through, audit #8):

```yaml
# data/household/screens/{screen}.yml
surround: auto      # default when absent | off | <definition-id>
```

- New `frontend/src/modules/Surround/SurroundSettingContext.js` — React context, default
  `'auto'`.
- Modified `frontend/src/screen-framework/ScreenRenderer.jsx` — wrap the rendered tree in
  `<SurroundSettingContext.Provider value={config.surround ?? 'auto'}>` (alongside the
  existing providers around `:421-429`). Non-screen-framework mounts of MenuStack get the
  context default (`auto`) automatically.
- No screen YAML edits are required for the PoC (`auto` is the default); authoring the
  sidecar is the opt-in.

---

## Logging (required per CLAUDE.md)

Frontend: child loggers via the framework (`getLogger().child({ component: … })`), lazy
module-level pattern for hooks.

| Event | Level | Component | Payload |
|---|---|---|---|
| `surround.mount` | info | `surround-host` | `{ contentId, surroundId, regions: [names], modules: [names] }` |
| `surround.unmount` | info | `surround-host` | `{ contentId, surroundId, watchedSec }` |
| `surround.item-change` | debug | `surround-host` | `{ from, to, enriched: bool }` |
| `surround.disabled` | debug | `surround-host` | `{ mode }` (mode=off, or forced-id mismatch) |
| `surround.render.error` | error | `surround-host` | `{ contentId, error }` (boundary catch → bare fallback) |
| `surround.clock.driver` | debug | `media-clock` | `{ driver: 'rvfc'\|'timeupdate' }` |
| `surround.clock.stalled` | warn | `media-clock` | `{ position }` (playing=true, no tick > 5 s) |
| `surround.module.missing` | warn | `surround-frame` | `{ module, surroundId }` |
| `surround.collapse` | debug | `surround-frame` | `{ dropped: [modules], footerPx }` |
| `surround.asset.missing` | warn (sampled ≤5/min) | `surround-frame` | `{ src }` |
| `surround.cue.shown` | debug | `cue-ticker` | `{ kind: 'cue'\|'fact', at }` |

Backend (structured logger already injected into both projections and composition):

| Event | Level | Payload |
|---|---|---|
| `surround.index.built` | info | `{ pieces, composers, definitions, ms }` |
| `surround.sidecar.invalid` | warn | `{ file, reason }` |
| `surround.definition.missing` | warn | `{ id, file }` |
| `surround.match.rebound` | warn | `{ staleContentId, matchedTitle, file }` |
| `surround.attach` | debug | `{ contentId, surroundId, path: 'play'\|'queue' }` |

Rule honored: no raw `console.*` anywhere in the new code.

---

## Test plan

Runners per `docs/ai-context/testing.md`: colocated `*.test.mjs` next to backend routers
run under vitest (precedent: `play.userlog.test.mjs`, supertest + vi mocks); colocated
frontend `*.test.jsx` run under vitest with testing-library (precedent:
`ScreenActionHandler.test.jsx`); Playwright flow tests in `tests/live/flow/`.
Discipline: no conditional assertion skipping; setup failures fail in `beforeAll`.

### Backend (vitest, colocated)

`backend/src/1_adapters/content/surround/YamlSurroundStore.test.mjs` — fixture tree written to
a temp dir (no PII, no real household data):
1. Exact contentId lookup returns merged payload (piece + `_composer.yml` inheritance,
   piece `composer:` override winning per key).
2. Title rebind: lookup with unknown contentId + real-title-with-orchestra-suffix matches
   the substring sidecar title; asserts the `surround.match.rebound` warn fired (spy logger).
3. Malformed YAML file: skipped, `surround.sidecar.invalid` warned, other files still index.
4. Missing definition file: lookup returns `null`, warn fired.
5. Freshness: edit a sidecar's mtime after first lookup → second lookup (after the guard
   window) reflects the change. Fake timers for the 2 s guard.
6. Miss returns `null` and attaches nothing (assert exact `null`, not falsy garbage).

`backend/src/4_api/v1/routers/queue.surround.test.mjs` — supertest with stub
adapter/queueService (pattern of `play.userlog.test.mjs`):
1. Store hit → item carries `surround` payload verbatim.
2. Store miss → response **deep-equals** the response with no store injected (the
   byte-identical fail-soft claim, asserted).
3. Store throws → handler still 200s without `surround` (store contract is never-throw,
   but the router must not amplify a violation) — wrap the enrichment loop in try/catch.

`backend/src/3_applications/content/services/PlayResponseService.surround.test.mjs`:
1. With `surroundStore` hit → `response.surround` present.
2. Without store / with miss → key absent, response otherwise identical.

### Frontend (vitest, colocated in `frontend/src/modules/Surround/`)

`SurroundHost.test.jsx`:
1. No `surround` on now-playing → renders children with no wrapper element (snapshot the
   container: identical to bare children).
2. `surround` present, mode `auto` → `surround-frame` root present, video children inside
   the media box.
3. Mode `off` → bare children even when enriched.
4. Module throws in render → boundary logs `surround.render.error` and children still mount.
5. Queue advance to un-enriched item (poll tick with changed `getNowPlaying`) → frame
   unmounts, children remain.

`useMediaClock.test.js`: fake media element (EventTarget + currentTime/duration/paused);
assert position after `timeupdate`, `seeking`→`seeking:true`, `seeked`→cleared + position
jump reflected, null element → zeros without throwing, listener removal on unmount.

`MovementMap.test.jsx`: 4 movements over 3223 s → segment widths proportional; position
917 → movement 2 active; position jump (seek) moves cursor same render.

`CueTicker.test.jsx`: fact cycles on timer (fake timers); timed cue at 917 preempts the
fact at `position=917`; cue expires after dwell; no cues + no facts → renders empty, no
throw.

### Runtime (Playwright, `tests/live/flow/surround/surround-poc.runtime.test.mjs`)

Preconditions in `beforeAll`, failing (not skipping) if unmet: backend healthy;
`GET /api/v1/play/plex:663146` returns a `surround` field (proves sidecars are authored
and the store is live).

1. Navigate to the screen route with `?play=plex:663146` (URL autoplay path —
   `ScreenRenderer.jsx:122` → ActionBus → ScreenPlayer): assert `.surround-frame` appears,
   a `video`/`dash-video` element is inside the media box, and the media box's
   width/height ratio is 16:9 ±1%.
2. Seek via the transport (dispatch `ArrowRight` keydowns or `media:seek-abs`): assert the
   MovementMap cursor's left-offset changed consistently with the new `currentTime`.
3. Ticker: assert the cue-ticker region's text content changes within the fact-cycle
   window (fake-timer-free: use a piece cue near the start of "Spring").
4. Regression: `?play=` an un-enriched item from the same library: assert
   `.surround-frame` is absent and the player mounts (existing player selector).
5. Menu path parity (the corrected seam): open a menu (`menu:open`), select an enriched
   item, assert `.surround-frame` appears — this is the test that would have caught the
   design's seam error.

Playwright port/URL discipline per `tests/_lib/configHelper.mjs` and
`tests/_fixtures/runtime/urls.mjs` — no hardcoded ports.

---

## Fail-soft paths as testable assertions

1. **No sidecar** → play/queue responses contain no `surround` key and deep-equal
   pre-feature responses. (queue.surround.test 2, PlayResponseService test 2)
2. **Malformed sidecar** → indexed library minus that file; warn logged; lookups for other
   pieces unaffected. (YamlSurroundStore test 3)
3. **Missing definition** → whole lookup null; playback identical to un-enriched. (YamlSurroundStore test 4)
4. **Store throws** (contract violation) → both projections catch and serve un-enriched. (queue.surround.test 3)
5. **Unregistered module in definition** → empty region + warn; video plays. (frame behavior; SurroundHost test 4 covers the throw case)
6. **Missing asset** → hidden `<img>`, sampled warn, layout intact.
7. **Null media element** (audio-only, pre-mount) → clock zeros, frame renders, no throw. (useMediaClock test)
8. **Any surround render error** → error boundary logs and yields bare `<Player>`. (SurroundHost test 4)
9. **ratingKey churn after rescan** → title rebind serves the surround + actionable warn naming the stale id. (YamlSurroundStore test 2)
10. **Screen `surround: off`** → enriched items render bare. (SurroundHost test 3)

---

## File manifest

### New files

| Path | Purpose |
|---|---|
| `backend/src/1_adapters/content/surround/YamlSurroundStore.mjs` | Sidecar index: load, inherit, match, mtime-guarded freshness, never-throw lookup |
| `backend/src/1_adapters/content/surround/YamlSurroundStore.test.mjs` | Store unit tests (fixture temp tree) |
| `backend/src/4_api/v1/routers/queue.surround.test.mjs` | Queue enrichment + byte-identical fail-soft |
| `backend/src/3_applications/content/services/PlayResponseService.surround.test.mjs` | Play enrichment + absence |
| `frontend/src/lib/Player/useMediaClock.js` | Independent playhead subscriber (rVFC + events), 10 Hz sampled state |
| `frontend/src/modules/Surround/SurroundHost.jsx` | Seam wrapper: mode gate, now-playing poll, error boundary, clock owner |
| `frontend/src/modules/Surround/SurroundFrame.jsx` | Slot layout + aspect-locked 16:9 media box + region resolution + collapse |
| `frontend/src/modules/Surround/SurroundFrame.scss` | Frame geometry (namespace `surround-frame__*`) |
| `frontend/src/modules/Surround/SurroundSettingContext.js` | `auto\|off\|<id>` context, default `auto` |
| `frontend/src/modules/Surround/registry.js` | Separate WidgetRegistry instance + register/get helpers |
| `frontend/src/modules/Surround/builtins.js` | Registers movement-map, cue-ticker, composer-card |
| `frontend/src/modules/Surround/modules/MovementMap.jsx` | Proportional movement bars + cursor |
| `frontend/src/modules/Surround/modules/CueTicker.jsx` | Docked cue/fact ticker |
| `frontend/src/modules/Surround/modules/ComposerCard.jsx` | Static composer/piece identity rail |
| `frontend/src/modules/Surround/SurroundHost.test.jsx` | Host behavior + fail-soft |
| `frontend/src/modules/Surround/modules/MovementMap.test.jsx` | Geometry + seek tracking |
| `frontend/src/modules/Surround/modules/CueTicker.test.jsx` | Cue/fact precedence + timers |
| `frontend/src/lib/Player/useMediaClock.test.js` | Clock drivers + null element |
| `tests/live/flow/surround/surround-poc.runtime.test.mjs` | End-to-end PoC gate incl. menu-path parity |

### Modified files

| Path | Change |
|---|---|
| `backend/src/3_applications/content/services/PlayResponseService.mjs` | Optional `surroundStore` dep; attach `response.surround` in `toPlayResponse` |
| `backend/src/4_api/v1/routers/queue.mjs` | Optional `surroundStore` in config; enrich mapped queue items (try/catch) |
| `backend/src/5_composition/modules/contentApi.mjs` | Construct YamlSurroundStore; inject into both |
| `frontend/src/screen-framework/publishers/ScreenPlayer.jsx` | Wrap `<Player>` in `<SurroundHost>` |
| `frontend/src/modules/Menu/MenuStack.jsx` | Wrap `case 'player'` and `case 'composite'` Players in `<SurroundHost>` |
| `frontend/src/screen-framework/ScreenRenderer.jsx` | Provide `SurroundSettingContext` from `config.surround` |

**Not modified:** `frontend/src/modules/Player/Player.jsx` (verified unnecessary),
`useContentFilter.js` / `contentFilter.js` (parallel clock instead of extraction),
`PanelRenderer.jsx`, `screens.mjs`, `static.mjs`, `toQueueItem` body.

### Data deliverables (authored in the data tree, not the repo)

| Path (under the data dir; see `.claude/settings.local.json` / `DAYLIGHT_BASE_PATH`) | Content |
|---|---|
| `data/content/surround/_surrounds/concert-hall.yml` | The one PoC definition |
| `data/content/surround/classical/vivaldi/_composer.yml` + `four-seasons-spring.yml` | Spring, `plex:663146`, 3 movements, program-music cues |
| `data/content/surround/classical/beethoven/_composer.yml` + `symphony-3-eroica.yml` | Eroica, `plex:663134`, 4 movements (starts 0/917/1810/2158), the Napoleon fact |
| `media/img/surround/classical/{vivaldi,beethoven}/portrait.jpg` (+ city images) | Wikimedia Commons, public domain |

Movement start times for Spring must be taken from the actual video (628 s total) during
authoring — the design doc does not supply them.

---

## Done means (unchanged from design, plus the corrected seam)

- Both pieces surround-play on the living-room screen through **all three** trigger paths:
  WS command, URL `?play=`, **and a menu selection** (the path the design missed).
- Video locked 16:9 throughout; movement cursor tracks including across seeks; ticker cycles.
- Every un-enriched item plays byte-identically (asserted, not eyeballed: queue.surround.test 2).
- Risks to measure on hardware, not assume: kiosk framerate with the 10 Hz sampled clock on
  the 54-minute Eroica page; rebind warning fires after a deliberate test rescan.

## Deferred (unchanged)

Backfill pipeline; chapter-marker movement extraction; `render: overlay` pop-up cues
(schema already carries `render:`, the frame already reserves the overlay slot); audio
cues; SVG structure templates; forcing a definition onto un-enriched items.
