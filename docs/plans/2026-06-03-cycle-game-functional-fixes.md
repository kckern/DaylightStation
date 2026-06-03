# CycleGame Functional Fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for every behavioral change below.

**Date:** 2026-06-03
**Scope:** `frontend/src/modules/Fitness/lib/cycleGame/` (engine, record) + `frontend/src/modules/Fitness/widgets/CycleGame/` (container render, lobby presets)
**Relationship to other work:** A concurrent *styling* redesign also touches `CycleGameHome.jsx`/`.scss` (see `2026-06-03-cycle-game-ux-improvements.md`). Change 3 below edits `CycleGameHome.jsx` — keep it surgical (swap preset constants + preset-button render) to minimize conflict.

These are **functional** fixes, independent of the visual redesign.

---

## Change 1 — Distance race: lock at the finish line

**Problem:** `CycleRaceEngine.tick()` adds distance for every rider on every tick unconditionally. It sets `finishTimeS` when a rider first reaches `goalM` (and `standings()` already orders by finish time, so placement is correctly locked) — but `cumulativeDistanceM` keeps climbing past the goal, so a finished rider's odometer overshoots instead of parking at the line.

**Decision (confirmed):** *Freeze everything + finished state.* Distance locks at `goalM`, the speedometer's RPM gauge drops to idle/0, and the tile shows a clear FINISHED state. Others keep racing.

**Engine (`CycleRaceEngine.js`):**
- In the per-rider `tick()` loop, branch on "already finished" (distance race + `finishTimeS != null` from a prior tick): skip distance accumulation, keep `cumulativeDistanceM = goalM`, record `rpm = 0` / `zoneId = null` into the new series (so replay shows idle too). Continue recording live HR (real physiological data, useful for recap).
- When a rider crosses the line *this* tick: set `finishTimeS = elapsedS` **and** clamp `cumulativeDistanceM = goalM`.
- Applies to ghost riders too (their replayed distance also freezes at the line).
- Series must keep the same length across all riders each tick (time alignment for replay) — keep pushing samples for finished riders until the race ends.

**Container live render (`CycleGameContainer.jsx`, racing branch):**
- For a rider whose snapshot `finishTimeS != null` in a distance race, force the speedometer into FINISHED state: `rpm = 0`, odometer at goal, finished/placement marker. (Standings already give placement.)

**Tests:** `CycleRaceEngine.test.js` — a rider that crosses the goal freezes at exactly `goalM`; later ticks do not increase their distance; a slower rider keeps advancing; finish order → placement is stable.

---

## Change 2 — Ghost racer: replay all metrics (RPM, HR, multiplier/zone)

**Problem:** The race record persists only `distance_series` and `hr_series`. RPM and zone/multiplier are never recorded, so ghosts can't replay them:
- RPM: ghost has `equipmentId: null` → no cadence → speedometer reads `0`.
- Multiplier/zone color: ghost vitals are `{}` → `zoneId` null → multiplier 1 (badge hidden), no zone color ring.
- HR *is* already plumbed end-to-end (engine replays `ghostHrArr`); if it reads zero the source record simply had no HR. Add a test to confirm the path.

**Record (`raceRecord.js`):** add per-participant `rpm_series` and `zone_series` (zoneId strings), encoded with `SessionSerializerV3.encodeSeries` (RLE handles strings).

**Engine (`CycleRaceEngine.js`):**
- Live riders: store `rider.rpm = input.rpm` and `rider.zoneId = input.zoneId` each tick; push to `rpmSeries` / `zoneSeries`.
- Ghost riders: build `ghostRpmArr` / `ghostZoneArr` from `r.ghostRpmSeries` / `r.ghostZoneSeries`; replay via the existing nearest-sample `_ghostSampleAt` lookup; set `rider.rpm` / `rider.zoneId` accordingly.
- `getState()`: expose per-rider `rpm` and `zoneId`, plus `rpmSeries` / `zoneSeries` (so `buildRaceRecord` can persist them).

**Container (`CycleGameContainer.jsx`):**
- `ghostCandidates`: decode `rpm_series` → `rpmSeries`, `zone_series` → `zoneSeries`.
- `onSelectGhost`: thread `ghostRpmSeries` / `ghostZoneSeries` into `ghost.riders`.
- `buildRiders`: pass them through to engine rider config.
- Racing render: for ghost riders use replayed `riders[userId].rpm` and `riders[userId].zoneId`; resolve `multiplier = zoneMultiplierFor(zoneId, zones, hrlessMultiplier)` and zone color from the `zones` config by id (new small helper `zoneColorFor`).

**Backward compatibility:** old records lack the new series → ghost RPM 0, no multiplier (graceful). Distance + HR still replay. Log nothing noisy; this is expected.

**Tests:**
- `CycleRaceEngine.test.js` — a ghost built with `ghostRpmSeries`/`ghostZoneSeries` replays rpm + zoneId at the right ticks; `getState()` exposes them.
- `raceRecord.test.js` — record includes `rpm_series` + `zone_series`; round-trips through encode/decode.
- HR replay assertion (confirm existing path).

---

## Change 3 — Named tier presets (anchor on category, not number)

**Problem:** The value step shows raw numbers (`DISTANCE_PRESETS_M = [1000,3000,5000,10000]`, `TIME_PRESETS_S = [60,120,300,600]`), anchoring users on the digits.

**Decision (confirmed values):**

| Tier   | Distance | Time   |
|--------|----------|--------|
| Flash  | 100 m    | 1 min  |
| Sprint | 300 m    | 2 min  |
| Short  | 1 km     | 3 min  |
| Medium | 2.5 km   | 5 min  |
| Long   | 5 km     | 10 min |

- Default selected tier = **Medium** (2500 m / 300 s).
- Name is the primary button label; formatted value is a sub-label.
- Keep the custom stepper.

**Lobby (`CycleGameHome.jsx`):**
- Replace `DISTANCE_PRESETS_M` / `TIME_PRESETS_S` with `DISTANCE_TIERS` / `TIME_TIERS` (`{ key, label, meters|seconds }`).
- Render each preset button with `label` + `fmt(value)` sub-label; selection compares the numeric value.
- Pre-selected effective value → the Medium tier (replaces `presets[1]`).

**Container (`CycleGameContainer.jsx`):** align fallback defaults so Medium is the anchor: `distance_goal_default_m` fallback → 2500 (time default 300 already = Medium).

**Tests:** `CycleGameHome.test.jsx` — tier names render; clicking a tier sets its numeric value; Medium is pre-selected; custom stepper still adjusts.

---

## Change 4 — Staging/countdown ready screen: music + live compliance + clear penalty

**Problem:** The "Riders, to your bikes!" staging screen and the stoplight countdown don't show who's on board or whether they're pedaling early. The hot-start penalty (controller: rider with `rpm > 0` at the green light gets their meter locked for `hot_start_penalty_s`) is **only logged** — no visible indicator. The global `FitnessToast` lives in the player overlay and isn't reachable from inside this widget, so the penalty must surface within the cycle-game race screen.

**Decisions (confirmed):**
- Staging plays config-driven `sounds.ready` (the `cycle-game-ready.mp3` cue). Progression: lobby (idle) → **ready (staging)** → start jingle (stoplight) → racing playlist.
- A compliance strip shows during **both** staging and the stoplight: each on-board rider (avatar, name, **live RPM**) with status. Status language = word + icon + color (colorblind-safe): compliant (rpm 0) = `✓ READY` (green); pedaling (rpm > 0) = `⚠ WAIT` (amber, pulsing).
- At green, a rider who jumped gets a clear in-screen penalty: a `⛔ FALSE START` badge on their speedometer while the meter is locked, plus a banner naming offenders.

**Music (`CycleGameContainer.jsx` soundtrack effect):** idle → `playMusic(s.lobby, 'lobby')`; staging → `playMusic(s.ready || s.lobby, …)`; countdown/racing unchanged. New config key `cycle_game.sounds.ready` (gracefully silent/fallback if unset).

**Compliance strip:** new presentational `RiderReadyStrip.jsx` (`riders: [{ id, name, avatarSrc, rpm, heartRate, zoneColor, compliant }]`). Rendered in the staging branch (with the existing eyebrow + count) and beneath the `CountdownStoplight`. Container builds `stagingRiders` from claimed bikes (`getEquipmentRider` + live `getEquipmentCadence`), `compliant = !(rpm > 0)` (exact parity with the controller's green-light test). A ~300 ms poll during staging/countdown keeps RPM live. Ghosts are excluded (not physically present).

**Penalty:** container racing render adds `penalized: penalizedNow.has(userId)` (from `snapshot.penalized`) to each `riderLive`. `CycleSpeedometer` gains a `penalized` prop → `⛔ FALSE START / meter locked` overlay (sibling to the FINISHED overlay; shows real RPM so the rider sees pedaling isn't counting). `CycleRaceScreen` shows a transient banner naming penalized riders while any penalty is active.

**Note:** the penalty only fires when `cycle_game.hot_start_penalty_s > 0` in config — the compliance strip works regardless; the penalty badge requires it enabled.

**Tests:**
- `RiderReadyStrip.test.jsx` — renders a chip per rider; compliant shows `READY`, non-compliant shows `WAIT`; RPM rendered.
- `CycleSpeedometer.test.jsx` — `penalized` shows the FALSE START overlay; absent otherwise.
- `CycleRaceScreen.test.jsx` — penalty banner appears with offender names when a rider is penalized.

## Sequencing

1. Change 1 (engine freeze) — smallest, isolated to engine + render.
2. Change 2 (record/replay) — engine + record + container; builds on Change 1's series handling.
3. Change 3 (tiers) — lobby only.

Each change: tests first (vitest), then implementation, run the colocated suite, commit separately. Do **not** auto-deploy.
