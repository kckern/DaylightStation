# WeeklyReview Usability Audit — 2026-06-18

Scope: `frontend/src/modules/WeeklyReview/` (UI, input matrix, empty-state rendering,
exit affordances). Benchmarked against best-in-class remote/kiosk media-review UIs
(Apple TV Photos "Memories", Google Photos, Plex/Jellyfin 10-foot UIs).

Input model: D-pad/keypad + OK + Back (Arrow keys, Enter, Escape). No mouse on the
target surface; some launch contexts are touch.

---

## P0 — Reported: "Users can't exit the app"

### Root cause (confirmed in code)

While recording (`isRecording === true`), the **only** way out is:
`exitGate` modal → move focus to **"Save & end"** (focusIndex 1) → **Enter**.

But the two most intuitive exit gestures are dead ends:

- **Escape / Back on the exit gate just CLOSES the gate** and returns to the grid
  (`keymap.js:30`, `WeeklyReview.jsx:444`). A user who repeatedly presses Back —
  the universal "get me out" gesture — toggles the gate open/closed **forever** and
  never exits.
- **Enter on the gate defaults to "Keep going"** (`focusIndex` initializes to 0 in
  `modalReducer.js:12`). So pressing OK on a "End recording?" prompt keeps you in.
  The destructive/exit action is the *non-default* and requires a left/right press
  first — with no on-screen hint that arrows change focus.

Net: the exit requires a precise, undiscoverable 3-step sequence
(Back → Right → Enter), and the natural "mash Back" behavior provably cannot exit.

### Secondary trap: the "finalizing" hang

`onSaveAndExit` and the disconnect handler call
`DaylightAPI('.../recording/finalize')`, and `api.mjs` issues a bare `fetch` with
**no timeout / AbortController** (`api.mjs:36,117`). During that await the
`disconnect` modal ("Saving your recording…") is shown, and the keymap
**swallows every key** for that modal (`keymap.js:22`). If the request hangs (mic
just disconnected → flaky network is exactly when this fires), the user is pinned on
a spinner with no escape at all. `onSaveAndExit` exits in its `finally`, but only
once the await resolves/rejects — which may be never.

### Fixes

1. **Make Back on the exit gate exit, not toggle.** Convention: first Back opens the
   gate; second Back confirms the default safe action. Recommend: Back on the gate →
   `saveAndExit` (it already always exits in `finally`). At minimum, default the gate
   focus to "Save & end" so OK exits.
2. **Add a persistent control legend** (see P2-A) so the exit gesture is discoverable
   at all.
3. **Bound the finalize call** with an AbortController timeout (e.g. 8s) and let the
   disconnect/finalizing modal accept Back to force-exit after a grace period —
   "Save & end" must never be able to trap the user. The recording is already durable
   in IndexedDB + server chunks, so a forced exit loses nothing.
4. Consider an explicit **"Discard & exit"** affordance on the gate for the "I opened
   this by accident" case (today the only exit also finalizes/uploads).

---

## P0 — Reported: "Empty days fall back to blank instead of showing weather/calendar"

### Root cause (confirmed in code)

There are **two** empty-state surfaces and both under-use available data:

**A. Reel view (the worst offender).** Pressing Enter on a day with no media opens
the reel, and `DayReel.jsx:48` renders only:

> "No photos or videos this day"

The day's weather/calendar/fitness *do* exist and *are* rendered — but only inside
`DayContextPanel`, which is hidden until the user presses **Down** (`keymap.js:77`),
with no hint that it exists. So entering an empty day = a blank dead-end screen.
This is the exact complaint.

**B. Grid cell.** `DayColumn` is better — it renders calendar chips, fitness chips,
and a weather fallback. But:
- `hasContent = photoCount > 0 || fitness?.length` **excludes calendar**
  (`DayColumn.jsx:25`). A calendar-only day gets the `--empty` class and is dimmed to
  **0.5 opacity** (`WeeklyReview.scss:183`) despite having real content — its event
  chips are rendered but greyed out and easy to miss.
- The main photo area only falls back to weather → else a dimmed day-name at **0.3
  opacity** (`scss:318`). Calendar/fitness never fill the *main* area; they're small
  chips up top. A day with events but no photos/weather still reads as blank.

### Fixes

1. **Empty reel should surface the data, not a dead end.** When `items.length === 0`,
   auto-open the context panel (or render weather/timeline/fitness inline in the
   `--empty` reel) so an empty day still shows weather, events, and workouts. Best-in-
   class (Apple Photos "On This Day") never shows a blank — it always falls back to a
   map/weather/text card.
2. **Count calendar as content** in `hasContent`, and stop dimming days that have
   events/weather. Reserve `--empty` (and the 0.3–0.5 opacity) for genuinely
   data-free days only.
3. **Promote available data into the main cell area** for photo-less days: a compact
   "what happened" card (weather + top events + workouts) instead of a faded day name.

---

## P1 — Navigation correctness

- **Grid focus can leave the rendered viewport.** The grid renders only
  `data.days.slice(-8)` (`WeeklyReview.jsx:513`), but `GRID_MOVE` clamps against the
  **full** `data.days.length` (`keymap.js`/`viewReducer.js:25`). If there are ever >8
  days, Up/Left moves `dayIndex` to a day that isn't on screen → the focus ring
  vanishes and Enter opens an invisible day. Either render all days or clamp
  navigation to the visible window.
- **"Up from the top row opens the exit gate"** (`keymap.js:61`) is a hidden, easily
  triggered exit. A user navigating up between grid rows will hit it by accident.
  Make exit explicit (legend + dedicated affordance), not a side effect of Up.
- **Double-tap-to-cross-day** at reel edges (`keymap.js:94`, 500ms window) is
  undiscoverable and time-sensitive. Fine as an accelerator, but there should be a
  visible "← Wed | Fri →" edge hint so users know crossing is possible.

---

## P1 — Touch/click inconsistency

Modal buttons are inconsistently wired:

- `resumeDraft` and `PreFlightOverlay` buttons have real `onClick` handlers.
- `exitGate`, `finalizeError`, and `disconnect` buttons are **visual-only** — comments
  say "Remote-driven; buttons are visual focus indicators" (`WeeklyReview.jsx:540,554`).

On any touch launch context, tapping "Save & end" / "Dismiss" / "Exit (save later)"
does nothing. Either wire `onClick` to dispatch the same intents the keymap produces,
or hide the buttons' affordance entirely on touch. Right now it's a trap (looks
tappable, isn't).

---

## P2 — Discoverability & feedback

- **A. No control legend anywhere.** The only on-screen hint in the whole module is
  "▶ Enter to play" on video posters (`DayReel.jsx:64`). A 10-foot remote UI needs a
  persistent, context-sensitive footer hint (e.g. "OK Open · ↓ Details · Back Exit").
  This single change mitigates both P0s. Every benchmarked app (Plex, Jellyfin, Apple
  TV) shows contextual button hints.
- **B. Silence warning is mute.** `silenceWarning` only toggles a CSS pulse
  (`RecordingBar.jsx:52`) — no text. A user whose mic isn't picking up won't know why
  the bar is pulsing. Add "We can't hear you — speak up or check the mic."
- **C. `resumeDraft` has only one button** ("Finalize Previous"). Escape defers
  (`keymap.js:47`) but there's no visible "Not now" affordance, so the dialog looks
  like it has no way out.

## P2 — Accessibility

- `DayColumn` `aria-label` reports only photo count (`DayColumn.jsx:40`); it omits
  events, workouts, and weather — the very data we want to surface. Include them.
- Modals set `aria-modal` but **don't move/trap focus**; with keys routed through a
  global `document` listener and `tabIndex` on grid cells, SR/focus state and visual
  focus diverge. Move focus into the dialog on open, restore on close.
- Empty-state opacity 0.3 / 0.5 on `#888`/`#aaa` text is below WCAG contrast — and
  it's applied precisely to the data we're trying to make readable.

---

## What's already good (keep)

- Clean separation: pure `keymap.js` resolver + reducers (`viewReducer`,
  `modalReducer`) with priority-based overlay arbitration — easy to test and extend.
- Strong recording durability: IndexedDB chunking + server chunks + beacon flush +
  draft recovery. Exit-on-error always reaches `onExitWidget` in `finally`.
- VU meter driven by rAF + DOM mutation instead of React state (`RecordingBar.jsx:30`)
  — correct perf call.
- Good structured logging throughout, per the project logging rule.

---

## Suggested priority order

1. Exit gate: Back exits (or default focus = Save & end) + finalize timeout + legend. (P0)
2. Empty reel surfaces weather/calendar/fitness inline; count calendar as content. (P0)
3. Clamp grid navigation to the visible window; remove accidental Up-exits. (P1)
4. Persistent control legend; wire or hide touch buttons. (P1/P2)
5. Accessibility pass (aria-labels, focus trap, contrast). (P2)

---

## Resolution (2026-06-18)

All findings above were fixed on branch `feature/weekly-review-usability` per the plan
`docs/superpowers/plans/2026-06-18-weekly-review-usability-fixes.md` (9 TDD tasks).
Final state: **75 tests pass** (`npx vitest run frontend/src/modules/WeeklyReview`),
production `vite build` clean.

| Finding | Fix | Commit |
|---------|-----|--------|
| P0 — can't exit (Back toggles gate) | Back on the exit gate now dispatches `saveAndExit` (always exits in `finally`), not a CLOSE-toggle | `c8e276f33` |
| P0 — finalize hang traps user | `withTimeout()` bounds both finalize calls (8s); local-session delete gated on non-timeout | `6b105ab05` |
| P0 — empty reel is a blank dead-end | Empty reel renders `DayDataPoints` (weather/calendar/fitness) inline; shared `dayData.js` + `DayDataPoints.jsx` extracted (DRY) with a quiet-day fallback | `67ad630d1` |
| P0/P2 — calendar-only days dimmed; aria omits events | `hasContent` counts calendar; content-aware `aria-label`; empty-state contrast raised (0.3/0.5→0.6/0.7, `#888`→`#bbb`) | `564d55699` |
| P1 — accidental Up-from-top-row exit; grid focus can leave view | Removed the Up-opens-exitGate special case; grid renders every day (dropped `slice(-8)`/`offset`) so nav clamp matches the rendered set | `41075e210` |
| P1 — touch buttons inert | Wired `onClick` on exitGate / finalizeError buttons mirroring keyboard intents; added a visible "Not now" on resumeDraft | `d61da0f8d` |
| P2-A — no control legend | New presentational `ControlLegend` (context-sensitive, hidden under modals) surfaces Open / Details / Exit | `29c9bd1d3` |
| P2-B — silence warning is mute | `RecordingBar` shows visible "We can't hear you — speak up or check the mic." text when `silenceWarning` is active (VU meter stays rAF/DOM-driven) | `3a9cf12c8` |
| P2 — modals don't move focus | New `ConfirmOverlay` shell moves AT/keyboard focus into the dialog on open (`tabIndex=-1`, key handling stays on the document listener); wraps all four modals | `514e82bee` |

**Not done (deliberately deferred):** the optional "Discard & exit" affordance on the
exit gate, the double-tap-to-cross-day edge hint, and a true focus-restore-on-close —
all noted as nice-to-haves, none required to close the reported P0s.
