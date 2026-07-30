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

## Code follow-ups (accepted residuals, none load-bearing)

- Stale `cycleWrongsRef` across loop OFF→ON / Restart mid-cycle (stingy-only: denies passes, never grants).
- `onMode`/`pauseForRebuild` unconditional `silenceScheduled` — entering a mode while holding keys still panics (pre-existing class).
- `usePracticeRecord`: `currentUser === null` (roster pending/failed) leaves `loaded` false → auto-range waits; suggest `setLoaded(true)` for all non-persistent users.
- `RangeHandleLayer` `BAND_SLACK_PX = 40` not scale-aware (vs `measureAtPoint`'s `40 * scale`).
- Dead-but-inert transport loop branch in ScorePlayer's `onDone` (+ wrap dwell, `loopWraps`) — deletion candidate.
- Duplicate spelling modules after the merge: `MusicNotation/model/spelling.js` (degree-relative, chord/theory surfaces) vs `model/spellMidi.js` (diatonic-or-sharps, wet ink) — consolidation candidate.
- `SvgStaffRenderer` (ActionStaff family) still stems by avg-position with the opposite middle-line convention — route through `wetGlyphs`' `stemDirectionFor`/`stemLengthUnits`.
- Composer duration classes change the numpad-duration UX for entered notes (numpad still governs rests/dots/triplet) — product sign-off.
- `pendingOnsetsRef` unbounded on repeatedly dropped note_offs (cap/timeout).
- Test nits: L6 tail-measure test lacks a positive anchor; `TAP_SLOP_PX`/cross-system tie-break are surviving mutants; mocks omitting `persistent` read as guest (`persistent !== false`).
- Stale comments: `ScoreTransportBar` "Learn-only Play lockout"; `ScorePlayer` "a Listen part change" + `:1655` voided-readout claim; `KeySheet` "D major / +2"; `countIn` "top of TEMPO_STEPS is 1.5x".
- `--current` tier highlight shows on non-banking partial runs (gate on the completion predicate); live `scoreLabel` applies the overclock multiplier to a voided run mid-change.
