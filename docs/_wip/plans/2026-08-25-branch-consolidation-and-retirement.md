# Branch Consolidation and Retirement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reach a state where `main` is the single source of truth — every branch either has its work merged in or is deliberately retired with a restoration record.

**Architecture:** Three phases, in dependency order. Phase A lands work that exists in only one place (highest data-loss risk). Phase B ports the one branch with genuine unmerged features. Phase C retires everything proven redundant and cleans stale refs. Phases A and B must not be reordered — the surround port needs the school refactor underneath it.

**Tech Stack:** git (2.42 local, worktrees + `merge-tree`), ssh to the prod host, Docker on the prod host, vitest/jest for the repo's test suites.

**Placeholders** — resolve from `.claude/settings.local.json` and `CLAUDE.local.md`, per the no-instance-data docs rule:
- `{env.prod_host}` — the prod/deploy SSH target
- `{deploy_tree}` — the git checkout on that host that prod builds from
- `{repo_owner}` — the OS user owning `{deploy_tree}/.git` (SSH lands as root; committing as root creates root-owned objects and corrupts the tree's ownership)

---

## Context: why this plan exists

A 2026-08-25 audit dispatched one agent per open branch. Nine of nine carried work already present in `main`; all nine were deleted and recorded in `docs/_archive/deleted-branches.md`.

The audit then found the real problem, which was never on a local branch: **the prod container is built from a commit that exists on exactly one machine.** Two branches on the deploy host hold unpushed work.

**Two traps that invalidate the obvious tooling here:**

1. **The 2026-08-16 PII history rewrite changed every commit hash.** Branches predating it report thousands of false "unmerged" commits and hundreds of false `merge-tree` conflicts. **Judge such branches by content, never by hash or conflict count.** A branch reporting 981 conflicts turned out to be a strict subset of `main`.
2. **Several git operations here are blocked by the permission classifier** — `push --delete`, `merge` on the remote host, `worktree remove --force` (intermittently). Steps that need a human keystroke are marked **[USER]**. Do not attempt to route around these (e.g. `gh api -X DELETE` for a ref deletion); the guard is correct.

---

## Phase A: Land the at-risk work

### Task A1: Commit the pending archive-doc history notes

`docs/_archive/deleted-branches.md` has uncommitted additions documenting what the nine deleted branches contained. Losing them means re-running the whole audit.

**Files:**
- Modify: `docs/_archive/deleted-branches.md` (already edited, uncommitted)

**Step 1: Confirm the edit is present and is the only change**

```bash
git status --short
git diff --stat docs/_archive/deleted-branches.md
```
Expected: exactly one modified file; diff shows added lines only (four new `###` sections, no deletions).

**Step 2: Verify the sections landed**

```bash
grep -c '^### ' docs/_archive/deleted-branches.md
grep '^### ' docs/_archive/deleted-branches.md
```
Expected: includes `What was actually lost`, `Why the conflict counts were misleading`, `Still open`.

**Step 3: Commit**

```bash
git add docs/_archive/deleted-branches.md
git commit -m "docs(archive): record what the 2026-08-25 branch sweep discarded"
```

---

### Task A2: Land the live-build branch onto main  **[USER]**

**This is the highest-priority task in the plan.** The prod image is built from `fix/school-scan-print-incident` on `{deploy_tree}`. Its tip does not exist on origin or on any laptop. A disk failure on that host loses 69 commits of shipped work.

Contents: school launch cards, the three-way printer claim tier, printer status honesty fixes, OMR reader subscription warnings, burn-in touch fixes.

**Pre-verified (2026-08-25):** merges into `origin/main` with **zero conflicts** (`git merge-tree --write-tree` returned rc=0). The only commit it lacked was the archive-doc commit, already fast-forwarded in.

**Files:** none locally — this runs on `{env.prod_host}`.

**Step 1: Confirm the deploy tree is clean and level with origin**

```bash
ssh {env.prod_host} 'cd {deploy_tree} && git fetch origin -q && git status --porcelain | wc -l && git log -1 --format="%h %s" main && git log -1 --format="%h %s" origin/main'
```
Expected: `0` modified files; `main` and `origin/main` at the same hash.

**Step 2: Re-test the merge before doing it** (state may have moved since the audit)

```bash
ssh {env.prod_host} 'cd {deploy_tree} && git merge-tree --write-tree --name-only origin/main fix/school-scan-print-incident >/tmp/mt.txt 2>&1; echo "rc=$?"; awk "NR>1{if(\$0==\"\")exit; print}" /tmp/mt.txt'
```
Expected: `rc=0` and no file list. **If rc=1, STOP** and resolve conflicts interactively — do not force.

**Step 3: Merge, as the repo-owning user**

```bash
ssh {env.prod_host} 'sudo -u {repo_owner} git -C {deploy_tree} merge --no-edit fix/school-scan-print-incident'
```
Expected: a merge commit, no conflict markers.

**Step 4: Verify before pushing**

```bash
ssh {env.prod_host} 'cd {deploy_tree} && git log --oneline -1 main && git rev-list --count origin/main..main'
```
Expected: count is 70 (69 commits + the merge).

**Step 5: Push**

```bash
ssh {env.prod_host} 'sudo -u {repo_owner} git -C {deploy_tree} push origin main'
```

**Step 6: Confirm the at-risk commit is now on origin**

```bash
git fetch origin && git branch -r --contains 3b6f3cd37
```
Expected: lists `origin/main`. This is the assertion that the data-loss risk is closed.

---

### Task A3: Sync local to the new main

**Step 1: Fetch and fast-forward**

```bash
git fetch origin && git merge --ff-only origin/main
```
Expected: fast-forward, ~70 commits. **If this is not a fast-forward, STOP** — it means local `main` diverged and needs a real merge.

**Step 2: Verify the school work arrived**

```bash
test -f frontend/src/modules/School/selfService/LaunchCard.jsx && echo PRESENT
git log --oneline -1
```

**Step 3: Run the test suite to confirm the merge is sound**

```bash
npm test 2>&1 | tail -20
```
Expected: matches the pre-merge baseline. Note: per `reference_isolated_domain_tests_never_run`, `--only=domain` misroutes vitest files to Jest — run vitest directly if isolated-domain suites are involved.

---

## Phase B: Finish the one branch with real unmerged work

### Task B1: Port `feat/surround-containers` onto main

The only remaining branch with features not in `main`. 12 commits: the `agenda_print` token class, bulk-print fan-out to thermal receipt, `bulk_print` presentation blocks, the media search/dispatch taxonomy design spec, and the surround performer credit line.

**Why it conflicts, and why that is tractable.** It collides in the same 11 files whether merged before or after the school branch. The collision is **additive feature vs. refactor**, not contradictory behavior:
- surround **adds** a new `agenda_print` token class and a bulk fan-out path (`b8c185783`, `7c1117871`, `2e531b28f`, `9ee5e58db`)
- the school branch **refactored the shape underneath it** — `c28e059f2 refactor(school): ResolveAccessCode resolves through PlanProjection`

So the resolution is to re-apply surround's additions onto the refactored shape. Prefer `rebase` over `merge`: it replays each feature commit against the new structure, so conflicts arrive one small commit at a time instead of all 11 files at once.

**Conflicting files:**
- `backend/src/2_domains/school/sessions/tokens.mjs`
- `backend/src/3_applications/school/usecases/ResolveAccessCode.mjs`
- `backend/src/3_applications/school/usecases/RunSelfServiceAction.mjs`
- `backend/src/3_applications/school/usecases/BuildAgenda.mjs`
- `backend/src/2_domains/school/documents/receipts.mjs`
- `backend/src/1_rendering/school/documents/DocumentReceiptRenderer.mjs`
- `frontend/src/modules/School/selfService/LaunchCard.jsx`
- `frontend/src/modules/School/School.scss`
- `tests/isolated/domain/school/sessions/tokens.test.mjs`
- `tests/isolated/rendering/school/documentEscPosRenderer.test.mjs`
- `docs/superpowers/plans/2026-08-21-mediaapp-cast-failure-remediation.md`

**Step 1: Get the branch onto this machine**

```bash
git fetch {env.prod_host}:{deploy_tree} feat/surround-containers:port/surround-containers
git log --oneline main..port/surround-containers
```
Expected: 12 commits.

**Step 2: Isolate the work** (per CLAUDE.md: prefer worktrees; per `reference_second_backend_is_live_controller`: never start a second backend)

```bash
git worktree add ../DaylightStation-surround port/surround-containers
```

**Step 3: Capture the pre-port test baseline**

```bash
cd ../DaylightStation-surround && npm test 2>&1 | tail -20
```
Record pass/fail counts. You cannot tell a port regression from a pre-existing failure without this.

**Step 4: Rebase onto main**

```bash
git rebase main
```
Expected: stops on the first conflicting commit.

**Step 5: Resolve one commit at a time**

For each stop: keep **both** sides — the school branch's refactored structure AND surround's new token class / fan-out path. The question at each hunk is "how does this addition express itself in the new shape?", not "which side wins". If a hunk looks like a real either/or, stop and ask — that is a behavior decision, not a merge decision.

```bash
git status                      # see the conflicted files
# ...resolve...
git add <resolved-files>
git rebase --continue
```

**Step 6: Write a failing test for the ported behavior**

Before trusting the resolution, prove `agenda_print` still works end to end. Extend `tests/isolated/domain/school/sessions/tokens.test.mjs` — a token of class `agenda_print` must resolve through the refactored `ResolveAccessCode` (the PlanProjection path) and produce the bulk fan-out.

**Step 7: Run it and watch it fail for the right reason**

```bash
npx vitest run tests/isolated/domain/school/sessions/tokens.test.mjs
```
A failure that says "agenda_print is not a known token class" means the port dropped the feature. A pass means the resolution held.

**Step 8: Full suite against the baseline**

```bash
npm test 2>&1 | tail -20
```
Expected: no failures beyond Step 3's baseline.

**Step 9: Merge to main and push**

```bash
cd ../DaylightStation
git merge --no-edit port/surround-containers
git push origin main
```

**Step 10: Clean up**

```bash
git worktree remove ../DaylightStation-surround
git branch -d port/surround-containers
```

---

## Phase C: Retire what is proven redundant

Do **not** start Phase C until Task B1 is merged. Retiring the surround refs first would delete the shared pointer to work that exists in one place.

### Task C1: Retire `origin/feature/obd-relay`  **[USER]**

**Verified 2026-08-25:** all 15 files of its one "unique" commit exist in `main`, every diff showing `main` ahead (`main.cpp` grew from 333 lines). `main` holds the same commit as `8b07043f7c`. The unique-commit count is a rewrite artifact.

**Step 1: Re-verify**

```bash
git fetch origin
for f in $(git show --name-only --format= origin/feature/obd-relay); do
  git cat-file -e main:$f 2>/dev/null && echo "IN-MAIN $f" || echo "ABSENT $f"
done
```
Expected: every line `IN-MAIN`.

**Step 2: Record before deleting** (CLAUDE.md branch policy)

Append to `docs/_archive/deleted-branches.md`:
```markdown
| 2026-08-25 | origin/feature/obd-relay (remote) | 60a914dea9 | OBD relay scaffold. All 15 files present in main with main ahead; the single "unique" commit is a PII-rewrite hash artifact of main's own 8b07043f7c. |
```

**Step 3: Delete on origin**

```bash
git push origin --delete feature/obd-relay
```

### Task C2: Retire `origin/feat/surround-containers`  **[USER]**

**Blocked on B1.** Origin's copy is 0 commits ahead of `main`, but the deploy host's branch of the same name held 12 unpushed commits — which is exactly the trap this plan exists to avoid.

**Step 1: Prove the work landed first**

```bash
git branch -r --contains e4b130160
```
Expected: lists `origin/main`. **If it does not, STOP** — B1 is incomplete.

**Step 2: Record, then delete**

```bash
git push origin --delete feat/surround-containers
```

### Task C3: Decide `backup/pre-pii-rewrite`

Deferred by the user on 2026-08-25. No code is lost by deleting it — all six substantive commits are in `main`. It uniquely holds the last copy of pre-rewrite history, which is the only thing that could confirm the rewrite was faithful (never verified end to end). Against that: it is also the last local copy of the PII the rewrite existed to remove.

**Step 1: Run the verification that makes the decision cheap**

```bash
git diff --name-only backup/pre-pii-rewrite main | wc -l
comm -23 \
  <(git ls-tree -r --name-only backup/pre-pii-rewrite | sort) \
  <(git ls-tree -r --name-only main | sort)
```
The `comm` output is the real question: **paths that existed before the rewrite and do not exist now.** Empty output means the rewrite dropped nothing and the branch's insurance value is spent.

**Step 2: If empty, record and delete**

```bash
git branch -D backup/pre-pii-rewrite
```

**Step 3: If NOT empty, stop.** Each listed path is a file the rewrite may have dropped. Investigate before deleting the only copy.

### Task C4: Clean stale refs and detached worktrees

All three detached worktrees point at commits already in `main` (`160de117c2`, `3ca403891b`, `2705f01416` — verified 2026-08-25). `homeserver/deployed-main` is a tracking ref for a remote no longer in `git remote -v`.

**Step 1: Re-verify nothing unique is parked**

```bash
git worktree list
for h in 160de117c2 3ca403891b 2705f01416; do
  git merge-base --is-ancestor $h main && echo "$h IN-MAIN" || echo "$h *** UNIQUE ***"
done
```
Expected: all `IN-MAIN`.

**Step 2: Check for uncommitted work before removing**

```bash
git -C /private/tmp/daylightstation-school-push status --porcelain
```
Anything listed is real; salvage it first. Note `--force` may be permission-blocked — **[USER]** if so.

**Step 3: Remove**

```bash
git worktree remove --force <each path>
git worktree prune
git branch -rd homeserver/deployed-main
```

**Step 4: Confirm the end state**

```bash
git branch -a
git worktree list
```
Expected: `main` only (plus `backup/pre-pii-rewrite` if C3 deferred again), `origin/main` only, one worktree.

---

### Task C5: Correct the deploy-source documentation

`reference_deploy_source_homeserver` says to identify the live build via `build.txt`. **There is no `build.txt` anywhere on the deploy host** — verified 2026-08-25. The audit had to fingerprint the container by checking for a source file that landed that day.

**The method that actually works:**

```bash
# 1. Confirm source is baked into the image, not mounted
ssh {env.prod_host} 'docker inspect {env.docker_container} --format "{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}"'
# only data/ and media/ mount => code is baked in

# 2. Find a file that landed in a recent commit
git log -1 --format='%h %ad %s' --date=short main -- <recently-added-file>

# 3. Check the container for it
ssh {env.prod_host} 'docker exec {env.docker_container} sh -c "test -f /usr/src/app/<path> && echo PRESENT || echo ABSENT"'
```

Also correct: the live build came from a `.claude/worktrees/*` checkout, **not** the deploy tree's `main` — which was two days behind what was serving.

**Step 1:** Update the memory file with the corrected method.
**Step 2:** Update any runbook under `docs/runbooks/` that references `build.txt`.
**Step 3:** Commit.

---

## Done criteria

1. `git branch -r` lists only `origin/main`.
2. `git branch` lists only `main` (C3 resolved either way).
3. `git worktree list` shows one worktree.
4. `git branch -r --contains 3b6f3cd37` lists `origin/main` — the at-risk prod commit is safe.
5. `git branch -r --contains e4b130160` lists `origin/main` — surround work landed.
6. `npm test` matches or beats the Task A3 baseline.
7. Every retired branch has a row in `docs/_archive/deleted-branches.md` with its hash.

## Deliberately out of scope

- **Reimplementing the sheetmusic "drive axis."** `feature/sheetmusic-learn-listen` was deleted; its *idea* (Learn plays only the practice range, looping, vs. main's whole-piece) survives as a possible feature request against the current Learn state matrix. That is new feature work, not consolidation.
- **Deploying.** This plan moves git refs. Prod already runs the Phase A code; nothing here requires a rebuild.
- **The OBD ECU intermittent-link blocker.** Hardware/field issue, unrelated to any branch.
