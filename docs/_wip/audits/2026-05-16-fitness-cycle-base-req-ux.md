# Cycle Base-Requirements UX Audit (2026-05-16)

**Question (audit Direction #2 / Issue 3):** When a cycle challenge is paused by a
base-requirement gate, does the user see a comprehensible UI state, or does the
challenge silently freeze?

## Event source

`frontend/src/hooks/fitness/GovernanceEngine.js`

There are **two distinct** base-requirement mechanisms in the cycle tick:

1. **Global pause** — `governance.cycle.paused_by_base_req` (emitted at
   `GovernanceEngine.js:2548`). Triggered when `ctx.baseReqSatisfiedGlobal === false`
   and the challenge is **not** manually triggered (`!active.manualTrigger`). This
   fires when the surrounding household governance phase is not `unlocked` (i.e.
   someone in the house still owes base-requirement work). Effect: the tick `return`s
   early (`L2545-2560`), freezing `initElapsedMs` / `rampElapsedMs` / `phaseProgressMs`.
   It does **not** set `active.waitingForBaseReq`.

2. **Per-rider HR-zone hold** — `governance.cycle.holding_for_base_req`
   (`GovernanceEngine.js:2610`). Triggered when the rider IS pedalling at/above
   `init.minRpm` but their own HR-zone gate (`baseReqSatisfiedForRider`) is unmet at
   init-timeout. Effect: resets `initElapsedMs` and sets `active.waitingForBaseReq = true`.

## UI handlers

`frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx`

The overlay consumes three relevant snapshot fields (snapshot built at
`GovernanceEngine.js:705-736`):

- `waitingForBaseReq` → renders `CycleBaseReqIndicator` (`L437-438`), which shows an
  explicit "reach your zone" affordance.
- `clockPaused` (`L688`: `currentRpm < init.minRpm`) → prefixes the countdown with
  `"Paused — start in …"` / `"Paused — reach target in …"` (`L459`, `L465`).
- `baseReqSatisfiedForRider` → green/red HR-zone state on the indicator.

## Visible effect

| Scenario | clockPaused | waitingForBaseReq | What the user sees |
|----------|-------------|-------------------|--------------------|
| Per-rider hold (pedalling, HR gate unmet) | false | **true** | `CycleBaseReqIndicator` explains the wait. **Comprehensible.** |
| Rider stops pedalling (below minRpm) | **true** | false | "Paused — …" label on the countdown. **Comprehensible.** |
| **Global base-req pause** (household phase ≠ unlocked, rider pedalling) | false | false | Countdown timers **freeze in place with no label or indicator.** Looks stuck/broken. |

## Verdict

**PARTIAL PASS.** The two per-rider conditions are surfaced clearly. The **global**
base-requirement pause (`paused_by_base_req`) is a **silent freeze**: when the rider
is pedalling but the household governance phase is not `unlocked`, the challenge
countdown stops with no overlay explanation, because the global-pause branch neither
sets `waitingForBaseReq` nor affects `clockPaused`. To the rider this is
indistinguishable from a hung UI.

## Follow-up TODO (out of scope for the 2026-05-16 plan)

Surface the global base-req pause in the overlay. Minimal approach: have the
global-pause branch set a snapshot flag (e.g. `pausedByHouseholdBaseReq: true`) and
have `CycleChallengeOverlay` render a "Waiting for the household to warm up" (or
similar) label, mirroring the existing `clockPaused` / `waitingForBaseReq` treatment.
This is a separate scope-out decision and should be filed as its own task — do not fix
it inside the challenge/X-out/exit-destination plan.
