# Media App redesign — separation of concerns in the `/media` UX

**Status:** Remaining-P0 Tasks 1–6 are in production (Task 6 at `757102abb`). Task 7 (one voice for outcomes, retry, paused restore, itemised Start fresh) was implemented on branch `media/p0-task7` on 2026-10-02 and extends the P0 manifest to 31 stories / 69 criteria; it is not merged or deployed by this task (the orchestrator merges and deploys). Task 8 (accessibility, size parity, final certification) is not started. P1/P2 are not started.

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
| Application code changed | Remaining-P0 Tasks 1–6 shipped: aim/transport, item actions + Undo, unified search/browse, safe moves, house identity/liveness/routine safety (Task 6, salvaged 2026-09-28/29). Browse pages at the source; Back restores scrolled rows. Task 7 (branch `media/p0-task7`): one outcome store keyed by attempt and target, exact Retry / another screen, Not sent never replayed (Media loads send `deferredRetry=0`; a screen with no subscribed receiver is not "sent"), Stop after the Undo window, local skip notice + mini-player problem sign, paused held restore, safe discard of malformed/older saves, itemised Start fresh, reconnecting note |
| Runtime behaviour changed | Production since 2026-09-22 (Tasks 1–5) and 2026-09-29 (Task 6, `757102abb`) |
| Design | Complete: audit → ideal model → adversarial review → owner triage → requirements → handoff |
| Owner decisions | All recorded (Q1–Q11; 47 of 50 review proposals accepted) |
| Reference docs | `docs/reference/media/media-app.md` describes the shipped fleet, browser control and Browse paging/Back behaviour, and (Task 7) the outcome system and keeping your place; `media-app-technical.md` §4.7, §9.14, §10.1, §11.3 carry the Task 7 contracts |
| Implementation | Merged to `main`; the working branches were deleted and archived as `archive/media/*-2026-09-29` tags (see `docs/_archive/deleted-branches.md`). Tasks 7–8 (outcomes/retry/paused restore; accessibility + final certification) are deferred with their briefs |

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
| Execution plan (`2026-09-14-media-app-execution.md`) | — | Dropped 2026-09-25 after the stable core shipped: 11 of 82 stories accepted; the remaining slices are not scheduled. |
| [Remaining-P0 plan](../../superpowers/plans/2026-09-21-media-remaining-p0-on-stable-core.md) | — | Tasks 1–6 delivered; Tasks 7–8 deferred, not scheduled (briefs in the plan's SDD workspace). |
| [Task 6 salvage spec](../../superpowers/specs/2026-09-28-media-task6-salvage-design.md) / [plan](../../superpowers/plans/2026-09-28-media-task6-salvage.md) | — | How the rejected Task 6 was repaired, reviewed and certified. |
| [Media P0 hand-off](../../_archive/hand-offs/2026-09-22-media-p0-handoff.md) | — | Archived at P0 close-out. |
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
| P0 · 0 | Setup; record baseline unit and flow results | — | Complete | `f5ca438` | Remaining-P0 Task 1: fail-closed stable-core + P0 extension gate (`scripts/media-p0-gate.mjs`); baseline recorded in the SDD ledger. |
| P0 · 1 | Defects D1–D4 | RQ-PLACE-02, RQ-PLACE-04, RQ-STEER-10, RQ-STEER-15, RQ-RELY-06 | Complete | `015a6a0`, `7c3031367` | Remaining-P0 Tasks 2 and 5 (aim back to this device, Stop keeps the queue reachable, retry by exact dispatch, Remote search follows the aim). |
| P0 · 2 | One aim; Move here / Move to… | RQ-PLACE-01–08, 11, 12, 14 | Complete (partial criteria) | `015a6a0`, `7c3031367` | Tasks 2 and 5; promoted criteria are listed in the acceptance ledger. |
| P0 · 3 | One verb set and tap rule; TV-player queue ops | RQ-PLAY-01–07, RQ-FIND-09, 10 | Complete (partial criteria) | `9394cc7db` | Task 3: item actions, owner revisions, 10 s Undo. |
| P0 · 4 | One search, browse | RQ-FIND-01–08 | Complete (partial criteria) | `4d23d766a` | Task 4. |
| P0 · 5 | One handle, one set of controls | RQ-STEER-01–03, 05–10, 15–18 | Complete (partial criteria) | `7c3031367` | Task 5. |
| P0 · 6 | House view, browsers as screens, origin attribution, minimum naming | RQ-HOUSE-01–03, 05; RQ-AUTO-01, 03, 04; O6 | Complete | `757102abb` | Task 6 (salvaged 2026-09-28/29), in production; P0 manifest 25 stories / 54 criteria. Promoted only HOUSE.2a/AC3, HOUSE.3a/AC1+AC3, HOUSE.4a/AC2+AC4, and AUTO.3a/AC1+AC2. AUTO.1a/1b/2a, unique-name history/warnings, Move here, and whole-house reconnect acceptance remain unclaimed. |
| P0 · 7 | One voice for outcomes | RQ-RELY-01–03, 05, 06 | Implemented, not merged | branch `media/p0-task7` | Task 7. Promoted RELY.2a/AC2, RELY.3a/AC1–AC4, RELY.5a/AC1–AC3, RELY.6a/AC1 on exact-SHA runtime. RELY.1a, RELY.2a/AC1+AC3, RELY.5a/AC4, RELY.6a/AC2+AC3 have unit evidence only (see ledger). |
| P0 · 8 | Keep your place, orientation | RQ-RELY-07, 09–11 | Implemented, not merged | branch `media/p0-task7` | Task 7: RELY.7a/AC1, AC2, AC5 and RELY.8a/AC1–AC3 promoted. RELY.9a/RELY.10a were already accepted (`ee0e38db9`). RELY.7a/AC3 (power cut) is P1; AC4 (reconnecting note) is unit-only. |
| P0 · 9 | Comfortable use, device-size parity | RQ-RELY-13–15; NF-A11Y; NF-DEV | Not started | — | |
| P0 · 10 | Close-out: tap budgets, persona walkthroughs, deletions, reference docs | NF-TAP | Not started | — | |
| P1 | Household list and per-screen spots; favourites and removal; undo and Put it back; screen notes; Add to this queue; sleep timer; pause all; queue end and next episode; several-screen aim; move between screens; lock-screen controls; naming part 2 and "started by"; power-cut survival; first use; add-only | See handoff §6 | Not started | — | |
| P2 | Suggestions; played earlier; show briefly; music behind a slideshow; turn screen off; subtitles and audio language; screen admin; routine history; line up screens | See handoff §7 | Not started | — | |

## Open items

| # | Item | Waiting on |
|---|---|---|
| O1 | Undo while a far screen is still starting, and undo on live items (left open by rejecting R12) | **Closed 2026-10-02** (adopted Fable review): satisfied by the existing 10 s Undo rule. Measured wake-and-load durations over 30 days (`wake-and-load.complete`): office-tv p50 9.9 s, max 29.2 s; livingroom-tv p50 4.8 s, max 18.6 s — so a cold wake can outlast the Undo window. The one gap is closed in Task 7: after Undo expires, a far start still waking/loading offers **Stop** (that screen's transport stop, which keeps its queue, RQ-STEER-10) instead of Undo, so a mis-sent cold wake can be aborted from the sending device. |
| O2 | What "keep similar things playing" can draw on | Discovery, before P1 |
| O3 | What "this screen usually plays at this time of day" means | Discovery, before P2 |
| O4 | Turning off speakers (likely not offered) | **Closed 2026-10-02:** not offered; capability-gated per RQ-STEER-11. |

## Next action

Merge and deploy remaining-P0 Task 7 (`media/p0-task7`) through the deploy gate after review, then **Task 8** of the [remaining-P0 plan](../../superpowers/plans/2026-09-21-media-remaining-p0-on-stable-core.md) (accessibility, size parity, final P0 certification, P0 · 9–10).

What authorises it: the owner's acceptance on 2026-09-14.

## When this lands

At the end of P0:
- The requirements replace `docs/reference/media/media-app-requirements.md`.
- `media-app.md` and `media-app-technical.md` are rewritten to match.

When P2 lands, or the owner closes the effort: move this page, and the superseded `_wip` plans and audits, to `docs/_archive/` with the outcome recorded.
