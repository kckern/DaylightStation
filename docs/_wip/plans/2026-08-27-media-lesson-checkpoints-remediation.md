# Media Lesson Checkpoints — Remediation Plan (R-tasks)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> Companion to `2026-08-27-media-lesson-checkpoints-plan.md` (Tasks 1-19). These R-tasks
> close gaps found by auditing the execution of Task 1. **R1-R5 run BEFORE Task 2.**

**Goal:** Close six verification and hygiene gaps left by Task 1's execution, so the remaining 18 tasks run against a known-good, single-tree baseline instead of assumptions.

**Architecture:** No production code changes. These are tree hygiene (docs in one place), baseline establishment (know what was already broken), and closing verification loops that were shortcut under time pressure. Each R-task ends with a recorded artifact — a committed file or a written-down number — so the claim survives past this session's transcript.

**Tech Stack:** git worktrees, vitest, `scripts/gate-vitest.mjs`.

**Worktree:** `/Users/kckern/Documents/GitHub/DaylightStation/.worktrees/media-lesson-checkpoints`, branch `feature/media-lesson-checkpoints`. Referred to below as `$WT`. Main checkout is `$MAIN` = `/Users/kckern/Documents/GitHub/DaylightStation`.

---

## Why each of these exists

| R | Gap | How it was found | Risk if skipped |
|---|---|---|---|
| R1 | Design-doc edits sit uncommitted in `$MAIN`, plan edits on the branch | self-audit | Feature docs split across two trees; main's tree dirty; edits lost on a `checkout --` |
| R2 | No full baseline was ever taken | self-audit | Cannot tell a failure we caused from one that was already there — for 18 more tasks |
| R3 | `.env` symlink fix unverified | self-audit | "The worktree trap is closed" is an assumption, not a fact |
| R4 | Task 1's spec review never returned ✅ | skill requires re-review; I substituted a 2-command check | A drift introduced by the fix commit is unreviewed |
| R5 | Renamed symbols never swept by NAME repo-wide | self-audit | Same silent-0-tests failure mode as the Task 1 regression, one rename later |
| R6 | Process gaps that caused the above | self-audit | They repeat 18 more times |

---

### Task R1: Consolidate the feature's docs onto the branch

**Files:**
- Move (content): `$MAIN/docs/_wip/plans/2026-08-27-media-lesson-checkpoints-design.md` (uncommitted edits) → same path in `$WT`
- Restore: `$MAIN` working tree back to clean

**Context:** The design doc's `GateVerdict.id` / `PauseDecision` amendments were written into the MAIN checkout by mistake while the plan amendments went to the branch. The branch's copy is still the pre-amendment version committed at `efc75f95c`.

**Step 1: Confirm the divergence before touching anything**

```bash
git -C "$MAIN" status --short docs/_wip/plans/
diff <(git -C "$WT" show HEAD:docs/_wip/plans/2026-08-27-media-lesson-checkpoints-design.md) \
     "$MAIN/docs/_wip/plans/2026-08-27-media-lesson-checkpoints-design.md"
```
Expected: `M docs/_wip/plans/2026-08-27-media-lesson-checkpoints-design.md`, and a diff showing the `PauseDecision` typedef, the `GateVerdict.id` rename, the blocked/paused explanation, and the "no legacy governance slot" bullet.

**Step 2: Copy the amended file onto the branch**

```bash
cp "$MAIN/docs/_wip/plans/2026-08-27-media-lesson-checkpoints-design.md" \
   "$WT/docs/_wip/plans/2026-08-27-media-lesson-checkpoints-design.md"
```

**Step 3: Restore main to clean**

```bash
git -C "$MAIN" checkout -- docs/_wip/plans/2026-08-27-media-lesson-checkpoints-design.md
git -C "$MAIN" status --short   # expect: empty
```

**Step 4: Verify the branch copy carries the amendments**

```bash
grep -c "PauseDecision\|GateVerdict.id\|blocked.*standing" \
  "$WT/docs/_wip/plans/2026-08-27-media-lesson-checkpoints-design.md"
```
Expected: non-zero.

**Step 5: Commit (explicit path — never `git add -A` in this checkout)**

```bash
git -C "$WT" add docs/_wip/plans/2026-08-27-media-lesson-checkpoints-design.md
git -C "$WT" commit -m "docs: consolidate design-doc amendments onto the feature branch"
```

---

### Task R2: Establish a real, recorded baseline

**Files:**
- Create: `$WT/docs/_wip/plans/2026-08-27-baseline.md`

**Context:** The worktree was declared "green" on ~82 tests over expected-to-be-touched surfaces. That is not a baseline. Seventeen tasks remain, several touching load-bearing shared files (`sessionEvents.mjs` is imported by every school session path), and there is no way to attribute a failure without knowing the starting state. The repo's own `vitest.config.mjs` documents a roaming-flake ("one roaming victim per sweep, each passing every solo run"), so a single sweep is NOT sufficient evidence — take two and intersect.

**Step 1: Take two full vitest sweeps, recording output**

```bash
cd "$WT"
npx vitest run 2>&1 | tail -40 > /tmp/baseline-run1.txt
npx vitest run 2>&1 | tail -40 > /tmp/baseline-run2.txt
```
Note: this is a large sweep; allow it several minutes and do NOT interrupt it.

**Step 2: Run the repo gate twice**

```bash
npm run test:unit:vitest 2>&1 | tail -30 > /tmp/gate-run1.txt; echo "exit=$?"
npm run test:unit:vitest 2>&1 | tail -30 > /tmp/gate-run2.txt; echo "exit=$?"
```

**Step 3: Classify every failure into exactly one bucket**

For each failing file appearing in the outputs, determine:
- **STABLE-PREEXISTING** — fails in both runs, and also fails at the pre-feature commit. Verify that last claim: `git -C "$WT" stash` is NOT safe here; instead check out the base commit in a scratch worktree:
  ```bash
  git -C "$MAIN" worktree add /tmp/wt-baseline efc75f95c
  ln -s "$MAIN/node_modules" /tmp/wt-baseline/node_modules
  ln -s "$MAIN/frontend/node_modules" /tmp/wt-baseline/frontend/node_modules
  ln -s "$MAIN/.env" /tmp/wt-baseline/.env
  cd /tmp/wt-baseline && npx vitest run <the failing file> 2>&1 | tail -10
  ```
- **ROAMING FLAKE** — fails in one run, passes in the other, and passes when run solo.
- **OURS** — anything else. Any file in this bucket is a STOP: fix it before Task 2.

**Step 4: Write the baseline document**

Record, in `$WT/docs/_wip/plans/2026-08-27-baseline.md`: the two sweep totals, the two gate exit codes, and a table of every failing file with its bucket and the evidence for that bucket. State explicitly which files the rest of this feature's work is allowed to ignore.

**Step 5: Clean up the scratch worktree**

```bash
git -C "$MAIN" worktree remove /tmp/wt-baseline --force
```

**Step 6: Commit**

```bash
git -C "$WT" add docs/_wip/plans/2026-08-27-baseline.md
git -C "$WT" commit -m "docs: record pre-existing test baseline for the feature branch"
```

---

### Task R3: Prove the worktree `.env` fix

**Context:** Two tests (`registryCompleteness`, `singalongStoredShape`) failed with `no data path — set DAYLIGHT_BASE_PATH or DAYLIGHT_DATA_PATH` because `.env` is untracked and exists only in `$MAIN`. A symlink was added at `$WT/.env`. That fix was never demonstrated — an attempt hit the fact that `tests/unit/` is Jest-owned, and the question was deferred.

**Step 1: Confirm the symlink exists and resolves**

```bash
ls -l "$WT/.env" && head -1 "$WT/.env"
```
Expected: a symlink to `$MAIN/.env`, and a readable first line (`DAYLIGHT_BASE_PATH=...`).

**Step 2: Locate the two tests and identify their runner**

```bash
cd "$WT"
find tests -name '*registryCompleteness*' -o -name '*singalongStoredShape*'
```
For each, check whether it imports from `'vitest'` (vitest-owned) or is run by `tests/unit/harness.mjs` (Jest-owned). `scripts/gate-vitest.mjs:53` (`isVitestOwned`) is the authority on how the gate decides.

**Step 3: Run each under its correct runner and record the result**

Vitest-owned: `npx vitest run <path>`.
Jest-owned: `npm run test:unit` (or the harness invocation that targets it).

**Step 4: Interpret**

- Both pass → the symlink closed it; record that in the R2 baseline doc.
- Still failing with a data-path error → the symlink is not enough (e.g. the loader reads `.env` from `process.cwd()` differently, or needs `DAYLIGHT_DATA_PATH`). Diagnose, and if the real fix is an env export rather than a symlink, document the exact export in the baseline doc so every later task and subagent uses it.

**Step 5: Commit any doc update** (no code change expected).

---

### Task R4: Close the spec-review loop on Task 1

**Context:** The spec reviewer returned ❌ with one blocking item. It was fixed, then a quality review ran and produced a second round of changes (blocked/paused split, `GateVerdict.id`, dropping the governance alias). Neither round has had a spec-compliance pass since. The skill being followed requires re-review until ✅, and two rounds of changes have landed unreviewed against the spec.

**Step 1: Wait for the in-flight implementer to report and commit.** Do not start this while it runs.

**Step 2: Dispatch a spec-compliance reviewer** over the CUMULATIVE diff `c94e86f7c..HEAD`, with:
- The original Task 1 spec (from the plan), AND
- The two amendments (the blocking-fix instruction, and the quality-fix instruction: blocked/paused split, `id` rename, alias removal, five added tests, `PauseDecision` typedef).

Ask specifically:
- Does the final state match the AMENDED spec, not the original?
- Did dropping the `governance` alias leave any caller behind? (repo-wide, by symbol name — see R5)
- Are all 14 legacy assertions still present and now in gates form?
- Did the blocked/paused split change any behavior at the FitnessPlayer call site? (`governancePaused` must be true on exactly the same inputs as before.)

**Step 3:** If ❌, loop back to the implementer. If ✅, record it and proceed.

---

### Task R5: Symbol-name sweep for the Task 1 renames

**Context:** Every grep run so far chased the import PATH. Two renames also happened by NAME (`PAUSE_REASON.GOVERNANCE` → `GATE`; `GateVerdict.reason` → `id`), and a stale `'PAUSED_GOVERNANCE'` string literal was found only incidentally, inside a file a reviewer happened to be reading. The Task 1 regression proves the failure mode: a stale reference that fails at load reports as zero tests.

**Step 1: Sweep by symbol, repo-wide, code only**

```bash
cd "$WT"
for sym in 'PAUSE_REASON.GOVERNANCE' 'PAUSED_GOVERNANCE' 'governanceAsGate' 'governance:' ; do
  echo "=== $sym ==="
  grep -rn "$sym" . --include='*.js' --include='*.jsx' --include='*.mjs' \
    | grep -v node_modules | grep -v '^\./\.git'
done
```
Expected: no hits for the first three. `governance:` will legitimately hit fitness code that has nothing to do with the arbiter — inspect each hit and confirm none of them is an argument being passed INTO `resolvePause`.

**Step 2: Confirm no test file fails to LOAD anywhere**

A load failure is invisible in pass/fail counts. After the R2 sweeps, check the output for `Cannot find module`, `0 tests`, or files reporting no tests collected:

```bash
grep -n "Cannot find module\|no tests\|0 tests" /tmp/baseline-run1.txt /tmp/baseline-run2.txt
```
Expected: nothing referencing this feature's files.

**Step 3: Record the sweep result in the baseline doc; commit.**

---

### Task R6: Process corrections for Tasks 2-19

**Files:**
- Modify: `$WT/docs/_wip/plans/2026-08-27-media-lesson-checkpoints-plan.md` — "Standing rules for every task"

**Step 1: Add these rules** (two are already present — repo-wide grep, and the gate contract; add the rest):

```markdown
- **The controller does not edit files in this worktree while an implementer subagent
  is live.** Task 1 collided: the implementer's `git add -A` swept the controller's
  in-progress plan edits into its commit. It caught and amended it, but the amend
  window briefly reverted the file on disk. Batch controller edits between tasks.
- **Subagents stage by explicit path.** Never `git add -A`, never `git commit -a`.
- **Every task's report must give REAL numbers** — the command run and its actual
  output counts. "Tests pass" is not a result.
- **A failing gate must be attributed, not waved past.** Compare against
  `docs/_wip/plans/2026-08-27-baseline.md`. Anything not in that baseline is ours.
- **Both reviews must return ✅ before the next task is dispatched** — spec compliance
  first, then quality. A fix in response to either review requires the corresponding
  review to run again. (Task 1 shipped with this loop shortcut; R4 repays it.)
```

**Step 2: Add a per-task verification checklist** to the same section:

```markdown
Before reporting a task complete, the implementer must have run and quoted:
1. The task's own new tests (count).
2. The suites the changed files belong to (count).
3. A repo-wide grep for anything moved or renamed — by PATH and by SYMBOL NAME.
4. `npm run test:unit:vitest`, with any failure attributed against the baseline doc.
```

**Step 3: Commit.**

---

## After R1-R6: resume the feature

Tasks 2-19 in `2026-08-27-media-lesson-checkpoints-plan.md` are unchanged in substance.
Task 2's spec already carries its amendment (resume must be conditioned on `!blocked`,
never on `paused === false` alone). Dispatch Task 2 only once R4 has returned ✅ and R2's
baseline exists.

**Ordering note:** R1, R5, R6 are quick and independent. R2 is the long one (two full
sweeps plus a scratch-worktree comparison). R3 folds into R2's write-up. R4 is gated on
the in-flight implementer finishing.
