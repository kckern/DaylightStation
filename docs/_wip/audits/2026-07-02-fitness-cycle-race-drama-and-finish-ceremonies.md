# Wire up race drama events + add a finish-line ceremony for distance-goal finishers

- **Source:** live chat follow-up to voice feedback `fitness/20260702215307_J0bvRU` · route `/fitness/menu/app_menu1` · reported `2026-07-02` (same session, spoken as a chat follow-up rather than a recorded feedback-panel note — no separate inbox item/audio for this one)
- **Type:** improvement / feature
- **Area:** Cycle Game — race event feedback (`lib/cycleGame/deriveRaceSnapshot.js`, `CycleGameContainer.jsx` `recordRaceEvent`, `CycleEventToast`)

## What the user said
> I thought you had a bunch of sleeping code that we never implemented about various ceremonies or things that happen when one overtakes the other or something that makes it more exciting. Also, we need some sort of ceremony on a distance one when somebody reaches the goal — you know whether that's a sound effect or a toast or something, because right now it doesn't do anything until they all complete or the mercy killing takes effect.

## Problem / opportunity
Both parts of this are confirmed true by direct code inspection, not just recollection:

1. **The "sleeping code" is real and still unwired.** `frontend/src/modules/Fitness/lib/cycleGame/deriveRaceSnapshot.js` computes `LEAD_CHANGE`, `PHOTO_FINISH` (tight-gap tension), and `FINAL_LAP` events from race state — fully implemented, exported, with its own test file — but has **zero consumers anywhere in the app** (grep confirms the only file referencing it is itself). This was independently flagged in the same-day cycle-game audit (`docs/_wip/audits/2026-07-01-cycle-game-audit.md`, finding C2) as "the highest fun-per-line fix in the codebase" — built, tested, never wired in.
2. **An individual rider finishing a distance race is currently silent.** `recordRaceEvent` (the existing toast/chart-marker event system used for DNF and penalty events) has no case for a rider crossing their distance goal. The only feedback a finisher gets is the speedometer's passive "FINISHED" overlay — no sound, no toast, nothing that reads as a moment — and the race just keeps running silently until every rider finishes or the mercy-kill window closes.

## Desired outcome
- The existing `deriveRaceSnapshot` events (lead changes, photo-finish tension, final lap) are wired into the live race tick and surfaced via the existing toast/SFX systems (`CycleEventToast`, `playSound`), the way the plan for this already envisioned.
- The moment an individual rider crosses their distance goal mid-race (while others are still racing) gets its own ceremony — a toast and/or sound effect marking "so-and-so finished!" — instead of the race continuing in silence until everyone's done.

## Actionable tasks
- [ ] Wire `deriveRaceSnapshot` into the race tick effect in `CycleGameContainer.jsx`, feeding it live engine state each tick and diffing against the previous snapshot (the function already takes `prevSnapshot` for exactly this).
- [ ] Route `LEAD_CHANGE` / `PHOTO_FINISH` / `FINAL_LAP` events into the existing `recordRaceEvent`/toast pipeline, each with its own copy and (new or reused) sound cue.
- [ ] Add a new event type to `recordRaceEvent` (or a sibling mechanism) for "rider finished" in a distance race — fires once per rider the moment `finishTimeS` is set, with its own toast + sound.
- [ ] Confirm none of this fires for ghosts (mirror the existing ghost-exemption pattern already used for DNF/penalty/overtime events).
- [ ] Playtest a distance race with staggered finishers to confirm each ceremony reads as a distinct, well-timed moment and doesn't spam/overlap the toast queue.

## Acceptance criteria
- A lead change, a tight-gap "photo finish" moment, and a rider entering their final lap each produce a visible/audible in-race moment.
- A rider finishing a distance goal while others are still racing gets an immediate toast and/or sound — the race no longer goes silent until the whole field is done.

## Where to look
- `frontend/src/modules/Fitness/lib/cycleGame/deriveRaceSnapshot.js` — the existing, tested, unwired drama-event engine.
- `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx` — `recordRaceEvent` (~line 342) and the race tick effect where `dnf`/`penalty`/`overtime` events currently fire; this is the wiring point for both parts of this doc.
- `frontend/src/modules/Fitness/widgets/CycleGame/CycleEventToast.jsx` — existing toast component/variants to extend.
- `docs/_wip/audits/2026-07-01-cycle-game-audit.md` (finding C2, and the Phase 3 roadmap sketch at the end) — this exact gap was already identified and prioritized; this feedback is independent reinforcement that it's worth doing next.

## Context / evidence
No logs — this is a known/confirmed code-inspection finding (`deriveRaceSnapshot` has no consumers; `recordRaceEvent` has no finish-event case), not something diagnosed from a log trace. `null`.
