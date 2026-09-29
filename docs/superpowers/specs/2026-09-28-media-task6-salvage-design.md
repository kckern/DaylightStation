# Media P0 — salvage Task 6, then close P0

**Date:** 2026-09-28 · **Status:** approved by the owner in session · **Supersedes:** Phases 2–3 of `docs/_wip/hand-offs/2026-09-22-media-p0-handoff.md`

## Why

Tasks 1–5 of the remaining-P0 plan are in production (`0647ae90c`). Task 6
(`480a3f9e3`, branch `media/p0-remaining`) was rejected by independent review
with four blockers, and an unfinished repair sits uncommitted in
`.worktrees/media-p0-remaining`. Tasks 7–8 never started. The `/media` app sees
little use (five queue operations in the week before this decision) and the
2026-09-25 docs sweep already marked further media slices "not scheduled".

The owner chose to **salvage Task 6 and then formally close P0**: ship the value
Task 6 was built for — browser rows in the fleet that can be paused and stopped,
TVs that sort by what they are actually doing, routine provenance that does not
leak — and defer Tasks 7–8 honestly rather than leave them half-claimed.

## Scope

In: the four Task 6 review blockers, rebased onto current `main`; exact-SHA
certification; deploy; records and worktree cleanup.

Out: Task 7 (outcomes, retry, paused restore) and Task 8 (accessibility,
responsive parity, final certification). Their briefs stay where they are and
are marked deferred.

## 1. Branch and carry-over

- New worktree `.worktrees/media-task6-salvage`, branch `media/task6-salvage`,
  cut from current `main` (788 commits past Task 6's base).
- `git merge --no-ff 480a3f9e3`. A trial `git merge-tree` is clean.
- Copy the 13 uncommitted repair files over by `cp` (never the shared stash) as
  one commit labelled as unfinished carry-over. `backend/src/app.mjs` has moved
  on `main`, so its swap is redone by hand against the current file.
- The old worktree is untouched until close-out.

## 2. The four fixes

Each fix is one RED → GREEN loop: a failing test observed first, then the
smallest change, then the test passing.

1. **Production client ingress.** `ClientIngressService` already mirrors every
   branch of the inline router in `app.mjs` and adds `client-control` /
   `client-ack`, but only the acceptance fixture composes it, so fixture success
   never proved production. `app.mjs` calls `registerClientIngress()`
   (`backend/src/5_composition/modules/clientIngress.mjs`) and the inline router
   is removed; the fixture calls the same function.
   **The guard is a parity test** through the real composition: every message
   kind the inline router handles today — `homeline-authorize`,
   `homeline-call:*`, `homeline:*`, fitness and fitness-simulator, piano MIDI
   (valid and invalid), `device-state`, `device-ack`, playback logging, BT relay,
   kiosk-launch relay — plus the subscription and message authorizers, client
   disconnection, and `client-control` / `client-ack`. Anything the inline
   router gained on `main` since 2026-09-22 is included. This path carries
   household-critical traffic (calls, fitness, piano), so parity is the
   release-blocking part of this fix.
2. **Physical-device liveness.** Configured fleet rows merge their live
   snapshot and sort by it, so a playing TV ranks above idle and off devices.
   The merge honours the same two-minute uncertainty rule browsers use.
3. **Routine provenance scope.** An origin lives for exactly one command and is
   cleared when that command settles: success, rejection, no-op transport, or an
   expired undo. A positive test proves a *successful* routine action's
   transition is still stamped routine, so an early clear around an async
   transition cannot silently drop it.
4. **Duplicate correlation.** A bounded (256) cache keyed by command ID replays
   the original result under the caller's **own** command ID. Routine
   deduplication records into it, and a replay after more than ten seconds
   still correlates.

## 3. Verification and deploy

- Focused suites, then affected broad suites (`frontend/src/modules/Media`,
  `backend/src/1_adapters/eventbus`, `backend/src/3_applications/eventbus`,
  `backend/src/5_composition`, `shared/contracts/media`), then the
  architecture audits (`audit:fs`, `audit:layers`, `audit:links`,
  `test:composition-contracts`).
- One independent review against the four blockers and parity completeness.
- One full P0 gate (`npm run test:media-p0`) on the exact branch SHA, served by
  `tests/_lib/media-redesign-server.mjs` (production build + preview; a plain
  dev server hangs on `receiver-ready`). Bar: 25 stories / 54 criteria, nothing
  skipped, stable core intact. Evidence under
  `/tmp/daylight-media-p0-evidence/<sha>/task6-salvage/`.
- A failure gets one fix loop. After two failed hypotheses, stop and report.
- Merge to `main`; `./scripts/deploy-gate.sh` before and after the build, the
  second chained directly into the deploy; `/build.txt` equals the merged SHA,
  `/media` returns 200, the container is healthy, and the log store shows
  fitness, Home Line and MIDI traffic still routed after the deploy.

## 4. Close-out

- **Records:** acceptance ledger, refactor index, and SDD `progress.md` carry
  the real counts (Task 6's earlier "complete" line is corrected). The plan and
  the refactor page mark Tasks 7–8 *deferred, not scheduled* and link their
  briefs. `docs/reference/media/media-app.md` describes what shipped. The
  hand-off moves to `docs/_archive/hand-offs/`.
- **Cleanup that loses nothing:** clean `/tmp/daylight-media-*` worktrees whose
  HEAD is in `main` are removed. Unmerged or dirty worktrees,
  `.worktrees/media-redesign`, `feat/media-redesign-batch-1`,
  `media/p0-remaining`, and `media/task6-salvage` first get an archive tag or
  saved patch, are logged in `docs/_archive/deleted-branches.md`, then removed.

## Budget and escalation

The owner set a ceiling of about 3M tokens. Spend is reported at each
checkpoint (after carry-over, after the four fixes, after review, after the
gate, after deploy, after close-out). Approaching the ceiling is a hand-off
condition, not permission to continue. When stuck after two failed hypotheses,
or for the independent review, a Fable agent is dispatched.
