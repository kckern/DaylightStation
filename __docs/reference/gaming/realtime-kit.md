# Real-time Game Kit

The shared machinery for games that run a live loop: Skyline Glider and the Cycle
Race (Fitness) and the Piano Side Scroller. It is plumbing only. Each game keeps
its own rules, state shape, phases and log names.

Two layers, matching the gaming capability's usual split:

| Layer | Path | Rule |
|---|---|---|
| Portable | `__capabilities/gaming/portable/realtime/` | Pure `.mjs`. No DOM, no I/O, no `Math.random`. |
| Browser | `__capabilities/gaming/browser/platform/realtime/` | rAF, `window` and logging glue. |

Both barrels (`index.mjs`, `index.js`) are registered public entries in
`scripts/owner-entry-policy.mjs`. Import from the barrel, never a sibling file.

## Tiers and the promotion rule

Placement is decided by how many current games share a thing with the same meaning.

- **Tier 1, the run kit** (all three games): step runner, frame driver, tick
  fraction and lerp, effect dispatcher, run roles, the game-achievement
  announcement. This is what exists today.
- **Tier 2, scroller geometry** (Skyline and the Side Scroller): boxes, overlap
  queries with edge modes, swept hits. Built; see "Scroller geometry" below. It is deliberately geometry
  only; see "What was left out" below.
- **Tier 3, stays in each game:** Skyline's flight dynamics, stall, terrain,
  missile homing, course YAML and checkpoint repository; the Side Scroller's
  jump and duck arcs, note targets and level evaluation; the race's laps, oval
  model, ghosts and standings.

**Promotion rule:** when a fourth game repeats a Tier 3 concept with the same
meaning, it moves down a tier in that game's change, not before. Two games that
only look alike do not qualify (see below).

## Scroller geometry

`portable/realtime/scroller/geometry.mjs`, re-exported from the barrel. Axis-aligned
boxes, y down; pure, no clocks or randomness.

```js
box(x0, x1, y0, y1)                                   // frozen { x0, x1, y0, y1 }
overlaps(a, b, { x = 'open', y = 'open' } = {})       // per-axis edge mode
sweepHits(boxes, sweep, { x = 'closed', y = 'closed', include = () => true } = {})
  // -> [{ index, at }] in input order; at = max(sweep.x0, box.x0)
```

Edge mode is per axis: `'open'` means boxes that merely touch do not overlap,
`'closed'` means they do. Each caller states the mode its game needs:

| Caller | x | y |
|--------|---|---|
| Piano Side Scroller collisions and pellet sweep | open | open |
| Skyline craft contact | closed | open |
| Skyline point hits, blasts and sweeps | closed | closed |

`sweepHits` does not rank. Each game orders the results itself: Skyline takes the
earliest entry, with entities winning ties over terrain; the Side Scroller takes
the leftmost block edge (`obstacles[index].x`), first in input order on ties.

`sweepHits` and `overlaps` do not validate inputs: a NaN bound makes every
comparison false, so that box is silently skipped (no throw, no hit), and a NaN
in the sweep itself skips every box. For Skyline, entity bounds and aim come
from a validated course (`courseModel` rejects a non-finite `at_s` and a
`width_s` or `height` that is not > 0); sweep endpoints come from runtime shot
state, which the kit's stepping keeps finite.

## Portable API (`portable/realtime`)

```js
import { planSteps, dueAnchoredSteps, advance, RUN_ROLES, projectRunRole, tickFraction }
  from '__capabilities/gaming/portable/realtime/index.mjs';
```

| Export | Signature | Contract |
|---|---|---|
| `planSteps` | `(elapsedS, { stepS, remainder = 'partial', carryS = 0 }) -> { dts, carryS }` | Splits elapsed seconds into fixed slices. `partial`: whole steps then one short step, nothing carried. `carry`: whole steps only; the remainder returns as `carryS` and is fed back next frame. |
| `dueAnchoredSteps` | `({ sinceAnchor, stepsTaken, step, maxSteps = Infinity }) -> { due, run }` | Steps owed against a fixed anchor, in any unit. A null `sinceAnchor` owes one step. `run` is `due` capped at `maxSteps`; the caller logs the gap when `due > run`. |
| `advance` | `(state, input, elapsedS, { step, stepS, remainder, carryS, oncePerFrame = ['actions'] }) -> { state, carryS, steps }` | The options object is required (no default). Folds the game's `step(state, input, dt)` over the plan. Keys in `oncePerFrame` are cleared from the input after the first step, so a press fires once per frame, not once per sub-step. |
| `tickFraction` | `(nowMs, tickAtMs, tickMs) -> 0..1` | Progress from a tick toward the next; saturates at 1 when the tick is overdue so a lerped value freezes on the latest data. A non-positive `tickMs` returns 1. |
| `RUN_ROLES` | frozen array | `ready, countdown, playing, paused, result, exiting`. |
| `projectRunRole` | `(phase, mapping = {}) -> role` | Maps a game-owned phase to a run role: the mapping entry, else the lower-cased phase, else `ready` when that is not a role. |

The piano host's `gameLifecycle.js` re-exports `RUN_ROLES` and `projectRunRole`
as `HOST_PHASES` and `projectHostPhase`; there is one vocabulary.

## Browser API (`browser/platform/realtime`)

```js
import { createFrameDriver, createTickLerp, createEffectDispatcher,
  GAME_ACHIEVEMENT_RECORDED_EVENT, announceGameAchievement }
  from '__capabilities/gaming/browser/platform/realtime/index.js';
```

| Export | Signature | Contract |
|---|---|---|
| `createFrameDriver` | `({ onFrame, maxFrameS = Infinity, now, raf, caf, onError }) -> { start, wake, stop, running }` | One rAF loop. `onFrame({ nowMs, rawElapsedS, elapsedS })` gets `elapsedS` capped at `maxFrameS`, so a backgrounded tab cannot produce one giant step. Returning `false` parks the loop; `wake()` re-arms it. A throwing `onFrame` is isolated, reported to `onError(err)`, and the loop continues; a throwing `onError` is swallowed. `raf`/`caf` resolve to the globals at call time; pass `null` for a no-rAF mode where `start`/`wake` do nothing. |
| `createTickLerp` | `({ intervalMs = 1000, now }) -> { onTick(payload), subscribe(cb), stop(), running }` | One linear motion clock for data that arrives at ~1 Hz. `onTick` resets the fraction to 0 and re-arms; subscribers get `cb(fraction, payload)` each frame, are isolated from each other, and the loop parks at 1. With no rAF, `onTick` emits 1 at once. Consumers write to the DOM imperatively, so React does not re-render per frame. |
| `createEffectDispatcher` | `({ table, playCue, log, logNames, correlation, skippedReason }) -> { dispatch(events, extra) }` | Maps event types to ordered effects. `table[type](event, extra)` returns `[{ id, cue }]` or `[{ id, visual }]`. A cue effect logs `logNames.executed` when `playCue(cue)` returns truthy, otherwise `logNames.skipped` with a reason. A throwing effect logs `logNames.failed` and the rest still run. `logNames.event(event)` names an optional per-event line. The per-event line (`logNames.event`) carries `correlation()`, `extra` and `event.data`. The per-effect `executed`/`skipped`/`failed` lines carry `correlation()`, `extra`, `eventType` and `effectId`, plus `reason` on skipped and `error` on failed. Defaults: `log = null`, `logNames = {}`, `correlation = () => ({})`, `skippedReason = () => 'audio-unavailable'`; with no `log` or no name, nothing is logged. |
| `GAME_ACHIEVEMENT_RECORDED_EVENT` | `'game-achievement-recorded'` | The window event name. |
| `announceGameAchievement` | `(source, detail = {})` | Dispatches the event with `{ source, ...detail }`. A no-op without `window`. |

## How each game uses it

- **Skyline Glider.** `stepFlight` sub-steps through `advance` (1/60 s,
  `partial`). The flight loop is a `createFrameDriver` with a 0.1 s frame cap;
  a throwing frame logs `skyline_glider.frame.error` and flight continues. Flight
  effects go through `createEffectDispatcher`, and the existing
  `skyline_glider.effect.executed/skipped/failed` names and fields are unchanged,
  because the log store is queried by them. See [Skyline Glider](../fitness/skyline-glider.md).
- **Cycle Race.** Its 1 s tick catches up with `dueAnchoredSteps` against the
  wall-clock anchor, capped, with the gap logged as `cycle_game.tick_catchup`
  (absent in normal play). Its motion clock is a `createTickLerp`.
- **Piano Side Scroller.** Fixed 1/60 s steps with `carry`, on a simulated clock.
  See below.

## The piano simulated clock

The Side Scroller's engine takes timestamps as `now` in milliseconds. The hook
passes a **simulated** time, `simMs`, that advances only by whole fixed steps and
only while the run is `PLAYING`. Duck start and auto-release, damage
invincibility, the shooting pose and obstacle spawn spacing all read it, so
pausing, a hidden tab or a slow frame never leaves a timer half-run. Played
actions (jump, duck, shoot) still apply the instant their chord matches, stamped
with the current `simMs`: the kit adds no input latency. Duck stays level-held.

A fail stops the frame's remaining steps and pins the clock to the failing step.
Outcomes (fail, level advance) are consumed exactly once: applied right after
`setWorld`, or at the render's commit when React defers the updater, never a frame
late and never twice. The details and the tests that pin them are in
[Piano games, Clock and stepping](../piano/piano-games.md#clock-and-stepping);
this page does not repeat them.

## The ceremony ordering rule

**An economy ceremony (gem or coin) never shows during a live run (run role
`countdown` or `playing`). It may show over the result (role `result`) — fitness
shows the gem ceremony over the race/flight result as shipped. The piano is
stricter by construction: its ceremony renders only on the Games picker, so it
never covers a game or its result screen, and a ceremony interrupted by opening
a game shows again on return.**

A game announces **after its record is saved**: `announceGameAchievement` runs
once the cycle race or Skyline flight has been persisted, so a Gem Board read
sees the new evidence. The gem ceremony then looks (fresh) shortly after.

On the piano kiosk the ceremony runs in the Games mode shell:

1. The queue lives in a hook **above the routes**, so opening a game unmounts the
   card but not the queue. A ceremony interrupted by opening a game shows again
   on return.
2. Looking is enabled only on the picker route, and the card renders only on the
   picker. A gem is never shown over a live game.
3. Arriving at the picker counts as "a game just ended", so the hook does not
   learn silently on mount. The picker looks with a fresh read (`fresh: true`)
   each time it is shown, so a gem won seconds ago is not missed to the
   server's cached board.
4. The piano's contained ceremony intentionally covers the whole piano stage
   (header included) as a celebration scrim. This is a controller ruling, not
   an oversight.

Economy details (snapshot, what counts as a new gem, events) are in
[Household economy](../economy/economy.md#gem-board).

## HUD set

`__capabilities/gaming/browser/platform/ui/hud/` (barrel `index.js`, styles
`hud.scss`) holds the shared HUD. Components own structure and behaviour only;
every colour comes from `--game-hud-*` set by the host game.

| Component | Props |
|---|---|
| `CountdownOverlay` | `value` (renders nothing when null/undefined), `className` |
| `LifeMeter` | `current`, `maximum`, `dangerAt = 0.25` (fraction of maximum), `variant = 'notches'` or `'glyphs'`, `glyph = '♥'`, `emptyGlyph = '♡'`, `label = 'Health'`, `ariaLabel`, `className` |
| `ProgressMeter` | `value`, `maximum = 100`, `label`, `className` |
| `MomentBanner` | `text` or `title` + `subtitle`, `momentKey`, `className` |

- `LifeMeter` notches: `role="meter"` with `aria-valuenow` (partial health rounds up); notches at or below `dangerAt` take the danger colour. Glyphs: `role="img"` with `ariaLabel`; zero shows the empty glyph.
- `MomentBanner` is `role="status"`. Changing `momentKey` replaces the node and replays the entrance animation (disabled under reduced motion). It renders nothing without `text` or `title`.

**Custom properties:** `--game-hud-ink`, `--game-hud-edge`, `--game-hud-live`,
`--game-hud-danger`, `--game-hud-track`, `--game-hud-banner-ink`,
`--game-hud-banner-bg`, `--game-hud-shadow`. Unset, they fall back to
`currentcolor` / transparent / no shadow.

**Mapping per surface.** The piano maps them to `--pg-*` in
`game-platform/chrome/gameChrome.scss` and re-exports the components from its
chrome. Skyline sets a palette block on `.skyline-glider` (`--game-hud-hearts`,
banner ink and background) and uses `LifeMeter` glyphs for hearts and
`MomentBanner` for its checkpoint/cue banner.

**Choosing a meter.** Segmented (`LifeMeter` notches) for a count of hits the
player can take; continuous (`ProgressMeter`) for a trend such as time or
progress.

**Specificity.** A surface with stronger local styles may out-specify
`.game-hud-moment` on purpose: Skyline's `.skyline-glider .skyline-glider__checkpoint-banner`
positions and sizes its banner this way, keeping the kit's markup and
accessibility.

## What was left out, and why

The design was narrowed twice after review. Each cut failed the test "same
meaning in two games":

- **Checkpoint store.** The race keeps JSON with a 30-minute age; Skyline keeps
  identity and schema validation with no age.
- **Seeded random.** Only the Side Scroller has real-time randomness.
- **Contact roles, damage tables, entity hit points.** The Side Scroller has one
  role (everything hurts). Skyline stores damage taken, the Side Scroller hp
  remaining; converting either would change state shapes that tests assert.
- **Scroll policy, projectile lifecycle and presence windows** each had one real user or meant different things per game (spec, Revision 2); Tier 2 is geometry only.
- **Terrain profiles** stay in Skyline: one user.

Design record: `ops:docs/superpowers/specs/2026-11-05-realtime-game-kit-design.md`.
