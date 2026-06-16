# ArtMode Menu-Launch — Design

**Date:** 2026-06-15
**Status:** Approved design, ready for implementation plan

## Context

**Sub-project 4 of 4** (final) in the ArtMode rework. Sub-projects 1-3b shipped:
collections, presets, and transport-agnostic `display:content` scene triggering. This
adds the ability to launch an ArtMode preset from a **menu**.

The earlier "is ArtMode an app / does it need a registry?" tension is fully resolved: it
is **not** an AppContainer app and needs no app registry. A menu entry is simply a
`display` content intent — the same verb the load API uses. Menu-launch, the idle
screensaver, and `/load?display=` all converge on the single `display:content` scene
handler in `ScreenActionHandler` (sub-project 3b).

## Purpose

A "Gallery" menu lists art presets; selecting one engages the ArtMode scene on the
current screen. Backs the menu with silent **period presets** (one per art-history era)
so the existing collections are immediately browsable.

## What already exists

- Backend `listConfigNormalizer` maps a menu item `{ action: Display, input: <id> }` →
  `{ display: { contentId: <id> } }`. No backend change needed.
- `MenuStack.jsx` already has an `else if (selection.display)` branch — but it pushes the
  generic `Displayer` overlay (`push({ type: 'display', ... })`), which renders ordinary
  content, not an `art:<preset>` scene.
- `ScreenActionHandler` already handles `display:content` for `art:<preset>` ids
  (fetches the preset, shows ArtMode) — sub-project 3b.

So the only code change is **routing**: a `display` menu selection whose id is an
`art:` preset should go to the scene handler, not the generic Displayer.

## Components

### 1. `MenuStack.jsx` — route `art:` display selections to the scene

In the `else if (selection.display)` branch, compute the id
(`selection.display.contentId || selection.display.id`); if it starts with `art:`,
`getActionBus().emit('display:content', { id })` and return (engage the ArtMode scene
via `ScreenActionHandler`). Otherwise keep the existing `push({ type: 'display', ... })`
Displayer path unchanged.

`getActionBus` is imported from the screen-framework input module
(`../../screen-framework/input/ActionBus.js`).

### 2. Period presets in `artmode.yml`

Add seven silent presets, one per period, each identical to `gallery-silent` but scoped
to its collection and with `music: null`:

```yaml
  renaissance:   { collection: renaissance,   music: null, placard: true, matMargin: 4, cropMaxPerSide: 8, frame: {...}, ambient: {...} }
  baroque:       { collection: baroque,        music: null, ... }
  rococo:        { collection: rococo,         music: null, ... }
  romantic:      { collection: romantic,       music: null, ... }
  realism:       { collection: realism,        music: null, ... }
  impressionism: { collection: impressionism,  music: null, ... }
  modern:        { collection: modern,         music: null, ... }
```

(`frame`/`ambient` are the same blocks as `gallery-silent`. The period collection keys
already exist in `art.yml` from sub-project 1.)

### 3. Gallery menu config + TVApp entry

`data/household/config/lists/menus/gallery.yml` — a menu listing the period presets:

```yaml
title: Gallery
items:
  - { uid: <uuid>, label: Renaissance,   action: Display, input: art:renaissance }
  - { uid: <uuid>, label: Baroque,       action: Display, input: art:baroque }
  - { uid: <uuid>, label: Rococo,        action: Display, input: art:rococo }
  - { uid: <uuid>, label: Romantic,      action: Display, input: art:romantic }
  - { uid: <uuid>, label: Realism,       action: Display, input: art:realism }
  - { uid: <uuid>, label: Impressionism, action: Display, input: art:impressionism }
  - { uid: <uuid>, label: Modern,        action: Display, input: art:modern }
```

Add a top-level **Gallery** entry to the TVApp menu (`lists/menus/tvapp.yml`) that opens
`menu:gallery` (mirroring the existing Music entry that opens `menu:music`).

## Behavior

Selecting a Gallery item engages ArtMode on the current screen with that period's
collection, silent. Exit (OK/Back) returns to the menu. Works on any screen that shows
the menu — the selection emits on the local action bus; no device-load/transport
involved.

## Error handling

- Unknown preset → `ScreenActionHandler` already handles the 404 (logs, engages nothing).
- Non-`art:` `display` selections are unaffected (still the generic Displayer).

## Testing

- **`MenuStack`**: a `display` selection with an `art:` id emits `display:content`
  `{ id }` on the action bus and does NOT push a `display`-type overlay; a non-`art:`
  `display` selection still pushes the `display` overlay (existing behavior). (Scene
  engagement itself is covered by the 3b `ScreenActionHandler` tests.)

## Out of scope

- Dynamic menu generation from `artmode.yml` (the Gallery menu is hand-authored config).
- Per-device targeting from the menu (menu-launch is local to the current screen; remote
  targeting is the `/load?display=` path).
- Music presets in the Gallery (period presets are silent by decision; the music preset
  `classical-evening` remains for the `/load` trigger).

## Wrap-up

With this, the ArtMode rework is complete: collections (what art) → presets (how it's
presented) → transport-agnostic triggering (`display=art:<preset>` on any target) →
menu-launch. One component (`ArtMode`, an OS/shell scene), one preset config, one
`display:content` action, reached from idle, the load API, and now a menu.
