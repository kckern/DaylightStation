# ArtMode `MediaRewind` view-mode cycle double-fires (Shield remote)

**Date:** 2026-06-19
**Status:** Fixed (pending deploy)
**Component:** `frontend/src/screen-framework/widgets/ArtMode.jsx`
**Screen:** `data/household/screens/living-room.yml` (Shield TV / FKB WebView)

## Symptom

Pressing the Shield remote's **Rewind** button once cycles ArtMode's view mode
**twice**, so the viewer skips a mode per press.

## Confirmation (prod logs)

Frontend `artmode.viewmode` events (logged at the raw-key handler) arrive in
pairs — every `MediaRewind` press is followed by a **second identical event
147–208 ms later** (mean ~178 ms):

```
03:12:26.437  viewmode  key=MediaRewind
03:12:26.611  viewmode  key=MediaRewind   +174ms   ← echo
03:12:27.561  viewmode  key=MediaRewind
03:12:27.752  viewmode  key=MediaRewind   +191ms   ← echo
```

Three facts pin the cause:

1. **`via:'rate'` count = 0.** The ActionBus `media:rate` path never fires; both
   events come from the raw `onKey` handler (`ArtMode.jsx`, the only path logging
   a `key` field). So this is **not** the raw-vs-semantic-action collision the
   code comments guard against — the existing `stopImmediatePropagation()` is
   working, and RemoteAdapter's bubble listener is correctly suppressed.
2. **Specific to `MediaRewind`.** In the same session, `ArrowLeft`/`ArrowRight`
   shuffle events are always isolated (seconds apart) — never a ~180 ms echo.
3. **Tight bimodal timing.** Real presses are >450 ms apart; echoes cluster at
   147–208 ms. Rules out duplicate React listeners (would fire sub-ms apart,
   identical timestamps, and would affect arrows too) and rules out double-taps.

## Root cause

The Shield TV remote's Rewind button, through the FKB WebView on Android 11,
emits **two `MediaRewind` keydown events per physical press** (~180 ms apart).
ArtMode faithfully cycles twice. A hardware/WebView key-delivery quirk, not a
wiring bug.

## Fix

Dedupe a repeat of the same cycle key within `cycleDedupeMs` (default 250 ms) in
the raw key handler. Scoped to **non-`Tab`** cycle keys: `Tab` is the wired-
keyboard fallback (no echo) and is driven by rapid synthetic presses in tests;
the echo is a property of the remote's transport keys. The phantom is still
`preventDefault`/`stopPropagation`-swallowed (it just doesn't act). Deliberate
presses on this remote are >450 ms apart, well clear of the window.

Tests: `ArtMode.test.jsx` — "dedupes a phantom duplicate MediaRewind",
"cycles again … after the dedupe window", "does not dedupe Tab".

## Note

5 unrelated tests in `ArtMode.test.jsx` were already failing in the working tree
before this fix, due to in-progress `artModes.js` matless changes that make the
`single()` 1.6-ratio fixture start in `framed-cover` instead of `gallery`. Those
are a separate WIP, untouched here.
