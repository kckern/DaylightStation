# Media App redesign — separation of concerns in the `/media` UX

**Status:** Stable-core release candidate is isolated on `release/media-stable-core` at product/test source `bf9edf3d2`. Production is unchanged. 11/82 stories and 32 acceptance criteria are accepted on the candidate; 71 stories remain in the active redesign objective. The dirty implementation worktree remains separate and is not part of this candidate.

**Started:** 2026-09-14 · **Planning baseline:** `b2ff8a460` (the code the baseline audit describes)
**Authorised by:** the owner, 2026-09-14. They accepted the requirements and their P0/P1/P2 phasing, chose to evolve the app in place, and gave the implementer authority to commit to `main` and deploy only when the deploy gate is clear.

---

## What this refactor is

The owner reports that `/media` is largely unusable. Existing code is an inventory, not a functional baseline.

- Each button decides on its own where things play.
- Three searches behave three ways.
- Your own playback and a TV are controlled differently.
- Whether an action confirms depends on which button was pressed.

The redesign reorganises the app around one home per concern: **one aim, one verb set, one search, one set of controls for any screen, one voice for outcomes.** It also fixes the defects the audit found.

The requirements define the target behavior. Each story must be built and verified without assuming its existing pieces are wired correctly; reuse is justified by evidence. Changes evolve the app in place while preserving the single media-node hosting contract.

## What has actually happened

| | |
|---|---|
| Application code changed | D1–D4 reviewed; real duration/progress, focused hosting, playback identity, pause and seek-completion repairs in the isolated worktree |
| Runtime behaviour changed | Development browser only; production unchanged |
| Design | Complete: audit → ideal model → adversarial review → owner triage → requirements → handoff |
| Owner decisions | All recorded (Q1–Q11; 47 of 50 review proposals accepted) |
| Reference docs | Factual drift in `docs/reference/media/media-app.md` corrected; not yet rewritten for the redesign |
| Implementation | `feat/media-redesign`; 82 stories / 288 acceptance criteria tracked; browser failures preserved for playback, queue menu, search retention and idle aim; see acceptance ledger for current verdicts |

## Where everything lives

### Plans and evidence, in the order they were produced

| Document | Lines | What it is |
|---|---|---|
| [Baseline audit](../audits/2026-09-14-media-app-jobs-to-be-done-baseline.md) | 892 | **The app as built.** 50 user jobs (A1–K3) rated by how well each is served; every JSX component mapped to its jobs; cross-cutting findings: the destination matrix, duplicated implementations, confirmation gaps, vocabulary, lost context. |
| [Ideal jobs taxonomy](../plans/2026-09-14-media-app-ideal-jtbd-taxonomy.md) | 1435 | **The target model**, written blind from the audit. 15 personas; 7 areas, 20 groups, 69 jobs, 82 user stories with acceptance criteria; a persona × group matrix and persona paths; a crosswalk to the audit; 13 tensions. §5 holds the owner decisions, §6 the adopted review changes. |
| [Adversarial review](../audits/2026-09-14-media-app-jtbd-taxonomy-review.md) | 387 | **Holes in the model**, found blind: missing jobs, tap counts, intent-versus-result mismatches, contradictions, stress tests of the decisions, and proposals R1–R50. §11 records the owner's triage. |
| [Requirements](../plans/2026-09-14-media-app-redesign-requirements.md) | 390 | **The contract.** 10 principles, scope changes, 101 requirements with priorities and traces, non-functional budgets and defaults, reconciliation of the current C1–C10/N1–N6, and open items. Replaces `docs/reference/media/media-app-requirements.md` at the end of P0. |
| [Implementation handoff](../plans/2026-09-14-media-app-redesign-handoff.md) | 310 | **How to build it.** A reuse map, capability gaps, 10 ordered P0 steps, P1/P2 work items, invariants, verification, the deploy procedure and the doc endstate. |
| [Story implementation map](../plans/2026-09-14-media-app-story-implementation-map.md) | — | Each story mapped to JSX/controller/API ownership. |
| [Execution plan](../plans/2026-09-14-media-app-execution.md) | — | Current slices and binding verification/safety constraints. |
| [Acceptance ledger](../plans/2026-09-14-media-app-acceptance-ledger.md) | — | Every criterion and its evidence; passing unit counts are not story acceptance. |
| [Stable-core release design](../plans/2026-09-20-media-stable-core-release-design.md) | — | Approved release boundary and verification gates for the accepted core. |
| [Stable-core release plan](../../superpowers/plans/2026-09-20-media-stable-core-release.md) | — | Task-by-task isolation, gate, verification, and activity-check sequence. |
| [Stable-core release evidence](../plans/2026-09-20-media-stable-core-release-evidence.md) | — | Candidate provenance and verification evidence for the isolated release branch. |
| [Disclosure Day session evidence](../bugs/2026-09-14-media-disclosure-day-playback.md) | — | Today's logs, real-player browser reproduction, and demonstrated wiring failures. |

### The decision record

**Implementation coverage:** [Story-to-JSX/API map](../plans/2026-09-14-media-app-story-implementation-map.md) maps all 82 stories to interaction owners, controllers/APIs, and delivery phases. It distinguishes existing seams from proposed contracts and identifies the P0/P1 undo dependency and failure-safe move work. This is proposed implementation ownership, not a change to the accepted requirements or evidence that implementation has started.

| What | Where |
|---|---|
| Q1–Q11 product decisions: aim idle reset, tap rule, household list, play-next order, live items, scope lifetime, screen notes, multi-screen, words, naming, children | Taxonomy §5 |
| Review triage: **accepted** R1–R4, R7–R11, R13–R50; **rejected** R5 (announce an aim reset), R6 (home aim for kiosks), R12 (undo timing on slow screens), with what each rejection leaves | Taxonomy §6; review §11 |
| Phasing accepted as proposed; evolve in place; commit and deploy through the gate | Requirements status line; handoff §1 |
| Minimum device naming pulled into P0 (a build dependency, not a scope change) | Requirements O6; handoff §4 |

### Findings that shape the work

**Defects to fix first** (P0 · Step 1; audit §5 and §7; handoff §5):

| # | Defect |
|---|---|
| D1 | A phone can't aim back at itself once a TV is chosen. |
| D2 | Stop keeps the queue but hides the only way to reach it. |
| D3 | Every Retry resends the most recent cast, not the one it sits next to. |
| D4 | In the Remote view, search taps go to the controlled device while the label names another destination. |

**Capability gaps** (handoff §3):
- The TV player ignores remote add, reorder, remove, jump and clear.
- Local "Play next" orders items most-recent-first, against Q4.
- Every "Play now" clears the queue, against R1.
- Nothing records who or what started playback.
- Browsers are absent from the fleet.
- There is no remote speed control, no lock-screen controls, no subtitle or audio-track selection, no per-screen resume position, and no device history contract.

### Changes already made outside `_wip`

| Commit | Change |
|---|---|
| `fab309975` | `docs/reference/media/media-app.md`: removed home category cards and the `browse` config, corrected the result-row actions, moved the mini player out of the dock, noted that Settings holds only reset, corrected fleet card actions and scope persistence. |
| `526e9ab3a` | `docs/reference/media/media-app.md`: corrected the search-scope config location. |

### Planning commits

`fab309975` baseline audit → `b618f3a1d` taxonomy → `0b14dad93` Q1–Q11 → `bb7109e42` review → `4679ee672` triage applied → `684ada243` requirements → `526e9ab3a` handoff and this page.

### Background: earlier media audits this builds on

These are superseded as guidance by the documents above, but they explain how the app got here:
- 2026-02-27 implementation
- 2026-04-15 cast usability
- 2026-04-18 requirement coverage
- 2026-04-19 UX best practices
- 2026-05-15 usability
- 2026-06-09 lookup and UX
- 2026-06-10 rebuild carry-over
- 2026-07-14 "Bluey" incident

All live in [`../audits/`](../audits/).

## Progress

Update a row when its step lands: date, commit, tests, deploy, and notes (including baseline and budget results).

| Phase · Step | Scope | Requirements | State | Commit | Notes |
|---|---|---|---|---|---|
| P0 · 0 | Setup; record baseline unit and flow results | — | Not started | — | |
| P0 · 1 | Defects D1–D4 | RQ-PLACE-02, RQ-PLACE-04, RQ-STEER-10, RQ-STEER-15, RQ-RELY-06 | Not started | — | |
| P0 · 2 | One aim; Move here / Move to… | RQ-PLACE-01–08, 11, 12, 14 | Not started | — | |
| P0 · 3 | One verb set and tap rule; TV-player queue ops | RQ-PLAY-01–07, RQ-FIND-09, 10 | Not started | — | |
| P0 · 4 | One search, browse | RQ-FIND-01–08 | Not started | — | |
| P0 · 5 | One handle, one set of controls | RQ-STEER-01–03, 05–10, 15–18 | Not started | — | |
| P0 · 6 | House view, browsers as screens, origin attribution, minimum naming | RQ-HOUSE-01–03, 05; RQ-AUTO-01, 03, 04; O6 | Not started | — | |
| P0 · 7 | One voice for outcomes | RQ-RELY-01–03, 05, 06 | Not started | — | |
| P0 · 8 | Keep your place, orientation | RQ-RELY-07, 09–11 | Not started | — | |
| P0 · 9 | Comfortable use, device-size parity | RQ-RELY-13–15; NF-A11Y; NF-DEV | Not started | — | |
| P0 · 10 | Close-out: tap budgets, persona walkthroughs, deletions, reference docs | NF-TAP | Not started | — | |
| P1 | Household list and per-screen spots; favourites and removal; undo and Put it back; screen notes; Add to this queue; sleep timer; pause all; queue end and next episode; several-screen aim; move between screens; lock-screen controls; naming part 2 and "started by"; power-cut survival; first use; add-only | See handoff §6 | Not started | — | |
| P2 | Suggestions; played earlier; show briefly; music behind a slideshow; turn screen off; subtitles and audio language; screen admin; routine history; line up screens | See handoff §7 | Not started | — | |

## Open items

| # | Item | Waiting on |
|---|---|---|
| O1 | Undo while a far screen is still starting, and undo on live items (left open by rejecting R12) | Owner, with real wake durations recorded by the implementer |
| O2 | What "keep similar things playing" can draw on | Discovery, before P1 |
| O3 | What "this screen usually plays at this time of day" means | Discovery, before P2 |
| O4 | Turning off speakers (likely not offered) | None |

## Next action

**P0 · Step 0**, per the [handoff](../plans/2026-09-14-media-app-redesign-handoff.md): create a worktree and record baseline test results here. **Then Step 1** (defects D1–D4), shipped through the deploy gate.

What authorises it: the owner's acceptance on 2026-09-14.

## When this lands

At the end of P0:
- The requirements replace `docs/reference/media/media-app-requirements.md`.
- `media-app.md` and `media-app-technical.md` are rewritten to match.

When P2 lands, or the owner closes the effort: move this page, and the superseded `_wip` plans and audits, to `docs/_archive/` with the outcome recorded.
