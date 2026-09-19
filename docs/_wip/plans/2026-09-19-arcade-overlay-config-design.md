# Arcade session overlay: unified, config-driven design

Date: 2026-09-19
Status: design validated (revised after investigation found a third surface),
not yet implemented

## Problem

The "who's playing / what console / how much time" badge shown during arcade
play is drawn by **three unrelated mechanisms today**, confirmed by screenshots
taken on both the garage Firefox kiosk and the Shield/RetroArch device
(2026-09-19):

1. **`frontend/public/arcade-film.html`** — a standalone static page Fully
   Kiosk Browser floats as a transparent `webOverlayUrl` window on top of
   *anything* the kiosk shows, RetroArch included (armed/disarmed by
   `FullyKioskPlayOverlay.mjs` via `OverlayPlaySessionAnnouncer`). This is what
   produced the dashed-yellow "Player / GAME BOY COLOR / 11:49" box on the
   Shield screenshot. Its own source comments say plainly: `banner.classList
   .add('placeholder')` — *"PLACEHOLDER, not the finished countdown... Design
   comes later."* Its **position** is genuinely well-engineered (a rect
   computed server-side from real bezel negative-space,
   `data/household/gaming/games.yml` zones + `OverlayPlacement.mjs`'s
   `choosePlacement`) and must not be replaced — a fixed corner anchor would
   sit on top of the game on consoles like the N64 where the bezel is a thin
   pillar. But its **fields shown** (name, sub-label, clock, avatar, a
   progress bar, even a raw debug field dump) and its **look** (yellow dashed
   border, "placeholder" skin) are fully hardcoded, with zero configurability.
2. **Per-manifest `OverlayLayer`** (`frontend/src/modules/Emulator/ui/OverlayLayer.jsx`)
   — a bare, unstyled "2:08" floating mid-screen on the garage kiosk. Position
   IS already config-driven per console via `media/emulation/{system}/{system}.yml`
   → `presentation.overlays` (percent region → CSS,
   `frontend/src/modules/Emulator/ui/regionStyle.js`). Confirmed live on the
   real data tree: `gb`, `gbc`, `gba`, and `genesis` manifests each declare a
   `timer` overlay (`source: session.play_seconds`, `format: timer`) and a
   `player` overlay (`source: session.current_player`, `format: player_card`)
   — the exact two concepts the new unified badge replaces.
3. **Hardcoded play-budget box** (`frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.jsx:464-475`,
   styled in `frontend/src/modules/Emulator/EmulatorConsole.scss:508-530`) —
   the boxed "02:08 PLAYED" seen top-right on the garage kiosk. Has the
   countdown/count-up logic (`usePlayBudget.js`) and unused access to player
   identity and `systemLabel`, but position/size/border are fully hardcoded,
   causing the clipping/blob look the user originally flagged.

So on the garage kiosk alone, the same clock is drawn **twice** (mechanisms 2
and 3) in two different places with two different looks, and mechanism 1 (a
different technology entirely, on a different device) draws a third, visually
unrelated version of the same three facts.

## Decision: one config, three renderers, one look

Not one shared component — `arcade-film.html` is a dependency-free static
page (no build step, no React) floating in an Android WebView, and it stays
that way; forcing it to share code with the React tree would cost more than
it buys. Instead: **one household YAML** decides *what shows* (which fields,
in what order) for every surface, and a **shared, explicitly-written visual
spec** (colors, radius, spacing scale, type) is implemented independently in
each renderer's own styling, so a household member sees one consistent design
language even though the underlying files never touch. Position stays
per-technology, because it has to: `arcade-film.html` keeps its bezel-zone
placement (a hard constraint — the docs are explicit that a wrong placement
"is worse than none"), while the browser overlays get a new, simple
anchor+offset+scale model.

Retired: the hardcoded play-budget box, the per-manifest `timer`/`player`
overlay entries in `gb`/`gba`/`gbc`/`genesis`, and `arcade-film.html`'s
placeholder skin (dashed border, debug field dump, "PLACEHOLDER" framing).

## Config file

`data/household/gaming/arcade-overlay.yml`, registered in
`shared/contracts/householdConfig.mjs` as `'arcade-overlay': 'gaming/arcade-overlay'`,
loaded via `ConfigService.getHouseholdAppConfig(null, 'arcade-overlay')` — the
same pattern every other household app config uses.

```yaml
defaults:
  anchor: top-left       # top-left | top-right | bottom-left | bottom-right (browser only)
  offset_x: 2%           # from the anchor's horizontal edge (browser only)
  offset_y: 2%           # from the anchor's vertical edge (browser only)
  scale: 0.5             # multiplier on the badge's base font/padding (browser only)
  fields: [player, system_label, timer]   # order = display order; shared by ALL surfaces

systems:
  gbc:
    scale: 0.4
  snes:
    anchor: bottom-right
    fields: [player, timer]   # drop system_label where it's redundant
  n64:
    fields: []             # overlay fully hidden for this console, on every surface
```

Resolution: `resolved = { ...defaults, ...systems[currentSystemId] }`. A
per-console entry only names the keys it wants to change. `fields: []` is an
explicit, valid "show nothing" — distinct from omitting `fields`, which
inherits the default list. `anchor`/`offset_x`/`offset_y`/`scale` are read
only by the browser renderer; `arcade-film.html` reads `fields` alone and
keeps using its own computed placement rect for position.

Field vocabulary starts at three, matching data already computed today:
- `player` — name + avatar, from the existing `nowPlaying`/`current_player`.
- `system_label` — e.g. "Game Boy Color", from the existing `systemLabel`
  already on the wire (`backend/src/5_composition/modules/playSessions.mjs`,
  `EventBusPlaySessionAnnouncer.mjs`).
- `timer` — mm:ss, count-up or countdown depending on session mode; reuses
  `usePlayBudget`'s existing `derivePlayBudget`/`formatClock`.

`coins` is deliberately excluded: today's `overlayData.session.coins` is a
hardcoded placeholder (`'—'`), not real data — making it a selectable field
would let a console configure a field that never shows a real value.
`arcade-film.html`'s progress bar and debug meta dump are not fields either —
the bar is existing automatic behavior (shown whenever a real budget exists),
and the meta dump is placeholder-only debug output being deleted outright.

## Delivery: ride the existing play-session message, add no new endpoint

Both browser surfaces (the per-manifest-turned-session overlay and
`arcade-film.html`) already receive their state over the SAME channel: the
`play-session:<deviceId>` pub/sub message that
`EventBusPlaySessionAnnouncer`/`OverlayPlaySessionAnnouncer` already build and
broadcast on start/progress/end, and which `usePlayBudget.js` already
subscribes to. That message already carries `systemLabel` and `placement`,
resolved once per message in `EventBusPlaySessionAnnouncer#presentation()`.

Rather than adding a frontend fetch for the new household config (a separate
round trip, a separate cache-invalidation story, a separate place to get the
system id wrong), **resolve the arcade-overlay.yml config server-side, once
per system, in that same `#presentation()` method**, and attach it to every
message as `overlay: { fields, anchor, offsetX, offsetY, scale }`. Both
consumers then just read a field off a message they already have:
- `arcade-film.html`'s `handle()` reads `m.overlay.fields` and toggles which
  of name/sub/clock render — nothing else about the file's placement logic
  changes.
- The browser's `usePlayBudget` hook exposes `overlayConfig: message?.overlay
  ?? null` (a plain passthrough, alongside the `systemLabel` it already needs
  to expose), which `EmulatorGameWidget.jsx` forwards to `EmulatorConsole` to
  drive the new anchor-positioned `session` overlay.

This keeps the defaults/override merge in exactly one place
(`resolveOverlayConfig(config, systemId)`, a new pure domain function next to
`OverlayPlacement.mjs`), tested once, backend-only.

## Component changes

- **Domain (backend):** new `backend/src/2_domains/gaming/value-objects/OverlaySessionFields.mjs`
  exporting `resolveOverlayConfig(config, systemId)` — pure `{...defaults,
  ...systems[systemId]}` merge, unit tested in isolation.
- **Composition (backend):** `createPlaySessionTracking` (`playSessions.mjs`)
  gains an `arcadeOverlayConfig` param (loaded in `app.mjs` alongside
  `gamesConfig`, via the new household-config registry entry) and threads an
  `overlayConfigFor(systemId)` callback into `EventBusPlaySessionAnnouncer`,
  analogous to the existing `placementFor`. `#presentation()` adds `overlay:
  overlayConfigFor(content?.console)` to every message payload.
- **Native surface:** `arcade-film.html`'s `show()`/`handle()` read
  `m.overlay?.fields` and add/remove a `shed-name`/`shed-sub`/`shed-clock`-style
  class (reusing the file's existing `.shed{display:none}` pattern) so a
  console can drop `system_label` without a code change. The placeholder skin
  (dashed border, `.placeholder` class, `#meta` debug dump) is deleted and
  replaced with the shared visual spec (see Styling).
- **Frontend — value resolution:** `resolveOverlayValue.js`/`formatOverlayValue()`
  gains one new format, `'countdown'`: input is `{ text, urgency, stale }`
  (already-formatted by `usePlayBudget`'s `formatClock`, not raw seconds —
  keeps clock math in exactly one place), output `{ kind: 'stat', text, unit:
  '', urgency, stale }`. `system_label` needs **no new source case** — it is
  not `state.*`/`governance.*`, so `resolveOverlayValue`'s existing default
  branch (`ctx.overlayData?.[source]`) already reads it once
  `overlayData['session.system_label']` is populated.
- **Frontend — rendering:** `OverlayLayer.jsx` gains a `session`-kind overlay:
  instead of one `resolve(o)` call producing one descriptor, a session overlay
  entry (`{ id: 'session', kind: 'session', anchor, offsetX, offsetY, scale,
  fields: [...] }`) resolves and renders ONE descriptor per listed field
  inside a single container positioned by a new `anchorStyle.js` (sibling to
  `regionStyle.js`; anchor + offset → CSS inset, `transform: scale()` from the
  anchor's corner for the size multiplier — one CSS transform, no
  per-field math). `OverlayBody`/`emu-overlay--session` styling forwards
  `urgency`/`stale` as CSS classes the same way `.is-warn`/`.is-crit`/`.is-stale`
  already work on the box being deleted.
- **Frontend — wiring:** `EmulatorConsole.jsx` accepts a new
  `sessionOverlayConfig` prop (anchor/offset/scale/fields) and synthesizes the
  `session` overlay entry from it; `overlayData` gains
  `'session.system_label'` and `'session.timer'` (an object, not seconds).
  `usePlayBudget.js` exposes `systemLabel`/`overlayConfig` alongside its
  existing `visible`/`stale`/`ms`/`label`/`urgency`. `EmulatorGameWidget.jsx`
  deletes its inline play-budget `<div>` (lines ~464-475) and instead folds
  `playBudget`'s timer/systemLabel/overlayConfig into the props it already
  passes to `<EmulatorConsole>`.
- **Dead code removed:** with the manifest `timer` overlays gone,
  `EmulatorConsole.jsx`'s `elapsedSec` state, its `setInterval` effect, the
  `playStartedAt` prop, and the `'session.play_seconds'` overlayData key have
  no remaining consumer anywhere in the codebase (verified by grep) and are
  deleted rather than left as dead plumbing.
- **Data (real files on the household tree, not in git):**
  `data/household/gaming/arcade-overlay.yml` is created; the `timer` and
  `player` overlay entries are deleted from `media/emulation/gb/gameboy.yml`,
  `media/emulation/gba/gba.yml`, `media/emulation/gbc/gbc.yml`, and
  `media/emulation/genesis/genesis.yml` (their `coins` entries are untouched —
  a different, still-unbuilt concept). `snes`/`n64` manifests declare no
  overlays today and need no edit.
- **Backward compat:** none needed — this is pre-launch tuning of an
  already-broken/placeholder display, not a public API.

## Styling — shared primitives, independent implementations

One small, explicit visual spec, implemented once in `EmulatorConsole.scss`
(the `.emu-overlay--session` rules) and once in `arcade-film.html`'s inline
`<style>` — same numbers, two files, because the two renderers can't share a
stylesheet:
- Background: `rgba(8, 10, 15, 0.78)`, no border by default (a visible border
  appears only for the existing `is-stale` degraded state, reusing that
  established convention rather than inventing a new one).
- Corner radius, type (`Roboto Condensed` where available, else system-ui),
  and an accent color (`#ffd666`, the one thing worth keeping from the old
  placeholder's yellow, now used sparingly — urgency color, not a border) are
  the same values in both files.
- Every dimension scales off one multiplier (`scale` in the browser CSS
  `transform`; `arcade-film.html`'s existing `--u` layout-unit mechanism, which
  already does exactly this) so neither renderer needs per-console hand
  tuning beyond the config.
- `arcade-film.html` keeps its existing fit-then-shed behavior (shrink the
  layout unit, then drop optional content) for the rare zone too small to
  hold everything — that logic is sound and untouched; only the *skin* and
  the *field-visibility* source change.

## Testing / verification

- Unit (backend): `resolveOverlayConfig` merge — per-key override, `fields:
  []` explicit-hide, unknown system id falls back to pure defaults.
- Unit (backend): `EventBusPlaySessionAnnouncer` — extend the existing
  harness/tests to assert `overlay` appears on every published payload and
  survives a throwing `overlayConfigFor` the same way `placementFor` already
  does (existing test: "still publishes when the placement lookup throws").
- Unit (frontend): `resolveOverlayValue`/`formatOverlayValue` — new
  `countdown` format; `OverlayLayer` — new `session`-kind rendering
  (multi-field, anchor-positioned).
- Unit (frontend): `usePlayBudget`/`derivePlayBudget` — `systemLabel`/
  `overlayConfig` passthrough fields.
- Updated: `EmulatorGameWidget.test.jsx`'s "subscribes to the device play feed"
  test currently asserts a `data-testid="play-budget"` node that this change
  deletes; it moves to asserting the same facts (clock text, "played" label)
  via the mocked `EmulatorConsole`'s received props instead.
- Visual: after implementation, screenshot all three surfaces — the garage
  kiosk (`ssh garage`, X11 `:0`, `scrot`), the Shield/RetroArch device (`adb
  exec-out screencap`, since RetroArch's own foreground blocks FKB's own
  screenshot command) — confirm exactly one badge renders per surface (no
  more duplicate garage clock), the browser badge sits top-left without
  clipping, `arcade-film.html` no longer shows the placeholder skin or debug
  dump, and a per-console override (e.g. `snes.anchor: bottom-right`, or
  dropping a field) visibly changes the right surface.
