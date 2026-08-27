# The vitest gate is non-deterministic at 2605 files

**Date:** 2026-08-27
**Introduced by:** `df722fb7d` — adding `frontend` to `gate-vitest`'s `ROOTS`
(population 1447 → 2605). Not by anything in the frontend code itself.
**Severity:** high. `scripts/gate-vitest.mjs`'s own header says it: *"A gate that
flakes is a gate people learn to re-run until it is green, which is the same as
having no gate."* That is the state it is in now.

## The evidence

Three consecutive full runs on the same commit, same machine:

| Run | New failing files |
|---|---|
| 1 | *none* — `OK (no new failures vs baseline)` |
| 2 | `RubiksCubeProgram`, `SentenceLadderProgram`, `SchoolApp.lockSplit`, `WeeklyReview.paging` |
| 3 | `PianoMenuActivity` |

**A different set each time, and every one of them passes in isolation** —
the four from run 2 together give 51/51 in 2.9s; `PianoMenuActivity` gives
12/12 in 1.18s. `vitest.config.mjs` already names `WeeklyReview` and
`RubiksCubeProgram` among its "roaming victims", so two of these were known.

## It is not (only) a timeout

The natural assumption is worker starvation against `testTimeout`. At least one
is something else. `PianoMenuActivity › records the rendered shape for the next
cold load` failed with:

```
expected [ 2, 2, 2 ] to deeply equal [ 2 ]
```

`[2, 2, 2]` is the *fallback* shape `readShape()` returns when nothing is
remembered. The spec synchronises on the cards rendering —
`await waitFor(() => expect(loadedCards()).toHaveLength(1))` — and then asserts
the persisted shape immediately. The component's `localStorage` write is not
covered by that wait, so under load the assertion reads before the write lands.
A missing synchronisation, not a slow one: raising `testTimeout` would not fix
it, because nothing is timing out.

So the population growth did not merely slow things down. It put more files per
worker, which surfaced latent per-spec bugs that were previously hidden by luck.

## Why the old calibration no longer holds

`gate-vitest.mjs` caps workers at half the cores, and its comment states the
premise plainly: that was tuned when *"folding backend/ in took it past 1200"*.
The population is now 2605 — more than double the number the calibration was
chosen for — while the worker count did not change. Per-worker load went from
~181 files to ~326.

## What NOT to do

- **Do not baseline these files.** They are not consistently failing; a baseline
  entry would absorb a whole file's real failures to excuse an intermittent one,
  and the set changes every run.
- **Do not re-run until green.** That is the habit the gate exists to prevent,
  and this document exists so nobody has to rediscover why the gate is untrustworthy.
- **Do not raise `testTimeout` reflexively.** At least one failure is a
  synchronisation bug that no timeout value fixes.

## Plausible directions, in order of appeal

1. **Fix the specs.** The `PianoMenuActivity` case is a genuine missing
   `waitFor` around the persisted-shape assertion and is a small fix. Diagnose
   the other four the same way before assuming they share a cause — the evidence
   so far says they do not.
2. **Re-calibrate concurrency for the new size** — fewer workers, or
   `isolate`/`fileParallelism` tuning — and say in the comment what population
   the new number was chosen for, so the next doubling invalidates it loudly.
3. **A fast path** (`--changed`/`--since`) for iteration with the full sweep
   reserved for branch end. A 13-minute gate invites the re-run habit on its own,
   independent of flakiness.

## What is NOT implicated

`fix/surround-band-name-floor` (`aac316a22`) touches `band.js` comments, the
`band.measure` cushion band, and baseline prose. None of the five flaking suites
imports `Surround/band`; all pass in isolation; and the Surround module is green
at 976 passed. That change is orthogonal to this one.
