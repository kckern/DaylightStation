# Preschool Daily Reading — Plan Set Overview

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement each plan task-by-task.

**Goal:** Give the two preschoolers a daily school assignment that is an *enrollment with no course* — "read N stories today" — satisfied by tapping their own NFC card in the living room and then tapping a book sticker, with the result turning their tile green on the School board.

**Why this is four plans:** each lands standing-up value on its own and the later ones depend on the earlier ones. Do them in order.

---

## Sequencing

| # | Plan | Depends on | Ships |
|---|------|-----------|-------|
| 1 | [NFC learner-card intent unification](./2026-08-26-preschool-reading-01-nfc-learner-intent.md) | — | A learner card works at **every** reader, not just the study one. Fixes the structural defect. |
| 2 | [Story-time program](./2026-08-26-preschool-reading-02-story-time-program.md) | — (parallel with 1) | The daily-reading enrollment, its evidence log, and green-on-the-board. |
| 3 | [Living-room reading session screen](./2026-08-26-preschool-reading-03-livingroom-session-screen.md) | 1 and 2 | The TV screen: avatar, history, book scan with a change-your-mind countdown, completion ceremony. |
| 4 | [School-day calendar on the enrollment](./2026-08-26-preschool-reading-04-school-day-calendar.md) | — (parallel) | Weekends/vacation stop reading as unmet obligations. |

Plans 1, 2 and 4 are independent of each other and may be executed in parallel by separate agents. Plan 3 requires 1 and 2 merged first.

---

## The structural defect plan 1 exists to fix

`TriggerDispatchService.handleEvent` is already the one convergence point for every trigger in the house. The HTTP door is a one-line wrapper over it:

```js
// backend/src/3_applications/trigger/TriggerDispatchService.mjs:268
async handleTrigger(location, modality, value, options = {}) {
  return this.handleEvent(TriggerEvent.create({ source: modality, location, value }), options);
}
```

The WebSocket-bus door calls `handleEvent` too. **But the decision "is this tag a learner card?" was written as an `if` chain sitting *above* that convergence point**, inside `backend/src/5_composition/modules/nfcTapIngress.mjs` — a module whose own header claims it is transport-only. It isn't. So only taps arriving over the bus (i.e. the study OMR relay) ever reach the fork.

Verified consequence, 2026-08-26: a book sticker tapped on the living-room reader produced

```
trigger.fired  location=livingroom modality=nfc value=04ffca71cc2a81
               registered=false error=trigger-not-registered
```

and a learner card tapped there would produce the same, because `school_learner` is not in `NfcResolver`'s actionable-field set.

**The fix:** `school_learner` stops being a magic field a transport module sniffs for and becomes a **resolved intent with an action**, exactly like `plex: 620681` becomes a `play-next` intent. The action is chosen by the *reader location* — which is how `sources.yml` already works. Same card, different room, different meaning, as config.

---

## Learner names in these plans

This repo is public and a commit hook refuses real household first names (`.claude/secret-patterns.local.txt`). Throughout this plan set the four kids are `learner-a` and `learner-b` (grade school) and `learner-c` and `learner-d` (preschool). **Substitute the real roster ids when you touch config under `$DAYLIGHT_BASE_PATH`, which is outside the repo — never when you write code, tests, or docs.** The real ids are in `data/household/school/school.yml` `students:`.

---

## Vocabulary (do not drift from this)

| Term | Meaning |
|---|---|
| **Course** | Published curriculum in `data/content/school/`: units, modules, progression, profiles. |
| **Syllabus** | Reusable teacher-authored arguments for enrolling in one course. `data/household/school/plans/syllabi/`. |
| **Enrollment** | Frozen realization of a syllabus for one learner, on their assignment record under `courses[]`. |
| **Program** | An enrollment with **`courseId: null`** — `assignment.programs[]`, projected by `appendAssignedProgramEntries`, evidence owned by a registered `IProgramLauncher`. **This is the lane story-time lives in.** |
| **Study day** | 4am→4am in the household timezone. `backend/src/2_domains/school/studyDay.mjs`, `boundaryHour = 4`. |

---

## Existing machinery these plans build on (do not reinvent)

- **Program lane:** `backend/src/3_applications/school/assignedProgramPlan.mjs` emits entries with `courseId: null`, `cadence: 'daily'`. `agenda.mjs` reads `doneToday` → `servedToday` → `obligation: 'served'` → `resolveDayCompletion` → `complete` → `AgendaStatusBoard` paints the card green.
- **Launcher contract:** `status({userId, programInstance}) -> {doneToday, progressLabel, score, terminal?}`. See `FlashcardProgramLauncher.mjs` (short) and `SurfaceProgramLauncher.mjs` (the study-day-boundary template — read its header before writing plan 2).
- **Trigger pipeline:** `ResolverRegistry` → `NfcResolver` → `mapIntentToResponse` → `responseHandlers`, discriminated by `Response.kind`. Additive-open: a new behavior is a new factory + a new handler entry.
- **Ceremony bus:** `frontend/src/modules/School/selfService/useScanCeremony.js` already listens on the `omr` and `school` topics, and already has the precedent for a non-scan acknowledgement (`piano-lesson-complete`).

---

## Out of scope, deliberately

- **The shutdown tag stays in `nfcTapIngress`.** It is a household safety command whose UID lives in `shutdown.yml` rather than the tag registry, and it deliberately precedes every other branch. Converting it to an action means moving that config on a safety path, which is real risk for no gain here. Plan 1 leaves it alone and documents why. Revisit separately.
- **Parents reading aloud off-screen.** Every plan here assumes the TV is the reader and the audiobook finishing is the evidence. If lap-reading should also count, that is a second evidence path and a new decision — not a tweak to these plans.
- **Module-subset enrollment, per-learner pass bars.** Already documented as unbuilt in `docs/reference/school/enrollment.md`; nothing here changes that.
