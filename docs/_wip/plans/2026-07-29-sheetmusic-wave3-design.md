# Sheet Music Wave 3 — Design (rev 2)

**Date:** 2026-07-29 · **Status:** Design for review (no implementation started)
**Basis:** user requirements gathered 2026-07-29 (23 items, confirmed); revised against the stern review (3 blockers, 10 majors, 8 minors — all resolved below). Builds on waves 1–2, both deployed.
**Scope ruling:** tempo tiers ship NOW; ticker consolidates into existing grading surfaces (no new overlay); range handles ship complete (tap AND drag). Honest task count ~17–19; accepted.

---

## 0 · Mode identities

| Mode | Identity | Transport chrome |
|---|---|---|
| **Listen** | Pure playback | Restart/Play · metronome (off by default, session-local) · hand toggles · Key/Tempo/View/Volume. No looping. |
| **Learn** | Untimed practice at the frontier | Listen's chrome **plus** the loop group; range handles on the score |
| **Polish** | Real-time scored runs, whole piece only | Play + count-in · metronome (on by default) · hand toggles · settings. No looping. |
| **Perform** | Music stand | Zero chrome; left pedal turns pages |

**Loop/focus is Learn-only state.** Entering Listen or Polish **clears** `focus` and the loop toggle (resolves the shipped "range carries across modes" semantics — deliberately reversed; `LearnComplete`'s Polish handoff no longer carries the range). The evaluator/transport loop machinery (`boundary`, `loopWraps`, the zero-span dwell) becomes Learn-only; Polish always grades whole-piece runs, which is what makes tier bests comparable (§H).

---

## A · One hands model

`HandsControl` loses the `mypart` variant; one semantic — **active hands**:

- **Listen:** which hands the kiosk performs (staff → `play`/`mute` role directly from the toggles). The play-along machinery (`myStaves`, roles `you`, `disruptListenPlayback`, the Listen MIDI-participation subscription) is deleted.
- **Learn/Polish:** which hands the user practices (existing `activeParts` semantics).
- ≥1-hand floor in all modes. Defaults: both on in Listen/Polish; Learn from preference (§E).

**Scope rule (non-grand-staff scores):** the hands model applies ONLY to grand-staff (2-staff) scores, exactly where `HandsControl` renders today. Single-staff and 3+-staff scores keep part chips; for them the hand preference is ignored, practice-history buckets collapse to `both`, and dimming applies per deselected chip staff via the same mask machinery.

**Migration:** persisted `myStaves` is discarded on read (same strip-on-read pattern scoreSettings used to retire `focus`) and never written again — naively reusing it would exactly invert intent under the new semantics. The persisted `'none'` value has no home; Listen seeds both-on.

**Listen keyboard:** the `myStaves`-driven auto-show dies with play-along; the on-screen keyboard is hidden in Listen by default (manual View-sheet toggle still works).

**Staff dimming (Listen/Learn/Polish):** deselected staves render under a translucent mask (~0.35 effective opacity) using **new per-staff geometry**: `extractStaffGeometry` is extended to per-staff bounds (OSMD `StaffLines[i].PositionAndShape`; fallback: bounds derived from that staff's note boxes, and for rest-only stretches the system box split between staves). This is its own task, not a freebie. **Z-order (bottom→top): dim mask · range tint · cursor band · engraved note ink · wet ink.** A wrong note on a dimmed staff still renders at full strength above the mask.

## B · Learn: states and the ready-to-play landing

**The Learn state matrix** (each cell is normative):

| State | Play button | Cursor driver | Kiosk audio | Gate / red ink | Count-in |
|---|---|---|---|---|---|
| **No range** | Enabled | Transport (machine), Listen's note timeline | Performs **active hands only** | No gate; wet-ink renders user notes in neutral ink, never red | None |
| **Range + loop ON** | Disabled, label "Learn advances as you play" | User (follow tracker) | Silent | Gate active; wrong = shake + red ink | None |
| **Range + loop OFF** | Enabled | Transport, whole piece | Performs active hands | No gate; neutral wet-ink | None |

So: Play is enabled exactly when the loop is off; the follow tracker and the transport are never active simultaneously; the range brackets stay visible in all three states.

**Auto-range on Learn entry** — `learnRange.js`, pure:
`pickLearnRange({ sections, measures, stepsByMeasure, activeHands, history }) → { inMeasure, outMeasure, reason }` (measure **indices**). Cue order: (1) history frontier — first ~4-measure window where any measure's pass count for the selected hands is < 3 (min-based aggregation); (2) first rehearsal section; (3) first 4-measure window clearing the active-hand density floor (skip rest-heavy intros); (4) first 4 non-empty measures, else whole piece. `reason` → telemetry.

## C · Practice history

Endpoints follow the existing preferences pattern (`GET`/`PUT`-with-merge):
`GET/PUT api/v1/piano/users/{user}/practice/{scoreKey}` → YAML under `users/{id}/apps/piano/practice/`.

```yaml
fingerprint: { measureCount: 24, xmlBytes: 48213 }   # invalidation: mismatch → discard record
measures:            # keys are measure INDICES (0-based into measures[]) — never numbers
  "4": { rh: {attempts: 3, passes: 2}, lh: {attempts: 1, passes: 0}, both: {attempts: 0, passes: 0} }
polish:
  tiers: { slow: 78, medium: 84, full: 61, overclocked: null }   # best run scores (§H)
updatedAt: …
```

- **Attempt** = a completed loop cycle (in→out, wrap) with the gate active. A cycle is **voided** by: any seek/tap, hand-toggle change, range change, transpose change, or mode exit mid-cycle.
- **Pass** = an attempt with **zero wrong-note events** (the follow tracker's `onWrong` for the selected hands) — this is precisely what the gate does NOT enforce, so passes < attempts is meaningful.
- Each valid cycle increments attempts (and passes if clean) for **every measure in the range**, under the hands bucket (`rh`/`lh`/`both`; non-grand-staff → `both`).
- **Learned threshold: 3 passes** per measure per hands-bucket (the frontier heuristic reads this).
- **No user selected (guest/walk-up): no reads, no writes** — the heuristic runs history-less.

## D · Correctness gate + wet-ink

- **`LearnInkLayer`** — single-`<svg>` overlay (PendingLayer's jank discipline; never a re-engrave). Renders user input at the cursor column: correct notes flash briefly; wrong notes render as a **red notehead at the played pitch**, then fade. In machine-driven states, ink is neutral (never red).
- **Placement spec:** wrong notes render on the selected hand's staff (single hand) or the staff of the nearest expected note (both hands); pitch spelled from the **sounding** key signature (transpose-aware; new MIDI→spelling helper over the sounding-fifths math), sharps-default for non-diatonic pitches. Glyph geometry (ledger lines, accidentals, stems) borrowed from the Composer wet-ink components; the MIDI→position path is NEW work, spelled here so it isn't improvised.
- **Punishment budget (kid-UX):** wrong note = shake + red ink, and that's all. The reveal-keys assist no longer fires per wrong note — it arms only after **3 consecutive wrongs** on the same step (stuck support, not punishment).
- Judged only against selected hands; RH-only ignores LH input entirely.

## E · Hand preference

`piano.yml → sheetmusic.learn.defaultHands: both|rh|lh` (resolver passthrough + test — the projection gotcha), per-user `preferences.yml → learnHands`, resolution user → household → both. **Content clamp:** if the preferred hand's staff has no notes in the piece (or in every candidate window), fall back to the content-bearing hand(s) — a preference must never select an empty staff and deadlock the gate (the density data in §B already exists to check this).

## F · Loop group + range handles (Learn only)

- **`transport/LoopGroup.jsx`** — extracted from the video chrome (set-in `loop-a`, set-out `loop-b`, toggle `repeat`, clear `clear-loop`); the video chrome re-consumes it. In Learn the in/out buttons show their measure numbers (`m5`/`m8`).
- **Set-in/set-out are tap-to-arm** (resolves the cursor-clamp deadlock — the cursor can never leave an active range, so "mark at cursor" cannot move a loop): tapping set-in arms endpoint-picking; the next tap **on the score** sets that endpoint (SelectBanner-style hint, taps escape the clamp while armed). Symmetric for set-out. In/out auto-swap if crossed.
- **`RangeHandleLayer`** — ≥48px in/out handles at the range boundaries, BOTH interactions shipping now: tap-to-arm-then-tap-a-measure, and **drag** with measure snapping (`touch-action: none` + pointer capture on the handle only, so drags never become scrolls; dragging near the container edge auto-scrolls vertically; across wrapped systems the handle tracks the measure nearest the pointer). Handles snap to rehearsal-section boundaries when within a measure of one.
- **Sections rehomed:** the LoopSheet section menu dies; section starts render as **snap markers** while an endpoint is armed or dragged (and the auto-range heuristic still uses sections). "Loop the Chorus" = arm set-in, tap near the section start (it snaps), arm set-out, tap its end.
- Wave-2's `LoopControl` + `LoopSheet` retire. Listen/Polish render no loop chrome.

## G · Listen simplification + metronome

Chrome per §0. Metronome in Listen is **session-local, off by default** (like Learn's click — NOT the persisted `clickOn` shared with Polish, so Polish's persisted ON never contradicts Listen's default). **Tempo-map guard:** the free-running click is only offered when the score's tempo map has a single entry; scores with mid-piece tempo changes keep the metronome disabled-in-place with the existing gating pattern (a free-running click against a ritardando is worse than none).

## H · Polish: real-time scoring with tempo tiers

- Metronome on by default (persisted `clickOn` semantics unchanged); count-in stays.
- **Per-measure grade** = the existing evaluator's `combined` (notes-hit and on-time already both feed it). Live feedback = the existing on-score measure wash (MeasureGradeLayer) — **no new floating ticker**. The cumulative readout rides the transport bar's center readout in Polish: `82% · m 12/24`.
- **Run score** = `round(100 × mean(combined over measures with expected notes))`.
- **Tiers**, bucketed by `tempoMult` **at run start**: slow `< 0.8` · medium `[0.8, 1.0)` · full `= 1.0` (±1e-6) · overclocked `> 1.0`. A mid-run tempo change **voids tier persistence** for that run (live grades still show; the summary labels it "mixed tempo").
- **Overclocked extra credit:** stored/displayed score = `round(100 × mean × 1.25)` (can exceed 100 — that's the point).
- **RunSummary extends** into the final-score view: this run's score + tier, and the four tier bests side by side (from the practice record §C). Tier bests only update on non-voided, completed whole-piece runs.

## I · Perform

Page indicator removed — zero chrome. Verify left-pedal paging end-to-end on the physical piano (config + `pedalEdge` + the CC subscription exist; fix whatever's broken). Needs the instrument — schedule accordingly.

## J · Shared-control polish

- **`ToggleSwitch`** primitive (role="switch", aria-checked, ≥48px track, left label); first consumer: View's Keyboard row.
- **Key abbreviations:** cells `DM` / `F#m` (M major, m minor); footer keeps the long form.
- **Tempo ladder:** `60 · 70 · 80 · 90 / 100 / 110 · 125 · 150 · 175` — 100% dead-center.
- **Header crumb icon:** 0.35em icon→label gap; inline-flex vertical centering.
- **Guest zero-start (Videos):** `resumeSecondsFor` returns 0 for unenriched items; the device-playhead fallback dies in the kiosk.

## Deliberate contract deletions (so review doesn't flag them as regressions)

Tests/telemetry retired with their features: HandsControl `mypart` tests; `LoopControl.test.jsx` + `LoopSheet` tests + the bar's loop-prop tests; telemetry events `score.listen.mypart`, `score.listen.part`, `score.loop.toggle`, `score.focus.select-*` (replaced by loop-group/handle equivalents); the `myStaves` scoreSettings field.

## Sequencing sketch (~17–19 tasks)

1. §J batch (ToggleSwitch, key abbrev, ladder, crumb icon, guest zero-start) — 2 tasks
2. Per-staff geometry extraction (§A dep) — 1
3. Hands model refactor + myStaves migration + Listen simplification (§A, §G) — 2
4. Staff dimming layer — 1
5. Learn state matrix (transport in Learn, Play gating) — 2
6. Range heuristic + practice endpoints + hook + preference (§B, §C, §E) — 3
7. LearnInkLayer + spelling helper + punishment-budget rewire (§D) — 2
8. LoopGroup extraction + video re-consume; tap-to-arm; RangeHandleLayer (tap + drag); retirements (§F) — 3
9. Polish scoring/tiers/summary + bar readout (§H) — 2
10. Perform cleanup + pedal verify (§I) — 1
11. Data/config, docs, deploy, on-device verify — 1

## Open items / risks

- OSMD per-staff geometry is now a first-class task with a specified fallback chain (not a hand-wave).
- Wet-ink MIDI→spelling is specified (§D) but still the fiddliest new math; budget a fix round.
- Pedal verification and final on-device checks need the physical piano.
- Handle drag on the jank-prone tablet: pointer-capture-on-handle-only pattern specified; verify on-device during the final pass.
