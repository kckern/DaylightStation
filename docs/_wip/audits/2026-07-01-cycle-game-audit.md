# Cycle Game — Full Audit (2026-07-01)

Four parallel review passes: frontend architecture/lifecycle, UX/visual design, backend/data/leaderboards, game design/mechanics. Every file under `frontend/src/modules/Fitness/widgets/CycleGame/`, `frontend/src/modules/Fitness/lib/cycleGame/`, the backend cycle-race stack, and both reference docs was read. All findings are code-verified with file:line references; nothing is speculative.

## Verdict

**Strong core, unfinished shell.** The simulation core (`CycleRaceEngine`/`CycleRaceController`) is pure, deterministic, and carries the best unit suites in the module. Logging discipline is the best in the frontend codebase. RaceResults and CountdownStoplight are broadcast-grade. The PovGrid three.js engineering (shader-AA grid, pooled labels, damped camera) is excellent.

What reads as "fresh out of dev" is concentrated in the layers *around* that core:

1. **Policy layers** — camera framing policy, chart zoom policy, finish-tie policy, DNF labeling policy — where the math is right but the rules produce bad experiences.
2. **Integration layers** — a 1,453-line god container; a drama-event system that is fully built, fully tested, and plugged into nothing; sounds cued in code but absent from config.
3. **Presentation consistency** — five desynchronized motion clocks animating the same 1 Hz datum; token drift; 9–12 px type on a 10-foot TV.
4. **Data maturity** — the backend is a dumb archive; all scoring lives in the browser over a 5-day window; no index; no crash resilience.

The 186 commits since March are dominated by targeted `fix(cyclegame)` patches — the game grew by whack-a-mole. The good news: almost every headline problem is a policy/wiring fix over state the engine already exposes, not a rebuild.

---

## Cross-validated critical findings

These were independently discovered by 2+ agents from different angles — highest-confidence items.

### C1. A mid-race kiosk reload loses the race entirely
- All race state is in-memory; the only save fires on entering `results` (`CycleGameContainer.jsx:1031-1064`). Firefox reload (the documented post-deploy procedure), a tab crash (the documented tick-storm freeze), or unmount mid-race discards a 20-minute effort with zero trace.
- Compounding: `savedRef.current = true` is latched **before** the POST (`:1034`); the save is one fire-and-forget fetch with no retry — a transient API failure is silent permanent loss.
- The platform sets a higher bar: Player saves progress on unmount; FitnessSession has resume/merge; fitness sessions persist incrementally to JSONL.
- **Fix:** sessionStorage checkpoint every ~5 ticks (`getState()` is already serializable) + resume-or-finalize on remount + `sendBeacon` on racing-phase unmount; latch `savedRef` only on success, retry with backoff, "not saved" badge on RaceResults. Longer-term: server-side race `status` + interim/heartbeat saves.

### C2. The drama engine exists, is tested, and is completely unplugged
- `lib/cycleGame/deriveRaceSnapshot.js` computes LEAD_CHANGE, RIDER_FINISHED, PHOTO_FINISH, FINAL_LAP, LAPPING_IMMINENT, race-phase hysteresis (EARLY/MID/FINALE), `closingRateMPS`, `tightestPairGapM` — and its only consumer is its own test file (grep-verified).
- The architecture pass flagged it as dead code to delete; the game-design pass identified it as **the highest fun-per-line fix in the codebase**. Resolution: wire it in, don't delete it.
- **Fix:** run `deriveRaceSnapshot` in the race tick → route events into the existing toast queue (new variants) + SFX; use `phase === 'FINALE' && tightestPairGapM < 25` for music duck / visual tension.

### C3. Scoring, PBs, and leaderboards live in the browser over a 5-day window
- `buildHighScores` (`lib/cycleGame/highScores.js:25-56`) computes household PBs client-side from the last 5 date folders (`CycleGameContainer.jsx:471-496`). **All-time bests are wrong by construction** — a genuine record older than 5 days never shows.
- The board holds exactly two household-global cards by raw avg km/h — **a kid can structurally never appear on it**; the strongest adult owns both forever. No "New PB!" recognition exists anywhere at race end.
- Domain rules (km/h derivation, sprint/endurance split, "live riders only", winner selection) are implemented once in the frontend and **partially re-implemented** in `CycleGameProvider.mjs` — two independent versions of "who won / whose distance counts." The zero-distance guard exists in three places.
- **Fix:** move scoring/PB/leaderboard into `2_domains/fitness`, server-computed over full history, with per-person PBs; expose `/cycle-races/leaderboard` and `/cycle-races/personal-bests`.

### C4. The "SVG drags behind" complaint: five desynchronized motion clocks
Five mechanisms animate the same 1 Hz datum:

| Element | Mechanism | Duration |
|---|---|---|
| Chart line tip | rAF lerp, easeOutQuad | 1000 ms (`DistanceChart.jsx:19,197-217`) |
| Chart tags/markers | CSS linear transition | 300 ms (`CycleRaceScreen.scss:100-107,125-129`) |
| Speedo needle | CSS ease transition | 180 ms (`CycleSpeedometer.scss:43`) |
| Oval markers | CSS linear transition | 900 ms (`OvalTrack.scss:50-54`) |
| PovGrid riders | rAF lerp, linear | 1000 ms (`tickFraction.js`) |

The terminus disc sprints to its new point in 300 ms and parks while its own line tip glides for another 700 ms — the tag visibly detaches from its line once per second, all race. CSS transitions restart on every React render → velocity discontinuities.

Additionally the chart's tip glide runs `setTickFrac` in a rAF loop → **a continuous 60fps full React re-render of the whole chart for the entire race**, recomputing per-rider coords twice per frame over an unboundedly growing series (`DistanceChart.jsx:197-209, 348, 368`). PovGrid already solved this correctly (rAF writes transforms imperatively; React renders only on tick).

- **Fix:** one motion system — every data-driven position (needle, oval, chart tags, markers, odometer) interpolates on the shared `tickFraction` rAF clock, linear, imperative transform writes; CSS animation reserved for state transitions (where the craft is already strong). Memoize chart geometry per tick; decimate long series.

### C5. The POV view breaks at large gaps — the "unusable when far behind" complaint
- Camera dolly caps at `MAX_DIST = 150` (`PovGrid.jsx:24-25`) but framing span is unbounded; fog is camera-relative (`FOG_FAR_M = 220`). Past ~140–200 m gap the leader is fully fogged out and its avatar card hits `CARD_MIN_SCALE = 0.225` → a ~20 px dot with a ~2 px label.
- Worse: metre marks and lap gates generate only in `leaderM − 220 → leaderM + 25` (`povWorld.js:47-48,61-63`), so the trailing rider — whom the camera follows — rides a **blank, unlabeled road with no lap arches**.
- No ordinal, no gap readout anywhere on the road; the only per-rider number is an absolute distance at 0.62rem further shrunk by depth scale (2–7 px at 720p).
- **Fix:** gap-compress z beyond ~100 m (same `log1p` idea as `chartScale.gapFrac`) so the leader is always on-screen; horizon-pinned fixed-size leader chip ("LEADER +312 m") when beyond the window; generate marks/gates across `[lastM − 30, leaderM + ahead]`; fixed-screen-size placement + gap badges per card. Never let the person you're chasing leave the screen.

### C6. Ghosts are invisible from selection until they materialize mid-race
- After picking a ghost, its only representation is a small "vs Name" chip (`RaceTypePicker.jsx:81-90`). Starting grid, ready strip, and countdown map physical bikes only (`CycleGameContainer.jsx:427-447`); PovGrid/chart exclude anyone at 0 m (`PovGrid.jsx:110`, `chartTrim.js:12-17`) — so the screen is **empty at GO** and the chosen opponent silently appears seconds later.
- During the race there is no gap-to-ghost readout; beating a ghost produces a normal results row — the entire emotional payload of a ghost system (*I beat yesterday's me*) is never delivered. No auto-offered PB ghost for solo riders; the picker scope is "recent 5 days," not "relevant" (all-time PBs age out).
- **Fix:** phantom grid slot with ghost-treated avatar + pace label; AUTO chip in the ready strip; all riders parked on the start line at t=0; live gap-to-ghost chip; GHOST_BEATEN results callout with delta; auto-suggest PB ghost ("👻 Your best: 2:41 — race it?").

---

## Per-dimension highlights

### Frontend architecture (full report: agent 1)

**Strengths:** pure engine/controller core; exemplary structured logging (zero raw console.*, phase-transition spine, raceId correlation); prop-driven view layer with hard-won `PanelSlot`/zoneBox lessons encoded; sensor-reality hardening (rpm gap hold vs cooldown, two-phase DNF grace, multi-sensor merge) in small tested helpers; cleanup discipline throughout (timers, rAF, GL resources all paired).

**Top issues:**
1. **[Critical]** No mid-race checkpoint (C1).
2. **[Major]** `CycleGameContainer.jsx` god component — 1,453 lines, ~30 hooks, ~25 refs, ~10 concerns (music engine, roster building, ghost decoding, phase machine, three polling loops, 155-line tick interval, persistence, toasts, sim seam, inline staging screen). Extract `useRaceAudio`, `useRaceHistory`, `useLobbyRoster`, `useRaceLifecycle`, `useRacePersistence`, `StagingScreen.jsx` → container drops to ~300 lines of composition (matches the DancePartyWidget sibling convention).
3. **[Major]** Save failure silent + latched pre-attempt (C1).
4. **[Major]** Container logic effectively untested — 119-line smoke test guards the riskiest 1,453 lines; the decomposition is what makes hook-level behavioral tests possible.
5. **[Major]** Race clock counts ticks, not wall time (`CycleRaceEngine.js:96`) — under documented kiosk jank a "5:00" race stretches in wall time. Also the tick interval is torn down/recreated at go→racing (effect deps `[phase,...]`, `CycleGameContainer.jsx:1028`), contradicting its own comment. Fix: wall-clock accumulator + boolean `isEngineLive` gate.
6. **[Major]** DistanceChart 60fps setState (C4).
7. **[Major]** Context-churn re-renders (`FitnessContext.jsx:2401` unmemoized value) + 300/750 ms `assignVersion` polling; FitnessSession needs an assignment-change event.
8. **[Minor]** Dead code (`deriveRaceSnapshot` — see C2, `stagingTimerRef`), doc drift (`cycle-game.md` references nonexistent `leaderAnchoredZoom.js`; §9.4 describes the retired CSS PovGrid), setState-inside-updater (`:1175-1180`), unguarded `__cycleGameControl.startRace`, sequential history fetch, HR-strap-drop scoring change invisible on screen, `getState()` deep-clone ×4/tick.

### UX / visual design (full report: agent 2)

**Strengths:** RaceResults podium (stagger, count-ups, reduced-motion); CountdownStoplight; staging-gate UX ("Stop pedalling" bar); GhostPicker roster card; PovGrid tech; single `cg-ghost` treatment; toast system; chart tag de-overlap concept.

**Top issues (by user pain):**
1. POV breaks at large gaps (C5).
2. **No standings ladder exists during a live race** — the old roster is dead CSS (`CycleRaceScreen.scss:141-173`), SplitsChart isn't in the live panel map (`CycleRaceScreen.jsx:57-79`; the reference doc §9.1 is stale). Nowhere can a rider read *my position, who's next, the gap*. Fix: persistent standings tower (rank ≥2rem, avatar, lane chip, gap-to-next) in both layouts.
3. **Race-screen text is illegible from the bikes** — 9–12 px labels across every panel (PovGrid 0.55–0.62rem, gate labels 0.72rem, chart header 0.7rem, oval strip 0.6rem, splits 0.62–0.78rem…). Fix: 10-foot type scale in `_cgTokens.scss` (hero ~3rem, labels ≥1.4rem, hard floor 1.1rem); anything that can't earn 1.1rem gets removed, not shrunk.
4. Five motion clocks (C4).
5. **Speedometer overlaps verified:** RPM digits at `top: 8%` collide with the 12-o'clock tick label at every size (`CycleSpeedometer.jsx:116-123`, `.scss:67-72`); fixed-rem badges/readouts collapse onto the 38 px avatar at wide-mode `minGauge: 96`; `layoutSizing.js:32` under-budgets real chrome by ~16 px and the zone is `overflow: visible` → band bleeds into the chart. Fix: container-scaled typography, RPM into the free lower hemisphere, honest height budget, `overflow: hidden`.
6. **Chart can't answer "how much is left":** no axis labels anywhere (log-mode gridlines re-projected to uneven spacing with no key); goal line hidden until the leader passes ~2160 m of a 2500 m race (`DistanceChart.jsx:111-115`); stepped 2× zoom rug-pulls lanes to half height repeatedly. Fix: distance races get fixed Y=[0..goal] with the finish line always visible + labeled axes; continuous rescale for time races only.
7. Ghost invisible pre-race / screen empty at GO (C6).
8. Wide mode (4+ riders) loses all lap/split info — fold the oval's Last/Now lap strip into the chart header or standings rail.
9. Palette failures: rider-1 cyan ≈ chrome cyan (`lineColors.js:12` vs `_cgTokens.scss:18`); maroon lane ~3.4:1 contrast; FlatUI cadence-band colors inside synthwave gauges (`speedometerGeometry.js:17-23`); legacy indigo `#7aa2ff` accent surviving in 4 files; three unrelated reds and greens.
10. Accretion signals: emoji as HUD iconography (platform-dependent rendering, placeholder feel next to the existing SVG icon set), dead roster CSS, single-initial chart tags ("Mom" and "User_3" are the same letter), `race-layout__top3` naming a layout that no longer exists.
11. `RaceRecap` scrubber is a native drag slider — violates the household's explicit "no drag sliders on touch" rule. Replace with discrete skip buttons.

### Backend / data (full report: agent 3)

**Strengths:** clean adapter↔application↔API↔provider layering, DI-wired; sound unbounded-safe storage layout (one file per race, day folders sliced from the id); disciplined UTC chokepoint (`raceEpochMs`); thoughtfully correct and well-tested `CycleGameProvider` band math; mature `groupSessions`; genuinely good reference docs.

**Top issues:**
1. **[Critical for first-class]** Backend is a dumb archive; all domain logic client-side (C3).
2. **[Major]** No index — `findGhostCandidates` (`CycleRaceService.mjs:25-40`) loads and parses **every YAML across all history** per call. It adopted `YamlSessionDatastore`'s layout but not its `_index/{YYYY-MM}.json` self-healing shards. Prerequisite for leaderboards.
3. **[Major]** Mid-race reload loses the race; no server race state, no interim save, no client retry (C1).
4. **[Major]** `course_id` is a phantom field: service + tests filter on it (`CycleRaceService.test.mjs:36-41` injects it) but `buildRaceRecord` (`raceRecord.js:22-30`) **never persists it** — the course-ghost query path is dead against real data and green in tests (textbook ported blind spot). Persist it or delete the branch.
5. **[Major]** Ghost series are inlined into every re-race — race a popular ghost 10× and its full 4-channel series is stored 11×. No ghost library / reference model, no resolution cap.
6. **[Major/minor cluster]** Save not idempotent or validated: client-generated seconds-precision id (collision → silent overwrite), no id-shape enforcement (malformed id → write-to-limbo folder that `listDates()` then hides), 400 returned for internal I/O errors, one GET overloaded across three resources (`fitness.mjs:442-456`, `?date` silently wins over `?courseId`), non-atomic `writeFileSync` with corrupt-YAML silently vanishing from lists.
7. **[Minor]** No retention/GC policy; `version:1` written but never read (no migration dispatch); no caching (every lobby entry re-fetches + re-parses 5 days).

### Game design / mechanics (full report: agent 4)

**Strengths:** real, legible officiating (false-start penalty box requiring RPM-0 to clear, two-phase DNF tuned to actual sensor hardware, staging gate); physics SSOT reused by the gauge so display can't disagree with scoring; ghost replay fidelity (interval-aware interpolation, finish clamp); honest sim seam + scenario-grade tests; lifecycle polish.

**Top issues:**
1. Drama engine unplugged (C2).
2. No per-person PBs / PB recognition (C3).
3. **No handicap/pursuit starts for a mixed-ability family** — the single biggest format gap for this household (4 kids + 2 adults). Pursuit starts (staggered greens from historical avg km/h so projected finishes converge) and per-rider goal scaling are trivial on top of the existing controller. Explicit and named, never hidden — records stay honest.
4. Ghost races lack the rivalry loop (C6).
5. **Countdown/GO/finish are silent in production** — code cues `sounds.countdown` (`CycleGameContainer.jsx:859`), `sounds.go` (`:847`), `sounds.finish` (`:1008`) but the live config's `cycle_game.sounds` block only defines `lobby/ready/start/end/racing`. The three highest-adrenaline moments of the race are mute. **Config-only fix.**
6. **Infinite sensor-gap RPM hold** — `equipmentRpm.rpmDuringGap` (`equipmentRpm.js:32-40`) holds last RPM through a gap and the container never appends history while disconnected, so a sensor that dies mid-sprint accrues distance at frozen sprint RPM forever and can never DNF. Cap ~5 s hold → 3 s decay + "sensor lost" gauge chip.
7. **Mercy-kill brands honest slow finishers "DNF"** and hides their real distance (`CycleRaceController.js:147-160`, `RaceResults.jsx:55-58`) — the game's cruelest message aimed at its weakest riders. Split `overtime` from `dnf`; show "2.1 km · 84%" with placement.
8. **Ties decided by bike-slot order; finish times quantized to 1 s** — `finishTimeS = this.elapsedS` (`CycleRaceEngine.js:122-125`) with no within-tick interpolation, even though lap crossings ARE interpolated three lines below. Interpolate the crossing; declare dead heats within ~0.1 s.
9. **No progression economy** — no coins (despite the fitness zone-coin economy in the same config), no streaks, no lifetime odometer; every race ends value-flat except for the winner.
10. Anti-cheat clamp configured at a level nothing reads (`cycle_game.abuse_max_rpm` vs the `equipment.abuse_max_rpm` the code reads — the ab roller is uncapped in prod); `hrless_multiplier: 1.0` beats Cool zone ×0.8 (strap-off exploit kids will find); mid-race rider swap silently misattributed; no idle-lobby timeout (music loops forever in an empty garage); doc drift (zone multipliers, `distance_goal_default_m: 3000` matching no lobby tier so no preset highlights); `CycleStateMachine.test.js` actually tests GovernanceEngine (rename).

---

## Roadmap to first-class

### Phase 0 — Quick wins (hours; mostly config/wiring)
1. Ship `countdown` / `go` / `finish` sound files (config only).
2. Latch `savedRef` only on success; retry with backoff; "not saved" badge.
3. Fix `hrless_multiplier` ≤ 0.8; move `abuse_max_rpm` to a key the code reads; align `distance_goal_default_m` with a lobby tier; delete dead config keys.
4. Hygiene: delete `stagingTimerRef`, fix setState-in-updater, phase-guard `__cycleGameControl.startRace`, parallelize history fetch, rename `CycleStateMachine.test.js`, fix doc drift.

### Phase 1 — A race you can trust (correctness; ~1 week)
5. Wall-clock-anchored tick accumulator; single interval across go→racing.
6. Interpolated finish times + dead-heat rule; `overtime` split from `dnf` with real metrics shown.
7. Sensor-gap hold cap (5 s hold → 3 s decay) + "sensor lost" chip.
8. Mid-race checkpoint to sessionStorage + resume-or-finalize on remount + sendBeacon on unmount (C1).

### Phase 2 — A race you can read (UX; ~1–2 weeks)
9. One motion system: everything on the shared `tickFraction` rAF clock, imperative transforms; kill the CSS data-transitions and the chart's 60fps setState.
10. Persistent standings tower (rank, avatar, gap-to-next) in both layouts.
11. POV gap compression + horizon leader chip + rider-anchored marks/gates + start-line lineup at t=0.
12. Distance-race chart: fixed Y=[0..goal], goal line always visible, labeled axes; continuous rescale for time races.
13. 10-foot type scale; speedometer geometry rebuild (RPM into lower hemisphere, container-scaled type, honest height budget); palette consolidation pass (rider colors as CSS custom props from `lineColors.js`, cyan reserved for chrome, semantic danger/success/warn tokens, SVG glyphs replacing HUD emoji).

### Phase 3 — A race that's fun (drama + motivation; ~1 week)
14. Wire `deriveRaceSnapshot` into the tick → toasts + SFX for LEAD_CHANGE / FINAL_LAP / PHOTO_FINISH / RIDER_FINISHED; FINALE music duck.
15. Per-rider PBs by course-class + "New personal best!" celebration + lobby PB cards for assigned riders.
16. Ghost rivalry loop: phantom grid slot, ready-strip presence, live gap-to-ghost, ghost-beaten callout, auto-offered PB ghost, post-race "race this as a ghost" CTA.

### Phase 4 — Structure that scales (architecture; ~1 week, parallel-friendly)
17. Container decomposition into tested hooks (`useRaceAudio`, `useRaceHistory`, `useLobbyRoster`, `useRaceLifecycle`, `useRacePersistence`) + `StagingScreen.jsx` — the keystone that makes #8 and behavioral testing tractable.
18. FitnessSession assignment-change event; drop both `assignVersion` polls; memoize FitnessContext value (fleet-wide win).

### Phase 5 — Backend maturity (~1–2 weeks)
19. Domain-layer scoring in `2_domains/fitness`; server-computed leaderboards + per-user PBs over full history; monthly `_index` shards (mirror `YamlSessionDatastore`).
20. Ghost library by reference (kill series duplication); persisted `course_id`; course-matched all-time ghost discovery.
21. Idempotent validated atomic save; race `status` + interim saves; RESTful route split; retention lifecycle; version dispatch.

### Phase 6 — Formats & progression (the family layer)
22. Pursuit (handicap) starts seeded from history; per-rider goal scaling.
23. Elimination on lap gates; team total-distance.
24. Coins for participation/finish/PB via the existing economy; lifetime odometer; streaks; seasonal boards; idle-lobby timeout.

Phases 0–3 transform perceived quality without touching the data model. Phase 5 can proceed in parallel with 2–3.
