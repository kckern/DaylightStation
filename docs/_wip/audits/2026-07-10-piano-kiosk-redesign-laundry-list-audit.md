# Piano Kiosk — Redesign Laundry List (Triaged)

**Date:** 2026-07-10
**Status:** **Implemented.** Waves 0/0b/1/2 built on `feat/piano-backlog-completion`.
Everything code-completable is DONE, unit-tested (Piano suite green), and `vite build` clean.
Two items (**#9 staff, #10 course-video/chord-panel**) are **VISUAL-BLOCKED** — the dev server
is down, and they're visual-diagnosis fixes I won't guess at blind (risk of regressing the very
surfaces in question). A batch of **visual confirmations is pending** an on-device pass (Games
centering, home 5×2, connect-gate layout, skeletons, bigger home button, instrument icons, no
stray tap-focus rings, Settings inputs selectable) — automated checks pass, but these were never
eyeballed because the server was down this session.
**Source:** Verbal walkthrough of everything that feels wrong across the piano kiosk,
then a code + screenshot audit of what still holds.

This is a **kiosk-wide redesign** backlog. The original capture was deliberately broad —
"the tip of the iceberg." A triage pass (code reads + rendered screenshots of the connect
gate, main menu, games, courses, settings, and studio) found that **the 48 commits since the
list was written already resolved or shrank about half the items.** What remains is a small
foundation residue plus a handful of real per-surface redesigns.

Verdict legend: **DONE** (close it) · **OUTDATED→SMALL** (original framing stale; only a
small real residue left) · **REAL** (still needs doing) · **UNVERIFIED** (needs a populated
screenshot to confirm).

---

## Triage summary

| # | Surface | Verdict | Real residue | Effort |
|---|---------|---------|--------------|--------|
| F2 | Tile primitive | **DONE** | — | — |
| 2 | Main menu tiles | **DONE** | — | — |
| 8 | Poster grids | **OUTDATED→SMALL** | forced 6→3+3 rebalance + ~12 cap (centering already done) | S / optional |
| 5 | Settings menu | **OUTDATED→SMALL** | subsystem restart (5b); instrument picker extraction (→#12) | S |
| 11 | Studio recording | **✅ DONE** (`c325b0f30`) | `StudioReviewPrompt` keep/discard replaces auto-save-on-stop | — |
| F1 | Touch-reset base styles | **✅ DONE** (Wave 0) | consolidated base-reset; `user-select` killed globally + text-field escape hatch | — |
| F3 | Balanced/count-aware grid | **✅ DONE** (Wave 0) | `balancedColumns` helper + `--tile-cols`; menu/games centered | — |
| F4 | Skeleton loaders | **✅ DONE** (Wave 0+0b) | primitive (Grid/List/Stage) + course-wall proof + ~15 surfaces routed | — |
| F5 | Spacing scale | **✅ DONE** (Wave 0) | `--sp-*` scale added + adopted in tile grid/mode padding | — |
| 1 | Connect / first-load gate | **✅ DONE** (`0d2538a2e`) | dead Connect btn removed + auto-retry; Reboot btn; BT/Continue real buttons w/ icons | — |
| 3 | Games submenu | **✅ DONE** (Wave 0) | fixed by the count-aware grid (F3); 4 tiles now centered | — |
| 6 | Who's-playing turn-off | **✅ DONE** (`d22cf7596`) | shared `usePianoScreenOff`; chip switcher now always shows it | — |
| 12 | Instrument picker | **◑ ICONS DONE** (`1f15c7732`) | `instrumentEmoji` glyphs on voice cards + keyboard voices/families; standalone route deferred | M (route) |
| 4 | Loaders everywhere | **✅ DONE** (Wave 0b) | ~15 loading surfaces routed to shaped skeletons; error/empty kept as text | — |
| 5b | Settings subsystem restart | **✅ DONE** (`183b47b66`) | `resync()` + "Restart audio & MIDI" (reconnect MIDI + re-assert voice/fx) | — |
| 7 | Header home button | **✅ DONE** (`183b47b66`) | font 1.5→2.5rem, padding trimmed — near-fills header (visual confirm pending) | — |
| 9 | Staff cutoff / centering | **⛔ VISUAL-BLOCKED** | dev server down — can't verify. Culprits: `.current-chord-staff-wrapper`/`.action-staff` `overflow:hidden` (cutoff); ChordStaffRenderer note x-position (flush-left). Needs a populated-staff screenshot before a safe fix. | M |
| 10 | Course video spacing / chord panel | **⛔ VISUAL-BLOCKED** | dev server down. CHORD panel positioning in `StudioTopPane`/`TheoryPanel`; video spacing in `PianoVideoPlayer`/`PianoVideoChrome`. Needs course-video + Studio screenshots. | S–M |

---

## Sequencing (decided 2026-07-10: foundation-first)

### Wave 0 — Foundation residue *(one spec → plan → build cycle)*
High-leverage, small, unblocks the rest.
- **F5 — Spacing scale.** Add `--sp-*` tokens to `:root` in `PianoApp.scss` alongside the
  existing color/type/radius scales; start adopting where "smashed together / cut off" bites.
- **F1 — Touch-reset consolidation.** Fold the scattered `touch-action` /
  `-webkit-tap-highlight-color` / `focus-visible` rules into one documented kiosk base-reset;
  kill `user-select` globally (today it's only on specific draggables).
- **F3 — Count-aware tile grid.** The menu tile grid is hardcoded `repeat(5, …)` (built for
  the 10-item home menu), so any other count clumps left with empty trailing columns. Make the
  grid adapt column count to item count (and center). **This closes #3 (Games) for free.**
- **F4 — Skeleton loaders.** Turn `PianoEmpty` (`PianoKiosk/PianoEmpty.jsx`) from bare text
  into a content-shaped skeleton, and route the ~8 inline `piano-mode__placeholder` "Loading…"
  bypasses (Music, Videos, Games, Lessons, StudioPlayback, Singalong, PianoVideoPlayer,
  PianoPicker) through it. **This closes #4.**

### Wave 1 — Surgical fixes *(each ~½ day, standalone)*
- **✅ #6 — Who's-playing turn-off (bug).** DONE (`d22cf7596`). Extracted a shared
  `usePianoScreenOff` hook (backlight off + MIDI-wake cooldown + suppress-wake + drop-to-guest)
  so both entry points behave identically, and wired the chrome-chip switcher to it so the
  control is always shown.
- **#5b — Subsystem restart.** Today's "Reload app" reloads the whole page; add a control that
  restarts just the MIDI + sound + feedback subsystem.
- **#7 — Header home button** (only if it still reads as too small in situ).

### Wave 2 — Feature redesigns *(each its own spec)*
- **#1 — Connect gate.** Remove the dead green "Connect piano" button, promote "Continue
  without piano" to a real button, add a Reboot device button, give Bluetooth an icon, rethink
  as ~3 clear tiles. Verify touch-safety (stray outlines/selection) during.
- **#12 — Instrument picker.** Extract from Settings into its own UX/lifecycle; add icons
  (emoji placeholders OK). Removes the instrument grid from #5.
- **#11 — Studio recording lifecycle.** The recorder, count-up, auto-save, and Recordings tab
  (playback/favorite/delete) already exist — add the missing **arm** step and a **review →
  save/discard** decision instead of the current auto-save-on-stop.
- **#10 / #9 — Course video + staff.** **Parked** (blocked on a populated screenshot — dev
  server was down at triage time). Re-audit once a course video / rendered staff is visible,
  then fix the chord-panel positioning, video spacing, staff cutoff (`overflow:hidden`), and
  note centering.

### Closed / downgraded
- **#2 Main menu** and **F2 Tile primitive** — DONE. `PianoTile` (`PianoApp.scss:217`,
  `aspect-ratio: 3/2`) gives equal heights even when labels wrap (verified: "Playalong"
  wraps two lines, tile stays level), with consistent gutters and outer margin.
- **#8 Poster grids** — downgraded. `.piano-video-grid--posters`
  (`PianoApp.scss:1038`) already centers both axes (`justify-content: center`,
  `align-content: safe center`, tabpanel `justify-content: safe center`). Only the explicit
  "force 6→3+3, cap ~12" rebalance is optional residue.
- **#5 / #11** — downgraded from "redesign the whole thing" to the small residue noted above.

---

## Cross-cutting themes (foundation — current state)

Where each originally-listed foundation theme actually stands today:

1. **Touch-reset / kiosk base styles** — PARTIAL. Rules exist but scattered (F1, Wave 0).
2. **Tile primitive** — DONE (`PianoTile`, reused by home + games).
3. **Balanced grid primitive** — SPLIT: poster grids centered (#8 done); menu tile grid not
   count-aware (F3, Wave 0 — fixes #3).
4. **Skeleton loader primitive** — PARTIAL: shared `PianoEmpty` gives consistency but is
   text-based; needs shaping + de-bypassing (F4, Wave 0).
5. **Spacing scale** — MISSING (F5, Wave 0).

---

*Next step: brainstorm Wave 0 into a single design spec (spacing tokens + touch-reset +
count-aware grid + skeleton), then `writing-plans` → implement.*
