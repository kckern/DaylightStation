# A dead sensor must not read as a lazy child

**Status:** design agreed, not yet implemented
**Slice:** third of three (see `2026-09-16-chess-round-standing-ux-design.md`)
**Date:** 2026-09-16

## What the garage screen says today

> **Did Not Finish — Stopped pedaling for 30s**

It says that to a child who was pedalling. The cadence sensor sent nothing, the
rider's rpm read 0 for `race_idle_dnf_s` (30), and the game forfeited them and
named them for it.

## The evidence

A clean natural experiment, one rider, one bike, one variable. `niceday` is
bound to ANT+ sensor `7138` (the `cadence:` key on its entry under `equipment:`
in the household fitness config). What that sensor actually emitted:

| Window (UTC) | Sensor 7138 | Races in that window | Result |
|---|---|---|---|
| 17:25:00–17:28:59 | **no packets at all** | three | DNF at 30s, 0 rpm, three times |
| 17:30:40 onward | 42, 71, 73, 75–81 rpm | one | 73 rpm, 6 m, no DNF |

Four minutes of radio silence covering exactly three DNFs, then the sensor woke
and the very next race registered. He was on the bike throughout.

Scale, same day: **29 `cycle_game.sensor_lost` against 13
`cycle_game.sensor_recovered`** — sixteen sensors dropped mid-race and never came
back. Over seven days every machine is affected: tricycle 20, cycle_ace 20,
niceday 14, ab_roller 12, generic_pedaler 7. Whole races show four or five live
riders at 0 m while only the ghost replays move.

## Why nothing catches it

**The game deliberately suppresses the warning.** The SENSOR chip is gated on
`everConnected` — a rider with no connected reading yet is assumed to still be
mounting the bike. That is right for the first few seconds and exactly wrong for
a sensor that never appears, which is the case here. So the forfeit arrives with
no sensor warning at all.

**The bridge logs nothing about sensor state.** It emits raw data lines and HR
rejections and nothing else — no attach, no detach, no channel events. Checked
a fifteen-minute window across the failures: not one line about a sensor coming
or going. A dropout is invisible at every layer, which is why diagnosing this
required diffing race telemetry against raw container output by hand.

## The work

1. **Split "never connected" from "stopped pedalling."** A rider who has had no
   connected reading since the race began has not idled out — they have no
   sensor. Show the sensor state instead of a forfeit, and never print the
   "stopped pedaling" sentence for them. Keep the existing `everConnected`
   suppression for its real purpose (the first seconds), but expire it: after a
   few seconds with no reading it should say SENSOR, not stay silent.

2. **Make the dropout visible.** Log ANT+ channel attach and detach in the
   bridge. Today the only way to distinguish a still bike from a silent sensor
   is to cross-reference two systems by hand.

3. **Fix the two faults found while diagnosing.** `cycle_ace`'s sensor `49904`
   sent nothing across the whole race window and reappeared later; its REV
   counter reads 2633, so it was recently reset or had a battery change. And the
   app has no binding for it — 787 `fitness.auto_assign_skip` events, every one
   `hasLedgerEntry: false, hasUser: false`. Whoever rides CycleAce is not being
   identified.

## How to diagnose this class of problem again

Race telemetry alone cannot tell a still bike from a silent sensor. Cross-check
the bridge's raw lines against the race window:

```
docker logs <fitness-bridge-container> --since <ISO>Z --until <ISO>Z \
  | grep "<deviceId> CAD"
```

`--since`/`--until` without a trailing `Z` are read in the daemon's local zone,
not UTC. Equipment-to-sensor bindings are the `cadence:` key per entry under
`equipment:` in the household fitness config.

## Tests

- A rider with no connected reading for the whole race gets the sensor state,
  not a DNF, and the "stopped pedaling" copy never renders for them.
- A rider who connects, rides, and then drops still idles out normally — this
  must not become a way to avoid ever finishing.
- The `everConnected` suppression still holds for the first seconds of a race
  and releases after that.
