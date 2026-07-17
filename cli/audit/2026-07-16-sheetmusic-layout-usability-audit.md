# Sheet Music mode — layout & usability audit

**Date:** 2026-07-16
**Scope:** `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/` (post journey-redesign, merged 2026-07-14)
**Method:** full code read of the mode's components + `PianoApp.scss` transport-bar styles. No on-device screenshots were taken; visual claims are derived from the CSS and should be confirmed on the kiosk (see "Verify on device" at the end).
**Reported complaints:** hard to learn/practice a piece; setting in/out points for looping several measures is hard; toggling the metronome is confusing; the bottom chrome is scattered, ugly, and confusing.

---

## 1. The user journey this mode must serve

The core user story is: *"I'm learning this piece. I want to hear it, drill the hard 4–8 measures slowly until my hands know them, test them at tempo against a beat, and eventually play the whole thing."*

The mode's information architecture already models this well — the Listen → Learn → Polish → Perform ladder is the right skeleton, and the code is full of deliberate journey plumbing (focus range carries Learn↔Polish, Drill-worst drops you from a Polish summary into a Learn loop, LearnComplete offers "Polish it →"). The complaints are not about the model; they're about the three highest-frequency *actions inside a practice session*: **set/adjust a loop**, **hear a beat**, and **find the control you used 10 seconds ago**. Each of those currently costs more taps, more reading, or more re-orientation than it should. Details below.

---

## 2. What works well (keep these)

- **The mode ladder itself.** Four tabs that read as a progression, with per-mode gating of controls (`ScoreTransportBar.jsx:161-172`). Perform strips the bar to a page indicator only — exactly right for a music stand.
- **Closed loops in the journey.** RunSummary → "Drill worst section" sets a range and drops to Learn (`ScorePlayer.jsx:767-774`); LearnComplete → "Polish it →" carries the range up (`ScorePlayer.jsx:762`). This is real coaching flow, not just chrome.
- **Per-score persistence** of mode/tempo/range/hands/my-part (`scoreSettings` via `ScorePlayer.jsx:366-368`) — a walk-up user finds the piece the way they left it.
- **The on-score range visualization.** Brackets + tint on the music itself (`FocusRangeLayer.jsx`), a pending bracket during selection, and a `SelectBanner` that says exactly what to tap next, with Cancel. The *feedback* half of loop-setting is well designed; it's the *input* half that fails (see 3.1).
- **Count-in** with a big beat overlay, tap-anywhere-to-cancel, and the run button reading Pause during the count (`ScorePlayer.jsx:335-344`) — good live-performance ergonomics.
- **Learn pedagogy details:** the keyboard doesn't spoil the target key until a wrong attempt (`revealKeys`, `ScorePlayer.jsx:454-457`); the last active staff can't be turned off (deadlock guard, `ScorePlayer.jsx:836-839`); measure-based position readout ("m 3 / 24") instead of note-step counting.
- **Visual fundamentals:** paper-white sheet on dark chrome; safe-area inset padding on the bar; `prefers-reduced-motion` respected; tabular numerals on readouts; a disabled "Preparing…" transport state instead of a dead Play button.
- **Accessibility bones are solid:** `role=tablist/tab`, `aria-pressed`, `aria-expanded`, `aria-live` on the banner and count-in.
- **Engineering hygiene** (memoized bar clusters so cursor steps don't reconcile the chrome) is genuinely good and worth preserving through any redesign.

---

## 3. Findings

Severity: **P1** = directly causes the reported complaint · **P2** = compounds it · **P3** = polish.

### 3.1 Looping (in/out points) — the input model fights the user

**L1 (P1). The loop is buried and mislabeled.** The only entry point is `Practice: Whole piece ▾` → popover → `Select measures…` (`PracticeScope.jsx`). A user looking for a "loop" has to decode that "Practice" means "loop scope," open a menu, and pick the third item. Nothing on the score or near the transport says *loop*. Three interactions before the actual task begins.

**L2 (P1). No way to adjust an existing range.** There are no drag handles on the brackets, no ±measure nudge, no tap-bracket-to-move. To move the out-point one measure you must redo the entire flow: open Practice → Select measures… → tap first → tap last. Iterating a loop boundary — the single most common act while drilling — costs 4 taps every time. (`FocusRangeLayer` is explicitly `pointer-events: none`, `PianoApp.scss:2700-2710`.)

**L3 (P1). Selection taps have no miss protection.** `nearestEvent` (`ScorePlayer.jsx:39-48`) returns the nearest note to *any* tap with no distance threshold, and Y is weighted at 0.45 — so a tap in the margin, between systems, or on empty paper silently selects whatever note is mathematically nearest, possibly on a different system. During the two-tap flow this commits a wrong endpoint with no confirmation step and no undo other than starting over.

**L4 (P1). The range tint draws the wrong region when the loop crosses a line break.** `FocusRangeLayer.jsx:53-63` computes ONE rectangle from the union of only the two *endpoint* measures' extents. In wrapped flow, a range from the end of system 1 to the start of system 2 yields `left` from the out-measure, `right` from the in-measure, and a top/bottom spanning both systems — a band that visually covers measures *not* in the loop and misses ones that are. "Several measures" almost always crosses a system, so the marquee misleads in exactly the target use case. (The per-endpoint brackets are correct; the tint is not.)

**L5 (P1). Restart ignores the loop.** `reset()` (`ScorePlayer.jsx:742-753`) sets step 0 and scrolls to the top even when a focus range is active, and in Learn the follow tracker then advances linearly from the top of the piece until it happens to re-enter the range (`useFollowTracker.js:75-77` only wraps at the out-point). Practical effect: tapping ↺ while drilling m9–16 dumps you at m1. Restart should seek the loop in-point.

**L6 (P2). You can't *listen* to your loop.** Focus is a Learn/Polish-only affordance (`ScorePlayer.jsx:159`), and hopping Learn → Listen → Learn destroys the range (`onMode` clears focus when leaving the practice pair, `ScorePlayer.jsx:699-701`). "Play me just these measures so I can hear them" — a natural step in drilling — is impossible, and even peeking at Listen costs you the loop you just set.

**L7 (P2). Polish loops with no breathing room.** The at-tempo wrap (`ScorePlayer.jsx:300-306`) jumps from out-point straight back to in-point with no gap and no re-count-in, and each pass overwrites the previous pass's measure grades — the run summary ends up describing a blend of passes.

**L8 (P3). Sparse fallback when a score has no rehearsal marks.** `sections` come only from rehearsal marks; most MusicXML in the wild has none, so the Practice menu collapses to just "Select measures… / Whole piece" — a menu wrapping two items.

### 3.2 Metronome — right feature, wrong exposure

**M1 (P1). The toggle is a bare `♩` glyph.** No text, no state word; the only "on" cue is a faint blue tint (`.piano-score-btn.is-on`, `PianoApp.scss:2728`). It sits in the right-hand *view* cluster, away from Play/tempo which it conceptually belongs to. Users who complain about "toggling the metronome" most likely can't find it or can't tell whether it's on.

**M2 (P1). It exists only in Polish, and only while the transport is running** (`ScorePlayer.jsx:349-352`). In Learn — where a struggling player most wants a steady reference beat — there is no metronome at all, by design ("Learn is self-paced"). The mental model of every practicing musician is that a metronome is an ambient practice tool; here it's a mode-scoped side effect. Tapping ♩ while paused does nothing audible, which reads as broken.

**M3 (P2). Click state isn't persisted.** `saveScoreSettings` stores mode/tempo/focus/parts (`ScorePlayer.jsx:367`) but not `clickOn`, which resets to ON on every mount (`ScorePlayer.jsx:113`) — inconsistent with everything else the mode remembers.

**M4 (P2). No BPM anywhere in the bar.** Tempo is expressed only as a percentage ("Tempo 100%") of a base the user can't see without opening ⋯ → About. The metronome therefore clicks at an unknown rate; "75%" is meaningless without "♩ = 68".

**M5 (P3). No visual beat.** When the click is on, nothing in the UI pulses with it — on a loud piano the click can be inaudible, and there's no fallback.

### 3.3 Bottom chrome — why it reads as scattered

**C1 (P1). The right cluster wraps into ragged rows.** `.piano-score-view` is `flex-wrap: wrap; justify-content: flex-end` (`PianoApp.scss:2641`). On the tablet, Hands (label + 3 segments) + `Practice: Whole piece ▾` + ♩ + `Tempo 100%` + ⋯ can exceed the available width (especially with a long section label in the Practice button), and the overflow wraps into a second right-aligned line inside a vertically-centered bar. That *is* the "scattered" look.

**C2 (P1). The bar reshuffles on every mode change.** Learn drops the transport buttons (the center becomes a lone floating "m 1 / 24"), Listen adds Key±/Tempo, Polish adds ♩ and Restart, Perform empties everything — and because the layout is `space-between` over whatever happens to render, surviving controls physically move. Spatial memory never forms; the same button is never twice in the same place. This is the single largest source of "confusing."

**C3 (P2). Three visual languages in one row.** Pill mode-tabs (999px radius), 12px-radius `piano-score-btn`s, and 999px part *chips* coexist; toggle-on is blue (`is-on`), run-active is green, "you" role is amber, armed loop is green. Nothing states a rule like "green = go, blue = setting on"; the result reads as unrelated fragments — the "ugly."

**C4 (P2). Six labeling idioms.** `↺ Restart` (icon+word), bare `▶`/`❚❚`, bare `♩`, bare `⋯`, `Practice: Whole piece ▾` (label+value+chevron), `Tempo 100%` (label+value, no chevron despite opening a popover). Which things open menus and which are one-tap toggles is not inferable from their form.

**C5 (P2). Touch targets are ~38px.** `.piano-score-btn` is `padding: 0.5rem 0.8rem` on one line of text (`PianoApp.scss:2719-2729`) with 0.25–0.3rem gaps — under the ~48px kiosk-touch floor, on a tablet used at arm's length while seated at a piano.

**C6 (P3). Two parallel popover systems.** `PracticeScope` owns its own `open` state and backdrop; tempo/⋯ share the single-open state in `ScoreViewControls` (`ScoreTransportBar.jsx:154-157`). Anchoring also differs (Practice: left; tempo/view: right). Mostly invisible, but it means dismissal behavior and stacking aren't uniform.

**C7 (P3). ⋯ mixes settings with reference.** ViewMenu holds Layout/Size/Keyboard controls *and* the About `<dl>` (title/composer/key/tempo) — configuration and metadata in one unnamed menu behind an unnamed button.

**C8 (P3). Color double-duty.** Mode accents (green=Learn, amber=Listen, blue=Polish) collide with grade colors (green/yellow/red) and role colors (amber=you) — green simultaneously means "Learn," "correct," and "loop armed."

---

## 4. Recommended direction (prioritized)

1. **Make the loop a first-class transport control.** Put a labeled `Loop` (or A–B) button in the center cluster next to Play. When a range is active, show it as `Loop m9–16 ✕`. Fixes L1's discoverability with one move.
2. **Direct manipulation of endpoints.** Make the brackets touch targets: drag to move, or tap a bracket to get ±1-measure nudge chips. Keep the two-tap flow as the *creation* gesture, add snap-to-measure and a minimum tap-distance threshold (reject taps > ~1 measure-width away from any note) to fix L2/L3.
3. **Fix the tint geometry** (L4): draw one rect per system spanned, from the union of *all* measures in range, not just the endpoints.
4. **Restart = loop in-point** when a range is active (L5). One-line intent fix in `reset()`.
5. **Promote the metronome to a labeled toggle beside Play** with a live BPM readout (`♩ 68`), available in Learn (free-running at the practice tempo) and Polish; persist `clickOn`; show resulting BPM on each tempo step in the popover (M1–M4).
6. **Freeze the bar's geography.** Three fixed zones (modes | transport+position | settings) with reserved widths; per-mode gating *disables/dims in place* rather than unmounting, so Play is always where Play was. Kill `flex-wrap` on the right cluster by moving overflow into ⋯ instead of wrapping (C1/C2).
7. **One button grammar.** One radius, one height (≥48px), one on-color for "setting enabled," one accent for "transport running," chevrons on everything that opens a menu (C3–C5).
8. **Let Listen respect the loop** (L6): keep focus across all non-Perform modes; in Listen, play just the range. This completes the hear → drill → test loop the ladder promises.

Items 3 and 4 are small correctness fixes worth doing regardless of any redesign; items 1, 5, and 6 are the ones that answer the users' three complaints directly.

## 5. Verify on device (claims that need a kiosk screenshot)

- Actual wrap behavior of the right cluster at the tablet's real viewport width, in each mode, with a long section label in the Practice button (C1).
- Whether the lone position readout in Learn visually "floats" as predicted (C2).
- Metronome audibility at piano volume, motivating M5.
- Tap accuracy of the two-tap selection on real glass (L3) — margin taps and cross-system taps.

---

## Remediation (2026-07-16)

Implemented on branch `feature/sheetmusic-practice-ux` (16 commits after `ef049bbae`). Reference doc updated: `docs/reference/piano/sheet-music-player.md`.

| Finding | Status | How |
|---------|--------|-----|
| L1 | ✅ Fixed | `LoopControl.jsx` — labeled first-class `Loop` trigger in the center transport zone |
| L2 | ✅ Fixed | One-tap ✕ clear beside the trigger + ±1-measure Start/End nudge rows (menu stays open) |
| L3 | ✅ Fixed | `nearestEvent.js` `SELECT_MAX_DIST` — margin/between-system taps rejected, not committed |
| L4 | ✅ Fixed | `FocusRangeLayer` draws one tint band per system the range spans |
| L5 | ✅ Fixed | Restart seeks the loop in-point (`homeStep`), not step 0 |
| L6 | ✅ Fixed | Loop follows Listen↔Learn↔Polish; Listen plays only the loop; tail range wraps at `onDone` (one-beat dwell for the zero-span edge); cleared entering Perform / new score |
| M1 | ✅ Fixed | Labeled metronome toggle beside Play — quarter-note SVG + live BPM readout |
| M2 | ✅ Fixed | Learn gets a free-running click at the practice tempo (session-local); Polish keeps the armed run click |
| M3 | ✅ Fixed | `clickOn` persisted per score via `scoreSettings` |
| M4 | ✅ Fixed | BPM on the toggle; each tempo step shows its resulting BPM (hook keeps exact bpm, readout rounds) |
| C1 | ✅ Fixed | Stable three-zone grid bar (tabs · transport+position · settings) with nowrap + overflow guards (1400px media query, loop-label ellipsis) |
| C2 | ✅ Fixed | In-place disable/dim gating — controls never move between modes; Perform is the sole unmount |
| C3 | ✅ Fixed | One button grammar: unified radii, blue = setting-on / green = transport-running |
| C4 | ✅ Fixed | Shared inline-SVG icon set (`icons.jsx`), no glyph/emoji button content; chevrons on all popover triggers |
| C5 | ✅ Fixed | ≥48px touch targets across the bar |

### Out of scope / deferred

- **L7** — no gap / re-count-in between Polish loop repetitions yet.
- **L8** — no auto-section fallback for scores without rehearsal marks.
- **M5** — no visual beat pulse synced to the click.
- **C6** — the two parallel popover systems were not unified under one manager.
- **C7** — About metadata still lives inside the View menu.
- **C8** — full semantic palette rework (mode vs grade vs role color collisions) beyond the blue/green button grammar.
- Review deferrals: generation-counter anchor detection in the transport (vs the backward-seek heuristic); per-in-point tempo for dwell/count-in timing; dedup of the wrap/clamp helpers; a sampled log on loop wrap; cleanup of the stray `.claire/` nested checkout.

### Verification gate

Task 13 **on-kiosk verification is still pending** — the §5 "Verify on device" claims (wrap behavior, tap accuracy on glass, click audibility) must be confirmed on the tablet before merge is called done.
