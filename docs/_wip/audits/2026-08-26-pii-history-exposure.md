# 2026-08-26 — Household PII in public git history: audit and decision brief

**Status:** decision-ready. Read-only audit; nothing here has been executed.
**Repo:** `kckern/DaylightStation`, PUBLIC on GitHub. Analyzed at `origin/main` = `d285217dab` (fetched 2026-08-26). Local `main` was `fe1870b58c` at audit start and moved during the audit — the branch is under active parallel work.
**Pattern set:** the gitignored `.claude/secret-patterns.local.txt` — seven household first names ("learner names" below), two grandparent slugs, seven numeric fitness device IDs, one personal email. This document names none of them; hits are shown redacted.

---

## 1. What the earlier "PII history rewrite" actually was

The record in `docs/_archive/deleted-branches.md` overstates it. Empirically:

- `backup/pre-pii-rewrite` (`f74979545e`) and the rewritten lineage (`47f5d592da`, the deleted `rewrite-pii` branch tip, an ancestor of today's `main`) share a merge-base at `1e9443fab3` (2026-08-16) and differ by **exactly 10 commits on each side** (`git rev-list --count` both directions: 10/10).
- Those 10 commits are the `feat/display-capability-guard` branch. The rewrite's entire content delta, measured pairwise, is **two lines in one file**: a household name in a menu-tile label and symptom sentence in `docs/_wip/bugs/2026-08-16-display-action-capability-mismatch.md`, replaced from the point of introduction forward.
- The tip trees are **byte-identical** (`git diff backup/pre-pii-rewrite 47f5d592da` is empty), and author/committer identity and dates are preserved on every pair.
- The 10 original commits were **never pushed**: no remote branch contains `f74979545e`, and the GitHub API returns "No commit found" for it. The rewrite was pre-push hygiene on a local branch. It never touched public history.

So the sweep note's claim that "the 2026-08-16 PII history rewrite changed every commit hash in the repo" is wrong. Current `main` contains the whole pre-rewrite history: `git log main..backup/pre-pii-rewrite` lists only those 10 commits, and 11,182 of the backup's 11,192 commits are reachable from `main`. Whatever caused old branches to report thousands of unmerged commits in the 2026-08-25 sweep, it was not this rewrite. **No broad history rewrite has ever happened.**

## 2. What is exposed on public `origin/main` right now

Method: every text blob reachable from `origin/main` (47,571 blobs ≤10MB, from `git rev-list --objects` + `cat-file --batch`) was scanned for the full pattern set with case-insensitive word-boundary regexes; tree states were sampled at dated commits with `git grep -w`; commit-level counts came from `git log --pickaxe-regex` filtered to word-bounded matches. Binary blobs and blobs over 10MB were listed but not content-scanned.

### The tip is dirty, and the fix is unpushed

The 283-file placeholder scrub is commit `51d90959c` (2026-08-26, riding in a commit titled "refactor(school): one declaration of the story-time id and default target"). At audit time it sat among **19 unpushed commits** (`origin/main..main`). The public tip `d285217dab` therefore still carries learner names in **212 files** and real fitness device IDs in one file (`docs/_wip/plans/2026-06-25-fitness-hr-profile-classification.md`). Until that push happens, even the "clean tree" exists only locally.

### History totals

| Measure | Value |
|---|---|
| Commits on `origin/main` | 12,056 |
| Text blob versions matching ≥1 pattern | 1,892 |
| Distinct file paths ever matching | 685 |
| Commits whose diff adds/removes a learner name (word-bounded) | 672 |
| First public commit introducing a learner name | `1b2ef5735`, 2025-09-26 |
| File paths whose **filename** contains a learner name | 2 (both under `_extensions/ti86-app/`) |

Distinct paths per pattern: the four most-used learner names appear in 438, 342, 179, and 141 paths respectively; the other three in 9, 3, and 1. A grandparent slug appears in 3 paths. The device-ID group matches 59 paths, of which 2 are coincidences (ESP-DSP FFT bit-reversal tables); the rest are real IDs in fitness tests, one committed session fixture, and plan/audit docs. The personal email appears in 2 doc paths — and, unavoidably, in the author field of every one of the 12,056 commits, so blob-level removal of it is cosmetic.

Names first entered history on 2025-09-26 (`1b2ef5735`), in a fitness simulation file mapping real device IDs directly to children's first names; that file left the tree again within days. Sustained presence begins 2025-12-18 (`8dc7055fe`). Tree contamination at sampled commits (files matching learner names, word-bounded): 0 at 2025-10-01 and 2025-11-15 → 10 on 2026-01-01 → 123 on 2026-03-01 → 204 on 2026-06-01 → **17 on 2026-08-01** (the July externalization worked) → **212 at today's public tip**. The August regression is the school/teacher-workspace and TI-86 work; the 2026-08-26 scrub reverses it but is unpushed.

### Sensitivity: mostly labels, with a handful of worse spots

By file kind (distinct paths): 372 test/fixture, 241 docs (plans, audits, postmortems), 71 source files, 1 data file. The bulk is a first name used as a fixture label or roster id. Materially worse than a bare first name:

- **Name + birth year rosters** in school test fixtures (`TeacherGate.test.mjs`, `GetTeachers.test.mjs`, `PrintService.deny.test.mjs`): a child's first name with `birthyear: 2014`-style fields, alongside adult household members.
- **A health claim**: one memory-skill test fixture stores "`<name-1>` is allergic to peanuts". Probably invented for the test; a reader cannot tell.
- **Names + quiz/progress data** across the TI-86 CLI cases and school fixtures; names + heart-rate/session data in fitness fixtures and postmortems, including one committed prod session summary (`logs/prod-session-summary-20260114.md`) naming two children as session participants.
- **A committed binary** (`_extensions/ti86-app/dist/.../DSUSERS.86s`) matches learner names (`git grep` at the public tip); binaries were otherwise outside the text scan.
- Since the surname is derivable from the repo owner everywhere, first names here are effectively full names.

No street addresses, phone numbers, or full birthdates were found near names (regex sweep over all 1,892 matching blobs).

### Two gaps the pattern set does not cover

1. **The spouse's first name and id** appear in the same rosters (6+ files at today's local `main` tip, more in history). Not in the pattern file, not scrubbed, not guarded. Adult, so lower sensitivity — but any rewrite keyed to the pattern file will keep it. Decide deliberately.
2. **The whitelisted lullaby media title** contains a learner name and is deliberately kept in 3 tip files (`.claude/hooks/secret-guard.sh`, `_extensions/playback-hub/README.md`, the externalization handoff doc). Any global replace-text rewrite would alter these files at the tip and break the guard's own whitelist line. This needs an explicit call (see option B).

### Other public refs

- `origin/feat/surround-containers`: 0 commits ahead of `origin/main`; a stale pointer whose tree carries names in 121 files. Deleting the remote branch costs nothing.
- `origin/feature/obd-relay`: 1 unique commit; tree carries names in 8 files. The work is superseded on `main` (per the 2026-08-25 sweep).

### How far it has spread

- **0 forks, 2 stars, 1 watcher, no GitHub Pages, no open issues.**
- Software Heritage has **not** archived this repo (API: origin not found).
- GH Archive records push events (SHAs, messages), not file contents.
- GitHub keeps orphaned objects fetchable by SHA after a force-push until Support runs a GC; the cached-view purge is a standard "remove sensitive data" support request.

With zero forks and no third-party archive, this is close to the best case for after-the-fact remediation: the exposed copies are GitHub's own, and GitHub has a process for purging them.

## 3. Was the rewrite faithful?

Yes — conclusively, because its scope was tiny. Tip trees identical, all metadata preserved, delta limited to the intended two lines. The question the backup branch was retained to answer is now answered. There is nothing further the branch can verify.

## 4. Options

**(a) Leave history as-is (push the scrub, change nothing else).**
Cost: zero effort. Consequence: eight months of public history keep the children's names, birth-year rosters, the allergy line, and quiz/fitness data, forever, in a repo whose commit log now also documents (via scrub commits and the guard) exactly which strings were sensitive — a scrub in the tip with dirty history is a map to the PII, not a removal of it. Rejected.

**(b) Full-history rewrite (git-filter-repo) + force-push + GitHub Support purge.**
This is the only path that removes the material while staying public. Costs: every clone and worktree invalidated (7 worktrees on this machine, the deploy tree at `{env.prod_host}:/opt/Code/DaylightStation` plus its worktrees, possibly the garage box); all recorded commit hashes — including every restoration hash in `docs/_archive/deleted-branches.md` and in agent memory — go stale; the two extra origin branches must be deleted or rewritten; orphaned objects remain fetchable until Support acts; and the multi-machine workflow must freeze during the cutover. With 0 forks the usual "forks keep the data" caveat does not apply.

**(c) Make the repo private.**
One command, reversible, immediate, no history surgery, no machine breaks (SSH-key access continues for the owner). Removes the entire public exposure today. Cost: the repo stops being publicly browsable — with 2 stars and 0 forks, approximately nobody is affected. It does not clean history; it removes the audience.

**(d) Delete and recreate the repo.**
Strictly worse than (b)+(c): loses stars/watchers/settings and every external link, for erasure that (c) achieves instantly and (b)+Support achieves while keeping the repo. Rejected.

## 5. Recommendation

**Flip the repo private today, then rewrite history without time pressure, and only re-publicize (if ever) after the rewrite is verified.** Reasoning: (c) ends the exposure in one reversible command; every other option takes hours-to-days during which the public tip still shows the names (the scrub is not even pushed). Once private, the rewrite in (b) stops being an emergency and becomes a hygiene project that can wait for a frozen, synced moment. If the repo is never made public again, the rewrite is optional; if it might be, the rewrite is a prerequisite.

### Step 1 — today (minutes)

```bash
# stop the public exposure
gh repo edit kckern/DaylightStation --visibility private --accept-visibility-change-consequences
gh repo view kckern/DaylightStation --json visibility   # confirm PRIVATE

# land the tree scrub on the remote (per commit policy, the user pushes)
git push origin main

# drop the stale public branch pointers (record in docs/_archive/deleted-branches.md first)
git push origin --delete feat/surround-containers
git push origin --delete feature/obd-relay
```

Also ask GitHub Support (or the "remove sensitive data" form) to purge cached views for the repo, referencing the visibility change — cheap to request now even before any rewrite.

### Step 2 — the rewrite, when convenient (half a day, repo private throughout)

Pre-flight checklist:

1. **Freeze**: no pushes from any machine or agent session; confirm `{env.prod_host}` deploy tree has no unpushed branches (`git log origin/main..HEAD` there) and integrate anything real first. Check the garage box for a checkout.
2. **Backup**: `git clone --mirror git@github.com:kckern/DaylightStation.git daylight-pre-rewrite.git` to a non-synced, non-Dropbox location. This mirror contains the PII by design; it is the rollback and the verification baseline. Delete it after the verification window.
3. **Build the replacements file** (gitignored location, never committed). Derive the exact name→placeholder mapping mechanically from the scrub commit so the rewrite matches the tree: `git show 51d90959c` pairs each removed name with its `learnerN`/`grandparentN` replacement. Emit one `regex:(?i)\b<name>\b==><placeholder>` line per pattern-file entry, plus the real device IDs → `000000`-style placeholders. **Decide the two open items first**: whether the spouse's name/id joins the mapping, and whether the lullaby title is scrubbed everywhere (simpler; then update the guard's whitelist line and the playback-hub README afterward) or preserved via a blob callback (fiddly).
4. **Rewrite in a fresh mirror**, never in a working tree:

```bash
git clone --mirror git@github.com:kckern/DaylightStation.git rewrite.git
cd rewrite.git
git filter-repo \
  --replace-text /path/to/replacements.txt \
  --invert-paths --path _extensions/ti86-app/dist \
  --path-rename <name-bearing-yml-path>:<learner4-equivalent-path> \
  --path-rename <name-bearing-mjs-path>:<learner4-equivalent-path>
```

The `--invert-paths` line drops the binary dist artifacts (already deleted at tip; replace-text would corrupt rather than clean them). The two name-bearing paths are the ones under `_extensions/ti86-app/` listed by `git rev-list --objects origin/main | grep -iE '<patterns>'`.

5. **Verify before pushing** — this is the step the last rewrite never got:
   - Re-run this audit's blob scan (script in the session scratchpad, `piiscan/scan.py`) against `rewrite.git`: expect zero hits, or exactly the deliberate whitelist survivors.
   - `git diff <old-main-tip> <new-main-tip>`: expect empty, or only the lullaby/whitelist files if that decision changed them.
   - Spot-check three historical trees (early 2026, mid 2026, pre-scrub August) with `git grep -w` for all patterns.
   - Run the test suite on the rewritten tip.
6. **Cut over**: `git push --force --mirror origin` from `rewrite.git`, then the GitHub Support GC/purge request, then on every machine: re-clone (or `git fetch && git reset --hard origin/main` and recreate worktrees) — this macbook tree + its 7 worktrees, the `{env.prod_host}` deploy tree + its worktrees, garage if applicable.
7. **Record**: note in `docs/_archive/deleted-branches.md` that all pre-rewrite hashes in that file are dead as of the rewrite date; re-run `git rev-parse HEAD > docs/docs-last-updated.txt`.
8. **Verify remotely**: fresh clone from GitHub, re-run the blob scan; after Support confirms GC, `gh api repos/kckern/DaylightStation/commits/1b2ef5735` should return "No commit found".

## 6. The `backup/pre-pii-rewrite` decision: delete it

The branch was retained for one purpose — verifying the rewrite was faithful — and section 3 completes that verification. What it uniquely holds is now precisely known: 10 commits whose only difference from `main`'s copies is the un-scrubbed household name, i.e. its only unique content **is** the PII. No code, no history of independent value.

- Record it in `docs/_archive/deleted-branches.md` (name, `f74979545e`, "pre-rewrite copy of the display-capability-guard branch; retained to verify the 2026-08-16 surgical rewrite; verified faithful by the 2026-08-26 audit; deleted").
- `git branch -D backup/pre-pii-rewrite`
- The commits stay reflog-reachable for ~30 days, then GC removes the last copy. If step-2's full rewrite happens, run `git reflog expire --expire=now --all && git gc --prune=now` locally afterward anyway, which also disposes of these objects.

Condition to keep it instead: only if the human wants to re-verify section 3 personally before trusting this audit. In that case, delete immediately after that check — there is no third use for it.

---

*Audit artifacts (scan script, hit lists, commit lists) are in the session scratchpad under `piiscan/`; they contain the real strings and stay out of the repo.*
