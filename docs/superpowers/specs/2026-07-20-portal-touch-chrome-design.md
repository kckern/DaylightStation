# Touch Chrome for Screen-Framework Overlays

**Date:** 2026-07-20
**Status:** Approved, pending implementation plan
**Driver:** Portal screen (`/screen/portal`) — a repurposed Facebook Portal used as a touch-only kiosk.

## Problem

The Portal screen runs with `input.type: touch`. `TouchAdapter`
(`frontend/src/screen-framework/input/adapters/TouchAdapter.js`) deliberately registers no
key listeners and emits no actions — its premise is that "touchscreens interact directly
with clickable UI elements."

That premise holds for the menu, which gained `onClick` activation in `354490b53`. It does
**not** hold for anything mounted as a fullscreen overlay. The Player renders no exit
affordance, so once content opens there is no way to emit `escape`: no remote, no keyboard,
no Esc key. The user is stuck until the kiosk is reloaded out-of-band.

FullyKiosk `kioskMode` was enabled on the Portal on 2026-07-20, which also suppresses the
Android back/home buttons. On-screen chrome is therefore the *only* available exit.

## Goals

- A touch user can always leave any fullscreen overlay.
- A touch user gets remote-equivalent transport control over playing media.
- Non-touch screens (living-room, office) are provably unaffected.

## Non-Goals

- Changing `modules/Player` or `lib/Player`. Those are shared modules; per project
  convention the fix belongs in the consumer. The consumer seams here are
  `ScreenOverlayProvider.jsx` and `ScreenActionHandler.jsx`.
- Reimplementing escape/playback/volume semantics. Chrome emits existing ActionBus actions.
- A scrub bar or any drag interaction. Established project rule: touch surfaces use discrete
  tap targets, never sliders.

## Layout

The Portal is 1280x800 — 16:10, not 16:9. A full-width 16:9 video is 1280x720, leaving 80px
of dead letterbox.

Rather than deriving the lane from content aspect (a 4:3 read-along scales to 1067x800 and
would leave no band), the layout **reserves** it:

```
┌──────────────────────────────┐ ─┐
│                              │  │
│          content             │  │ 720
│   (any aspect, letterboxed   │  │
│        within this box)      │  │
├──────────────────────────────┤ ─┤
│ [←] [⏮][⏯][⏭] [↺][↻] [–]▮▮▯[+]│  │ 80
└──────────────────────────────┘ ─┘
             1280
```

Because chrome occupies reserved space rather than overlaying content, it is **always
visible**. No auto-hide timers, no reveal-tap handling, and no possibility of the user
hunting for a hidden control.

The lane is `flex-shrink: 0`; the content box takes the remainder. Buttons are at least 64px
tall. The lane carries `transform: translateZ(0)` — a playing `<video>` GPU-promotes above
sibling controls, and while a beside-not-over lane largely sidesteps this, the promotion
guard is cheap insurance.

## Architecture

`ScreenOverlayProvider` owns the lane. Each `showOverlay` call declares which chrome it
needs; `TouchChrome` is a dumb presentational component that emits actions and holds no
media state.

### Components

| Component | Change | Responsibility |
|---|---|---|
| `overlays/TouchChrome.jsx` | new | Renders the button row; emits ActionBus actions. |
| `overlays/TouchChrome.css` | new | Lane + button sizing. |
| `overlays/ScreenOverlayProvider.jsx` | modified | Accepts `inputType`; when `'touch'`, wraps the fullscreen overlay in the lane layout and renders `TouchChrome` in the declared mode. Accepts a `chrome` option in `showOverlay`. |
| `actions/ScreenActionHandler.jsx` | modified | Passes `{ chrome: 'media' }` on its `showOverlay(Player, …)` calls. |
| `ScreenRenderer.jsx` | modified | Passes `inputType={config.input?.type}` to `ScreenOverlayProvider` (today it reaches only `ScreenActionHandler`). |

### Chrome modes

- `'back'` — default for every fullscreen overlay. Back button only.
- `'media'` — declared by Player mounts. Back plus transport plus volume.

When `inputType !== 'touch'`, no lane and no chrome render at all; the overlay renders
exactly as it does today.

## Action mapping

Chrome emits only actions that already have handlers. This is the core of the design: all
existing semantics — MenuStack's pop-one-level escape interceptor, PiP dismissal, the YAML
`actions.escape` fallback chain — keep working untouched.

| Button | Action | Payload | Resolves to |
|---|---|---|---|
| Back | `escape` | — | interceptor → PiP dismiss → YAML `actions.escape` chain |
| Play/pause | `media:playback` | `{command:'toggle'}` | synthetic `Enter` |
| Prev | `media:playback` | `{command:'prev'}` | synthetic `Backspace` |
| Next | `media:playback` | `{command:'next'}` | synthetic `Tab` |
| Seek back | `media:playback` | `{command:'rew'}` | synthetic `ArrowLeft` |
| Seek fwd | `media:playback` | `{command:'fwd'}` | synthetic `ArrowRight` |
| Volume down | `display:volume` | `{command:'down'}` | `useScreenVolume().step` |
| Volume up | `display:volume` | `{command:'up'}` | `useScreenVolume().step` |

`media:playback` is handled by `handleMediaPlayback`, which dispatches synthetic keydown
events via its `keyMapping` table. Chrome therefore drives media through the identical path
the remote uses.

**Seek step is the Player's, not ours.** `rew`/`fwd` become `ArrowLeft`/`ArrowRight`, and the
Player decides how far that seeks. The chrome must not label these with a specific duration
(no "30s") — label them with direction-only icons, so the control never promises an interval
the Player doesn't honour.

**Verified correction:** an earlier draft specified `media:seek-rel` for ±30s seek.
`media:seek-rel` appears in `actionMap.js` but has **no handler in `ScreenActionHandler`** —
it is handled on another path. Seek uses `media:playback` `rew`/`fwd` instead.

## Config change

`data/household/screens/portal.yml` currently sets:

```yaml
volume:
  fixed: true
  defaultMaster: 1.0
```

`fixed: true` disables `setMaster`/`step`/`toggleMute`, so on-screen volume buttons would
render but do nothing. Replace with a stepped software master:

```yaml
volume:
  defaultMaster: 0.6
  stepSize: 0.1
  curve:
    - { in: 0,   out: 0 }
    - { in: 0.5, out: 0.1 }
    - { in: 1,   out: 1 }
```

The knee at 0.5 → 0.1 mirrors `office.yml`: the lower half of the range shapes the quiet
0–10% band, the upper half the audible 10–100% band.

## Error handling / edge cases

- **No active media.** `handleMediaPlayback` already logs and no-ops on unknown or
  inapplicable commands. Transport buttons in `'media'` mode are harmless when nothing plays.
- **Chrome mode absent.** `showOverlay` calls that omit `chrome` default to `'back'`, so no
  overlay can ship without an exit.
- **Non-touch regression risk.** Guarded by `inputType !== 'touch'` producing no DOM change,
  covered by an explicit test.

## Testing

- Each button emits the expected action and payload.
- `chrome: 'back'` renders the Back button and no transport controls.
- `chrome: 'media'` renders transport controls.
- `inputType` other than `'touch'` renders no lane and no chrome (protects living-room/office).
- Back emits `escape` rather than calling `dismissOverlay` directly, so the interceptor chain
  is preserved.

## Deployment note

The Portal caches the built frontend. After deploy, reload it:

```bash
FKB_HOST=10.0.0.92:2323 FKB_PW=… node cli/fkb.cli.mjs reload
```
