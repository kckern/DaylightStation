# Game Time Budget and the Match Gate

Games on the piano kiosk are bounded two ways. A **budget** caps how many minutes a
child plays in a day. A **gate** asks for a short played challenge before every match.
Both are off unless the household turns them on, and both are designed around one
asymmetry: the kiosk is used by children who cannot debug it, so every failure that is
not the child's fault opens the door rather than closing it.

Related: [piano-games.md](./piano-games.md) for the engines, [exercise-bank.md](./exercise-bank.md)
for the material the gate draws from, [performance-assessment.md](./performance-assessment.md)
for how an attempt is graded.

---

## The gate stack

Three gates stand between the Games tile and a running match, in this order. The first
that blocks wins, and each carries its own copy.

| # | Gate | Opens on | Fails |
|---|---|---|---|
| 1 | School completion | today's schoolwork is `complete` or `no_work_today` | closed |
| 2 | Match gate | a played challenge scores at or above the bar | open on infrastructure; the ladder floor cannot fail on verdict |
| 3 | Budget | minutes remain in the learner's allowance *and* the device's | open |

Gate 3 is two balances checked in series with distinct copy — "you've used your piano
game time for today" for a learner, "this piano has reached its shared game time" for
the device.

**The challenge sits above the budget lock, and that ordering has a visible
consequence.** A child whose budget is already spent still meets the challenge first,
plays it, and only then meets the lock. Because the gate commits the ladder move before
it grants, they bank a climb for a match they never get. This is current behaviour, not
an accident of layering: the challenge is what a match is bought with, so it is asked
before the day's balance is read. It is worth knowing when reading a log where
`gate.passed` is followed by no game.

The curfew window and the Games tile's own school lock are documented in
[README.md](./README.md); neither is part of this feature.

---

## The budget

The **server is the source of truth**. This kiosk reloads many times a day — render
watchdog, page-failure reload, connectivity reload, manual restarts — and a counter held
only in the browser never survives a day. The client ticks; the day file decides.

### Metering

```
open(learnerId, deviceId)   → one session per learner, returning the seconds already spent
tick (1s)                    → drain while a match is mounted and someone is present
settle(cumulativeSeconds)    → every 60s, the running total since open
close(cumulativeSeconds)     → on exit, depletion, or unmount
```

Settle carries the **cumulative total, never a delta**, and the server charges only
newly-crossed whole seconds. Retries are therefore idempotent and a crash costs at most
the unsettled tail.

Two properties keep the meter honest, and both exist because the natural failure here is
**under**-charging:

- **Open returns the server-held cumulative and the client seeds from it.** A client that
  restarted its counter at zero would send settles the server treats as no-ops until it
  climbed back past the pre-reload total, making play after a mid-match reload free.
- **A settle is raced against a 15s timeout.** A hung fetch that never resolves would
  wedge the settle loop shut for the rest of the session, arriving at the same free-time
  outcome through a different door. The timeout does not cancel the request; it stops
  waiting on it.

A session left behind by a crash is **adopted** by the next open within 15 minutes, at
the cumulative it already held; past that it is sealed and a fresh one starts.

### What is metered

Only time inside a mounted match. The gate is unmetered and so is the practice route it
offers — a child struggling at a scale must not lose game minutes to the scale. The
picker, every other mode, and the gate itself never open a session.

### Idle

The meter pauses after a configured idle gap and resumes on the next activity. Activity
is one shared kiosk signal covering MIDI note-ons, `pointerdown`, `keydown`, and the
keep-alive — the same sources the inactivity return watches, published at seconds
granularity so the meter can see both edges. A paused meter charges nothing and counts
nothing down.

Expect measured game time to read lower than "minutes containing at least one event":
idle gaps inside a minute count toward the latter.

### Warning

Below the configured threshold the meter reports `warning` and the host shows a
non-blocking countdown over the game. It never intercepts input — a countdown, not a
wall.

### The day files

```
data/household/history/piano-games/{YYYY-MM-DD}.yml
```

One file per **household study day**, which begins at **4am local**, not midnight — the
same boundary School uses. A UTC day would reset allowances mid-afternoon.

```yaml
schema: piano.game-budget-day/v1
studyDate: 2026-08-27
device:
  totalSeconds: 4200
learners:
  kid_a: { totalSeconds: 2700 }
sessions:
  gbs_abc123:
    learnerId: kid_a
    deviceId: yellow-room-tablet
    openedAt: 2026-08-27T20:00:00.000Z
    lastSettleAt: 2026-08-27T20:41:00.000Z
    cumulativeSeconds: 2460
    closed: false
```

This file **is** the balance, not a copy of one held elsewhere, and it is written by the
domain service rather than a logging transport. A ledger transport swallows write
failures by design; for a balance a swallowed write is a lost debit, and a lost debit is
free game time. So writes are atomic and throw on failure, and a corrupt or wrong-schema
file throws on read rather than quietly loading as a zero balance. A genuinely absent
file is a fresh day — "never written" and "written and unreadable" are different answers.

A session opened before 4am and settled after it is **carried forward** at its existing
high-water mark, so only the post-boundary seconds are charged to the new day, and the
two days land in two files.

### Routes

| Route | Answers |
|---|---|
| `GET /api/v1/piano/users/:userId/game-budget` | the live balance, or `{enabled:false}` |
| `POST /api/v1/piano/users/:userId/game-budget/session` | open or adopt a session |
| `POST …/session/:sessionId/settle` | charge up to `cumulativeSeconds` |
| `POST …/session/:sessionId/close` | seal the session |

Settle and close bodies must be a numeric JSON `{ cumulativeSeconds }`; anything else is
a 400. A settle whose session belongs to a different learner is a 409, and the client
treats that as permanent — it stops the meter and falls open rather than retrying
forever.

---

## The match gate

The gate fires at **every match boundary**, entering a game and playing again alike.
Replays outnumber game entries by roughly 3:2, so a per-entry gate would miss most play.

### It swaps, it does not overlay

The gate renders **in place of the game, at the same route**. The URL does not change;
the game unmounts, the gate mounts, and passing swaps back to a fresh match.

This is not a styling preference. The MIDI note stream is one shared store with no focus
or ownership concept, so every mounted consumer receives every note — a modal over a live
game would let the gate's scale drive the game underneath. Swapping guarantees exactly
one MIDI consumer at a time without adding input routing that every game would inherit.
Because the gate only fires at a boundary, the previous match is already over and there
is no in-progress state to lose.

The rematch is a genuine remount, keyed on a match id, so "play again" cannot keep its
board across a gate that was paid for.

### The ladder

A rung is five axes, each with a hard and an easy value. On repeated failure the gate
eases the first axis that is not already easy; after enough clean passes it restores the
last one eased, retracing the same path in reverse.

| Axis | Hard → easy |
|---|---|
| Direction | `both` → `ascending` |
| Difficulty | `exotic` → `major` |
| Span | 2 octaves → 1 |
| Hands | 2 → 1 |
| Timing | `cued` → `free` |

Timing eases **last**, because it changes what failure means. Cued material is
tempo-aware: a wrong note and a late note both count. Free material is wait-for-correct —
the cursor does not advance until the right key is down, so a child corrects at their own
pace.

The ladder position is stored per child, not per device. A stored value that is corrupt,
truncated, or from an older shape lands the child at the **top** of the ladder rather
than on undefined axes that would degrade into nonsense.

> **Only the timing axis currently changes what a child experiences.** The assessment
> engine consumes `requirement.mode`, `gates.pace.target_bpm` and `rubric` and nothing
> else, so `hands`, `span`, `difficulty` and `direction` never reach it. Material
> selection uses `hands` as a soft preference over an instance's `axes.hands` — and no
> live bank instance carries that axis (741 instances sampled across all 58 seeds: zero),
> so the preference always falls through to the unfiltered list. In practice the ladder is
> **one effective step plus a floor** until either the bank publishes those axes or the
> requirement plumbing carries them into selection.

### Passing

`verdict.passed` is **not** the pass signal off the floor. A non-floor requirement carries
no rubric and no pace gate, so the engine has no thresholds to fail and its verdict is
unconditionally true at any score, including a run where nothing was played. Non-floor
rungs are judged on `score >= passScore`; the floor is judged on `verdict.passed`.

That makes `passScore` the single most load-bearing value in the config, and it fails
silently in both directions — `passScore: 80` (percent for fraction) fails every child
down to the floor while logging ordinary failures, and `""`/`false`/`[]` coerce to 0 and
pass everyone at any score while logging healthy passes. It is therefore **range-checked**,
not merely coerced: anything outside `(0, 1]` becomes the default, and a non-floor
requirement that somehow reaches the run without a usable bar makes the gate fail open
rather than judge wrong.

### The floor cannot fail

The floor is unfailable because of its **rubric**, not its matcher. Wait-for-correct
matchers still record a stray key as a wrong note, and the default generated rubric
requires cleanliness of 1.0 — so one stray key on a completed floor run would fail the
verdict and strand a child at the bottom of the ladder with nowhere lower to go, locked
out of a game they had already earned.

The floor's requirement therefore omits `cleanliness` deliberately and carries no numeric
bar. **This shape is in code, not in config** — the ladder module builds it, and a
`ladder.floor` block in the household YAML is not read:

```js
{ mode: 'free', hands: 1, span: 1, rubric: { criteria: { completeness: 1 } }, passScore: null }
```

Completeness is structurally 1 when a wait-for-correct run completes, so the floor passes
through the ordinary verdict machinery with no special case inside the engine. Wrong
notes at the floor are still written to the attempt evidence — they simply stop being
disqualifying.

### Failure

A completed attempt that missed its bar offers three ways on, and none of them reaches a
match:

| Button | What it does |
|---|---|
| Try again | Re-runs the current rung. After the configured number of failures the rung eases, and the panel says "We made it a little easier" |
| Practice this | Leaves for the ordinary practice route — ungraded, unmetered, ungated |
| Leave | Returns to the game menu |

**Walking away is not failing.** Exiting the run mid-attempt moves nothing. If it did, a
child could press Exit their way down to the unfailable floor without touching a key, and
the gate would become a formality that still logged like a gate.

### Failing open, and the one case that does not

Infrastructure fails **open**. A catalog or instance fetch that 502s during a backend
restart, an attempt that will not build, a material configuration nothing can act on —
all of these start the match the child earned and log `gate.unavailable`. Failing closed
there would block earned games on an unrelated backend blip, about which the child can do
nothing.

**"No player chosen" does not fail open.** It is permanent, known, and fixed by one tap,
so opening on it would make selecting the Guest profile a reliable one-tap bypass of the
whole gate. It renders a non-granting "choose a player first" panel with a way out, and
logs `gate.blocked`.

There is also always a Leave button beside the run itself, so a state neither the run nor
the gate anticipated cannot strand a child on a kiosk with no browser chrome.

### Material

The gate asks for material through a provider seam that names two kinds from the start:

- **`exercise`** — an instance from the exercise bank, chosen from the configured
  collections among seeds that support the rung's mode. Up to three seeds are tried
  before the gate gives up, because a seed can sit in the right collection and still have
  nothing this rung can run.
- **`score`** — a passage from a compiled score. Accepted at the seam and declined in
  rendering: there is no wrong-note ghost for a score on the run surface yet, so a gate
  that served one would put a child in front of a bare stave. Each declined entry is
  logged as `gate.material-skipped` with its own reason code, so it stays distinguishable
  from a typo'd kind.

Score-passage parity is the pending work: the assessment side already unifies, the
notation side does not, because exercises engrave through abcjs and sheet music through
OSMD and the ghost measures abcjs geometry directly.

---

## Where the gate is not

**The office screen is ungated and unmetered by construction.** The screen-framework
`piano` widget mounts games directly, with no gate provider and no meter, so nothing
there asks for a challenge or spends a budget. It does enforce the school lock. The
budget and the gate are kiosk-surface features.

**Battle Stadium's rematch is not gated.** Eight of the nine registered games route
"play again" through the shared match-boundary context and so meet the gate on every
restart. Battle Stadium restarts through the shared gaming runtime, which has no gate
consumer: its entry is gated, its rematch is not. Its picker tile is disabled (preview
status), so it is reachable only by deep link. This is a known limit of the boundary
contract, not an outstanding defect.

**Device identity is per-tablet.** The device-wide cap and every per-device log query key
off the browser's captured kiosk identity, taken from the launch URL and persisted — not
a shared constant. A literal could not tell a wall tablet from a dev laptop: both would
stamp the same id, every per-device query would merge them, and the device cap would be
one bucket that whichever kiosk was used first spent for both. A client with no captured
identity stays null rather than guessing.

---

## Configuration

Both blocks live in the household piano config and both default to off. Household app
config is cached in memory at startup, so a change needs a reload or a dev-server restart
before it takes effect.

```yaml
gameLimit:
  enabled: false            # off by default, like curfew
  source: fixed             # fixed | earned | economy
  dailyMinutes: 45
  deviceDailyMinutes: 120
  warnAtMinutes: 5
  idleAfterSeconds: 90
  users:
    user_1: { dailyMinutes: 30 }
    user_2: { dailyMinutes: 45 }

gameGate:
  enabled: false            # the household default, for every child
  passScore: 0.80
  retriesBeforeDegrade: 3
  climbAfterCleanPasses: 3
  material:
    - kind: exercise
      collections: [scales, arpeggios, intervals, chords]
    - kind: score
      source: current-study-piece
      measures: 4
  users:                    # optional per-child overrides, merged key-by-key
    kckern:
      enabled: true
      games: [chess]        # optional allowlist; absent means every game
```

The top level is the default for everybody. `users.{learnerId}` overrides it
key-by-key for one child, and `games` narrows an enabled gate to named game ids.
Both are absent by default, which reads as "everyone, everywhere" — so a block
without them behaves exactly as an unscoped one. A child with no entry never
sees a gate the household has not switched on for them, which is what makes a
rollout to one child on one game possible.

The scoping is decided by the host, not the gate: `Games.jsx` asks
`gateAppliesTo` before it mounts anything, so a gate that does not apply is
never constructed. The gate component itself never reads `enabled` — a
component that opened itself because a key was absent would be a gate that
quietly stops existing.

Every key above is read, with one exception noted below. **Keys the design named that are
deliberately absent from that example, because setting them today does nothing:**

| Key | State |
|---|---|
| `gameGate.every` (`match` \| `entry` \| `interval`) | resolved and then **never consumed** — the gate always fires at every match boundary. Setting `entry` to stop gating replays changes nothing. |
| `gameGate.metered` | resolved and then **never consumed.** The gate is unmetered because nothing meters it — the budget session is closed while a gate stands (`active` is false whenever a gate is pending), not because this key says so. Setting `metered: true` does not make the gate drain the budget. |
| `gameGate.ladder.axes` | **not read.** The five axes and their order live in the ladder module. |
| `gameGate.ladder.floor` | **not read.** The floor requirement is built in code (see "The floor cannot fail"). Setting `floor.passScore: 0.5` changes nothing. |
| `gameLimit.source` | present in the sample and **not read** by any budget code path. `fixed` is the only implemented behaviour; see the note on the source vocabulary below. |

None of these logs anything when set, because the config resolver returns an explicit
object literal and simply drops the key. A parent who sets one, restarts the kiosk, and
sees no change gets no explanation — so they are called out here rather than presented as
working configuration.

Both blocks reach the frontend as **whole-node passthrough**. The client resolver drops
any key it does not name, and a gate whose config never arrives is a gate that is
permanently off while the YAML says on. That is the same mechanism as the three rows
above: the difference is only whether something downstream reads the key once it lands.

`dailyMinutes` and `deviceDailyMinutes` must be positive finite numbers and the household
timezone must be set. A missing or malformed value is logged as `budget.config-invalid`
and the feature falls open — unmetered play, never a lockout — because the alternative,
`undefined × 60 = NaN` compared against zero, granted unlimited play in silence.

The budget source is a vocabulary, not yet a switch. No budget code path reads
`gameLimit.source`; `fixed` is what happens regardless of what the key says. `earned`
(minutes minted by passed gates, scaled by score) and `economy` (household coins through
the existing hold-and-settle session) are named so the vocabulary cannot drift when one of
them is built.

---

## Observability

Three layers with different lifetimes: the log store answers "what is happening now" and
expires in seven days, the day files answer "what happened in October", and the existing
per-user attempt evidence holds what was actually played.

**Every event on both sides carries `learnerId`, `deviceId`, `studyDate`, and
`sessionId`** — client and server, gate and budget alike. Gate events add `material`,
`rung`, `mode` and `attemptId` once an attempt has resolved. So an afternoon reconstructs
from a single query, `"budget.warning" AND data.deviceId:<tablet>` answers "which tablet
burned the shared cap" without a join, and `studyDate` keeps a late-evening session whole
across the 4am boundary that a calendar-date filter would cut in half.

`gate.presented` is emitted before anything can decline, precisely so the runs worth
reconstructing — the fail-open ones — are not the ones missing an anchor.

### `piano-game-gate`

| Event | Level | Fires when |
|---|---|---|
| `gate.presented` | info | the gate mounts, before any decision |
| `gate.attempt` | info | material resolved; the run is about to take the screen |
| `gate.passed` | info | a genuine pass, with its score |
| `gate.failed` | info | a completed attempt that missed its bar |
| `gate.rung-changed` | info | the ladder moved, with `direction`, `from` and `rung` |
| `gate.floor-reached` | info | the ladder arrived at the floor — once per arrival |
| `gate.practice-detour` | info | the child left for the practice route |
| `gate.abandoned` | info | the child walked away; the ladder did not move |
| `gate.unavailable` | warn | infrastructure failed and the gate opened anyway |
| `gate.blocked` | warn | no player is chosen; the gate refuses without granting |
| `gate.material-skipped` | info | a configured material entry was declined, with its reason |

`gate.rung-changed` and `gate.floor-reached` are the pair that says whether the ladder is
calibrated: a child who reaches the floor every time is being asked for material above
their level. The retry-count default is tuned from these, which is why the rung change
carries both ends of the move — a line with only the destination cannot say which axis
moved.

### `piano-game-budget`

| Event | Level | Side | Fires when |
|---|---|---|---|
| `budget.opened` | info | server | a session opened or was adopted |
| `budget.settled` | debug | server / client | a settle landed |
| `budget.depleted` | info | server / client | the learner's allowance reached zero |
| `budget.device-depleted` | info | server / client | the device's shared cap reached zero |
| `budget.day-rollover` | info | server | a session was carried across the 4am boundary |
| `budget.settle-failed` | error / warn | server / client | a charge did not land |
| `budget.learner-mismatch` | error / warn | server / client | a session id arrived with the wrong learner |
| `budget.config-invalid` | error | server | timezone or a minutes value is missing or malformed |
| `budget.idle-paused` | info | client | the child stopped being present |
| `budget.idle-resumed` | info | client | they came back |
| `budget.warning` | info | client | the balance crossed the warning threshold |
| `budget.open-failed` | warn | client | opening a session threw; play continues unmetered |
| `budget.disabled` | debug | client | the feature is off — the ordinary state, not a failure |
| `budget.seed-invalid` | warn | client | open answered without a usable cumulative to seed from |

`budget.settle-failed` is the alerting signal: a settle that never lands is uncharged
play. `budget.disabled` exists so that turning the feature off does not fill warn-level
triage with a failure that never happened.

`budget.warning` is an **edge, not a state**. The meter recomputes the warning condition
every second, so a per-state line would write one identical entry per second for the
whole window — 300 lines per child per depletion with the shipped defaults — and drown
the one that carries news.

It re-arms two ways. Within a session, if the balance climbs back above the threshold — a
settle can return a larger `secondsLeft` than the local countdown held. And **at every
match boundary**, because the meter is suppressed while the gate is up: with both features
on, the meter's session tears down and reopens around each challenge, so a child playing
five short matches inside one warning window gets five lines, not one. Harmless in volume
(the window is minutes, not hours), but it is a per-match edge, not a per-window one.

`budget.day-rollover` has no durable home of its own. The boundary is recorded by *which
file* a charge lands in, which is why the day files are the thing worth asserting: two
settles across 4am produce two files.

---

## Where things live

| Concern | Path |
|---|---|
| The gate host, config resolution, ladder persistence | `frontend/src/modules/Piano/PianoKiosk/modes/Games/GameGate.jsx` |
| The ladder (pure) | `frontend/src/modules/Piano/PianoKiosk/modes/Games/gameGateLadder.js` |
| Material seam and selection (pure) | `frontend/src/modules/Piano/PianoKiosk/modes/Games/gateMaterial.js` |
| Match-boundary seam between a game and its host | `frontend/src/modules/Piano/PianoKiosk/modes/Games/MatchGateContext.js` · `game-platform/host/useMatchRematch.js` |
| Gate stack mounting, budget locks, warning banner | `frontend/src/modules/Piano/PianoKiosk/modes/Games/Games.jsx` |
| The client meter | `frontend/src/modules/Piano/PianoKiosk/useGameBudgetMeter.js` |
| The shared activity signal | `frontend/src/modules/Piano/PianoKiosk/activitySignal.js` |
| Kiosk device identity | `frontend/src/modules/Piano/PianoKiosk/kioskDeviceIdentity.js` |
| Config defaults and projection | `frontend/src/modules/Piano/PianoKiosk/pianoConfigModel.js` |
| Client study day (the shared 4am boundary) | `frontend/src/modules/Piano/PianoKiosk/clientStudyDate.js` |
| Budget domain math | `backend/src/2_domains/piano/gameBudget.mjs` |
| Budget orchestration | `backend/src/3_applications/piano/PianoGameBudgetService.mjs` |
| Day files | `backend/src/1_adapters/persistence/yaml/YamlPianoGameBudgetStore.mjs` · `data/household/history/piano-games/` |
| Routes | `backend/src/4_api/v1/routers/piano.mjs` |
| Event coverage spec | `frontend/src/modules/Piano/PianoKiosk/modes/Games/gateEvents.test.jsx` |

---

## Open questions

1. **Retry count before the rung drops.** The default matters: too low and the ladder
   collapses to the floor on one normal bad attempt, too high and a stuck child grinds.
   `gate.rung-changed` and `gate.floor-reached` are instrumented precisely so this is
   tuned against real data rather than guessed.
2. **Whether the device cap should exempt an adult profile.** A grown-up sitting down to
   play should probably not consume the children's device allowance.
3. **Whether a passed gate should bank credit for more than one match**, so a strong run
   buys a short streak rather than exactly one game.
