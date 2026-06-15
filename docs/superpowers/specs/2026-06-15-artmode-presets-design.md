# ArtMode Presets + Config Extraction — Design

**Date:** 2026-06-15
**Status:** Approved design, ready for implementation plan

## Context

**Sub-project 2 of 4** in the ArtMode rework (see
`2026-06-15-art-collections-design.md` for the arc). Sub-project 1 (collections) is
shipped: `/api/v1/art/featured?collection=<key>` selects from `art.yml` collections.

This sub-project extracts ArtMode's configuration out of the screen YAML into named
**presets**, and makes a screen reference a preset by key. It also wires the one
missing link so collections actually drive the UI: the frontend `ArtMode` currently
calls `/art/featured` with no collection.

## Purpose

A **preset** is a named bundle of everything an ArtMode presentation needs:
`{ collection, music, placard, frame, matMargin, cropMaxPerSide, ambient,
defaultViewMode }`. A screen's screensaver references a preset by key instead of
inlining props. The backend expands the reference into `screensaver.props` when it
serves the screen config. The same presets + resolver feed the trigger path in
sub-project 3.

## Config split

- `data/household/config/art.yml` — *what art exists* (collections). Unchanged.
- `data/household/config/artmode.yml` (new) — *how it's presented* (presets):

```yaml
presets:
  gallery-silent:                 # the passive screensaver — no audio
    collection: all
    music: null
    placard: true
    matMargin: 4
    cropMaxPerSide: 8
    frame: { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 }
    ambient:
      defaultLux: 80
      curve:
        - { lux: 0, dim: 0.92 }
        - { lux: 5, dim: 0.85 }
        - { lux: 40, dim: 0.55 }
        - { lux: 150, dim: 0.32 }
        - { lux: 400, dim: 0.15 }

  classical-evening:              # defined now; used by the trigger path (sub-project 3)
    collection: all
    music: { queue: "plex:622894", shuffle: true, volume: 0.25 }
    placard: true
    matMargin: 4
    cropMaxPerSide: 8
    frame: { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 }
    ambient: { defaultLux: 80, curve: [ { lux: 0, dim: 0.92 }, { lux: 5, dim: 0.85 }, { lux: 40, dim: 0.55 }, { lux: 150, dim: 0.32 }, { lux: 400, dim: 0.15 } ] }
```

## Reference syntax + resolution

A screen references a preset under `screensaver`:

```yaml
screensaver:
  widget: art
  idle: 180
  showOnLoad: true
  interactive: true
  preset: gallery-silent
  props:               # optional — shallow-merged ON TOP of the preset
    matMargin: 6
```

Resolution (backend, in the screens router):
1. Load the screen YAML (as today).
2. If `screensaver.preset` is set, read `artmode.yml` (fresh per request, matching the
   screen-from-disk behavior), look up the named preset, and set
   `screensaver.props = { ...preset, ...existingInlineProps }` (preset is the base;
   inline `screensaver.props` override per key — shallow merge).
3. Return the resolved config. The frontend mounts ArtMode with the resolved props,
   unchanged from how it consumes `screensaver.props` today.

`screensaver.preset` may remain on the returned object (harmless) or be removed; the
frontend reads `screensaver.props`.

## Pure resolver

`backend/src/1_adapters/content/art/presetResolver.mjs`:

- `resolvePreset(presets, key, inlineProps = {}) → props`
  - known key → `{ ...presets[key], ...inlineProps }`.
  - missing/unknown key → `{ ...inlineProps }` (the caller logs a warn for unknown).
  - no key (`key` falsy) → `{ ...inlineProps }`.

Pure and unit-testable; reused by the trigger path (sub-project 3) so a dispatched
preset resolves identically to a screensaver preset.

## Frontend change

`ArtMode.jsx` gains a `collection` prop (default `null`). In `load()` the request
becomes `api/v1/art/featured?collection=<collection>` when `collection` is set, else
the bare `api/v1/art/featured` (today's behavior). This is the only frontend change —
the resolved preset supplies `collection` as a prop like any other.

## Migration

`data/household/screens/living-room.yml`: replace the inline `screensaver.props`
(placard/cropMaxPerSide/matMargin/frame/ambient/music) with:

```yaml
screensaver:
  widget: art
  idle: 180
  showOnLoad: true
  interactive: true
  preset: gallery-silent
```

Net effect: the passive screensaver loses its background music (per the splash/lock =
no-audio design); `classical-evening` waits in `artmode.yml` for sub-project 3's
trigger path. All other ArtMode behavior (frame, ambient dimming, placard, view modes)
is preserved by the `gallery-silent` preset.

## Backward compatibility

Additive. A screensaver with no `preset` and inline `props` works exactly as today
(resolver returns the inline props untouched). `ArtMode` with no `collection` prop
fetches the default pool, as it does now. Absent `artmode.yml` → presets `{}`; an
unknown/absent preset falls back to inline props (or ArtMode's built-in defaults).

## Error handling

- Unknown preset key → warn (`screens.preset.unknown`) + fall back to inline props.
- Absent/unreadable `artmode.yml` → presets `{}`, inline props used; no throw.
- The screensaver must always end up with usable props (preset, inline, or ArtMode
  defaults) so the screen never breaks.

## Testing

- **Pure (`presetResolver`)**: known key returns the preset; inline props override
  per key (shallow); unknown key → inline props only; no key → inline props only;
  empty inline → preset as-is.
- **Screens router**: a `screensaver.preset` reference expands into `screensaver.props`
  from a fixture `artmode.yml`; inline `props` override the preset; unknown preset →
  inline props + warn; no preset → config returned unchanged; absent `artmode.yml` →
  inline props pass through.
- **Frontend `ArtMode`**: with a `collection` prop, `load()` calls
  `/art/featured?collection=<key>`; without it, calls the bare endpoint. (Extend the
  existing ArtMode test's `DaylightAPI` assertions.)

Run via `./node_modules/.bin/vitest run --config vitest.config.mjs <file>`.

## Out of scope (later sub-projects)

- Triggering a preset via the device load API + the passive/active distinction in
  practice (sub-project 3) — `classical-evening` is staged here for it.
- Registry / menu launch and the screensaver-shell-vs-app tension (sub-project 4).
