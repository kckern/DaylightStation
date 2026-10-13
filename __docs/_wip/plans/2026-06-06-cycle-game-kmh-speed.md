# Cycle Game — surface effective km/h

**Date:** 2026-06-06
**Status:** implemented (tests green)

## Problem

The "effective speed" a rider produces — `rpm × wheel-circumference × zone-boost` — is
the real output of the game, but it appears nowhere. The speedometer shows raw RPM
(cadence) only, and the lobby history shows raw distance/time per race, which aren't
comparable across races of different lengths.

## Formula (single source of truth)

Effective speed reuses the engine's own distance accumulation so the gauge can never
disagree with the lanes:

```
metres/sec = computeDistanceDelta(rpm / 60, wheelCircumferenceM, multiplier)
km/h       = metres/sec × 3.6
```

`multiplier` is the zone boost (already passed to the speedometer for the ×N badge);
`wheelCircumferenceM` lives on each engine rider.

## Change 1 — Speedometer (`CycleSpeedometer`)

- New prop `speedKmh` (precomputed at the call site → component stays presentational).
- Layout (avatar stays centered):
  - **rpm** moves to the empty top-center zone *above* the avatar — small + muted (the
    needle + lit band already encode cadence, so the digits are secondary).
  - **`28.4 km/h`** hero (cyan) sits *below* the avatar, where rpm used to be.
  - odometer (distance) stays below the whole gauge.
- Needle, ticks, lit cadence bands unchanged (still RPM — the controllable input).
- `CycleGameContainer` computes `speedKmh` per rider in `riderLive` (it has rpm, mult,
  wheel circumference); `SpeedoRow` forwards it.

## Change 2 — History table (`HistoryTable` + `recordRow.js`)

Columns: **RIDERS · SPEED · RACE · WHEN** (was RIDERS · DIST · TIME · WHEN).

- **SPEED** — the **winner's** average km/h: `finalDistanceM ÷ durationS × 3.6`, where
  `durationS = finalTimeS ?? timeCapS`. Shared `kmh()` helper, reused by `buildHighScores`
  so the two can't drift.
- **RACE** — the course's defining target with a small icon: 🏁 + target distance for
  distance races ("3 km"); ⏱ + time cap for time races ("2:00"). (= the old `goalLabel`.)
- Drop the goal/score `distanceLabel`/`timeLabel` columns and the `goalColumn` flip logic.

## Tests

- `recordRow`: builds `speedLabel` + `raceLabel`/`raceKind` from a candidate.
- shared `kmh()` helper unit test.
- `HistoryTable`: renders SPEED + RACE columns.
- `CycleSpeedometer`: renders km/h hero + rpm sub-readout.

## Out of scope (YAGNI)

- No per-participant speed picker in history (winner only).
- No instantaneous-speed history sparkline.
- Speedometer needle stays cadence (not converted to a speedo).
