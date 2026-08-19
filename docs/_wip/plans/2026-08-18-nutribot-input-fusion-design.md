# Nutribot input fusion — design

**Date:** 2026-08-18
**Status:** design, awaiting review
**Supersedes nothing.** Extends [`docs/reference/nutrition/README.md`](../../reference/nutrition/README.md),
whose "Implementation status" table is stale in one row — see [What already exists](#what-already-exists).

---

## The problem, from a real failure

On 2026-08-18 at 12:31 PM someone weighed food and scanned two cards. The log store has the
whole thing:

| Time | Event | Outcome |
|---|---|---|
| 12:31:45 | scale settles at 639 g | posted to Telegram, `stage: density` |
| 12:31:47.493 | scan `dl:140` (Mixed, 1.4 kcal/g) | **swallowed** |
| 12:31:51.857 | scan `ct:60` (Tupperware, 60 g tare) | **swallowed** |
| 12:31:57 | scale settles at 473 g | entry edited to 473 g |
| after | — | stranded at `stage: density`, no calories |

Both scans were read correctly by the scanner and both were discarded. Net stayed equal to
gross at every step, so the Tupperware's 60 g is still counted as food, and no density was
ever applied.

Two independent causes stacked:

1. **Nutriscan is disabled at every boot.** `validateScanConfig` throws
   `MALFORMED_DENSITY_LEVEL: Density level 1 is missing macros`, so `applyScanToComposition`
   stays `null` (`app.mjs`), and `routeNutribotScan` returns `{action:'swallow', reason:'nutriscan-disabled'}`
   for every `ct:`/`dl:`/`rs:` code. The `density_levels` block in `scales.yml` overrides the
   code defaults "purely to attach `icon:`" and drops `macros`, which the validator requires.
2. **The refusal is silent by construction.** In `scanDispatch.mjs`, `handleNutrition` only
   calls `refreshPrompt(scaleId, notice)` on the `nutriscan` branch. The `swallow` branch
   returns without it — so the ACK that exists to prevent silent failure cannot fire on the
   one path where nothing happened at all.

A third defect made the incident nearly unreadable: `nutriscanWarned` warns once per reason
per process and downgrades every repeat to `debug`, which is never shipped. That is why
`dl:140` appears in the log store and `ct:60`'s refusal does not exist anywhere.

---

## What already exists

Most of the coordination model is built and tested. The README's status table says
"Bridge integration: not started", and that row is **wrong** — `ScaleNutribotBridge` already
does the bridging.

| Capability | Where | State |
|---|---|---|
| Order-independent weight/density/container slots | `Composition` value object | shipped, 62 tests |
| 15-minute rolling window, slot consumption, one-deep undo | `CompositionStore` | shipped, 70 tests |
| `dl:` / `ct:` / `rs:clear\|undo\|done` grammar | `ScanVocabularyService` | shipped, 24 tests |
| Net weight, calories, macros | `ScanNutritionService` | shipped, 58 tests |
| One prompt per placement, edited in place as weight changes | `ScaleNutribotBridge` | shipped |
| Placement ends on the placed→at-rest crossing | `ScaleNutribotBridge` | shipped |
| Composition read into the prompt so a tare can be ACKed | `ScaleNutribotBridge` | shipped |
| `refreshPrompt(scaleId, notice)` for transient notices | `ScaleNutribotBridge` | shipped |

So this design is not a new subsystem. It is four changes to close the gap between what is
built and what a person at the kitchen counter actually experiences.

---

## Decisions

Confirmed with the household head, 2026-08-18:

- **D1 — Auto-accept after a quiet pause.** The entry live-updates on every input. Once
  weight and density are both present *and* nothing new has arrived for the quiet interval,
  it finalises itself and the message switches to a done state that still offers **Edit**.
  No tap in the common case, but a container scanned four seconds after a density scan — the
  exact shape of the 12:31 incident — still lands before the entry commits.
- **D2 — Return to ~zero ends a placement.** While anything is on the scale the latest weight
  wins and keeps editing the same entry; adding, spilling and spooning back are corrections.
  Lifting everything off consumes the slots and closes the placement; the next non-zero weight
  starts a fresh entry. This is already the bridge's behaviour and is hereby the intended one.
- **D3 — A memo names the entry and refines macros; it never overrides the measured weight.**
  The scan-derived net weight is ground truth. "Beans and rice" may re-split the calories into
  better macros than the density level's hand-estimated ones, but it may not revise the grams,
  and it may not revise kcal, which stay derived from density × net weight.

---

## Design

### 1. Fix the config (unblocks everything)

Restore `macros` to all nine rows of `nutribot.density_levels` in
`data/household/config/scales.yml`, or drop the override and re-apply `icon:` on top of
`DEFAULT_DENSITY_LEVELS`. Until this lands, every other change here is unreachable.

This is a data fix, not a code fix, and it is the whole reason the feature has been dark.

### 2. Quiet-commit, in the bridge

The fusion point is `ScaleNutribotBridge`. It already owns per-scale session state, the
single-live-prompt invariant, placement start/end, and the composition read. Alternatives
considered and rejected: putting the timer in `CompositionStore` (a pure state holder with an
injected clock and no scheduling — adding timers breaks its character and its tests'
assumptions), and a new `PlacementSession` coordinator (re-implements session tracking the
bridge already has, leaving two objects owning the same state).

Add to each scale's state a **commit timer**:

- **Reset by** any input that changes the composition: `setWeight` on a qualifying placement,
  an applied `dl:`/`ct:` scan, an applied `rs:undo`, or an accepted memo.
- **Not reset by** raw scale frames (the 0.5 Hz at-rest heartbeat would hold it open forever —
  the same reasoning `CompositionStore` already applies to its window), nor by `read()`.
- **On expiry**, if the composition is `complete` (weight AND density), finalise: compute net
  and nutrition, write the entry, and edit the Telegram message into its done state.
- **Cancelled by** `rs:done` (commit now), `rs:clear` (abandon), and placement end.

Default quiet interval: **25 seconds**, configurable as `nutribot.commitQuietSec` in
`scales.yml`. Chosen to comfortably cover the 4.4 s gap between the two scans in the incident
plus a reach across the kitchen, while still committing before the person has walked away.

`rs:done` remains the explicit "process it now" and bypasses the wait entirely.

### 3. Every scan gets an ACK — including a refusal

Move the `refreshPrompt` call in `scanDispatch.mjs`'s `handleNutrition` so it also fires on the
`swallow` branch, carrying a notice built from `decision.reason`:

| reason | notice |
|---|---|
| `nutriscan-disabled` | `scanning is off — the fridge sheet is not configured` |
| `no-scale-id` | `no scale for this scanner` |

The invariant this establishes, worth a test of its own: **a code the fridge grammar claims
must always produce a visible change on the prompt** — an applied slot, or a stated refusal.
Silence is a bug.

### 4. Memo flow

The done-state message carries an **Edit** button. Tapping it puts the conversation into a memo
state for that `logUuid`; the next message (text or voice, transcribed by the existing
`voiceTranscriptionService`) is the memo.

Applying a memo:

- Sets the entry's **name** from the memo.
- Re-splits **macros** via the AI gateway, given the memo text and the known net weight and
  kcal. The prompt states the weight and calories as fixed inputs.
- **Never** writes `grams`, `net`, or `kcal`. If the model returns them they are discarded and
  the discard is logged — the measurement outranks the guess (D3).
- Refreshes the message so the name and macros are visible.

A memo arriving before commit simply resets the quiet timer like any other input.

### 5. Observability

Every state change on this path emits a structured event, at `info` or above — never `debug`,
which is not shipped:

`nutriscan.applied`, `nutriscan.refused`, `placement.committed`, `placement.ended`,
`memo.applied`, `memo.rejected-field`.

Replace `nutriscanWarned`'s warn-once-then-debug with `logger.sampled(event, data,
{ maxPerMinute, aggregate: true })`, which rate-limits *within* a level and keeps a countable
record instead of routing repeats into a level that never leaves the process.

Register nutriscan's boot failure in the degraded-features registry proposed in the
observability work, so "nutriscan: DISABLED — MALFORMED_DENSITY_LEVEL" is answerable by a curl
rather than by reading boot logs.

---

## Data flow

```
  scale settles ─┐
  dl: / ct: scan ├─▶ CompositionStore (per-scale, 15-min window, order-independent)
  rs: control   ─┤            │
  memo          ─┘            │ every applied input resets…
                              ▼
                   ScaleNutribotBridge commit timer (25 s quiet)
                              │
              ┌───────────────┴───────────────┐
         complete?                        not complete
              │                                │
              ▼                                ▼
     compute net + nutrition           leave the prompt live;
     finalise entry                    window expiry forgets it
     message → done + [Edit]
              │
              ▼
        memo → name + macros only
```

---

## Error handling

- **A refused scan leaves the store exactly as it was** — no half-filled slot and no window
  refresh. Already guaranteed by `CompositionStore`; this design adds only the visible notice.
- **A memo that fails to parse** leaves the entry as it was and says so on the message. The
  entry is already committed and correct without a name.
- **A dead Telegram** must never cost a measurement. All message edits stay fire-and-forget, as
  they are today.
- **Backend restart loses the buffer** — a known, documented gap that this design does not
  close. It is now more visible, because a committed entry survives and an in-flight one does
  not. Out of scope; worth its own decision about persisting the buffer.

## Testing

- **Permutation test for the commit timer**: for every arrival order of {weight, density,
  container}, the same entry results, and the timer fires once. This mirrors the existing
  order-independence test on `CompositionStore`, which is the correctness claim the whole
  feature rests on.
- **The 12:31 incident as a regression test**: 639 g → `dl:140` → `ct:60` (4.4 s apart) →
  473 g, asserting a single committed entry of net 413 g at 578 kcal.
- **Refusal ACK**: a `swallow` decision calls `refreshPrompt` with a non-null notice. This is
  the test that would have caught the silent failure.
- **Memo guard**: a model response containing `grams`/`kcal` is applied for name and macros
  only, with the rejected fields logged.
- **Heartbeat does not hold the window open**: at-rest frames arriving continuously do not
  reset the commit timer.

## Out of scope

- The `fd:` food grammar (foods still print as inert labels).
- Multi-user attribution — every scan-enriched entry still attributes to the head of household.
- A product UPC working at the fridge.
- Persisting the composition buffer across restarts.
