# Media App redesign — separation of concerns in the `/media` UX

**Status:** Live on `main` except Task 8's branch. Remaining-P0 Tasks 1–7, the P1 backend and frontend batches A/B/C, and the P2 batch D are merged to `main` (last merge `f42eef7fc`). Task 8 — accessibility and size parity, TV input, tap budgets, persona walkthroughs, deletions, docs end state — is on branch `fix/media-task8` awaiting the orchestrator's merge and deploy gate; with it the P0 manifest stands at **59 stories / 147 criteria** (`validateP0Manifest`), the stable core still 11/11. Open items O1–O4 are closed (below).

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
| Application code changed | Remaining-P0 Tasks 1–6 shipped: aim/transport, item actions + Undo, unified search/browse, safe moves, house identity/liveness/routine safety (Task 6, salvaged 2026-09-28/29). Browse pages at the source; Back restores scrolled rows. Task 7 (branch `media/p0-task7`): outcome notices are an overlay that never takes page space; one outcome store keyed by attempt and target, exact Retry / another screen, Not sent never replayed (Media loads send `deferredRetry=0`; a screen with no subscribed receiver is not "sent"), Stop after the Undo window, local skip notice + mini-player problem sign, paused held restore, safe discard of malformed/older saves, itemised Start fresh, reconnecting note |
| Runtime behaviour changed | Production since 2026-09-22 (Tasks 1–5) and 2026-09-29 (Task 6, `757102abb`) |
| Design | Complete: audit → ideal model → adversarial review → owner triage → requirements → handoff |
| Owner decisions | All recorded (Q1–Q11; 47 of 50 review proposals accepted) |
| Reference docs | `docs/reference/media/media-app.md` describes the shipped fleet, browser control and Browse paging/Back behaviour, and (Task 7) the outcome system and keeping your place; `media-app-technical.md` §4.7, §9.14, §10.1, §11.3 carry the Task 7 contracts |
| Task 8 (close-out) | Measured and repaired on the running app: 44 px floor in the theme and handle/queue/tray/picker/breadcrumb, `/` really focuses search (it targeted a testid that did not exist), reduced motion honoured, large text wraps the dock, phone handle gets its title back, Search on the phone tab bar and a tappable aim on Now Playing (one-thumb reach), TV prompts operable with D-pad + OK. New journeys: accessibility, tap budgets, personas, screen TV input. |
| Implementation | Merged to `main`; the working branches were deleted and archived as `archive/media/*-2026-09-29` tags (see `docs/_archive/deleted-branches.md`). Tasks 7–8 (outcomes/retry/paused restore; accessibility + final certification) are deferred with their briefs |

## Where everything lives

### Plans and evidence, in the order they were produced

| Document | Lines | What it is |
|---|---|---|
| [Baseline audit](../../_archive/media-app-redesign/2026-09-14-media-app-jobs-to-be-done-baseline.md) | 892 | **The app as built.** 50 user jobs (A1–K3) rated by how well each is served; every JSX component mapped to its jobs; cross-cutting findings: the destination matrix, duplicated implementations, confirmation gaps, vocabulary, lost context. |
| [Ideal jobs taxonomy](../plans/2026-09-14-media-app-ideal-jtbd-taxonomy.md) | 1435 | **The target model**, written blind from the audit. 15 personas; 7 areas, 20 groups, 69 jobs, 82 user stories with acceptance criteria; a persona × group matrix and persona paths; a crosswalk to the audit; 13 tensions. §5 holds the owner decisions, §6 the adopted review changes. |
| [Adversarial review](../../_archive/media-app-redesign/2026-09-14-media-app-jtbd-taxonomy-review.md) | 387 | **Holes in the model**, found blind: missing jobs, tap counts, intent-versus-result mismatches, contradictions, stress tests of the decisions, and proposals R1–R50. §11 records the owner's triage. |
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
| P0 · 7 | One voice for outcomes | RQ-RELY-01–03, 05, 06 | Complete | `69a780e83` (merge) | Task 7. Promoted RELY.2a/AC2, RELY.3a/AC1–AC4, RELY.5a/AC1–AC3, RELY.6a/AC1 on exact-SHA runtime. |
| P0 · 8 | Keep your place, orientation | RQ-RELY-07, 09–11 | Complete | `69a780e83` (merge) | Task 7: RELY.7a/AC1, AC2, AC5 and RELY.8a/AC1–AC3 promoted; RELY.9a/RELY.10a were already accepted. |
| P0 · 9 | Comfortable use, device-size parity | RQ-RELY-13–15; NF-A11Y; NF-DEV | Complete on branch `fix/media-task8` | see ledger run `TASK-8-CLOSEOUT` | Task 8. Promoted RELY.11a/AC1–AC3, RELY.12a/AC1–AC2, RELY.13a/AC1–AC2, RELY.14a/AC3 on exact-SHA runtime at 390/820/1440 (and 360). Gamepad is not added to /media (arcade menu only). |
| P0 · 10 | Close-out: tap budgets, persona walkthroughs, deletions, reference docs | NF-TAP | Complete on branch `fix/media-task8` | see ledger run `TASK-8-CLOSEOUT` | Tap budgets measured by the page (NF-TAP-01, 02, 04, 05, 06, 08, 09 pass; 07 is the Home card's single Move here, 03 and 10 not separately counted); six persona walkthroughs at phone and laptop with two virtual screens; every candidate component for deletion still has live callers, only the dead `searchStates` went; requirements promoted to the reference doc. |
| P1 | Household list and per-screen spots; favourites and removal; undo and Put it back; screen notes; Add to this queue; sleep timer; pause all; queue end and next episode; several-screen aim; move between screens; lock-screen controls; naming part 2 and "started by" | See handoff §6 | Complete (partial criteria) | `ef9e32348`, `8fad15e7e`, `45f0580d3`, `f42eef7fc` (merges) | Batches A, B, C and the screen-side capabilities; criteria without exact-SHA runtime evidence stay Partial in the ledger. |
| P1 · screen | Screen player capabilities: sleep timer, Add only, end of queue (stop/repeat/similar per revised O2), next-episode countdown + stop after this one, screen notes + Put it back, power-cut survival, start status to everyone | RQ-STEER-12, 19, 20, 21; RQ-PLAY-10; RQ-RELY-08; RQ-HOUSE-04 | Built on `media/p1-screen`, not merged | see branch | Screen + backend + contracts done (tech doc §4.9–4.10, §6.2.6–6.2.7, §6.6, §9.14–9.15). Media frontend controls/house-view wiring is the next batch. 7/7 browser journeys pass on the virtual receiver (`tests/live/flow/media/screen-session-controls.runtime.test.mjs`). |
| P1/P2 · FE-A | Frontend batch A — home and items: start-page suggestions (FIND.7a), household recent (FIND.9a), carry on + Now on/Move here (FIND.10a), Played earlier in every queue (FIND.11a), favourites (FIND.12a/b), remove from household list with Undo (FIND.13a), saved spots + Start over (PLAY.4a), play/log origin | RQ-FIND-11–17; RQ-PLAY-08/09 | Built on `media/fe-home`, not merged | branch `media/fe-home` | Promoted 21 criteria on exact-SHA runtime (`HOUSEHOLD-HOME`, `media-app-household-home.runtime.test.mjs` 18/18); server-rule criteria FIND.7a/AC3, FIND.10a/AC5+AC7, FIND.11a/AC2, FIND.12a/AC3, FIND.13a/AC2 are Partial (backend tests). Client contract: tech doc §2.10. |
| P2 | Suggestions; played earlier; show briefly; music behind a slideshow; turn screen off; subtitles and audio language; screen admin; routine history; line up screens | See handoff §7 | Complete (partial criteria) | `14d082b41`, `74baf4c6f` (merges), batches A/B/C | Batch D plus the P2 items of A–C. |

## Tap budgets (NF-TAP), measured

Counted by the page itself (trusted primary `pointerdown` from a settled state), not by the test, on the compiled exact source `ddfe8f7db`, at phone (390) and laptop (1440) — `media-app-p0-personas.runtime.test.mjs`. Typing is not a tap; opening the search surface is setup.

| Budget | Path | Requirement | Measured |
|---|---|---|---|
| NF-TAP-01 | A name typed → a playable item playing at the aim | 1 | **1** |
| NF-TAP-02 | A name typed → a collection started via its inline Play | 1 | **1** |
| NF-TAP-04 | Open the queue of the playback being held, from anywhere | 1 | **1** |
| NF-TAP-05 | Add a search result to the aim's queue (⋯ → Add to queue) | 2 | **2** |
| NF-TAP-06 | Aim back at this device (aim line → This device) | 2 | **2** |
| NF-TAP-08 | Pause all screens (house menu → Pause all) | 2 | **2** |
| NF-TAP-09 | Put a change back (Undo on the confirmation) | 1 | **1** |
| NF-TAP-07 | Move a screen's playback to this device | 2 | 1 by construction: Home's "Now on …" card carries Move here (`media-app-household-home` journey); not separately counted |
| NF-TAP-10 | Send one item to a screen other than the aim (⋯ → Play on… → screen → send) | 3 | **4 — over budget.** The picker keeps a confirm step because it carries the move/keep-playing-here choice and the busy-screen warning. Making a single-screen tap with nothing playing here send at once would meet the budget but changes the picker's contract and six journeys; left for an owner ruling rather than redesigned in the close-out. |
| NF-TAP-03 | Pause the screen this device last sent to, from anywhere | 1 | Not counted by this task |

## Open items

All closed; the rulings are recorded in the reference requirements §10.

| # | Item | Ruling |
|---|---|---|
| O1 | Undo while a far screen is still starting, and undo on live items (left open by rejecting R12) | **Closed 2026-10-02.** The 10 s Undo from the tap stands, with **Stop** offered while a screen is still starting; an Undo on a live item returns to the live edge. |
| O2 | What "keep similar things playing" can draw on | **Closed.** The finished item's container (siblings, then parent), preferring never-played, then not played in 7 days, then least recently played; batches of 5 / ~30 min; stops after 4 unattended batches; "Nothing similar left". |
| O3 | What "this screen usually plays at this time of day" means | **Closed.** ±90 min, last 30 days, ranked by distinct days (≥ 3), whole-household fallback; row order favourites, carry on, usually at this time, new. |
| O4 | Turning off speakers | **Closed 2026-10-02:** speakers are not turned off; capability-gated per RQ-STEER-11. |

## Next action

Merge `fix/media-task8` and deploy through the deploy gate. After that the refactor can be closed: move this page and the remaining superseded `_wip` plans to `docs/_archive/` with the outcome recorded.

What authorises it: the owner's acceptance on 2026-09-14.

## When this lands

Done at the end of Task 8: the requirements replaced `docs/reference/media/media-app-requirements.md`; `media-app.md` and `media-app-technical.md` were updated to match what shipped; the two audits and the 2026-09-19/20 session briefs moved to `docs/_archive/media-app-redesign/`.

When the owner closes the effort: move this page, and the remaining superseded `_wip` plans, to `docs/_archive/` with the outcome recorded.
