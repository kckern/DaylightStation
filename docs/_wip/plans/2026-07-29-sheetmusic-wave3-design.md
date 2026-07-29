# Sheet Music Wave 3 — Design

**Date:** 2026-07-29 · **Status:** Design for review (no implementation started)
**Basis:** user requirements gathered 2026-07-29 (23 items, restated and confirmed); builds on wave 1 (transport design system) and wave 2 (sheet-music chrome redesign), both deployed.

---

## 0 · Mode identities (organizing principle)

| Mode | Identity | Transport chrome |
|---|---|---|
| **Listen** | Pure playback — "what does this sound like?" | Restart/Play · metronome (off by default) · hand toggles · Key/Tempo/View/Volume. No looping. |
| **Learn** | Untimed, correctness-gated practice at the user's frontier | Listen's chrome **plus** the loop group; range handles on the score |
| **Polish** | Real-time performance scoring (Guitar-Hero) | Play with count-in · metronome (on by default) · hand toggles · settings. No looping. |
| **Perform** | A music stand | Zero chrome (page indicator removed); left pedal turns the page |

---

## A · One hands model

`HandsControl` loses the `mypart` variant. One semantic everywhere — **active hands**:

- **Listen:** which hands the kiosk performs (staves map to `play`/`mute` roles directly from the toggles; the play-along "my part" concept and the `none` value leave Listen).
- **Learn/Polish:** which hands the user practices (existing `activeParts` semantics).
- The ≥1-hand floor applies in all modes (both-off = silence = pointless). Defaults: both hands on in Listen and Polish; Learn's initial hands come from preference (§E).

**Staff dimming (Listen + Learn + Polish):** new `useStaffDimming(activeParts, layout)` renders the deselected hand's staff at ~0.35 opacity. Note elements are already known per staff; staff lines/clef/system groups need one investigation pass into OSMD's SVG grouping. Fallback if the groups are unfriendly: a positioned translucent mask over that staff's rows using the system geometry the layout already provides. Acceptance is visual: the deselected staff clearly reads "asleep."

## B · Learn: the ready-to-play landing

New pure module `learnRange.js`:

```
pickLearnRange({ sections, measures, stepsByMeasure, activeHands, history })
  → { inMeasure, outMeasure, reason }
```

Cue order:
1. **History** — the first ~4-measure window where the selected hands' pass count is below threshold (the user's frontier).
2. No history — the **first rehearsal-mark section**, if the score has any (rare).
3. Else the first 4-measure window clearing a **density floor** for the active hands (skips rest-heavy/empty intro measures; density = active-hand notes per measure, from the engraved steps).
4. Degenerate scores — first 4 non-empty measures; else the whole piece.

`reason` goes to telemetry so the heuristic's real-world choices are observable.

On Learn entry: range auto-selected + loop armed + hands set from preference — something to play immediately. **No range selected → Listen-like behavior** (Play enabled, normal playthrough). The correctness gate applies only inside a loop.

## C · Practice history (server-side, per user per score)

New backend endpoints following the existing per-user piano data pattern (cf. `api/v1/piano/users/{user}/preferences`):

```
GET/POST api/v1/piano/users/{user}/practice/{scoreKey}    (scoreKey = encoded content id)
```

Stored as YAML under `users/{id}/apps/piano/practice/`. Shape:

```yaml
measures:
  "4": { rh: {attempts: 3, passes: 2}, lh: {attempts: 1, passes: 0}, both: {attempts: 0, passes: 0} }
polish:
  tiers: { slow: 78, medium: 84, full: 61, overclocked: null }   # best scores (§H)
updatedAt: 2026-07-29T…
```

- **Pass** = one clean loop cycle through the range with the selected hands (every gated note struck).
- **Attempt** = any completed cycle.
- Frontend `usePracticeHistory(scoreId, userId)`: loads for the range picker; records on loop-cycle completion. Polish writes tier bests into the same record — one practice file per user per piece.

## D · Correctness gate + wet-ink feedback (Learn)

The existing advance-on-correct-notes machinery remains the enforcement. New feedback:

- **`LearnInkLayer`** — renders what the user actually plays at the cursor column: correct notes flash briefly (the engraved note also lights, as today); wrong notes render as a **red notehead at the played pitch** (staff-placement math borrowed from the Studio/Composer wet-ink precedent), with the established shake animation on the cursor band, then fade.
- Judged only against the selected hands — RH-only practice ignores LH input entirely.
- Wet-ink renders in Learn always (loop or not): continuous visual feedback.

## E · Hand preference

- Household default: `piano.yml → sheetmusic.learn.defaultHands: both|rh|lh` (threaded through `resolvePianoConfig` — see the resolver-projection gotcha; passthrough + test required).
- Per-user override: `preferences.yml → learnHands` via the existing preferences endpoint.
- Learn entry resolves user → household → `both`.

## F · Loop group + range handles (Learn only)

- **`transport/LoopGroup.jsx`** — the video chrome's A/B cluster extracted into the shared family: set-in (`loop-a`), set-out (`loop-b`), toggle (`repeat`), clear (`clear-loop`). The video chrome re-consumes the same component (one implementation, two players). In Learn, set-in/set-out mark at the **current cursor's measure**; the in/out buttons carry their measure numbers as labels (`m5` / `m8`).
- **`RangeHandleLayer`** — visible ≥48px in/out handles at the range boundaries on the score itself; drag with measure snapping, or tap-to-arm then tap-a-measure. This replaces the two-tap select flow and menu nudges as the primary interaction.
- Wave-2's `LoopControl` chip and `LoopSheet` are **retired** (superseded). Listen and Polish carry no loop chrome.

## G · Listen simplification + metronome

Listen chrome: Restart · Play · Metronome (enabled, off by default) · hand toggles · divider · Key/Tempo/View/Volume. Loop gone. The "Listen's performance is the beat" force-disable is removed; the click runs against the transport tempo, as in Polish.

## H · Polish: real-time scoring

- Metronome **on** by default; the existing count-in stays.
- **Per-measure live grading** on two axes: notes-hit % and on-time % (existing evaluator timing tolerance). The existing grade-tally machinery emits a grade event per completed measure.
- **`ScoreTicker`** — small non-blocking overlay near the bar: last measure's grade + running cumulative. End of piece → the existing RunSummary extends into a **final score** view.
- **Tempo tiers:** runs bucket by `tempoMult` — slow (<0.8) · medium (0.8–0.99) · full (1.0) · overclocked (>1.0, bonus multiplier). Best score per tier persists to the practice record (§C); the summary shows tier bests side by side. Slowing down is never penalized — it's a separate column.

## I · Perform

- Page-count indicator removed — Perform renders zero chrome.
- Verify the left-pedal page turn end-to-end. The chain exists (`sheetmusicConfig` `perform.advancePedalCC: 67` / `backPedalCC: 66`; `pedalEdge.js`; the CC subscription in ScorePlayer's perform effect) — test on the physical pedal and fix whatever's broken in the chain.

## J · Shared-control polish

- **`ToggleSwitch`** — new shared primitive in `transport/` (role="switch", aria-checked, ≥48px track, label at left). First consumer: the View sheet's "Keyboard" row.
- **Key abbreviations:** KeySheet cells become `DM` / `F#m` (capital M = major, lowercase m = minor) — a formatter over the existing sounding-key math; the footer keeps the long form.
- **Tempo ladder rebalance:** `60 · 70 · 80 · 90 / 100 / 110 · 125 · 150 · 175` — 100% dead-center (50% dropped per user ruling).
- **Header crumb icon:** 0.35em gap between icon and label; inline-flex vertical centering (fixes the baseline-riding SVG).
- **Guest zero-start (Videos):** `resumeSecondsFor` returns 0 for any unenriched item — the device-playhead fallback dies in the kiosk. Device-level helpers survive only if a non-kiosk consumer exists (the wave-2 audit found none).

---

## Sequencing sketch (for the implementation plan, post-approval)

1. Shared primitives + small polish (§J): ToggleSwitch, key abbreviations, tempo ladder, crumb icon, guest zero-start.
2. Hands model + staff dimming + Listen simplification (§A, §G).
3. Learn landing: range heuristic + history endpoints + preference (§B, §C, §E).
4. Feedback: LearnInkLayer + correctness-gate wiring (§D).
5. LoopGroup extraction + RangeHandleLayer; retire LoopControl/LoopSheet (§F).
6. Polish scoring + ScoreTicker + tiers (§H).
7. Perform cleanup + pedal verification (§I).
8. Config/data, docs, one big-bang deploy with on-device verification.

Estimated 12–14 SDD tasks on a fresh worktree, same per-task + final review discipline as waves 1–2.

## Open items / risks

- **OSMD SVG grouping** for staff dimming is the main unknown (fallback mask design included).
- **Wet-ink staff-placement math** for arbitrary played pitches (red notes) — Studio/Composer precedent exists but needs adaptation to the engraved score's coordinate space.
- **Pedal verification requires the physical piano** — schedule that check while someone can press the pedal, or verify via the MIDI bridge's replay tooling.
- Retiring `LoopControl`/`LoopSheet` deletes wave-2 code shipped yesterday — deliberate supersession, noted so it doesn't read as churn.
