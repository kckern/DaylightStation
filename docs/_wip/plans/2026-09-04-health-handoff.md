# Health App — Handoff, 2026-09-04

State of the `/health` work at the point this session ended. Written for whoever
picks it up next. Everything below was verified against the running system, not
recalled.

---

## 1. Where things actually are

| | Commit | Note |
|---|---|---|
| `main` | `c21ba38b0` | in sync with `origin/main` |
| **Deployed (prod)** | `c21ba38b0` | `build.txt` 2026-09-04 09:17 PDT — matches main |
| `feat/health-usability` | `4e3970a62` | **not merged**, not deployed |
| `feat/catalog-density` | `b76c35ea5` | **not merged**, not deployed |

Worktrees: `.claude/worktrees/health-usability`, `.claude/worktrees/catalog-density`.
Both were live when this ended — **check for running agents before touching either**
(`ps -eo args | grep health-usability`).

### The 40-task usability program is DONE and LIVE
All 10 phases (0–10) are merged and deployed. Every phase was adversarially
reviewed, findings driven rather than read, fixes falsified before acceptance.
Reasoning is recorded in `docs/_wip/plans/2026-09-03-health-usability-decisions.md`
— **36 numbered decisions; that file is the SSOT for why anything is the way it
is.** Read it before changing health code.

---

## 2. Unfinished work, in priority order

### 2.1 `feat/health-usability` @ `60c7e2f18` — capture date context
**Ships a real bug fix that is NOT yet live.** The user logged food while viewing
*yesterday* and it landed on *today*. Cause: no capture path carried the viewed
date — `POST /catalog/quickadd` took `{catalogEntryId, mealTime}`, `/nutrition/input`
took `{type, content, bucket}`, and the service stamped "today" internally.
Commit `60c7e2f18` threads the viewed date through. A second defect was dispatched
in the same task and **its status is unconfirmed** — see §4.

### 2.2 `feat/catalog-density` @ `dff385f79` — catalog stores observations
Replaces "latest wins" (`FoodCatalogService.mjs:100-107`) so the catalog derives
nutrition from an observations ring instead of being overwritten by the most
recent capture. Status unconfirmed at handoff — see §4.

### 2.3 Icon manifest — STAGED, NOT LIVE
`data/household/apps/health/icon-manifest.yml` was rewritten in place to serve
**only** the hi-res set: 534 icons + 21 aliases, zero entries pointing at the old
`img/icons/food/` set. Backup alongside it: `icon-manifest.pre-hires-only.yml`.

**It needs a container restart** — the manifest is read once at boot. Until then
`/nutrition/icons/chicken` still serves the old 998-byte file while `carrot`
serves the new one.

**Known cost, accepted by the user:** only **12 of 258** legacy slugs have an
honest equivalent in the new vocabulary. It is a specific-dish set with no plain
`chicken`, `cheese`, `fish`, `kale` or `ranch`, so ~50 of 71 stored rows will show
the neutral dot rather than a wrong picture. Mapping `chicken → fried-chicken-bucket`
was refused as a guessed fallback.

---

## 3. Live data already changed (all reversible)

| File | Change | Backup |
|---|---|---|
| `.../nutrition/food_catalog.yml` | entry `9bc6be67` Premier Protein Shake 610/66/18/15 → **160/30/4/3** | `food_catalog.pre-premier-fix.yml` |
| `.../nutrition/nutrilist.yml` | the one 2026-09-04 row corrected 610 → 160 | `nutrilist.pre-premier-fix.yml` |
| `household/apps/health/icon-manifest.yml` | hi-res only | `icon-manifest.pre-hires-only.yml` |
| `media/img/music/instruments/` | 85 SVGs restored from a Dropbox conflicted copy | conflicted copy left intact |

All under `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/users/kckern/lifelog/`
unless noted. The `claude` user cannot read the data volume — use
`sudo docker exec daylight-station sh -c '...'`.

---

## 4. Both agents finished — final status

Both stopped cleanly, committed through the full pre-commit chain, and needed no
`--no-verify`. Trees are clean.

### `feat/health-usability` — `60c7e2f18`, `4e3970a62`
- **Defect 1, capture date: DONE.** The viewed day travels with quick add, typed
  sentence, voice, photo, barcode, the unknown-UPC custom-food branch, and
  template instantiation. Absent still means today. Text/voice take the day as an
  *anchor* on the existing `asOfDate` seam, so "this morning" resolves against the
  viewed day while a date the model computes still wins — passing it as
  `LogFoodFromText`'s `date` override would have flattened "yesterday".
  `createdAt`/`settledAt` stay wall-clock. Bucket rule: the clock speaks only for
  today; on any other day the target is that day's first meal (decision 2.41).
- **Defect 2, voice: code complete, NOT gated.** Persist-before-transcribe
  (`VoiceMemoStore`, sibling of `PhotoStore`), 5-attempt/90s retry budget with
  jitter, a human error sentence instead of `HTTP 500: socket hang up`, and a
  retry endpoint + "Try again" so nothing is re-recorded. **Missing: a full-repo
  verdict.**
- **My feed-harvest hypothesis was WRONG.** It is an hourly `:25` cron, not a
  post-boot job, and ran 23 more times that day at identical volume with
  concurrency hard-capped at 3. Two ECONNRESETs at ~15.1 s against our own 60 s
  timeout point upstream. The agent correctly refused to throttle it on a story.
- 33 mutations, all produced the matching failure — after it repaired **two of its
  own tests caught passing for the wrong reason**.

### `feat/catalog-density` — `dff385f79`, `b76c35ea5`
All six items DONE. `nutrients` is now a getter over `deriveCanonical`; "latest
wins" is deleted; the capture guard runs *before* the catalog donation and
corrects nothing; UPC provenance fills-never-renames and weights 3 in the
derivation.
- **Deliberate deviation:** drift proposals do **not** go through
  `TemplateService.saveProposals` — that mints a meal template with `components`
  that appears in the meal picker, so Approve would create a meal rather than fix
  a food. The **dismissal ledger** is reused via a new `dismissKey`, namespaced
  `catalog-density:<name>`.
- **Reconcile proven idempotent on a COPY** — 560/0/0, one identical SHA-256
  across three runs, `useCount` untouched. **Nothing was written to the data
  volume.**
- Premier Protein Shake, against the pre-fix catalog: 610 kcal → derived
  **192 kcal / 36.1 g** at the household's median 415 g portion (density 0.4638
  kcal/g). Quick-add at the remembered 385 g yields **178**, not 610. A fresh
  610/385 parse is flagged at **3.42×, "~179 expected"**.
- 23 mutations, all fail their named test — after closing one genuinely vacuous
  guard stub that never inspected its arguments.

### THE STEP THAT MAKES IT REAL
**The reconcile has no route and no scheduled task.** It is reachable only one
entry at a time via `POST /nutrition/catalog/audit/approve`. Existing entries keep
their old numbers until someone deliberately seeds all 560 rings. That was
intentional — it rewrites a lot at once — but it is the step that makes the fix
take effect on live data, and it **needs a backup of `food_catalog.yml` first**.

### Known-failing test, caused by a live data change, not by either branch
`backend/src/1_adapters/persistence/IconManifestStore.media.test.mjs` fails on
both branches and on a pristine tree. It reads the real media mount, and §2.3's
hi-res-only manifest rewrite is what changed under it. **Fix the test or revert
the manifest — do not baseline it blindly.**

## 5. Deploy sequence (do not shortcut)

```bash
# 1. gate must be able to HALT — run it as its own step
./scripts/deploy-gate.sh; echo "EXIT=$?"      # 0 = clear, 1 = someone is using it
# 2. build only on exit 0
./scripts/build-daylight.sh
# 3. RE-RUN the gate — a build takes minutes and someone can walk up
./scripts/deploy-gate.sh; echo "EXIT=$?"
# 4. deploy
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

The gate blocked once during this session for exactly the right reason (a school
media lesson playing plus Portal activity). The user then explicitly reaffirmed
"deploy", and it was overridden **on their instruction** — that interrupted a
video. Absent an explicit override, a blocked gate means wait.

---

## 6. Traps that cost real time here — read this section

**Four different things masqueraded as a verdict in one day.** Always
`cmd > log 2>&1; echo "EXIT=$?" >> log` and read `EXIT=` from the log:

| Looked like a verdict | Actually measured |
|---|---|
| `gate \| tail` exit 0 | `tail`'s status |
| `git status --short && echo "TREE CLEAN"` | the echo, which prints either way |
| background-task "completed, exit 0" | the **wrapper's** exit |
| `GATE_OWN_EXIT=137` | SIGKILL — **no verdict at all** |

Also a non-verdict: `gate-vitest` **exit 2** (a chunk produced no JSON report, so
files never ran). Never record it as pass or fail; re-run.

**One writer per worktree.** A reviewer that falsifies rewrites each target file
twice. Running a gate in the same tree produced a phantom red that took hours to
diagnose. Run the authoritative gate on a tree nobody is editing.

**Never `pkill -f`.** A pattern kill aimed at one gate killed another agent's run
and, separately, an unrelated worktree's process. Kill by PID or `setsid` PGID.

**`scripts/gate-vitest.mjs` was improved** (`c266035c6`): it now keeps one report
generation at `.prev` and prints the failing test name plus its first failure
lines, because the next run used to delete the evidence.

---

## 7. Open decisions for the user

1. **Re-icon history?** ~50 of 71 rows will show the neutral dot once the hi-res
   manifest is live. A one-time pass re-assigning icons from the new 534-word
   vocabulary would fix them. Not run — it rewrites logged rows.
2. **Merge the 15 Premier Protein duplicates?** They split history and ranking.
   Advice on record: not worth it, ranking already suppresses singletons; the
   prompt fix stops new ones. User's call.
3. **The `SentenceLadderProgram` / `RubiksCubeProgram` / `quizScanRecorder` gate
   flakes** are pre-existing roaming victims, reproduced at base commits, and were
   deliberately **not** baselined.

---

## 8. Second opinion on record (worth reading before touching the catalog)

A second-opinion pass overturned the first design and the evidence is in the
session. Headlines, all verified against the data:

- The 610 came from one capture on **2026-08-19** ("one bottle of Premier Protein"
  → 385 g / 610 kcal), not an old entry.
- "Latest wins" is the **normal** state: 68 of 188 entries with real history sit
  ≥1.5× off their own median, and they are portion multiples, not parse errors.
- A **"verified sources only" write rule is unimplementable** — all 683 entries are
  `source: nutritionix` with no `barcodeUpc`, because `LogFoodFromUPC.mjs:205-212`
  hard-codes the literal and discards the UPC across 224 UPC logs.
- **kcal/gram is the stable invariant**: within a name, calorie CV 0.36 vs density
  CV **0.07**. A density check flags 37 of 2,608 rows (1.4%) across 174 names.
- An **LLM curator was rejected as over-engineering** — the arithmetic separates
  parse errors from portion variance, and adding a second model to police the
  first buys nothing.

---

## 9. Verify the system is healthy

```bash
curl -s http://localhost:3111/build.txt                       # deployed commit
curl -s "http://localhost:3111/api/v1/health/budget?date=$(date +%F)"
curl -s "http://localhost:3111/api/v1/health/nutrilist/$(date +%F)"
curl -s http://localhost:9428/select/logsql/query \
  -d 'query=context.app:health AND _time:1h' -d 'limit=50'    # health events
```
Archived-day regression check (this was broken in prod and is now fixed —
`getBudget` used to read the hot file only):
```bash
curl -s "http://localhost:3111/api/v1/health/budget?date=2026-07-30"   # food must be 248, not 0
```
