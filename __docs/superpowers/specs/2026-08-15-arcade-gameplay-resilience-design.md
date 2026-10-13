# Arcade Gameplay Resilience — Design

**Date:** 2026-08-15
**Status:** Approved
**Scope:** The Fitness arcade emulator gameplay session only. The emergency-shutdown
subsystem (fingerprint intent-blindness, Cancel/commit split-brain) is explicitly
OUT of scope and gets its own spec.

---

## Problem

In one evening the arcade produced four defects that share a single root cause:

| Defect | What we do at boot | What EmulatorJS does |
|---|---|---|
| Gamepad ignored | (nothing — relied on EJS) | drops the `connected` event for an already-connected pad; `gamepadSelection` stays empty, so `gamepadEvent` discards every input |
| Volume too loud | `setVolume(persisted)` at `boot.ready` | re-asserts `config.volume` (our `EJS_volume: 0.5`) later in its start chain, clobbering ours |
| `audioContext` always null | probe `Module.AL.currentCtx.ctx.state` at `boot.ready` | core audio glue does not exist yet — 24/24 samples read `null` |
| Silent failure | log `gap: true` at `info` | nothing escalates; hundreds of gap samples told nobody |

**Root cause:** there is no barrier marking "EmulatorJS has finished starting", and
nothing verifies that configuration we asserted actually stuck. We fire config at
`boot.ready` and hope.

**The barrier exists and we were not using it.** EJS sets `this.started = true` at the
very end of its start chain — after the volume re-assert and after `setupSettingsMenu()`
(which creates `gamepadSelection`):

```js
…updateGamepadLabels(), this.muted||this.setVolume(this.volume), …
this.game.appendChild(this.canvas), this.handleResize(),
this.started = !0, this.paused = !1, …
```

`gamepadEvent` itself guards on it (`if(!this.started)return`). The hotfix shipped as
`9b9709e25` works only by timing luck: had `claimGamepads()` run before
`setupSettingsMenu()`, that function resets `gamepadSelection = []` and would have
silently wiped the claim.

## Goals

1. Every boot deterministically lands in the intended state, verified by read-back.
2. Faults that cost nothing to fix are fixed silently; faults that cost progress ask first.
3. An EmulatorJS upgrade that breaks our assumptions fails **loudly**, not silently.
4. A degraded session is visible on the kiosk and reaches an adult without a kid reporting it.

## Non-goals

- Rewriting the EJS integration behind a full adapter (YAGNI; revisit on a version bump).
- Any change to save/state/cheat/WRAM paths, which are working.
- The emergency-shutdown subsystem.

---

## Architecture

Three new pure, injectable units; `EmulatorConsole` shrinks to orchestration.

```
EmulatorConsole.jsx ── orchestrates only
   ├── core/ejsContract.js       assertEjsContract(instance) → { ok, missing[], version }
   ├── core/bootSettle.js        settleBoot({ instance, engine, desired, deadlineMs }) → report
   ├── core/sessionSupervisor.js createSessionSupervisor({ probes, policy }) → { observe, getState, onFault }
   └── input/ControllerIndicator.jsx  renders supervisor state (replaces InputActivityLED)
```

Each unit is testable without a browser: all EJS access is via injected probes.

### Boot sequence

1. `engine.boot()` resolves (`boot.ready`) — loaded, **not started**.
2. **Await `instance.started === true`**, polled ~50ms with a 5s deadline. Timeout ⇒
   `contract-broken` fault (EJS never started).
3. `assertEjsContract(instance)` — see contract below. Missing field ⇒ `logger.error` +
   fault, because that means an upgrade silently broke us.
4. `settleBoot()` — apply desired state, then read each back:

   | Setting | Apply | Verify |
   |---|---|---|
   | Gamepad slots | claim pads into `gamepadSelection` | `gamepadSelection.includes(id_index)` |
   | Volume | `engine.setVolume(persisted)` | `instance.volume === persisted` |
   | Input tap | wrap `simulateInput` | `simulateInput.__origSimulateInput` present |

   Mismatch ⇒ re-assert once, then emit `emulator.settle.reasserted { setting, expected, actual }`.
   **This event is the early-warning signal that did not exist.**
5. Hand verified state to the supervisor for the session.

### Supporting changes

- `EJS_volume` receives the **persisted** level at load time (`loadEmulatorJS.js:66`)
  so EJS's own re-assert lands on the correct value. Settle still verifies (belt and braces).
- The `audioContext` probe moves behind the barrier with a corrected path. If it still
  cannot read a real state, **delete the field** — a value wrong 24/24 times is worse
  than no value, because it trains readers to ignore a real audio failure.

---

## The EJS contract

`ejsContract.js` is the single declaration of every EmulatorJS internal we depend on.
Today these reach-ins are undocumented and scattered across two files.

```js
export const EJS_CONTRACT = [
  { path: 'started',                          type: 'boolean' },
  { path: 'volume',                           type: 'number'  },
  { path: 'gamepadSelection',                 type: 'array'   },
  { path: 'gamepad.gamepads',                 type: 'array'   },
  { path: 'gameManager.functions.simulateInput', type: 'function' },
  { path: 'setVolume',                        type: 'function' },
];
```

`assertEjsContract(instance)` returns `{ ok, missing: [path], version }`. Version comes
from the engine's `version.json` (currently 4.2.3), logged at boot for provenance —
a vendored dependency is invisible to `git log` and `npm audit`.

---

## Fault taxonomy and tiered recovery

| Fault | Detection | Tier | Action |
|---|---|---|---|
| `input-gap` | ≥3 consecutive 5s windows with `pings>0 && consumes==0` | safe | re-claim pads + verify, silently |
| `audio-suspended` | context state `suspended` | safe | `ctx.resume()` |
| `contract-broken` | missing EJS internal, or `started` never true | risky | fault state + alert |
| `frozen` | frame counter static ≥5s while unpaused | risky | prompt restart |
| `no-pad` | zero pads connected | info | keyboard hint (not a fault) |

**Safe** faults auto-heal with no UI. **Risky** faults never auto-act — they surface a
kid-readable prompt with one large button.

Auto-heal is bounded: **max 3 attempts per session per fault, with backoff**, so a
flapping pad cannot thrash. Exhausting attempts promotes the fault to risky. Every
attempt is logged whether or not it succeeds.

`no-pad` is deliberately not a fault: the keyboard mapping always works, and treating a
missing pad as an error would cry wolf.

---

## Indicator

Replaces `InputActivityLED`. Three semantic states, so failure is something that
**appears** rather than something that is missing — the flaw that let this bug hide.

```
HEALTHY      ● connected      ●҉ activity
NO PAD       ○ no pad         ·  keyboard works
HEALING      ◐ reconnecting…
FAULT        ▲ INPUT NOT REACHING GAME   [ Fix ]
```

- dot 1 = pad connected (steady while present)
- dot 2 = input activity (flickers on input the **core consumed**)
- fault = whole indicator turns amber/red with a label and a Fix action

The browser-vs-core differential is preserved — it is what caught this bug — but it now
drives the fault state instead of being rendered as two dots that always agree.

Note the two counters are **not** directly comparable: `browserPings` counts deduped
signature changes, while EJS emits multiple `simulateInput` calls per event (two per
axis change). `gap` must stay a directional heuristic (`pings>0 && consumes==0`), never a ratio.

---

## Telemetry

| Event | Level | Purpose |
|---|---|---|
| `emulator.settle.reasserted` | warn | EJS drift — config did not stick |
| `emulator.contract.broken` | error | upgrade guard tripped |
| `emulator.fault.detected` | error | with evidence payload |
| `emulator.fault.healed` | info | with attempt count |
| `emulator.fault.unrecovered` | error | triggers push |
| `emulator.boot.provenance` | info | EJS version at boot |

`input.summary` gains `gamepadSelection` contents and pad count **when `gap:true`** —
the exact state that would have named this root cause in seconds instead of requiring
disassembly of a minified bundle. Log state at the boundary, not just symptoms.

**Alerting:** rate-limited push to an adult on `fault.unrecovered` only (never on
`healed`), so a self-healed blip stays silent and a genuinely broken session does not
depend on a child reporting it.

---

## Testing

Three layers, because the outage happened while 375 tests passed — all of them mock the
EJS instance, so the contract that broke was asserted nowhere.

1. **Unit** (vitest, no browser): `ejsContract` (missing-field detection), `bootSettle`
   (verify/re-assert/timeout paths), `sessionSupervisor` (fault classification, heal
   bounding, state transitions). All dependencies injected.
2. **Runtime assertion** (production): the contract check + settle verification run on
   every real boot, so EJS drift fails loudly in the garage even if CI never sees it.
3. **Headless smoke** (Playwright): override `navigator.getGamepads` via `addInitScript`
   so a real EJS boot receives a synthetic pad; assert `simulateInput` fires and
   `gap:false`. This is the only layer that would have caught tonight's bug pre-deploy.

---

## Risks

- **Barrier never trips.** If a future EJS stops setting `started`, boot stalls at the
  deadline. Mitigated by the bounded 5s timeout falling through to a `contract-broken`
  fault rather than hanging — degrade, never brick.
- **Auto-heal masking a real hardware fault.** Mitigated by the 3-attempt bound and by
  logging every heal, so a pad healing repeatedly is visible in telemetry.
- **Indicator churn.** The fault state must debounce (≥3 windows) so a momentary blip
  does not flash a red alarm at a child mid-game.
