# Household Reorganization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Collapse `data/household/`'s five overlapping roots into one domain-first layout, fixing the two live bugs the ambiguity has already produced.

**Architecture:** `household/<domain>/` owns everything for that domain. Inside a domain, `log/` is the one reserved name — append-only, date-keyed, prunable; everything else in the folder is live state. `config/` and `auth/` stay at the root because the bootstrap loads them before any path resolver exists. `screens/` and `assets/` stay because they are a different scope (per-surface, shared static), not domains.

**Tech Stack:** Node.js ESM, vitest, js-yaml. No new dependencies. The data lives on a Dropbox-synced volume, which constrains how files may be moved (see Ground Rules).

---

## Ground rules — read before touching anything

**1. Never `rm -rf` inside the data directory. Move to `_deleteme/`.**
Project rule, and it has saved us already. `mv <path> /Users/kckern/Documents/GitHub/DaylightStation/_deleteme/<descriptive-name>`. The user empties it manually. `rm` is permission-blocked in the data dir anyway.

**2. A Dropbox folder can read as EMPTY when its files are online-only.**
Do not conclude "this directory has no files" from `find -type f | wc -l` alone. Confirm with `ls -laR`: a real online-only placeholder still appears as a directory entry with a size; a genuinely empty directory shows only `.` and `..` at 64 bytes. Getting this wrong deletes data.

**3. Every move is copy → verify → relocate original.**
Never `mv` a tree you have not first checksummed. The pattern:
```bash
cp -Rp "$SRC" "$DST"
diff -r "$SRC" "$DST" && echo IDENTICAL
find "$SRC" -type f -exec shasum -a 256 {} \;   # compare against the same over $DST
mv "$SRC" "$REPO/_deleteme/<name>"
```

**4. The coupling is the key string, not the resolver.**
`ConfigService.getHouseholdPath(rel, hid)` resolves `data/household[-{hid}]/<rel>`, and `DataService.household.read/write(rel)` funnels into it. So a move is "cheap" only when the relative path string appears in one or two places. Grep for the literal segment, not just for the helper.

**5. `getHouseholdAppPath` is dead — do not build on it.**
`UserDataService.mjs:274` builds `data/households/apps/{app}` (note plural `households/`), a path that does not exist on disk. Treat it as legacy.

---

## THE DEPLOY HAZARD — read before moving any data

**The data directory is Dropbox-synced, and prod runs against the same tree.**

Local: `~/Library/CloudStorage/Dropbox/Apps/DaylightStation/data`
Prod container mount: `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data → /usr/src/app/data`

Those are the same Dropbox account. **A directory you move on the laptop propagates to the running production container within seconds**, while that container is still executing code that expects the old path. Every Tier 1-4 move therefore has a window where deployed code and on-disk data disagree, and the failure mode is not always loud — several relays *create* a missing directory rather than erroring, so the app comes up healthy and quietly writes into an empty tree.

This is not a theoretical concern. It is the single most likely way this reorganization causes an outage.

**Required sequence for every data move:**

1. **Make the code read both paths first.** Land a commit where the adapter tries the new path and falls back to the old one. Deploy it. Verify prod is healthy.
2. **Then move the data.** Prod is already reading the new location; the fallback covers the sync window.
3. **Verify on prod**, not just locally — `ssh homeserver.local` and confirm the app still resolves the data.
4. **Only then remove the fallback**, as a separate commit.

A move without the read-both step is a coin flip on whether anyone is using the app during the sync.

**Alternative, if a domain is genuinely idle:** stop the container, move, redeploy. Simpler and acceptable for low-traffic domains — but confirm idleness rather than assuming it, and never do this for anything the household uses on a schedule.

---

## Prerequisite for Tier 3 — DONE

A recursive grep for embedded path strings across the wider data tree timed out against the local Dropbox mount. It has since been run on the server against the real tree:

```bash
ssh homeserver.local "grep -rn --include='*.yml' --include='*.json' \
  -E 'household/(apps|common|shared|history)/' \
  /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data"
```

**Result: 8 hits, of which only 4 are real values** — exactly the four already named in Tier 3 (`scales.yml`, `vehicles.yml`, `games.yml`, `retroarch.yml`). The other four are comments (`piano.yml:12`, `school.yml:217`, a conflicted-copy header in `users/learner3/`) and one incidental match: a git commit log pasted inside a journal entry at `users/kckern/lifelog/journalist/debriefs.yml`.

**No hidden Tier 3 blockers.** The list in Tier 3 is complete.

Any hit is a path stored *inside a file's contents* — a Tier 3 item that needs a data migration, not a rename. **Tiers 0-2 do not depend on this. Do not start Tier 3 until it has run.**

---

## Tier 0 — Free. No layout change, no code coupling.

Fixes the two live bugs and removes junk. Nothing here commits you to the reorganization.

### Task 1: Fix household calendar reads

Household calendar reads are dead. `getHouseholdSharedPath` hardcodes the segment `'shared'`, so `readHouseholdSharedData(hid, 'calendar')` resolves to `household/shared/calendar.yml` — which does not exist. The real file is `household/common/calendar.yml` (40 KB). The fallback in the router lands on `household/apps/common/calendar.yml`, also nonexistent.

There are exactly two callers, both reading `'calendar'`:
- `backend/src/4_api/v1/routers/calendar.mjs:47`
- `backend/src/1_adapters/weekly-review/WeeklyReviewCalendarAdapter.mjs:63`

**Files:**
- Modify: `backend/src/0_system/config/UserDataService.mjs:260-262`
- Test: `tests/isolated/` — find the existing UserDataService suite first (`ls tests/isolated/**/userDataService*` and `grep -rl "getHouseholdSharedPath" tests/`); create one only if none exists.

**Step 1: Write the failing test**

```javascript
it('resolves household shared data to common/, where the data actually lives', () => {
  const svc = makeUserDataService();           // follow the file's existing harness
  const p = svc.getHouseholdSharedPath('default', 'calendar');
  expect(p).toMatch(/household[^/]*\/common\/calendar$/);
  expect(p).not.toContain('/shared/');
});
```

**Step 2: Run it, confirm it fails**

Expected: FAIL — the path contains `/shared/`.

**Step 3: Change the segment**

`UserDataService.mjs:261`:
```javascript
  getHouseholdSharedPath(householdId, ...segments) {
    return this.getHouseholdDataPath(householdId, 'common', ...segments);
  }
```
Update the JSDoc above it — it says "household shared data path"; make it say `common/`, and note that `shared/` is a legacy root holding `content-filter`/`retroarch` which are reached by other means.

**Step 4: Prove the real read works end to end**

```bash
node -e "
process.env.DAYLIGHT_BASE_PATH='/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation';
" # then exercise the calendar route or the adapter per this repo's usual harness
```
At minimum, assert the resolved path exists on disk:
```bash
ls -la "/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/common/calendar.yml"
```

**Step 5: Commit**
```bash
git add backend/src/0_system/config/UserDataService.mjs tests/...
git commit -m "fix(household): resolve shared household data to common/, repairing calendar reads"
```

---

### Task 2: Fix the gratitude seed script's write path

The seed script writes to `household/shared/gratitude`, which **nothing reads and which does not exist on disk**. The live datastore reads and writes `common/gratitude/` (`YamlGratitudeDatastore.mjs:60,70`), and the real data is there — 9 files.

So the script is the wrong one; do not "fix" the readers.

**Files:**
- Modify: `scripts/data-management/generate-gratitude-data.mjs:7`

**Step 1: Change the path**
```javascript
const baseDir = path.join(dataPath, 'household', 'common', 'gratitude');
```

**Step 2: Verify against the live tree (read-only)**
```bash
ls /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/common/gratitude/
```
Expected: `options.gratitude.yml`, `options.hopes.yml`, `discarded.*.yml` — the shape the script generates. Do **not** run the generator against live data; it would overwrite real entries.

**Step 3: Commit**
```bash
git add scripts/data-management/generate-gratitude-data.mjs
git commit -m "fix(gratitude): seed script writes to common/, where the datastore actually reads"
```

**Step 4: Correct the stale memory**

The assistant memory `reference_gratitude_data_model` states the path as `data/household/shared/gratitude/...`. That is now wrong. Update that memory file to say `common/gratitude/` and note the datastore file:line as the authority.

---

### Task 3: Fix the stale "apps/ removed" comment

`UserDataService.mjs:289` comments the fallback as `// Legacy fallback: apps/<appName>/<segments> (deprecated - directory removed)`. The `apps/` directory very much exists and holds seven domains. A future reader will trust this and be wrong.

**Files:** Modify `backend/src/0_system/config/UserDataService.mjs:288-290`

Replace the parenthetical with the truth: `apps/` still exists and is still read; it is slated to dissolve into `<domain>/` per `docs/plans/2026-08-15-household-reorganization.md`.

**Commit:** `docs(household): correct stale comment claiming apps/ was removed`

---

### Task 4: Sweep junk out of the data tree

**No code touches any of this.** Move, never delete. Verify emptiness per Ground Rule 2 before moving anything that looks empty.

Targets under `/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/`:

| What | Why |
|---|---|
| ~60 `*.bak-*` and `* (…conflicted copy…)*` files | Dropbox conflict residue and manual backups |
| AppleDouble `._*` files, `.DS_Store` | macOS noise |
| `config/untitled folder` | accidental |
| `common/school/` | empty, zero code consumers |
| `shared/komga/hero/` | orphan — no reader anywhere in the repo |
| `apps/piano/producer.backup-v1-2026-08-10T…/` | stale manual backup |
| `apps/gaming/games/`, `apps/fitness/workouts/`, `shared/retroarch/thumbnails/`, 6 × `.drafts/` | empty dirs |

**Step 1: Inventory first, move nothing**
```bash
B="/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household"
find "$B" \( -name "*.bak-*" -o -name "*conflicted copy*" -o -name "._*" -o -name ".DS_Store" \) | tee /tmp/junk-list.txt | wc -l
```
Read the list. Anything surprising, stop and ask.

**Step 2: Confirm the "empty" ones really are empty**
```bash
for d in "$B/common/school" "$B/apps/gaming/games" "$B/apps/fitness/workouts" "$B/shared/retroarch/thumbnails"; do
  echo "== $d"; ls -laR "$d" 2>/dev/null | head -6
done
```
A genuinely empty dir shows only `.` and `..`. If you see any entry with a size, it is NOT empty — leave it and report.

**Step 3: Move to `_deleteme/`, grouped so it can be reversed**
```bash
R="/Users/kckern/Documents/GitHub/DaylightStation/_deleteme"
mkdir -p "$R/household-junk-2026-08-15"
# move each target under that folder, preserving relative structure
```

**Step 4: Verify the tree still loads**
```bash
npx vitest run tests/isolated/config/ tests/isolated/application/school/
```
Expected: no new failures vs. the baseline you recorded before starting.

**No commit** — nothing in git changed. Note in the execution log what was moved.

---

## Tier 1 — Cheap moves. One or two call sites each.

> **EXECUTED 2026-08-16 on the server — see `docs/_wip/2026-08-16-household-tier1-outcome.md`.**
> Seven domains moved (feedback, feed, gameshow, newsreporter/log, media,
> gaming/games, cli/log); 73 files, all originals preserved in
> `data/_deleteme/`. **Four escalated to Tier 2** — `finances`, `komga`,
> `gratitude`, and `weather` all exceed the one-or-two-site budget, and
> `weather`/`komga` are split across two roots so they must move whole.
> **`common/cost` does not exist.** Three corrections to this plan's method
> are recorded in that outcome doc — read it before starting Tier 2.

Each of these resolves through `getHouseholdPath()` / `dataService.household.read`, so the move is: change the key string, move the data, run the tests.

**Do them one domain at a time, one commit each.** Do not batch — a batched failure is much harder to localize.

**The repeatable pattern, per domain:**

1. `grep -rn "<old-path-segment>" backend/src cli scripts --include="*.mjs" | grep -v test` — confirm the call-site count matches what's expected below. **If you find more than listed, stop and report** — the audit may have missed one, and that changes the tier.
2. Write/adjust a test asserting the NEW path resolves.
3. Change the key string(s).
4. Copy → verify → relocate the data per Ground Rule 3.
5. Run the domain's tests plus `tests/isolated/config/`.
6. Commit: `refactor(household): move <domain> to <domain>/[log/]`.

**The Tier 1 list:**

| Current | Proposed | Notes |
|---|---|---|
| `apps/media/queue.yml` | `media/queue.yml` | state |
| `apps/gaming/games` | `gaming/games` | currently empty — moves as an empty dir, or skip if Task 4 removed it |
| `common/cost` | `cost/` | |
| `common/feedback` | `feedback/` | |
| `common/finances` | `finances/` | backend consumers only |
| `common/feed` | `feed/` | |
| `common/gratitude` | `gratitude/` | **do Task 2 first**, and update `YamlGratitudeDatastore.mjs:60,70` |
| `common/komga/toc` | `komga/cache/toc/` | derived cache — could equally be discarded and regenerated |
| `state/gameshow` | `gameshow/` | |
| `history/newsreporter` | `newsreporter/log/` | |
| `history/weather` + `common/weather.yml` | `weather/log/` + `weather/current.yml` | two sources, one domain |
| `cli-transcripts/` | `cli/log/` | one consumer, `cli/_bootstrap.mjs:259` |

---

## Tier 2 — GATED. Multi-literal, coordinated edits.

**Do not start until all of Tier 1 is merged and the app has run clean for at least one full day**, so any latent path breakage surfaces before more churn lands.

Each of these has the path spelled out in many places, often bypassing `ConfigService` entirely.

### 2a. `common/weekly-review` → `weekly-review/log/` — the riskiest single subtree
**Eight independent** `path.join(this.#householdDir, 'common', 'weekly-review', …)` calls in `WeeklyReviewService.mjs` (lines 196, 223, 282, 310, 351, 372, 403, 423) with no shared helper. 48 MB of date-keyed data.

**Do this first:** extract those eight into one private `#reviewPath(...segments)` helper and commit that refactor **on its own, with no path change**. Verify tests pass. Only then change the one helper. A single-line path change is reviewable; an eight-line one is not.

### 2b. `history/media_memory` → `media/memory/`
Sites: `app.mjs:809,812`; `MediaMemoryService.mjs:27,39,45`; `ArtAdapter.mjs:40`; four CLI scripts. Same extract-then-move discipline.

### 2c. `history/hardware/volLevel` → `hardware/volLevel.yml`
One literal at `homeAutomation.mjs:160` feeding eleven `loadFile?.`/`saveFile?.` calls at `:165-213`. Low file count, mechanical.

### 2d. `history/fitness` → `fitness/log/`
75 MB, 3,187 files, **and roughly 19 CLI scripts hardcode `path.join(dataDir,'household','history','fitness')` while bypassing ConfigService** (`cli/lib/fitness/context.mjs:63`, `heal.mjs:163,192`, `merge.mjs:158`, `split.mjs:244`, plus eight `backfill-*` scripts).

Route every one of them through a single exported helper first, as its own commit. Note `history/fitness/_index/{YYYY-MM}.json` is a derived shard set (`YamlSessionDatastore.mjs:569`) — it moves with its parent and must be regenerated or invalidated afterward, never moved separately.

### 2e. Three sites that already break on a non-default household
These bypass `getHouseholdPath` today and would fail for any `hid` other than the default. Fix them regardless of whether their data moves: `app.mjs:2516` (`apps/fitness/exercise-index.yml`), `app.mjs:1205` (`apps/livestream/programs`), `app.mjs:2237` (`assets/icons`).

---

## Tier 3 — GATED on the homeserver sweep. Paths stored inside file contents.

Four household config files store data paths **as values**, read at runtime as overrides. Move the directory without editing these and the relay **silently creates an empty tree instead of erroring** — the failure is invisible.

| File | Key | Consumer |
|---|---|---|
| `config/scales.yml:21` | `dir: household/history/nutrition` | `foodScaleRelay.mjs:35,77` |
| `config/vehicles.yml:26` | `dir: household/history/automotive` | `AutomotiveContainer.mjs:49-53`, `automotiveRelay.mjs:46,103` |
| `config/games.yml:54` | `base_path: …/shared/retroarch/thumbnails` | |
| `config/retroarch.yml:49` | `base_path: …/shared/retroarch/thumbnails` | |

Config edit and directory move must land in the **same commit**.

Seven relay `DEFAULT_DIR` constants also embed the literal `household/` prefix (`omrRelay.mjs:51`, `foodScaleRelay.mjs:35`, `barcodeRelay.mjs:30`, `pressureMatRelay.mjs:24`, `automotiveRelay.mjs:46`, `quizScanRecorder.mjs:33,34`, `AutomotiveContainer.mjs:28,29`). Each already has a config-override seam, so they are the safest hardcoded sites — provided the config edits above land alongside.

**Unverified and must be checked first:** whether any of these paths are additionally baked into the ESP32 firmware image by the flash tooling. The flash comment points at the `provisioning:` block rather than `persistence:`, but confirm before moving. Label the finding measured-vs-inferred when you report it.

---

## Tier 4 — Its own plan. The School grading chain.

`content/school/print-documents/{published,derived-banks,allocations}` → household, plus School's own household data.

School's adapters are unusually well-behaved — fourteen `Yaml*Store` classes all resolve through `getHouseholdPath` — but three CLIs hardcode paths (`cli/school-docs.cli.mjs:612`, `cli/school-rekey-learner.cli.mjs:82`, `cli/school-atlas-sim.cli.mjs:79`), and critically **a card scan resolves published documents by path at grade time**.

That makes this the one move that can break physical paper already in a child's folder. It requires:
- printing idle and no outstanding unscanned sheets,
- an atomic move,
- a verification pass that reprints a known instance (`reprint <instanceId>`) and byte-compares against a pre-move render.

**Write a separate plan for this. Do not fold it into a Tier 1-3 session.**

---

## Rollback

Every tier is reversible because nothing is deleted — data moves to `_deleteme/<name>` and code changes are individual commits. To reverse a tier: `git revert` its commits, then move the data back from `_deleteme/`. Do not empty `_deleteme/` until the reorganization has run clean for a week.

## Definition of done

- `household/` contains only `<domain>/` folders plus `config/`, `auth/`, `screens/`, `assets/`.
- `apps/`, `common/`, `shared/`, `history/`, `state/`, root-level `automotive/`, `cli-transcripts/` are gone.
- No name appears under two roots.
- `household/*/log/` globs exactly the prunable data and nothing else — verify by listing what it matches and confirming every hit is genuinely append-only.
- `docs/reference/core/configuration.md` documents the rule.
- The two live bugs have regression tests.
