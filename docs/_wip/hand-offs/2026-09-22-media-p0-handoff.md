# Media P0 Recovery Handoff — 2026-09-22

## Mission

Deliver useful value immediately by deploying the last independently reviewed Media P0 checkpoint, then finish Tasks 6–8 in bounded, evidence-backed batches without exceeding a user-approved token budget.

This document is the recovery source of truth for the next agent. Do not infer completion from earlier chat claims or from a green test run against a fixture. Start from the repository state and evidence named below.

## Executive status

| Item | State | Authority |
|---|---|---|
| Production `main` when this handoff was written | `8e25294d7906d37c66eca0c317b36a606cfad286` | Recheck before acting |
| **Production `main` now (2026-09-22, Phase 1 complete)** | **`0647ae90ca61015dcdc34d47ce8f777424b60b32`** | **Deployed; verified via `/build.txt`** |
| Last safe Media checkpoint | `7c30313679b225b6ff172acd86864d1a80dc7c61` | Independently reviewed; full P0 gate passed; now merged into main |
| Task 6 committed checkpoint | `480a3f9e3c9413e21739d5ec3b5a519fb4e9ae79` | Rejected by independent review |
| Task 6 worktree | `.worktrees/media-p0-remaining` | Dirty, unfinished review fixes; preserve exactly — untouched by Phase 1 |
| Tasks 1–2 | Complete and previously deployed | Accepted |
| Tasks 3–5 | **Deployed to production 2026-09-22** | Accepted — see Phase 1 completion below |
| Task 6 | Incomplete | Four review blockers plus unfinished RED fixes |
| Tasks 7–8 | Not started | Execute only after Task 6 is accepted |
| Final merge/deploy | Pending (Tasks 6–8 only) | Must pass exact-candidate gates |

The fastest responsible path is to deploy Tasks 3–5 from `7c303136`, not to finish Task 6 first. **This has been done — see "Phase 1 completion" below.**

## Phase 1 completion (2026-09-22)

Tasks 3–5 are deployed to production. Summary for the next agent:

- **Divergence found and resolved.** By the time Phase 1 ran, `main` had moved 3 commits past the `8e25294d79` merge-base this handoff was written against (`feat/libby-ephemeral-proxy` — unrelated ephemeral Libby playback proxy work). `7c303136` was therefore not a descendant of current `main`. Per this handoff's own instruction, an integration branch was created from `main`, `7c303136` was merged into it (`git merge --no-ff`), and the merge was clean — zero file overlap between the Libby commits and the Media P0 work.
- **The full 47-criteria P0 gate was re-run against the actual merge commit**, not just recalled from the old `7c303136` evidence. Result: 21 stories / 47 criteria, all 20 grouped Playwright invocations passed. Evidence: `/tmp/daylight-media-p0-evidence/0647ae90ca61015dcdc34d47ce8f777424b60b32/phase1-integration-2026-09-22/` (20 JSON reports + logs).
- **Harness gap found and closed.** The gate's `BASE_URL` server must be `tests/_lib/media-redesign-server.mjs` (production-build `--build` + `preview` mode, wiring `tests/_lib/media-ordinary-device-fixture.mjs`'s virtual "acceptance-media" receiver) — not a plain `npm run dev` server. This wasn't obvious: the launcher exists and is checked in, but nothing outside the runtime test files' own header comments points to it. If a future gate run seems to hang or fail on `receiver-ready`/`media-search-bar`, that's the missing-harness symptom, not a regression — see the test file's top-of-file comment for the exact requirement.
- **Deploy gate ran twice** (before and after the ~2min image build), both clear (garage/Portal/piano/living-room/emergency all idle). No override was used.
- **Deployed SHA verified**: `/build.txt` on production matches `0647ae90ca61015dcdc34d47ce8f777424b60b32` exactly; `/media` returns 200; container health is `healthy`.
- The integration branch (`media/p0-integration-2026-09-22`) was fast-forward-merged into `main` and deleted (logged in `docs/_archive/deleted-branches.md`) — it's fully contained in `main`'s history now.
- `.worktrees/media-p0-remaining` (Task 6's dirty, rejected work) was never touched.

**Next step for a future agent:** proceed to Phase 2 (repair and re-review Task 6) below. `main` is now the correct base to branch/rebase Task 6's repair work from.

## Non-negotiable repository safety

The following uncommitted Task 6 work belongs to the interrupted repair attempt:

```text
 M backend/src/app.mjs
 M frontend/src/modules/Media/externalControl/commandHandler.js
 M frontend/src/modules/Media/externalControl/commandHandler.test.js
 M frontend/src/modules/Media/externalControl/useExternalControl.js
 M frontend/src/modules/Media/externalControl/useExternalControl.test.jsx
 M frontend/src/modules/Media/fleet/FleetProvider.jsx
 M frontend/src/modules/Media/fleet/browserLiveness.js
 M frontend/src/modules/Media/fleet/browserLiveness.test.js
 M frontend/src/modules/Media/session/LocalSessionController.js
 M tests/_lib/media-ordinary-device-fixture.mjs
 M tests/live/flow/media/media-app-browser-control.runtime.test.mjs
?? backend/src/5_composition/modules/clientIngress.mjs
?? backend/src/5_composition/modules/clientIngress.test.mjs
```

Do not reset, clean, stash, amend, or merge this worktree as part of the Task 5 deployment. Create a separate deploy worktree pinned to the reviewed checkpoint. The dirty state has not reached GREEN and must not be represented as completed work.

## Phase 1 — deploy the reviewed value first

1. Re-read `CLAUDE.md` and `CLAUDE.local.md`, then confirm the current `main`, branch ancestry, worktrees, and dirty state.
2. Verify that current `main` is an ancestor of `7c303136`. If it is not, stop and integrate current production changes in a fresh branch; never force or rewrite history.
3. Create a fresh integration worktree/branch at the reviewed Task 5 checkpoint. Leave `.worktrees/media-p0-remaining` alone.
4. Run the full Media P0 gate against the exact integration SHA. The last passing evidence was:

   ```text
   /tmp/daylight-media-p0-evidence/7c30313679b225b6ff172acd86864d1a80dc7c61/task5-fix3/full-p0-retry
   ```

   That prior evidence establishes the checkpoint; it does not replace rerunning the gate on the actual merge candidate.
5. Run `./scripts/deploy-gate.sh` as a standalone step. Exit 1 halts the sequence. A log-store failure is not overridable.
6. Build with `./scripts/build-daylight.sh`.
7. Run `./scripts/deploy-gate.sh` again after the build. Someone may begin using the system while the image builds.
8. Only after both gates are clear, deploy with the local production procedure:

   ```bash
   sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
   ```

9. Verify container health, `/build.txt` equals the exact deployed SHA, and `/media` returns 200. Report the deployed SHA and gate results.

Never override the deployment gate unless the user gives the exact, explicit one-time override described in `CLAUDE.local.md`. Do not disrupt Portal, piano, reading, fitness, emergency, or active video use.

## Accepted checkpoint history

| Batch | SHA | Verified result |
|---|---|---|
| Task 3 | `9394cc7db9a3c3942a8353c3296e19b71db3e092` | Full P0: 14 stories / 35 criteria |
| Task 4 | `4d23d766a86bb79dc057bc0c6c20858cc9c0706a` | Full P0: 18 stories / 43 criteria |
| Task 5 | `7c30313679b225b6ff172acd86864d1a80dc7c61` | Full P0: 21 stories / 47 criteria; 20/20 grouped invocations; six-case runtime matrix 6/6 |

Tasks 3–5 are included in the Task 5 checkpoint. Do not cherry-pick them individually unless ancestry checks prove that necessary.

## Phase 2 — repair and re-review Task 6

The Task 6 report and progress-ledger completion claim are superseded by independent review. Treat `480a3f9e` as rejected until every issue below has an exact RED, implementation, GREEN, production-composition test, and independent re-review.

### Review blockers

1. **Production client ingress is missing.** `backend/src/app.mjs` does not compose client-control/client-ack routing. The acceptance fixture manually wires this behavior, so fixture success does not prove the deployed backend can complete Fleet Pause or Stop.
2. **Physical-device liveness is incomplete.** `FleetProvider.jsx` applies live state only to browser rows. Configured physical devices remain static with sort rank 99, allowing a playing TV to rank below idle/off devices.
3. **Routine provenance can leak.** `commandHandler.js` records routine origin before asynchronous success. A rejected item action, expired undo, or no-op transport can poison the next human action with stale routine provenance.
4. **Routine deduplication breaks correlation.** A duplicate returns the original ACK command ID and is not recorded in the idempotency cache, so correlation and retry semantics are incorrect.

### Interrupted repair state

The dirty worktree contains RED work aimed at:

- shared `registerClientIngress` and raw identify → route → ACK behavior;
- configured physical-device live-state merge and sorting;
- rejected item, expired undo, and no-op transport provenance leakage;
- replay of a duplicate command ID after ten seconds.

No GREEN run or repair commit was reported. Inspect the diff before changing it, preserve useful tests, and use the tests to establish the actual current state.

### Task 6 acceptance bar

- The backend test must exercise the real application composition path, not only `media-ordinary-device-fixture.mjs`.
- ACK receipt alone is not proof of playback or control success.
- State transitions must correlate to the requested command and target.
- Exact ordinary-input browser journeys must pass from a clean, exact-SHA server.
- An independent reviewer must explicitly clear all four blockers before Task 6 is promoted in the ledger.

## Phase 3 — remaining batches

### Task 7: outcomes, retry, reset, and paused recovery

Source: `.superpowers/sdd/2026-09-21-media-remaining-p0-on-stable-core/task-7-brief.md` and the corresponding section of the implementation plan.

Stories: `RELY.1a`, `RELY.2a`, `RELY.3a`, `RELY.5a`, `RELY.6a`, `RELY.7a` P0, and `RELY.8a`.

Build immutable attempt records keyed by `{ attemptId, targetId }`; retry only the selected failed attempt; make offline sends terminal `not-sent`; restore version-valid session, queue, config, nav, and aim in a paused state; and provide itemized Start fresh behavior. Start with focused REDs and promote only after the listed unit and ordinary-input browser suites pass.

### Task 8: accessibility, responsive parity, and final certification

Source: Task 8 in `docs/superpowers/plans/2026-09-21-media-remaining-p0-on-stable-core.md`.

Stories: `RELY.11a`, `RELY.12a`, `RELY.13a`, remaining P0 of `RELY.14a`, plus final criterion verification for every story.

Measure before changing UI. Cover phone, tablet, and desktop reachability; 44px targets; keyboard order; labels; live regions; non-color status; 200% reflow; reduced motion; overlay dismissal; and accepted tap budgets. Then run static gates, repository tests, stable-core acceptance, and the complete P0 manifest against one clean exact-SHA candidate.

### Final certification and deployment

The final manifest must map every accepted criterion exactly once to an ordinary-input exact-SHA journey. Expected baseline is stable core 11/11 with zero skipped, interrupted, or failed P0 cases. Merge and deploy only the reviewed exact candidate, using the two deployment-gate checks described above.

## Responsible orchestration and token policy

Before implementation resumes, obtain a fresh explicit usage ceiling from the user. Never infer, extend, or self-raise it. Record the starting percentage and report concrete progress at each user-required checkpoint.

Use this allocation policy:

- **Luna:** mechanical inventory, narrow test additions, manifest/ledger updates, and deterministic refactors.
- **Terra:** bounded component or backend implementation with an already-defined interface and test.
- **Sol:** integration work, cross-layer debugging, and review of fixture-versus-production behavior.
- **Astra:** only architectural decisions, a genuinely difficult blocked diagnosis, or final high-risk review. Do not use it for repository browsing, repeated summaries, or routine test loops.

Orchestration rules:

1. One implementer owns one bounded batch. One independent reviewer follows it. Avoid nested delegation.
2. Do not run exact browser gates in parallel; shared servers and resources create contention and misleading failures.
3. Do not run the full repository suite concurrently with Playwright.
4. Use one owned server, one recorded SHA, and one evidence directory per certification run.
5. Read targeted files and existing reports; do not repeatedly reread the full history or regenerate inventories already captured here.
6. Each batch gets one RED → GREEN implementation loop and one review loop. After two failed fix hypotheses, stop and reassess the design. After five review rounds, stop and report the blocker.
7. At every checkpoint report: stories/criteria newly cleared, exact SHA, tests run, failures remaining, usage delta, and the next bounded action.
8. Stop before the authorized ceiling. A near-limit state is a handoff condition, not permission to spend through it.

## Evidence and source map

- Design: `docs/_wip/refactors/2026-09-14-media-app-redesign.md`
- Acceptance ledger: `docs/_wip/plans/2026-09-14-media-app-acceptance-ledger.md`
- Implementation plan: `docs/superpowers/plans/2026-09-21-media-remaining-p0-on-stable-core.md`
- SDD workspace and task reports: `.superpowers/sdd/2026-09-21-media-remaining-p0-on-stable-core/`
- Task 7 brief: `.superpowers/sdd/2026-09-21-media-remaining-p0-on-stable-core/task-7-brief.md`
- Last safe full-gate evidence: `/tmp/daylight-media-p0-evidence/7c30313679b225b6ff172acd86864d1a80dc7c61/task5-fix3/full-p0-retry`

The Task 6 line in the progress ledger is stale because it predates the rejecting independent review. Tasks 1–5 remain the trusted portion of that ledger.

## Definition of done

A story is done only when every acceptance criterion has:

1. a failing test observed against the pre-implementation state;
2. an implementation exercising production wiring rather than fixture-only behavior;
3. a passing focused test;
4. a passing exact-SHA ordinary-input journey where applicable;
5. an evidence location recorded in the ledger; and
6. independent review for cross-layer or deployment-critical behavior.

The overall effort is done only when the complete manifest passes on the clean merge candidate, stable core remains green, the deployment gate is clear twice, production serves the exact expected SHA, and the user receives an honest count of accepted versus remaining stories.
