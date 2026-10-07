# Media proof gaps — design

**Date:** 2026-10-06 · **Owner decisions:** finish line = all P0 first, then P1/P2; household rules proven on a seeded test backend; hardware-bound criteria simulated where the real code path still runs, lock-screen marked "needs a physical phone"; approach = reconcile → infrastructure → P0 → P1/P2. Owner goal: close every gap, token-efficient, Sonnet agents for grunt work.

## Outcome
Every criterion in `docs/_wip/plans/2026-09-14-media-app-acceptance-ledger.md` is either **Accepted** on exact-SHA runtime evidence (ordinary input, real code path) or carries an explicit, honest non-acceptance verdict with a reason code. No criterion stays Unverified without a reason.

## Constraints (unchanged)
- Tests never write household data; Office is the only physical screen tests may touch (and this design does not use it); never weaken an assertion; unit tests alone never accept a story.
- One Playwright run at a time; gate runs only while `./scripts/deploy-gate.sh` reads clear; before each gate run, check the fixed test titles' files are readable and heal NFS ghost-000 files with `/home/ds/bin/media-source-heal.sh` (see `docs/reference/player/media-source-healing.md`).

## Baseline (2026-10-06)
82 stories, 288 AC: 144 Accepted / 37 Partial / 107 Unverified (53 stories with a gap). Gap categories: A stale/uncited 95 · B single-surface partial 19 · C unit-only 11 · D household rules faked in-test 6 · E fixture lacks state 5 · F product not built 5 · G physical/timing 2 · H measurement not taken 1.

## Reason codes (for every non-accepted row after Phase 0)
`NEEDS-JOURNEY` (closable by a journey on existing infra) · `NEEDS-FIXTURE:<what>` · `NEEDS-SEEDED-BACKEND` · `NEEDS-FEATURE:<what>` · `NEEDS-DEVICE:<what>` (terminal; physical hardware) · `PHASE:P1|P2`.

## Phases
**Phase 0 — Reconcile the ledger.** Run every existing Media journey once on one exact-SHA build; map each passing test to the criteria its assertions actually prove (read the assertions, not titles); promote rows whose evidence now exists (e.g. RELY.4a AC1-2, RELY.6a), correct stale reasons (fixture now has two screens), tag every remaining row with one reason code. Output: updated ledger + a gap table in the status page. No product or fixture code.

**Phase 1 — Shared test infrastructure** (all in `tests/_lib/`, served by `media-redesign-server.mjs`; no product code):
1. *Seeded household backend:* mount the REAL household services (`HouseholdMediaMemoryService`, suggestions, play ledger, favourites/removed stores, mark-watched) over a throwaway data dir created per run from a committed seed (known plays, per-screen spots incl. a <5 min and a >5 % item, a finished item, a next episode, favourites, a removed item, time-of-day history ≥3 days). Remove the in-test `page.route` fakes from the household journeys.
2. *More fixture screens:* a speaker-kind receiver; an unreachable/offline screen; a screen with virtual `device_control` (off/on routes served by the fixture, never real hardware); a 30-day-silent registry entry.
3. *Fake Home Assistant caller:* issues `/device/:id/load` with the HA User-Agent and routine query so the real recorder/catalog/history/dedupe code runs.
4. *Helpers:* network-loss (Playwright offline/route abort) and fake-clock helpers for long timers (sleep timer minutes).
Each helper gets unit tests; the house fixture's real-router pattern is the template.

**Phase 2 — P0.** Journeys for every P0 row tagged NEEDS-JOURNEY/FIXTURE/SEEDED-BACKEND, extending existing journey files where the story already lives (cross-surface/size parity for category B). Build the two missing P0 features with TDD: **Go to live** (STEER.4a/3) and **Move/keep choice on item-level Play on…** (PLACE.6a/2). Measure RELY.13a/1 (3:1 control-boundary contrast). Extend the P0 manifest; full gate on the final SHA.

**Phase 3 — P1/P2.** Same for P1/P2 rows; build **StartedByLine in the controls header** (HOUSE.5a/2), **room adjacency** for the drift warning (PLACE.4a/6, registry field + admin edit), and verify/complete **power-cut survival** (RELY.7a/3). Lock-screen (STEER.1a/5) → `NEEDS-DEVICE:phone lock screen`.

## Execution
Sequential phases on branch `test/media-proof-gaps` (one writer). Sonnet implementer per phase; Fable review of each phase's diff before merge (per owner rule); merge to `main` after each phase; deploy only when product code changed (Phases 2–3), through the deploy gate. Status page and ledger updated each phase with factual evidence only.

## Done when
Ledger: zero rows Unverified without a reason; every P0 row Accepted except `NEEDS-DEVICE`; P1/P2 rows Accepted or `NEEDS-DEVICE`; manifest + stable core green on the final exact SHA; reference docs and status page current.
