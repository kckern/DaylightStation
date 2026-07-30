# Sheet-Music Wave 3 — Post-Merge Follow-ups

Wave 3 merged to main 2026-07-29 (`3cb9c0d92`, deployed at `fdfda4929`). All 25 plan tasks + 3 ad-hoc tasks (adaptive course grid, studio chord logging/duration classes, wet-ink stemming) passed per-task review, a final whole-branch review, and one fix wave. This file preserves the accepted residuals.

## On-device verification (needs the physical piano / tablet)

- [ ] **Learn landing:** open a practiced score → auto-range at the frontier, loop ON, Play locked; wrong note = shake + red wet-ink at the played pitch; 3rd consecutive wrong reveals keys dimly.
- [ ] **Range handles on the jank-prone tablet:** drag the out-handle across a system wrap — no scroll hijack, snap on release, edge auto-scroll. Eyeball: collapsed one-measure grips bracket the boundary ±24px; section-tick amber `#f0d270` legibility.
- [ ] **Listen:** hand toggles mute + dim staves live; keyboard hidden by default; session metronome (single-tempo scores only) off by default.
- [ ] **Polish:** whole-piece run → summary with tier + per-bucket bests; check `users/<id>/apps/piano/practice/<scoreKey>.yml`; watch `score.polish.tier-best` in session logs.
- [ ] **Perform:** zero chrome; left pedal pages — if the piano's pedal emits a different CC, set `piano.yml → sheetmusic.perform.{advancePedalCC,backPedalCC}` (config, not code).
- [ ] **Course grid (/piano/videos):** one-viewport, balanced rows; eyeball wide-short splits (e.g. 19 → 2×10) and badge scaling at high counts.
- [ ] **Wet-ink stems/flags:** eighth/16th flags proportions at real zoom; courtesy accidentals on diatonic inks (deliberate; revisit if noisy).
- [ ] **Header crumb icon gap** (0.35em, inline-flex) on the tablet.
- [ ] **Studio chord data:** after some real use, pull `composer.input.chord-decision` / `note-duration` logs to size a real chord-grouping tolerance (root cause confirmed: NO grouping exists — every note-on inserts sequentially; `CHORD_ONSET_TOLERANCE_MS = 40` is diagnostic-only).
- Tablet was off WiFi at deploy time (known doze-drop) — it pulls the new bundle on next wake; hard-reload from FKB if it serves stale.

## Code follow-ups (resolved 2026-07-29 — `sheetmusic-residuals` branch)

All items from the original residuals list are resolved except the two flagged **OPEN** below (plus one record correction). None were load-bearing; each landed with tests.

| # | Residual | Resolution | Commit(s) |
|---|----------|------------|-----------|
| 1 | Stale `cycleWrongsRef` across loop OFF→ON / Restart mid-cycle | Fixed — reset now covers both paths. Toggle discard is OFF-edge-only, which wipes the arming void; equivalent for the leak since wrongs only accumulate while the gate is on. | `45531e56b` (+ `2bf16b0ea` comment fix) |
| 2 | `onMode`/`pauseForRebuild` unconditional `silenceScheduled` | Fixed — `stopForMatrixChange`'s held-note guard now applies to both entry paths. | `dda52ab08` |
| 3 | `usePracticeRecord` null-user `loaded` stall | Fixed — `setLoaded(true)` for all non-persistent users. | `4adf3ca89` |
| 4 | `RangeHandleLayer` `BAND_SLACK_PX` not scale-aware | Fixed — scale prop threaded through; slack = `40 * scale`. | `60255e818` |
| 5 | Dead transport loop branch (+ wrap dwell, `loopWraps`) | Deleted. The retired-L6 test's missing positive anchor (item 9) was hardened alongside — log-based (`score.transport.play`/`done`), since an audio anchor is unsatisfiable there by fixture design. | `e718a6fbe` (+ `ae0610d44` comment scrub) |
| 6 | Duplicate spelling modules (`model/spelling.js` vs `model/spellMidi.js`) | Resolved as a **deliberate split**, not a bug — documented with cross-reference headers. A merge would change wet-ink chromatic spelling by policy, so consolidation was rejected. | `d8a66a22d` |
| 7 | `SvgStaffRenderer` avg-position / backwards-middle-line stemming | Fixed — shared stem rules extracted to `MusicNotation/model/stems.js`; `wetGlyphs` now re-exports them. | `dc125c8e6` |
| 8 | `pendingOnsetsRef` unbounded on repeatedly dropped note_offs | Fixed — 30s lazy eviction added to both MIDI branches. Also cures a latent FIFO-poisoning bug: one dropped note_off previously caused every later note_off of that pitch to resolve the wrong onset. | `8c5bb3d78` |
| 9 | Test nits: L6 positive anchor; `TAP_SLOP_PX`/tie-break surviving mutants | Fixed — L6 anchor landed with item 5 (`e718a6fbe`); boundary + cross-system geometry tests added to kill the surviving mutants. | `60255e818` |
| 9a | *(record correction)* "mocks omitting `persistent` read as guest (`persistent !== false`)" | **This claim was wrong.** The production check is `isPersistentUser(id)` on an id string — no `persistent !== false` pattern exists anywhere in the codebase. The real gap was the missing `currentUser = null` test, closed by item 3. | `4adf3ca89` |
| 10 | Stale comments (`ScoreTransportBar`, `ScorePlayer`, `KeySheet`, `countIn`) | Fixed. The `countIn` fix also separates the ladder fact (reaches 1.75×) from the test's own fixture values (1.5× / 324 / 162), which the original comment conflated. The `ScorePlayer` `:1655` voided-readout comment was fixed together with its code. | `33640dcd0` (+ `455191c22` countIn correction); `cb874d978` (ScorePlayer) |
| 11 | `--current` tier highlight on partial runs; live `scoreLabel` overclock-on-voided-run | Fixed — highlight now gated on the completion predicate; `scoreLabel` freezes `runTierRef` and shows base-only tempo when a run goes mixed. | `7868ca696` (highlight); `cb874d978` (scoreLabel) |

**Still open:**

- Composer duration-classes numpad UX (numpad still governs rests/dots/triplet for entered notes) — **awaiting product sign-off**, a decision not code.
- Chord grouping (root cause confirmed in the original sweep: no grouping exists, every note-on inserts sequentially; `CHORD_ONSET_TOLERANCE_MS = 40` remains diagnostic-only) — **awaiting `composer.input.chord-decision` field data**. The stale-onset eviction from item 8 now protects that field data's integrity going forward.
