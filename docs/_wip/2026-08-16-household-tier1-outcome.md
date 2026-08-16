# Tier 1 outcome — executed on the server 2026-08-16

Supersedes the "STOP — two blockers" section of
`docs/_wip/2026-08-16-household-tier1-handoff.md`. Both blockers cleared before
this ran. Plan: `docs/plans/2026-08-15-household-reorganization.md`.

## Done — seven domains

| from | to | files |
|---|---|---|
| `common/feedback` | `feedback/` | 13 |
| `common/feed` | `feed/` | 1 |
| `state/gameshow` | `gameshow/` | 1 |
| `history/newsreporter` | `newsreporter/log/` | 56 |
| `apps/media` | `media/` | 1 |
| `apps/gaming/games` | `gaming/games/` | 0 (genuinely empty, `ls -laR` confirmed) |
| `cli-transcripts/` | `cli/log/` | 1 |

73 files in the new homes, 73 held in `data/_deleteme/` — exact match. Also
swept: the empty `common/school` Tier 0 listed but left behind.

Each move was copy → `diff -r` → relocate, one commit per domain, verified
against the running app (endpoints 200, real payloads, no ENOENT).

## Escalated to Tier 2 — do NOT treat these as Tier 1

The handoff's rule is one or two call sites. These exceed it:

| domain | real sites | files | why it is not Tier 1 |
|---|---|---|---|
| `common/finances` | 6 | 4 | `YamlFinanceDatastore` + 3 CLIs; 6.4 MB of real household money data |
| `common/komga` | 7 | 3 | `KomgaFeedAdapter`, `YamlTocCacheDatastore`, a backfill CLI — and komga ALSO lives at `shared/komga`, so the two must merge in one move |
| `common/gratitude` | 5 | 3 | `UserDataService`, `GratitudeFeedAdapter`, `YamlGratitudeDatastore` (4 of the hits are in that one file) |
| `weather` | 4 | 4 | split across `common/weather.yml` and `history/weather`; `WeatherFeedAdapter`, `YamlWeatherDatastore`, `homeAutomation.mjs` |

`weather` and `komga` are escalated **as whole domains**. Moving only the
half that qualifies (`history/weather`, 1 site) would leave the domain split
across two roots — the exact condition this reorganization exists to end.

**`common/cost` does not exist.** The handoff names it as the "start here,
lowest traffic" first move. There is no such directory. `common/feedback` was
used as the pattern-proving first domain instead.

## Three corrections to the plan

**1. The `#apps/` import alias inflates every count.** `#apps/` is the module
alias for `backend/src/3_applications/`, so a grep for the `apps/` DATA path
matches import statements. `apps/media` looked like 5 sites; it is 1. Any
future survey must exclude `#(apps|adapters|domains|composition|system|rendering)/`
and comment lines, or it will escalate domains that do not need it.

**2. `_deleteme/` must be `data/_deleteme/`, not the repo root.** The plan says
`mv <path> <repo>/_deleteme/`. That works from the laptop. On the server the
only writable route into the data volume is `docker exec`, and the container
cannot see the repo — `/usr/src/app/_deleteme` is the container's writable
layer and is **destroyed on the next deploy**. Use `data/_deleteme/`, which is
inside the mounted volume and visible from the host.

**3. Deploy AFTER the move, or the app creates the destination empty.** The
plan's own hazard section is right, and the failure is not hypothetical:
deploying first let the boot create `gameshow/sessions` and `gaming/games` as
empty directories, so the copy step found a destination already present. It
refused to write into it and said so, which is the only reason this was
caught. Either move first and then deploy, or keep a copy step that treats an
existing destination as a stop condition.

## One environment note

Dropbox runs as **root** on this host and the volume is shared with the
laptop. About a minute after removal, the two emptied directories reappeared
root-owned — the laptop's copy re-pushed the empty shells. Directories whose
files had actually moved stayed gone. A second removal held. Expect empty
directories to resurrect once; confirm rather than assuming a removal stuck.

## Tier 4 is already done, and its stated reason was wrong

The plan reserves `content/school/print-documents/{published,derived-banks,allocations}`
for its own plan because "a card scan resolves published documents by path at
grade time." They resolve by `documentId` + `rev`; no stored record contains a
path. Those three directories moved to `household/apps/school/print-documents/`
on 2026-08-15 and `school-docs audit` reports 4 cards, 5 records, 0 errors.
Tier 4 can be struck.

## Next

Tier 2 is gated on Tier 1 running clean for a full day. When it opens, start
with the four escalated domains above rather than re-deriving the survey —
and note that `2a` (`common/weekly-review`, 45 MB, eight hardcoded joins) and
`2d` (`history/fitness`, now **107 MB**, ~19 CLI scripts bypassing
ConfigService) are the two that genuinely need the extract-a-helper-first
discipline the plan describes.

## Two of the "eight regressions" were never regressions

`apps-success-false` (60 vs baseline 49) and `domains-tojson` (74 vs 67) score
identically on `main` and on this branch. Extracting `main` with `git archive`
and running the auditor against that clean tree returns the same 60 and 74, and
`git diff main...HEAD` adds zero matches for either pattern. Both baselines were
set on 2026-07-08; five weeks of `main` drifted past them.

They were left at 49 and 67 deliberately. Raising a ratchet baseline to meet the
debt is how the ratchet stops meaning anything — and the drift itself is the
evidence: eleven new `success: false` sites landed on `main` while the gate was
already red, because a permanently-red gate gets ignored. Moving the number up
would restore green and change nothing.

Nor is bulk-converting the 18 sites correct. They were sampled, not assumed:

- `fitness/manageBroker.mjs` settles an async enroll/delete request-response
  with `{ success: false, error: 'timeout' }`. That is a protocol outcome, not a
  swallowed exception; throwing across the `settle()` boundary would be worse.
- The five `nutribot/usecases/*` return the same envelope to
  `NutribotInputRouter`, which forwards it upward. Converting them changes a
  live food-logging contract, and a swallowed throw there means a log silently
  does not save.
- `agents/health-coach/tools/*` return `{ error, success: false }` to the LLM
  tool loop, which is the surface that has to *read* the error text.

`domains-tojson` has its own written plan at
`docs/_wip/plans/2026-07-08-serialization-ownership-migration.md`, and removal
is not mechanical: the playback-hub value objects define `toJSON() { return
this.#value; }`, so deleting it makes `JSON.stringify` emit `{}` instead of the
primitive.

The third rule, `api-handrolled-500`, was red on `main` too (93) but had a safe
fix: Express 5.2.1 forwards rejected handlers to `errorHandlerMiddleware`, so
five local catch-and-500s were bypasses. 93 -> 88, under the 89 baseline.

**Decision needed:** whether to work the two remaining rules down to their
baselines or re-baseline them with the drift recorded. That is a gate-policy
call, not a cleanup call.

## Pre-existing suite state

`vitest run backend/tests` on this branch: **43 failed files / 18 failed tests /
862 passed**, byte-identical before and after every change in this batch. That
red is inherited, not introduced, and is unrelated to the layer work.
