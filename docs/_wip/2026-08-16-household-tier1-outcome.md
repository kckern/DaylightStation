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
