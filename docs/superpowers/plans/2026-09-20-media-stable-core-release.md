# Media Stable-Core Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a clean, reproducible, deployment-ready release candidate containing the 11 accepted media stories and no unfinished story work.

**Architecture:** Branch a new isolated release worktree from exact product/test commit `bf9edf3d21959c1a6afd8329b2065c9c2b4adba4`, add only release documentation and a deterministic accepted-story gate, then verify that exact tree through repository, build, runtime, and household-activity gates. The dirty implementation worktree remains the continuation workspace for the other 71 stories and is never reset, cleaned, or merged into the candidate wholesale.

**Tech Stack:** Git worktrees, Node.js, Vitest, Playwright, Vite, existing `media-redesign-server.mjs`, Bash deployment gate.

**Spec:** `docs/_wip/plans/2026-09-20-media-stable-core-release-design.md`

## Global Constraints

- Product/test history freezes at `bf9edf3d21959c1a6afd8329b2065c9c2b4adba4` unless a release-gate failure proves a product repair is required.
- Preserve every uncommitted file in `/tmp/daylight-media-steer2a-candidate`; do not stash, reset, clean, or copy it wholesale.
- The candidate contains exactly 11 accepted stories / 32 accepted criteria; the 82-story objective remains active.
- No runtime skip, conditional skip, mocked playback success, or component-only result counts as accepted-story regression evidence.
- Build and runtime evidence must name the full candidate SHA, clean-tree state, artifact path and hash, command, exit, and log.
- `scripts/deploy-gate.sh` is read-only candidate evidence. Do not build a production image, merge, push, replace a container, or reload a kiosk.
- Stop at reported weekly usage 33% for the mandatory checkpoint; never cross 35%.

## Review Focus

1. A dirty source tree must not produce the artifact claimed as the release candidate; Task 1 and Task 4 assert clean status before and after verification.
2. A Playwright conditional skip must fail the release gate; Task 2 includes an explicit skipped-result RED/GREEN unit test.
3. Every one of the 32 accepted criteria must appear exactly once in the manifest; Task 2 tests duplicates, omissions, and unknown criteria.
4. The runtime must use the newly built candidate rather than a stale dev server; Task 3 checks the manifest SHA and owned preview PID/base URL.
5. A green code suite while the household activity gate is blocked is not deployable; Task 4 records the block without overriding it.

---

### Task 1: Isolate the accepted core and reconcile release documentation

**Files:**
- Create worktree: `/tmp/daylight-media-stable-core`
- Create branch: `release/media-stable-core`
- Cherry-pick: `docs/_wip/plans/2026-09-20-media-stable-core-release-design.md` from `926fbae90`
- Modify: `docs/_wip/plans/2026-09-14-media-app-acceptance-ledger.md`
- Modify: `docs/_wip/refactors/2026-09-14-media-app-redesign.md`
- Create: `docs/_wip/plans/2026-09-20-media-stable-core-release-evidence.md`

**Interfaces:**
- Consumes: exact accepted product/test source `bf9edf3d2` and the current ledger's 11 accepted story rows.
- Produces: a clean named release branch and an evidence document whose header fields are `candidate_sha`, `clean_status`, `artifact_sha256`, `static_gate`, `unit_gate`, `runtime_gate`, and `deploy_gate`.

- [ ] **Step 1: Verify isolation prerequisites**

Run from the dirty candidate:

```bash
test "$(git rev-parse HEAD)" = bf9edf3d21959c1a6afd8329b2065c9c2b4adba4
git diff --check
git worktree list
test ! -e /tmp/daylight-media-stable-core
```

Expected: HEAD matches; diff check exits 0; no target worktree exists. If the target exists, inspect it and stop rather than delete it.

- [ ] **Step 2: Create the isolated branch/worktree and add the approved design**

```bash
git worktree add -b release/media-stable-core /tmp/daylight-media-stable-core bf9edf3d21959c1a6afd8329b2065c9c2b4adba4
git -C /tmp/daylight-media-stable-core cherry-pick 926fbae90
git -C /tmp/daylight-media-stable-core status --porcelain
```

Expected: cherry-pick succeeds and status is empty. Do not run `git clean` or reset either worktree.

- [ ] **Step 3: Reconcile the acceptance ledger**

Copy only the current ledger file from the dirty worktree, then verify its semantic inventory instead of copying any product source:

```bash
cp /tmp/daylight-media-steer2a-candidate/docs/_wip/plans/2026-09-14-media-app-acceptance-ledger.md docs/_wip/plans/2026-09-14-media-app-acceptance-ledger.md
node - <<'NODE'
const fs = require('fs');
const text = fs.readFileSync('docs/_wip/plans/2026-09-14-media-app-acceptance-ledger.md', 'utf8');
const accepted = [...text.matchAll(/^### ([A-Z]+\.\d+[a-z]?)\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm)]
  .filter(([, , block]) => block.includes('| Accepted |') && !block.includes('| Partial |') && !block.includes('| Unverified |'));
if (!text.includes('11 accepted stories / 32 accepted AC') || accepted.length !== 11) process.exit(1);
console.log(accepted.map(match => match[1]).join('\n'));
NODE
```

Expected IDs: `FIND.1b`, `FIND.2a`, `PLAY.1b`, `PLACE.2b`, `PLACE.3b`, `STEER.1c`, `STEER.2a`, `HOUSE.1a`, `HOUSE.2b`, `RELY.9a`, `RELY.10a`.

- [ ] **Step 4: Update the refactor status and initialize evidence**

Change the status page to say production is unchanged, 11/82 stories and 32 criteria are accepted on the candidate, 71 stories remain, and link the stable-core design/plan/evidence. Add the evidence document with values `pending` except `candidate_sha` and `clean_status`.

- [ ] **Step 5: Verify and commit documentation only**

```bash
git diff --check
git diff --name-only | sort
git add docs/_wip/plans/2026-09-14-media-app-acceptance-ledger.md \
  docs/_wip/refactors/2026-09-14-media-app-redesign.md \
  docs/_wip/plans/2026-09-20-media-stable-core-release-evidence.md
git commit -m "docs(media): record stable core release candidate"
```

Expected: only the three named files are committed; the approved design is already present from its cherry-pick.

### Task 2: Add a fail-closed accepted-story manifest gate

**Files:**
- Create: `scripts/media-stable-core-gate.mjs`
- Create: `tests/unit/tooling/mediaStableCoreGate.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `BASE_URL`, the candidate SHA, and Playwright JSON reports.
- Produces: `npm run test:media-stable-core`; exit 0 only when the manifest contains all 11 stories/32 criteria and every selected Playwright case passes with zero skipped/interrupted cases.

- [ ] **Step 1: Write manifest-validation RED tests**

Export `ACCEPTED_STORIES`, `validateManifest(manifest)`, and `validateReport(report)` from the new script. Tests must assert:

```js
expect(validateManifest(ACCEPTED_STORIES)).toEqual({ stories: 11, criteria: 32 });
expect(() => validateManifest(ACCEPTED_STORIES.slice(1))).toThrow(/missing FIND\.1b/);
expect(() => validateManifest([...ACCEPTED_STORIES, ACCEPTED_STORIES[0]])).toThrow(/duplicate FIND\.1b/);
expect(() => validateReport({ suites: [{ specs: [{ tests: [{ status: 'skipped' }] }] }] })).toThrow(/skipped/);
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/unit/tooling/mediaStableCoreGate.test.mjs
```

Expected: FAIL because the script/exports do not exist.

- [ ] **Step 3: Implement the fixed manifest**

Each entry must contain `{ story, criteria, file, grep }`. Use these committed journeys:

```js
[
  ['FIND.1b', 2, 'media-app-result-play-now.runtime.test.mjs', 'FIND.1b'],
  ['FIND.2a', 4, 'media-app-search-scopes.runtime.test.mjs', 'FIND.2a'],
  ['PLAY.1b', 2, 'media-app-play-now-local-entrypoints.runtime.test.mjs', 'PLAY.1b'],
  ['PLACE.2b', 3, 'media-app-aim-journey.runtime.test.mjs', 'PLACE.2b'],
  ['PLACE.3b', 2, 'media-app-result-play-now.runtime.test.mjs', 'FIND.1b'],
  ['STEER.1c', 2, 'media-app-remote-controls.runtime.test.mjs', 'STEER.1c'],
  ['STEER.2a', 3, 'media-app-playback-journey.runtime.test.mjs', 'STEER.2a'],
  ['HOUSE.1a', 3, 'media-app-house-indicator.runtime.test.mjs', 'HOUSE.1a'],
  ['HOUSE.2b', 2, 'media-app-house-browser-session.runtime.test.mjs', 'HOUSE.2b'],
  ['RELY.9a', 2, 'media-app-navigation-history.runtime.test.mjs', 'RELY.9a'],
  ['RELY.10a', 3, 'media-app-navigation-history.runtime.test.mjs', 'RELY.10a'],
]
```

Run each unique `{file, grep}` serially with `npx playwright test <file> --grep <grep> --workers=1 --reporter=json`, preserve one JSON and one text log per unique invocation, and validate no selected test was skipped/interrupted/failed. Deduplicate identical invocations: FIND.1b's three-surface journey also contains the reviewed Fleet→Peek queue-row assertions for PLACE.3b, while the navigation invocation proves both RELY stories. The summary must list every story and criterion supported by each shared report.

- [ ] **Step 4: Add the package command and run GREEN**

Add:

```json
"test:media-stable-core": "node scripts/media-stable-core-gate.mjs"
```

Then run:

```bash
npx vitest run tests/unit/tooling/mediaStableCoreGate.test.mjs
```

Expected: all manifest/report unit cases pass.

- [ ] **Step 5: Commit the gate**

```bash
git add scripts/media-stable-core-gate.mjs tests/unit/tooling/mediaStableCoreGate.test.mjs package.json
git commit -m "test(media): gate the accepted stable core"
```

### Task 3: Verify the exact candidate and accepted journeys

**Files:**
- Modify: `docs/_wip/plans/2026-09-20-media-stable-core-release-evidence.md`
- Evidence directory: `/tmp/daylight-media-stable-core-evidence/<candidate-sha>/`

**Interfaces:**
- Consumes: Task 2's fail-closed command and the exact candidate tree.
- Produces: static/unit/build/runtime evidence tied to one full SHA and artifact hash.

- [ ] **Step 1: Record the candidate before testing**

```bash
candidate_sha=$(git rev-parse HEAD)
test -z "$(git status --porcelain)"
evidence_dir="/tmp/daylight-media-stable-core-evidence/$candidate_sha"
mkdir -p "$evidence_dir"
printf 'candidate_sha=%s\nclean_status=empty\n' "$candidate_sha" > "$evidence_dir/manifest.txt"
```

- [ ] **Step 2: Run static and repository gates once**

Run serially and tee each log:

```bash
npm run audit:fs
npm run audit:layers
npm run audit:ui
npm run audit:links
npm run check:parse
npm run check:scss
npm run test:unit:vitest
npm test
npm run lint --prefix frontend
```

Expected: every command exits 0. Stop on the first failure and diagnose it; do not continue merely to collect more red output.

- [ ] **Step 3: Build once and fingerprint the artifact**

```bash
npm run build --prefix frontend
sha256sum frontend/dist/index.html | tee "$evidence_dir/artifact.sha256"
```

Expected: build exits 0 and the artifact hash is non-empty.

- [ ] **Step 4: Start owned candidate services**

Use fresh ports and the existing acceptance fixture. Record backend/preview PID and base URL in `manifest.txt`; verify each PID is alive before testing. The preview must serve the just-built `frontend/dist`, and `/api` plus `/ws` must point to the owned backend.

- [ ] **Step 5: Run the stable-core gate**

```bash
BASE_URL="$owned_base_url" MEDIA_STABLE_CORE_EVIDENCE_DIR="$evidence_dir/runtime" npm run test:media-stable-core
```

Expected: all 11 stories and 32 mapped criteria appear in the summary, every unique invocation has a report, zero failed/skipped/interrupted tests, exit 0.

- [ ] **Step 6: Stop owned services and prove cleanup**

Stop only the PIDs recorded in `manifest.txt`; verify both ports are released. Re-run `git status --porcelain` and require it to be empty.

- [ ] **Step 7: Update and commit evidence**

Record exact command exits, test counts, artifact hash, evidence paths, and `runtime_gate: pass` in the evidence document.

```bash
git add docs/_wip/plans/2026-09-20-media-stable-core-release-evidence.md
git commit -m "docs(media): certify stable core verification"
```

### Task 4: Run the deployment-safety gate and final independent audit

**Files:**
- Modify: `docs/_wip/plans/2026-09-20-media-stable-core-release-evidence.md`

**Interfaces:**
- Consumes: the exact green candidate from Task 3.
- Produces: a deployability verdict, not a production deployment.

- [ ] **Step 1: Run the household activity gate without chaining a deploy**

```bash
./scripts/deploy-gate.sh | tee /tmp/daylight-media-stable-core-deploy-gate.log
```

Expected: exit 0 and `GATE CLEAR`. Exit 1 means `deploy_gate: blocked`; do not override, build a production image, or deploy.

- [ ] **Step 2: Reconcile final provenance**

Require clean status, record `git rev-parse HEAD`, verify the Task 3 artifact hash still matches, and update `deploy_gate` plus its log path in the evidence document. Commit only the evidence update.

- [ ] **Step 3: Independent Sol whole-candidate review**

Reviewer checks the spec, this plan, the full `bf9edf3d2..HEAD` diff, accepted ledger, all gate logs, manifest completeness, artifact provenance, service cleanup, and absence of unfinished HOUSE.3a/queue changes. Reject on any missing criterion, skipped runtime, dirty evidence source, or production side effect.

- [ ] **Step 4: Fix at most one bounded review round**

If rejected, dispatch one scoped repair, rerun every invalidated gate, and obtain one scoped re-review. If the finding requires changing the release boundary, stop and revise the design rather than silently broadening the candidate.

- [ ] **Step 5: Handoff through branch-finishing workflow**

Only after independent approval and fresh clean status, use `superpowers:finishing-a-development-branch`. Present merge/PR/keep options. Do not deploy; deployment remains a separate explicit user instruction with a fresh activity gate.
