# PianoKiosk — Design & UX Sins Audit

**Date:** 2026-06-22
**Scope:** `frontend/src/modules/Piano/PianoKiosk/` (+ shell `frontend/src/Apps/PianoApp.jsx` / `PianoApp.scss`)
**Lens:** frontend-design (distinctive, intentional visual design) + UX/usability + industry best-practice benchmark
**Verdict:** The kiosk *works* as a wiring diagram — every mode routes, every API call lands — but it reads as a **functional prototype dressed in AI-default chrome**. It commits the three signature AI-slop tells (near-black + single acid-green accent, emoji-as-iconography, undifferentiated condensed sans), and several genuine usability failures (now-playing title vanishes, passive playback gets yanked back to the menu, covers with no visible labels, native `<select>` on a touch wall). None of it is *broken enough to crash*; all of it is *generic enough to forget*.

---

## A. Experience failures (the ones a user actually feels)

### A1. The now-playing title/artist vanishes with the chrome — **the flagged bug, confirmed**
`MusicPlayer.jsx:118-126` puts the song **title and artist inside `__chrome`** (`__top` row), the same layer that `useVanishingControls` fades to `opacity:0` after 3s idle (`PianoApp.scss:441`). So three seconds into a track you are staring at a cover with **no idea what is playing** — the one piece of information a now-playing screen exists to show. Plexamp (the stated inspiration), Apple Music, and Spotify all keep the **title/artist persistently visible** and only fade the *transport*. 

**Fix:** split the layer. Title/artist/progress live in a layer that never hides; only the buttons (back, queue, transport, volume) belong to the vanishing layer. The blurred-art wash already darkens the bottom, so persistent white text reads fine.

### A2. Passive playback is yanked back to the menu mid-content — **structural bug**
`useInactivityReturn.js` counts activity from **MIDI notes + pointer/keydown only**. Watching a 45-minute lecture (Videos) or listening to an album (Music) produces *neither*. After `inactivityMinutes` (default **10**, `PianoConfig.jsx:66`) the kiosk **navigates home (`navigate(/piano/:id)`), unmounting the player mid-stream.** `useKeepScreenAwake('video', ...)` keeps the *screen* lit but does nothing to suppress the *return-to-menu timer* — they are two independent mechanisms and only one was guarded.

**Fix:** the inactivity-return must treat "media playing" as activity (the same `playing`/`isPlaying` signal both players already track), exactly as the screensaver does.

### A3. "Can't stop the video after it starts" — **the flagged complaint, root cause**
Two compounding problems:
- **Pause depends on an async-resolved element that may never resolve.** `usePlayerController(playerRef)` + `useResolvedMediaEl` (`useResolvedMediaEl.js`) `requestAnimationFrame`-poll the lazy Player ref **forever with no timeout and no failure path**. If `getMediaElement()` never returns (lazy chunk slow, resilience controller mid-rebuild, transcode stall), `ctrl.toggle` has nothing to toggle, `currentTime`/`duration` stay `0`, and the **seek bar is dead** — there is no visible signal that the transport is inert, so the user mashes a play/pause button that does nothing.
- **The only reliable "stop" is mislabeled.** The exit affordance is `‹ Lessons` (`PianoVideoChrome.jsx:39`) but Videos mode's hierarchy is *course grid → course detail → player* — there is **no Lessons in that stack**. The button actually returns to course detail. A user looking to "stop the video" is told the button goes somewhere it doesn't.

**Fix:** give `useResolvedMediaEl` a timeout → surface a "Player didn't start — Back" state (the `PlayerBoundary` only catches *thrown* errors, not a silent never-mount). Relabel the back button to its real destination.

### A4. The video chrome never hides; the music chrome hides too aggressively — **inconsistent within one module**
- Video: `PianoVideoChrome` is an **always-present in-flow bar** (`PianoApp.scss:328`) permanently sandwiching the video between a transport strip and a 9rem keyboard footer (`__keys`, `PianoApp.scss:321-324`). On a tablet that is a lot of fixed chrome eating the video.
- Music: chrome **fully disappears** (including, per A1, the metadata).

Two media players in the same kiosk with **opposite chrome philosophies** is a coherence failure. Pick one auto-hide model and share it.

### A5. Covers are a wall of unlabeled images — **discoverability sin**
`AlbumGrid.jsx:56-57` and the course/score grids deliberately put titles **in `alt`/`title` only** ("titles in alt", `PianoApp.scss:251`, `:359`). On a **touch** kiosk there is no hover, so `title=` tooltips never appear and `alt` is invisible. The user sees a grid of album/score thumbnails with **zero readable labels** and must recognize every album by cover art alone. Best-in-class music browsers (Plexamp included) caption the tile. This is "clever, not specific" — the opposite of the writing guidance.

### A6. Lessons ships a hollow shell to end users — **promise/delivery mismatch**
The menu tile sells Lessons with 🎓 and *"Guided & theory lessons"* (`PianoMenu.jsx:11`). Tapping it lands on `Lessons.jsx`, whose own docstring admits the notation renderer is "future work" and the theory runners are "skeletons." A kiosk tile that promises content and delivers an empty `<Notation>` seam is worse than no tile. Either hide the tile until the mode is real, or label it honestly ("Coming soon").

### A7. Destructive delete, one tap, no confirm
Studio's `🗑` (`Studio.jsx:129`) deletes a saved take **immediately, irreversibly, unconfirmed**, with an emoji as its only label. A recorded performance is exactly the kind of artifact that warrants a confirm step.

---

## B. AI-slop tells (the frontend-design calibration list, all three hit)

The skill names three clusters that AI design defaults to "regardless of subject." This kiosk lands on **two of them directly** and a third in spirit:

### B1. Near-black background + single acid-green accent — **slop look #2, verbatim**
`#0e0e12` background, `#3c7` (`#33cc77`) as the *only* accent — play buttons, progress fill, "on" toggles, connect button, badges, focus color, the status dot (`PianoApp.scss` throughout). This is the textbook "near-black background with a single bright acid-green accent" default. It carries **no relationship to the subject**: a *piano*. The instrument's own world is full of material to draw from — ivory/ebony key contrast, brass pedal, felt-red dampers, sheet-music cream, lacquer black — and **none of it appears.** The palette would be identical on a thermostat app.

### B2. Emoji-as-iconography, mixed with Unicode glyphs — **the loudest tell**
The icon system is a grab-bag with **no single visual language**:
- Menu tiles: 🎬🎵🎼🎮🎓🎹 (`PianoMenu.jsx:7-12`) — full-color emoji as the primary identity of every mode.
- Home: `⌂`. Status: a CSS dot + text. Back: `‹`. Queue: `≡`. Close: `✕`.
- **Music transport mixes two languages in one row** (`MusicPlayer.jsx:135-145`): play/pause/prev/next are *monochrome Unicode* (`❚❚ ▶ ⏮ ⏭`) but shuffle/repeat/volume are *full-color emoji* (`🔀 🔁 🔉 🔊`). Sitting side by side, half the row is line-art and half is rendered glyph art at a different weight, color, and baseline.

Emoji render differently on every OS/font, can't be tuned (stroke, weight, color, optical size), don't align to a baseline grid, and are the canonical "this was generated, not designed" signal. A piano kiosk is a place where **a real icon set pays for itself** — these should be SVGs sharing one stroke weight and the palette.

### B3. Undifferentiated condensed sans — **no typographic personality**
`Roboto Condensed` for **everything**, with the stylesheet header *forbidding* a display face ("do not introduce new display fonts," `PianoApp.scss:2`). Two weights (400/700), timid sizes (1.4–1.6rem titles on a wall/tablet). The skill: "Typography carries the personality of the page… make the type treatment a memorable part of the design, not a neutral delivery vehicle." This is a neutral delivery vehicle. A display face for mode titles / now-playing (the instrument vocabulary — engraved score serifs, or a confident geometric for the chrome) would cost nothing and give the kiosk a face.

### B4. The one "signature" is a borrowed cliché
The blurred-cover wash behind album art (`PianoApp.scss:408-412`, `blur(40px) brightness(0.4) scale(1.2)`) is the single atmospheric flourish — and it is the **Plexamp move, copied** (the code says "Plexamp-style" three times across Music). A signature element is supposed to be *the thing this page is remembered by*; an acknowledged imitation of another app isn't it.

---

## C. Touch / kiosk-fit violations (against the project's own rules)

### C1. Native `<select>` for the voice picker — **violates the house touch rule**
`PianoChrome.jsx:47-57` uses a raw HTML `<select>` (with a `Voice…` disabled placeholder) for instrument timbre. The project's own memory says **fitness/touch widgets use discrete tap targets, never sliders/native pickers** (`feedback_touch_ui_no_sliders`). A native select on a touch wall is a tiny target that pops an OS dropdown — alien to the rest of the UI and easy to miss. Should be a tap-to-cycle button or a tile sheet.

### C2. Chevron `‹`/`›` glyphs as primary navigation on a touch surface
Back is a single thin `‹` character (`MusicPlayer.jsx:120`, AlbumDetail, ScoreViewer). A 1-character low-contrast glyph is a poor touch target and clashes with the chunky `min-width:3rem` buttons elsewhere — the kiosk can't decide if it's chunky-touch or thin-glyph.

### C3. Video transport row is an overflow hazard
`PianoVideoChrome.jsx:38-54` packs **~12 controls** (back, time, «30 «15 ▶ 15» 30», speed, A, B, ✕, 🎹) into one non-wrapping flex row with three spacers, mixing 4.5rem play buttons against single-char `A`/`B`/`✕` buttons. On a narrow/portrait tablet this crushes or clips. No priority, no wrap, no overflow handling.

### C4. Back-button class is borrowed across unrelated modes
`piano-game-fullscreen__back` is reused by `AlbumDetail.jsx:38` and `ScoreViewer.jsx:38` — non-game modes inheriting a *game* fullscreen class. There is no shared "back" component; every mode hand-rolls a chevron with whatever class was nearby. The nav vocabulary is inconsistent across the app (`⌂` home vs `‹` vs `‹ Music` vs `‹ Lessons`).

---

## D. Layout & use of space

### D1. Zero responsive handling
The **entire stylesheet contains no `@media` query.** The menu grid is hard-pinned to `repeat(3, minmax(11rem,18rem))` (`PianoApp.scss:89`) — 6 tiles forced to 3×2 regardless of a tablet being **portrait or landscape**. A "touch-first" kiosk that rotates and never reflows is a structural gap. Orientation should drive 2×3 vs 3×2.

### D2. Now-playing wastes its canvas
The music meta is squeezed into a narrow center column between two buttons (`__top`, `MusicPlayer.jsx:119-126`) where long titles ellipsize — while a `min(60vh,80vw)` art square and large empty gutters sit below (`PianoApp.scss:414-418`). The information the user wants is starved; decoration is fed.

### D3. One stray cream panel in a dark UI
`__staff { background: #f7f3e8 }` (`PianoApp.scss:142`) drops a bright cream rectangle into the otherwise `#0e0e12` Studio screen — a jarring light block with no surrounding rationale.

### D4. Loading/empty/error are bare gray italics, and leak system language
Every grid rolls its own `Loading…` / `No X found` / raw `err.message` in `.piano-mode__placeholder` (italic `#999`). No skeletons, no spinners, no shared empty-state component. Worse, the copy leaks **implementation vocabulary** to the end user: *"No music.collection configured."* (`AlbumGrid.jsx:51`) names a YAML config key. The writing guidance: name things by what people control, not how the system is built; an empty screen is an invitation to act, not a config-key dump.

---

## E. Quality-floor gaps (the skill's non-negotiables)

- **Keyboard focus:** no `:focus-visible` styling anywhere; only `:active { transform: scale(.97) }`. Tiles, selects, and transport buttons show only the browser default ring (often invisible on `#1c1c25`).
- **Reduced motion:** transitions (`transform .12s`, `opacity .35s`) are unconditional; no `prefers-reduced-motion` guard.
- **Hit targets:** inconsistent — 3–4.5rem chunky buttons coexist with 1-char chevrons and a native select.

---

## F. Routing & deep-linkability — **no unique route per view; Plex IDs never reach the URL**

The router (`PianoApp.jsx`) goes **exactly one level deep**: it routes piano selection and the six mode roots, then stops. **Every data-rich drill-down view is switched by `useState`, not by the URL**, so the content IDs the views are *about* — album/playlist `plex:` ids, lecture `contentId`s, score ids, game ids — **never appear in the route.**

| Route | View | Routed? |
|---|---|---|
| `/piano` | Picker | ✓ |
| `/piano/:pianoId` | Menu | ✓ |
| `/piano/:pianoId/videos` etc. | Mode root | ✓ |
| `…/videos` → course → lecture | `useState(course)`, `useState(lecture)` | ✗ state-only (`Videos.jsx:19-20`) |
| `…/music` → album → now-playing | `useState(album)`, `useState(session)` | ✗ state-only (`Music.jsx:17-18`) |
| `…/sheetmusic` → score viewer | `useState(score)` | ✗ state-only (`SheetMusic.jsx:16`) |
| `…/games` → fullscreen game | `useState(selected)` | ✗ state-only (`Games.jsx:26`) |

A now-playing screen for a specific album has the **same URL** (`…/music`) as the empty album grid. The `lessons/*` splat in the router is the only gesture toward sub-routing and **Lessons doesn't use it** — the pattern was known and not applied.

**Why it bites this deployment specifically:**
1. **Kiosks hard-reload on every deploy** (garage Firefox, office Brave, FKB — per `CLAUDE.local.md`). A reload returns the URL to the mode root, so a deploy **dumps the user out of their album/lecture/score back to the grid**; state-held position can't survive it, a route could. (Compounds A2 — the only two ways you lose your place are *both* unguarded.)
2. **HA buttons deep-link by URL** (the kitchen panel drives content via `queue=…` query strings). The piano kiosk **cannot be driven to a specific album/score/lecture** because no URL addresses one.
3. **Browser/hardware Back can't act as "up"** — drilling in pushes no history, so browser/physical Back escapes the whole mode instead of going up one level. The custom `‹` is the only working up-gesture, and Back is already unreliable on Shield/FKB (per memory `feedback_esc_captured_by_fkb`, `feedback_shield_remote_input_vocabulary`).
4. **Observability** — logs record `mode-enter`, but the route can't tell you *what content* is on screen at a glance.

**Target route shape (IDs in the path):**
```
/piano/:pianoId/videos/:courseId
/piano/:pianoId/videos/:courseId/:lectureId        # lecture contentId
/piano/:pianoId/music/:albumId                      # plex album/playlist id
/piano/:pianoId/music/:albumId/play?track=N
/piano/:pianoId/sheetmusic/:scoreId
/piano/:pianoId/games/:gameId
```
Each mode becomes a small nested `<Routes>` (or `useParams`-driven), the in-app `‹` becomes a real history pop, and grids `navigate()` instead of `setState`. This restores deep-linking, makes browser/physical Back behave, survives the deploy-reload, and lets HA/automation address content directly.

## G. Caching, loading & layout stability — **why "the APIs are slow af and posters reload every time"**

The slowness is not (only) the backend. It's that **the views are stateful, not cached, so every navigation re-fetches and re-downloads everything**, on top of a Plex path that's already serial.

### G1. Every grid refetches on every mount; nothing persists — **the root cause of "posters take forever each time"**
`CourseGrid`, `AlbumGrid`, `ScoreGrid`, `CourseDetail`, `AlbumDetail` each `DaylightAPI(...)` inside a `useEffect` keyed only to the collection/id, with **no cache layer** — no module memo, no SWR/React-Query, no lifted store. Because the drill-down is `useState` (see §F), going **grid → detail → back unmounts the grid and re-runs its fetch from scratch**, and the browser **re-requests every poster `<img>` again** because the elements are brand-new. So the *second, third, fourth* time you open Videos you pay the full list-call + full poster download *again*. Combine with:
- **Plex requests serialize through the app** (memory `reference_plex_requests_serialize`): the list call and the poster proxy hits queue behind each other rather than fanning out.
- **The image proxy** (`/api/v1/static/img/{key}`, `api.mjs:164`) — verify it sets a long `Cache-Control: public, max-age=…, immutable`. If it doesn't, the browser revalidates every poster on every remount even when the bytes never change.

**Fixes, in order of payoff:**
1. **Persist grid/list data across mounts** — lift the fetched lists into the `PianoConfig`/roster context or a tiny module-level `Map` cache keyed by `plex:id` (mtime/TTL like `artSource`'s scope cache, memory `reference_art_preset_thumbnails`). Back-navigation then renders instantly from cache and revalidates in the background (stale-while-revalidate).
2. **Routing (§F) makes this natural** — a route loader fetches once and React keeps the parent grid mounted while the child route is active, so Back doesn't refetch at all.
3. **Long-cache the poster proxy** so re-mounts are 304/from-disk, not full downloads.
4. **Prefetch on intent** — fetch a course's lectures on tile `focus`/`pointerdown` (before the tap resolves) so detail is warm by the time it opens.

### G2. `loading="lazy"` is the wrong call for a fixed kiosk grid
Every grid sets `loading="lazy"` (`CourseGrid.jsx:39`, `AlbumGrid.jsx:57`, `ScoreGrid.jsx:42`). On a **fixed-size kiosk** the whole grid is at/near the viewport, so lazy doesn't save bandwidth — it just **defers and serializes decode**, making posters trickle in. And on every remount the lazy machinery restarts. Use eager loading (or `fetchpriority="high"` for the first row) plus `decoding="async"`; reserve lazy for genuinely long scroll lists.

### G3. No pre-sizing / skeletons → flash of empty tiles (partial CLS)
Posters have **no `width`/`height` attributes** anywhere — sizing relies entirely on CSS `aspect-ratio` + `width:100%`. That reserves the *box* (so layout shift is limited), but:
- The `<img>` only renders when `item.thumbnail||item.image` is truthy (`*Grid.jsx`), so a thumbnail-less tile **collapses** to nothing instead of holding its slot.
- There's **no placeholder/skeleton background** on the tile, so each poster **pops from empty-dark-rectangle → image** with no graceful intermediate. On a wall of 20+ posters loading serially that reads as "broken/slow."

**Fix:** give the tile itself the aspect-ratio + a neutral skeleton background (shimmer or solid `#1c1c25`), always render the box, set intrinsic `width`/`height` on the `<img>`, and fade the image in on `load`. Pre-sizing the *tile* (not just the img) means the grid is fully laid out before a single byte arrives.

### G4. Loading state is a single italic "Loading…" for the whole grid
`items === null` shows one centered "Loading…" then the entire grid pops in at once — no progressive reveal, no skeleton grid matching the final layout. A skeleton grid (N gray tiles at the right aspect ratio) makes the wait feel half as long and eliminates the all-at-once reflow.

## H. Kiosk fixity — the UI is zoomable and the per-mode heading wastes the fold

### H1. Pinch / double-tap zoom is not locked — **breaks the fixed-size kiosk**
The shared `index.html` viewport is `width=device-width, initial-scale=1.0` with **no `maximum-scale=1, user-scalable=no`**, and `PianoApp.scss` sets **no `touch-action`** on the root (CallApp uses `touch-action: manipulation` — the piano app does not). On a touch wall this means **pinch-zoom and double-tap-zoom shift the supposedly-fixed `100vw/100vh` layout**, stranding the user in a zoomed/panned state with no reset. A kiosk must pin the visual viewport:
- Add `touch-action: manipulation` to `.piano-app` (kills double-tap zoom immediately, app-local, no global side effects).
- For the kiosk route, lock the viewport (`maximum-scale=1, user-scalable=no`) — ideally scoped so it doesn't affect non-kiosk apps sharing `index.html`.
- Belt-and-suspenders: the kiosk browser's own zoom lock (FKB/Firefox kiosk pref), since browser-chrome Ctrl+zoom persists across reloads independent of the page.

### H2. The per-mode `<h2>` heading wastes the vertical fold and says nothing
Every grid renders a redundant heading — `<h2>Videos</h2>` (`CourseGrid.jsx:31`), `<h2>Music</h2>`, `<h2>Sheet Music</h2>`, `<h2>Games</h2>` — **directly after the user tapped that exact mode tile from the menu.** It restates what the user just chose, and combined with `.piano-mode { padding: 1.5rem }` (`PianoApp.scss:118`) plus the `<h2>` default margins it **pushes the first poster row down by ~3–4rem of dead space** on a fixed screen that can't scroll to recover it. Drop the per-grid `<h2>`: the mode name belongs in the persistent `PianoChrome` bar (which already renders the piano label), not duplicated inside every grid. That reclaims the fold for content.

## I. Rendered-layout crimes (the on-screen slop — what you actually stare at)

### I1. CourseDetail wastes both axes; the lecture grid is shoved below the fold — **"a crime against humanity"**
`CourseDetail.jsx` stacks **head → poster → summary → grid as four vertical blocks**, and the poster's `align-self: flex-start` (`PianoApp.scss:296`) is **inert** because `.piano-video-detail` is never `display:flex` — so the poster is just a 9rem block image floating top-left. Result: the back chevron + short title sit on one line (right ~40% blank), then a small left-aligned poster (right ~70% blank), then a 60ch summary column (right blank), and **only then** does the lecture grid start — pushed a third of the way down a screen that can't scroll to recover it. **Both axes are wasted at once:** everything is left-aligned and narrow (horizontal waste) while the content that matters is shoved down (vertical waste).

**Fix:** make a real header *band* — poster left, (title + summary + lecture count + resume button) in a column to its right — so the header is one shallow row and the lecture grid rises to the top of the fold.

### I2. Variable caption height → a ragged, uneven board
`.piano-video-grid__title` (`PianoApp.scss:248`) has **no line-clamp, no reserved height, no white-space rule**. Lecture titles wrap to 1, 2, or 3 lines; in the `auto-fill / 1fr` grid each row's height is set by its **tallest** tile, so one long title inflates the whole row and the short-title tiles in that row get a slab of dead space under them. The thumbnails align at top but the tile bottoms are ragged — no baseline grid, no rhythm. This is the "messy board."

**Fix:** clamp the title to a fixed line count and reserve that height always: `-webkit-line-clamp: 2; min-height: 2.6em; overflow: hidden`. Every tile becomes the same height; the grid reads as a grid.

### I3. Episode descriptions are fetched and thrown away — never viewable
The lecture tile renders **thumbnail + watched/progress badge + title, and nothing else** (`CourseDetail.jsx:52-59`), and tapping it **plays immediately** (`onPlay` → player) with no interstitial. There is **no lecture-detail view**, so any per-episode summary the API returns is dropped on the floor. In an *educational* context this is the worst place to hide the description — the user commits to a lecture blind. Best practice for a course list is title + duration + a 1–2 line synopsis per row, or a detail panel on focus/long-press.

### I4. Three incompatible tile systems + a fourth ragged one
The app has **four unrelated card languages**: menu = big `aspect 3/2` emoji cards; collection grids (Videos/Music/Sheet) = label-less poster/cover images; **Games = variable-width *text pills*** sized to their label (`piano-mode__tile`, `flex-wrap` — "Space Invaders" wide, "Tetris" narrow, a ragged row); lecture grid = 16/9 thumb + ragged caption (I2). No shared card component, no shared label treatment. Pick one card primitive and parameterize it (poster vs landscape vs square).

### I5. Inverted type hierarchy + uncontrolled heading margins
Mode page titles are `<h2>` at browser-default size (~1.5rem) while **menu tile labels are 1.6rem** (`PianoApp.scss:112`) — the page heading is *smaller and weaker* than the tiles beneath it. And every `<h2>`/`<h3>` keeps **browser-default margins**, which is a chunk of the vertical waste in CourseDetail and Studio. There's no type scale: 1rem / 1.4 / 1.6 / 3rem appear ad hoc with no ramp.

### I6. Absolutely-positioned back button overlaps content
`.piano-game-fullscreen__back` is `position:absolute; top:.5rem; left:.5rem` and is **reused by ScoreViewer** (`ScoreViewer.jsx:38`) where it floats a dark pill over the **top-left of the first white score page** — right where a score's title/first measures live. Same pattern overlaps game UI in fullscreen games. A back control shouldn't occlude the content it returns from.

### I7. Incoherent breadcrumb vocabulary
The Videos collection grid is titled **"Videos"** (`CourseGrid.jsx:31`) but the back button *into* it from a course is **"‹ Courses"** (`CourseDetail.jsx:37`) — two names for the same level — while the video player's back is the wrong **"‹ Lessons"** (§A3). A user can't build a mental map when every level is named differently going down vs. coming back up.

## J. System-level incoherence (no design system underneath any of it)

- **J1. Seven border-radii, no scale:** 16 / 12 / 10 / 8 / 6 / 4 / 999px scattered across components. Radius should be 2–3 tokens.
- **J2. Context-inappropriate persistent control:** the MIDI **voice `<select>` rides in the top chrome on *every* mode** — including Videos/Music/Sheet, where instrument timbre is meaningless. It's also visually orphaned: `[⌂][label][voice]……gap……[status]`.
- **J3. Borderline contrast on all secondary text:** blurbs/sub/summary at `#aaa`/`#999` on `#1c1c25`/`#0e0e12` hover around 3–4.5:1 — small-text AA failures; the `#8a8a9a` "Continue without piano" link reads as disabled.
- **J4. Zero view-transition motion:** grid → detail → player are hard state swaps (instant blink). No slide/crossfade to convey spatial hierarchy; the only motion in the whole app is a `:active` scale. A kiosk benefits from continuity between levels.
- **J5. No selected/focus state for D-pad/gamepad nav:** tiles have only `:active`. Per house rule gamepad support is mandatory, but nothing shows which tile is focused during controller/keyboard traversal — the Games grid especially (which leads into gamepad games) gives no current-selection affordance.
- **J6. Sparse grids look broken:** `auto-fill, minmax(…,1fr)` with a handful of items stretches them across the row with a vast empty remainder; no max-width centering, no item count, no "centered until N" rule.
- **J7. Mixed glyph weights inside lists:** `▶` current-track marker, `♫` playlist badge, `✓` watched, `🗑` delete, emoji transport — full-color emoji and thin monochrome glyphs interleaved at different baselines throughout (the §B2 problem, but it recurs in *content*, not just controls).
- **J8. The 9rem keyboard footer eats the video:** in PianoVideoPlayer the always-on transport bar **and** a permanent 9rem play-along keyboard (`PianoApp.scss:321-324`) squeeze the video into a small middle band, even when the user is only watching.

## K. Accidental reloads — swipe-down pull-to-refresh destroys kiosk state

### K1. Pull-to-refresh fires on an unguarded swipe and reloads the whole app
On a touch kiosk a downward swipe at the top of a scroll container triggers the browser's **native pull-to-refresh**, reloading the SPA — which (per §F/§G) dumps the user back to the mode root, drops their now-playing/lecture position, and re-pays every API + poster fetch. It's the most destructive accidental gesture available, and nothing currently blocks it.

**Primary fix (kill the gesture — recommended): `overscroll-behavior`.** This is the actual root cause and the surgical fix. On the kiosk root:
```scss
.piano-app, html, body {
  overscroll-behavior: none;   // disables pull-to-refresh + scroll chaining
}
```
Pair it with §H1's `touch-action: manipulation` on `.piano-app` (also kills the double-tap-zoom gesture). Between them, the disruptive browser gestures simply never start — no dialog, no interruption, nothing for the user to dismiss. This is how production kiosks do it.

**Requested fix (confirm before unload): `beforeunload` guard — use with caution.**
```js
useEffect(() => {
  const guard = (e) => { e.preventDefault(); e.returnValue = ''; };
  window.addEventListener('beforeunload', guard);
  return () => window.removeEventListener('beforeunload', guard);
}, []);
```
Caveats that matter for *this* deployment:
- **It collides with the documented deploy reload.** The garage/office kiosks are hard-reloaded after every deploy via `xdotool … key ctrl+shift+r` (per `CLAUDE.local.md`). A blanket `beforeunload` makes that programmatic reload pop a native **"Leave site?"** dialog that the `xdotool` keystroke **won't auto-dismiss** — silently breaking the reload-after-deploy workflow until someone walks out to the garage.
- The prompt text is **browser-controlled** (you can't say "are you sure?"), it's **generic**, and some kiosk browsers (FKB/Firefox-kiosk) **suppress it entirely**, so it's not even reliable.
- It fires on *every* unload, not just the accidental swipe — so legitimate reloads get nagged too.

**Recommendation:** ship `overscroll-behavior: none` (+ `touch-action: manipulation`) as the real fix — it prevents the accidental refresh at the source without a dialog. If a confirm is still wanted as a backstop, scope it so it does **not** fire for intentional reloads (e.g. only arm `beforeunload` while media is actively playing, and provide a query-param/flag the deploy reload can pass to bypass it), to keep the `ctrl+shift+r` deploy workflow working.

## Priority ranking

| # | Sin | Severity | Effort | Notes |
|---|-----|----------|--------|-------|
| A2 | Inactivity yanks user off playing media | **High** | Low | Feed `playing` into `useInactivityReturn` |
| A1 | Now-playing title vanishes with chrome | **High** | Low | Split metadata out of the vanishing layer |
| A3 | Video can't be reliably stopped; mislabeled back | **High** | Med | Timeout `useResolvedMediaEl`; relabel back |
| I3 | Episode descriptions never viewable | **High** | Low | Show synopsis in lecture row / detail panel |
| I1 | CourseDetail wastes both axes; grid below fold | **High** | Low | Header band (poster left, meta right) |
| I2 | Ragged caption heights → messy board | **High** | Low | `line-clamp:2` + reserved min-height |
| K1 | Swipe-down pull-to-refresh nukes the kiosk | **High** | Low | `overscroll-behavior:none` + `beforeunload` guard |
| H1 | UI is pinch/double-tap zoomable | **High** | Low | `touch-action:manipulation` + viewport lock |
| H2 | Per-mode `<h2>` wastes the fold, says nothing | High | Low | Move mode name to chrome; delete the h2s |
| G1 | No caching → grids + posters refetch every visit | **High** | Med | Persist lists (cache/route loader) + SWR |
| A5 | Covers have no visible labels (touch) | High | Low | Caption tiles |
| B2 | Emoji + mixed-glyph iconography | **High** (identity) | Med | One SVG icon set, one stroke, palette-tinted |
| B1/B3 | Slop palette + undifferentiated type | High (identity) | Med | Subject-derived palette + a display face |
| F | No route per view; Plex IDs not in URL | High | Med | Nested routes; restores deep-link + Back |
| G2 | `loading="lazy"` wrong for fixed kiosk grid | Med | Low | Eager + `fetchpriority`; skeletons |
| G3/G4 | No pre-sizing/skeletons → flash of empty tiles | Med | Low | Size the tile, skeleton grid, fade-in |
| I4/J1 | Four tile systems, seven radii — no system | Med | Med | One card primitive + radius tokens |
| A4/C3/J8 | Inconsistent + overflow-prone player chrome | Med | Med | Shared auto-hide; reclaim video height |
| C1/J2 | Native `<select>`, persisted on every mode | Med | Low | Tap-to-cycle, show only where relevant |
| I6/I7 | Back button overlaps content; incoherent labels | Med | Low | Shared back component + breadcrumb vocab |
| A6 | Lessons ships a hollow shell | Med | Low | Hide or honestly label |
| A7 | Unconfirmed destructive delete (Studio) | Med | Low | Confirm step |
| D1 | No responsive/orientation handling | Med | Med | Orientation media queries |
| I5/J3 | Inverted type hierarchy; borderline contrast | Med | Low | Type scale; lift secondary text to AA |
| D3 | Stray cream panel in dark UI (Studio staff) | Low | Low | Restyle to the dark surface |
| D4 | Bare, system-leaking empty states | Low | Low | Shared empty-state, user-facing copy |
| J4/J5/E | No view motion, no focus/selected state, no reduced-motion | Low | Med | Quality floor + gamepad focus ring |

---

## One-paragraph summary for the busy reader

PianoKiosk is wired correctly and falls down on *experience and identity*. The three highest-impact bugs are all about **state the user loses**: the song title disappears three seconds into a track (metadata is trapped in the auto-hiding layer), passive video/music gets force-navigated back to the menu after 10 idle minutes (the inactivity timer never learned that "playing" is activity), and the video transport rides on an element that can silently never mount with no timeout or visible failure — while its only "stop" button is labeled for a mode that isn't even in the stack. On identity, it hits the AI-default trifecta head-on: near-black-plus-one-acid-green, emoji-as-icons (with two glyph languages fighting in a single transport row), and a single condensed sans doing every job — none of it derived from the one subject sitting right there, a piano, whose ivory/ebony/brass/felt/score-cream vocabulary is begging to be used. The cheapest wins with the biggest payoff: pull title/artist out of the vanishing layer, teach the inactivity timer about playback, caption the cover grids, and replace the emoji set with one real SVG icon family on a subject-derived palette.

---

*Files reviewed: `PianoApp.jsx`, `PianoApp.scss`, `PianoChrome.jsx`, `PianoMenu.jsx`, `PianoPicker.jsx`, `PianoConfig.jsx`, `useInactivityReturn.js`, `usePianoScreensaver.jsx`; modes `Videos/` (`Videos.jsx`, `PianoVideoPlayer.jsx`, `PianoVideoChrome.jsx`, `useResolvedMediaEl.js`, `PlayerBoundary.jsx`), `Music/` (`Music.jsx`, `MusicPlayer.jsx`, `AlbumGrid.jsx`, `AlbumDetail.jsx`, `useVanishingControls.js`), `SheetMusic/` (`SheetMusic.jsx`, `ScoreViewer.jsx`), `Games/Games.jsx`, `Studio/Studio.jsx`, `Lessons/Lessons.jsx`.*
