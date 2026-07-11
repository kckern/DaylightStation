# Piano Kiosk — Redesign Laundry List (Triaged)

**Date:** 2026-07-10
**Status:** **Triaged** against the deployed tree (post-pull, HEAD `5a2a9ad6e`). Sequenced
into waves, foundation-first. Ready to start Wave 0 as a spec → plan cycle.
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
| 11 | Studio recording | **OUTDATED→SMALL** | explicit arm step + review→save/discard (recorder + list already exist) | M |
| F1 | Touch-reset base styles | **REAL (partial)** | consolidate scattered rules; kill `user-select` globally | S |
| F3 | Balanced/count-aware grid | **REAL** | tile grid is fixed 5-col; make it count-aware (also fixes #3) | M |
| F4 | Skeleton loaders | **REAL (partial)** | `PianoEmpty` is bare text; shape it + route ~8 inline bypasses | M |
| F5 | Spacing scale | **REAL** | no `--sp-*` tokens; spacing is magic rems | S |
| 1 | Connect / first-load gate | **REAL** | remove dead Connect btn, promote Continue, add Reboot, BT icon, tile layout | M |
| 3 | Games submenu | **REAL (small)** | count-aware grid (= F3); 4 games clump left in a 5-col grid | S |
| 6 | Who's-playing turn-off | **✅ DONE** (`d22cf7596`) | shared `usePianoScreenOff`; chip switcher now always shows it | — |
| 12 | Instrument picker | **REAL** | own UX/lifecycle + icons; today a text grid in Settings | M |
| 4 | Loaders everywhere | **REAL (= F4)** | see F4 | M |
| 7 | Header home button | **UNVERIFIED (minor)** | looks acceptable in shots; only if it bugs us | S |
| 9 | Staff cutoff / centering | **UNVERIFIED** | `overflow:hidden` present; needs a populated staff to confirm | M |
| 10 | Course video spacing / chord panel | **UNVERIFIED (partial)** | CHORD panel looks tacked-on; video spacing needs a course shot | S–M |

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
