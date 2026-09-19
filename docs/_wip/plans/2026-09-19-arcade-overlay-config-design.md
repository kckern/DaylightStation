# Arcade session overlay: unified, config-driven design

Date: 2026-09-19
Status: design validated, not yet implemented

## Problem

The in-game overlay shown during EmulatorJS arcade play (rendered by the
Fitness app's `EmulatorGame` widget, displayed on both the garage Firefox
kiosk and the Shield-adjacent browser path) is produced by **two unrelated
mechanisms today**, confirmed live on the garage kiosk (screenshot,
2026-09-19): a boxed "02:08 PLAYED" badge top-right, and a second, bare,
unstyled "2:08" floating mid-left — the same clock, drawn twice.

1. **Per-manifest `OverlayLayer`** (`frontend/src/modules/Emulator/ui/OverlayLayer.jsx`)
   — position IS already config-driven per console via
   `media/emulation/{system}/{system}.yml` → `presentation.overlays` (percent
   region → CSS, `frontend/src/modules/Emulator/ui/regionStyle.js`). Fields
   resolve through `resolveOverlayValue.js` / `formatOverlayValue()`, which
   today supports `player_card`, `timer`/`clock` (count-up only), and
   `bpm`/`rpm`/`coins`. No "console/system label" format exists.
2. **Hardcoded play-budget box** (`frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.jsx:464-475`,
   styled in `frontend/src/modules/Emulator/EmulatorConsole.scss:508-530`) —
   has the countdown/count-up logic (`usePlayBudget.js`) and (unused) access
   to player identity and `systemLabel`, but its position, size, and dashed
   border are fully hardcoded (`top: 2.2vh; right: 2.2vh`), causing the
   clipping/blob appearance the user flagged from the RetroArch/Shield
   screenshot.

`systemLabel` and `nowPlaying` (player name/avatar) are already computed
elsewhere in the same component tree and simply never reach either overlay
mechanism as a combined "who's playing, what console, how much time" badge.

## Decision: unify into one overlay, config lives in the household folder

Retire the hardcoded play-budget box and the ad hoc per-console timer overlay
declaration. Introduce a single `session` overlay kind rendered through the
existing `OverlayLayer` pipeline, positioned and composed entirely from a new
household YAML config — not from `media/emulation/` manifests, since the user
wants one central, easily-edited file under `data/household/`, with defaults
that every console inherits unless overridden.

## Config file

`data/household/gaming/arcade-overlay.yml`, registered in
`shared/contracts/householdConfig.mjs` as `'arcade-overlay': 'gaming/arcade-overlay'`,
loaded via `ConfigService.getHouseholdAppConfig(null, 'arcade-overlay')` — the
same pattern every other household app config uses.

```yaml
defaults:
  anchor: top-left       # top-left | top-right | bottom-left | bottom-right
  offset_x: 2%           # from the anchor's horizontal edge
  offset_y: 2%           # from the anchor's vertical edge
  scale: 0.6             # multiplier on the badge's base font/padding
  fields: [player, system_label, timer]   # order = display order; omit to hide

systems:
  gbc:
    scale: 0.5            # override just scale; anchor/offset/fields inherit
  snes:
    anchor: bottom-right
    fields: [player, timer]   # drop system_label where it's redundant
  n64:
    fields: []             # overlay fully hidden for this console
```

Resolution: `resolved = { ...defaults, ...systems[currentSystemId] }`. A
per-console entry only names the keys it wants to change. `fields: []` is an
explicit, valid "show nothing" — distinct from omitting `fields`, which
inherits the default list.

Field vocabulary starts at three, matching data already computed today:
- `player` — name + avatar, from the existing `nowPlaying`.
- `system_label` — e.g. "Game Boy Color", from the existing `systemLabel`
  already on the wire (`backend/src/5_composition/modules/playSessions.mjs`,
  `EventBusPlaySessionAnnouncer.mjs`).
- `timer` — mm:ss, count-up or countdown depending on session mode; reuses
  `usePlayBudget`'s existing `derivePlayBudget`/`formatClock`.

`coins` is deliberately excluded for now: today's `overlayData.session.coins`
is a hardcoded placeholder (`'—'`), not real data — making it a selectable
field would let a console configure a field that never shows a real value.

Open item to confirm during implementation: the household file's `systems:`
keys must match whatever system id string `EmulatorConsole.jsx` already uses
internally (the same `gb`/`gbc`/`snes` used under `media/emulation/{system}/`)
so no second id-mapping layer is needed.

## Component changes

- **Backend:** register the new household config key; expose it to the
  frontend via the existing generic household-config-fetch channel (reuse
  whatever route already serves e.g. `games` config to the browser, rather
  than adding an emulator-specific endpoint).
- **Resolution:** new helper `resolveOverlayConfig(config, systemId)` (e.g.
  in `frontend/src/modules/Emulator/core/`) performs the defaults/override
  merge. `EmulatorConsole.jsx` calls it once the active system id is known,
  alongside its existing `overlayData` construction.
- **Rendering:** `OverlayLayer.jsx` gains a `session` overlay kind, positioned
  via anchor + offset + scale — a new sibling to `regionStyle.js`'s existing
  x/y/width/height-region CSS (e.g. `anchorStyle.js`), rather than a manifest
  region. Its fields render through `resolveOverlayValue`/`formatOverlayValue`,
  extended with a `system_label` source and a `countdown`/`timer` format.
- **Removed:** `usePlayBudget`'s JSX box in `EmulatorGameWidget.jsx` (~464-475)
  and its CSS (`EmulatorConsole.scss` ~508-530) are deleted entirely.
  `usePlayBudget`'s *data derivation* (`derivePlayBudget`, `formatClock`,
  staleness) stays and feeds `overlayData.session.timer` instead of owning a
  box. Any manifest that declares its own ad hoc timer overlay is retired in
  favor of this one `session` overlay — no console manifest should render a
  second, redundant clock.
- **Backward compat:** none needed — this is pre-launch tuning of an
  already-broken display, not a public API.

## Styling

The `session` overlay gets one clean base style: small badge, subtle
background (`rgba(8,10,15,0.7)`), rounded corners, no dashed border. Every
dimension (font-size, padding, gap) scales off the single `scale` multiplier,
so the badge cannot overflow or clip regardless of console — it's sized
relative to itself, never a fixed box someone has to keep in-bounds by hand.
Anchor-based positioning (`top`/`left`/`right`/`bottom: offset` per corner)
pins it inside the screen bounds mathematically. Per-field rendering stays
visually consistent across consoles (`player` = avatar + name inline;
`system_label`/`timer` = plain text); only geometry and which fields appear
vary by config. Shipped defaults: `anchor: top-left, scale: 0.5`, matching the
user's stated preference for something subtle in the corner rather than the
current bottom-center blob.

## Testing / verification

- Unit: `resolveOverlayConfig` merge — per-key override, `fields: []`
  explicit-hide, unknown system id falls back to pure defaults.
- Unit: `resolveOverlayValue`/`formatOverlayValue` — new `system_label`
  source and `countdown` format.
- Visual: post-implementation, screenshot both the garage kiosk (`ssh garage`)
  and the Shield/browser path; confirm exactly one badge renders (no more
  duplicate clock), it sits top-left without clipping, and a per-console
  override (e.g. `snes.anchor: bottom-right`) visibly moves it.
- Extend the existing `EmulatorGameWidget.test.jsx` to cover overlay
  rendering rather than leaving it uncovered.
