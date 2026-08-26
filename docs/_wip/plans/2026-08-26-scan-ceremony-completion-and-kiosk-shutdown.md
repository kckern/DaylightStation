# Scan Ceremony Completion & Kiosk Shutdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get the 2026-08-26 silent-scan fix onto the Portal where a child can hear it, close the last precision gap in the ceremony taxonomy, stop a flaky test from masking real regressions, and finish the half-provisioned public-kiosk shutdown feature.

**Architecture:** Four independent tracks. Track A is operational (merge, gate, build, deploy, verify on hardware) and is the only one that delivers user-visible value today. Track B is a small TDD change in `ResolveCardScan` that routes a fully-blank card into the ceremony it should already have had. Track C removes wall-clock dependence from one test. Track D completes a feature whose server half is provisioned and whose device half needs an APK built on a Mac. B, C, and D do not block A.

**Tech Stack:** Node 20 ESM (`.mjs`), React 18 (`.jsx`/`.js`), vitest, Docker, Home Assistant REST, FullyKiosk REST, Android (Java, Gradle 7.5.1, AGP, compileSdk 33).

## Global Constraints

- Tests run with **vitest**: `npx vitest run <path>` from the worktree root. The project gate is `npm run test:unit:vitest` (`node scripts/gate-vitest.mjs`).
- `--reporter=basic` does not exist in this vitest version and errors. Use the default reporter, or `--reporter=verbose` when you need `console.log` output.
- Never use raw `console.log/debug/warn/error` for diagnostics in production code — use the logging framework. Test files may use `console.log`.
- **Production runs at `info`. `logger.debug` is NEVER shipped to the log store.** A `debug` line is not a diagnostic; it is a silence.
- Log store `_time` is **UTC**. Local is PDT (UTC−7). Query at `https://logs.kckern.net/select/logsql/query`.
- Aggregation syntax is `| stats by ("field") count()` — dotted names MUST be quoted.
- **Never `rm` inside the data tree.** `mv` to `data/_deleteme/`. `docker exec` runs as **root**, so `chown node:node` anything created inside the container.
- The deploy gate is its own step and **must be able to halt the sequence**. Never chain it with `&&` into the build.
- Commit messages end with: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- Two pre-existing gate failures are NOT yours and must not be "fixed": `nfcTapIngress.shutdown.test.mjs` and `pianoGames.test.mjs` report "no test suite found" because they are `node:test` files caught by a directory-glob vitest run.

## Current State (verified 2026-08-26)

Already committed on `fix/school-scan-print-incident` (3 commits, unpushed):

- `b991be97b` — F-1–F-4: the `speak()` funnel, hoisted `silentLiveRecords`, `scan-rows-unmarked`, `cardRecordCount`, log promoted to `warn`.
- `0862db2d0` — re-anchored `closeOutcome` and `school.progress` assertions.
- `67b20c024` — the portal-keys APK handoff doc.

Already provisioned on the data volume (not in git):

- `household/shutdown/config.yml` — tag `04aa660fcb2a81`, targets `portal` + `yellow-room-tablet`, 1800s, HA script. `portal_keys` block deliberately commented out.
- `household/auth/portal-keys-lockdown.yml` — secret generated, `chmod 600`, `chown node:node`.
- `script.public_kiosk_shutdown_cue` — confirmed present in Home Assistant.
- No `household/shutdown/lockdown.yml` — **nothing is armed**.

## File Structure

| File | Responsibility | Track |
|---|---|---|
| `backend/src/3_applications/school/documents/ResolveCardScan.mjs` | Modify: populate `silentLiveRecords` for a blank card | B |
| `backend/src/3_applications/school/documents/ResolveCardScan.test.mjs` | Test: blank card reports its unmarked live record | B |
| `backend/src/5_composition/modules/schoolPrintScanConsumer.silentScan.test.mjs` | Test: blank card gets `scan-rows-unmarked`, not "Already done" | B |
| `docs/_wip/bugs/2026-08-26-school-scan-silent-on-unmarked-live-rows.md` | Modify: correct the F-5 claim | B |
| `backend/src/3_applications/hardware/omrRelay.test.mjs` | Modify: condition-based waiting instead of wall-clock sleeps | C |
| `_extensions/portal-keys/app/app/build.gradle` | Modify: bump `versionCode` | D |
| `household/shutdown/config.yml` (data volume) | Modify: restore `portal_keys` block | D |

---

## Track A — Ship the silent-scan fix

The only track that changes what a child experiences. Do this first and alone.

### Task A1: Merge to main

**Files:**
- Modify: none (git operations only)

**Interfaces:**
- Consumes: branch `fix/school-scan-print-incident` at `67b20c024`
- Produces: `main` containing the ceremony funnel and `scan-rows-unmarked`

- [ ] **Step 1: Confirm the working tree is clean and tests pass**

```bash
git status --porcelain          # expect empty
npx vitest run backend/src/5_composition/modules/schoolPrintScanConsumer.silentScan.test.mjs \
  frontend/src/modules/School/selfService/ \
  backend/src/3_applications/school/documents/ResolveCardScan.test.mjs
```

Expected: `Test Files 14 passed`, no failures.

- [ ] **Step 2: Fetch and inspect what main has that you don't**

```bash
git fetch origin
git log --oneline HEAD..origin/main
```

Expected: exactly 1 commit. Read it. If it touches `schoolPrintScanConsumer.mjs`, `ResolveCardScan.mjs`, or `useScanCeremony.js`, STOP and resolve by hand — those are the files this work rewrote.

- [ ] **Step 3: Merge origin/main into the branch first**

```bash
git merge origin/main
```

Merging *into* the branch first keeps any conflict resolution on the branch, where it can be tested, rather than on `main`.

- [ ] **Step 4: Re-run the touched suites after the merge**

```bash
npx vitest run backend/src/5_composition/modules/ \
  backend/src/3_applications/school/documents/ResolveCardScan.test.mjs \
  frontend/src/modules/School/selfService/ tests/isolated/composition/
```

Expected: all pass except the two known `node:test` files (`nfcTapIngress.shutdown`, `pianoGames`) reporting "no test suite found". Those are expected — see Global Constraints.

- [ ] **Step 5: Fast-forward main**

```bash
git checkout main
git merge --ff-only fix/school-scan-print-incident
git log --oneline -1
```

Expected: `main` now points at the merge/branch tip.

- [ ] **Step 6: Push**

```bash
git push origin main
```

### Task A2: Deploy gate — MUST be able to halt

**Files:**
- Modify: none

**Interfaces:**
- Consumes: `./scripts/deploy-gate.sh`
- Produces: a go/no-go decision. Exit 0 = clear, exit 1 = someone is using the system.

- [ ] **Step 1: Run the gate as its own command**

```bash
./scripts/deploy-gate.sh
echo "gate exit: $?"
```

- [ ] **Step 2: Obey it**

Exit 0 → continue to Task A3.

Exit 1 → **STOP. Do not build, do not deploy.** The gate blocks on any of: an active fitness session (`sessionActive:true` or `rosterSize > 0`), a live Player video actually *playing* (`render_fps` lines with a title AND `videoState:"playing"`), or **any `school.selfservice` traffic in the last 3 minutes**. That third condition exists precisely because a redeploy once took the container down 5.1 seconds before a companion code was entered and the read-along never opened.

The gate **fails closed** — an unreachable log store blocks, because "I could not tell whether anyone was there" is not "nobody is there".

Wait and re-run. Do not pass it with a flag.

### Task A3: Build and deploy

**Files:**
- Modify: none

**Interfaces:**
- Consumes: `main` at the pushed tip
- Produces: `daylight-station` container running the new image; `/build.txt` carries the commit

- [ ] **Step 1: Build**

```bash
./scripts/build-daylight.sh
```

This wraps `docker build` with `BUILD_TIME` and full-SHA `COMMIT_HASH` build args, which land in `/build.txt`. Takes several minutes — the frontend `vite build` runs inside the image.

- [ ] **Step 2: Re-run the gate**

```bash
./scripts/deploy-gate.sh
echo "gate exit: $?"
```

The build took minutes and someone can walk up in that time. This second run is not optional. Exit 1 → stop and wait.

- [ ] **Step 3: Replace the container**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 4: Confirm the deployed commit is the one you pushed**

```bash
sleep 20
sudo docker exec daylight-station sh -c 'cat /build.txt'
git rev-parse HEAD
```

Expected: the `Commit:` line matches `git rev-parse HEAD`. A mismatch means a stale image — rebuild with `--no-cache`.

### Task A4: Reload the Portal so the new ceremony JS is served

**Files:**
- Modify: none

**Interfaces:**
- Consumes: the running container
- Produces: a Portal browser running the new bundle

The Portal is a FullyKiosk browser on a repurposed Facebook Portal at `10.0.0.92:2323`. It keeps serving the **old** JS until reloaded, so `scan-rows-unmarked` would fall through `buildCeremony`'s `default: return null` and the panel would stay silent — reproducing the exact bug you just fixed.

- [ ] **Step 1: Reload**

```bash
FKB_HOST=10.0.0.92:2323 FKB_PW=$(sudo docker exec daylight-station sh -c \
  "node -e \"const y=require('js-yaml');console.log(y.load(require('fs').readFileSync('data/household/auth/fullykiosk.yml','utf8')).password)\"") \
  node cli/fkb.cli.mjs reload
```

- [ ] **Step 2: Confirm it came back**

FKB returns HTTP 200 with an **error envelope** on failure — check for `status:"Error"` in the body, not just the status code. Also note this tablet's FKB build has no `foreground` field, so do not assert on it.

### Task A5: Verify the fix on real hardware

**Files:**
- Modify: none

**Interfaces:**
- Consumes: deployed backend + reloaded Portal
- Produces: evidence the ceremony fires

This is the task that matters. Everything before it is plumbing; the deliverable is a sound in a room.

- [ ] **Step 1: Feed a card whose live rows are blank**

Use a cumulative card with a `live` allocation record whose rows carry no marks — the same shape as card `4071314` on 2026-08-26 (rows 1–33 marked, live record at 34–39 blank).

- [ ] **Step 2: Observe the Portal**

Expected: a banner reading **"Nothing filled in yet"** with detail **"Your new questions are rows 34–39. Fill them in, then scan again."**, and the `error` tone — a low double-buzz (two 190 Hz square-wave pulses, 130 ms each, 190 ms apart).

If the banner shows but there is no sound, that is a *separate* and lesser failure: check the Portal's software volume master (`volume.defaultMaster` in `portal.yml`) and FKB's `autoplayAudio`. The banner rendering proves the wire is correct.

- [ ] **Step 3: Confirm the backend agrees**

```bash
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query="school.print.scan-live-record-unmarked" AND _time:15m' -d 'limit=10'
```

Expected: one record, with `data.testId` and `data.silentLiveRecords`.

- [ ] **Step 4: Confirm the old silence is gone**

```bash
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query="school.print.scan-no-allocation" AND _time:15m' -d 'limit=10'
```

Expected: **zero** records for this scan. `scan-no-allocation` now only fires for a card the store has no records for at all, and when it does fire for one of ours it fires at `warn`, not `debug`.

- [ ] **Step 5: Verify the happy path still works**

Bubble the live rows correctly and rescan. Expected: the sheet grades, the result receipt **prints**, and the panel shows **nothing** — because when paper reaches the child's hand, the paper is the feedback and repeating the score on a wall panel reads a grade out loud in a shared room. Confirm via `school.scan.scan-graded` with `data.suppressed: "receipt-printed"`.

### Task A6: Close out the incident

**Files:**
- Modify: `docs/_wip/bugs/2026-08-26-school-scan-silent-on-unmarked-live-rows.md`

- [ ] **Step 1: Have the learner rescan**

Card `4071314`'s live record (rows 34–39) is intact and still `live`. Bubbling those rows and rescanning grades normally and prints the receipt. No teacher-console intervention and no reissue is needed.

- [ ] **Step 2: Update the report's status line**

Change the `**Status:**` header to record the deploy date and the verified-on-hardware result.

- [ ] **Step 3: Commit**

```bash
git add docs/_wip/bugs/2026-08-26-school-scan-silent-on-unmarked-live-rows.md
git commit -m "docs(school): the silent-scan fix is verified on hardware

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Track B — Close the last precision gap (F-5)

**Read this before starting.** The bug report currently claims a fully blank card "exits silently by a different route". **That is no longer true** — verified empirically 2026-08-26 after F-3/F-4 landed. A blank card with a live record now emits `scan-not-recorded` and two `warn` lines. The remaining defect is *copy*, not silence: `scan-not-recorded` reads **"Already done — I read that sheet, but there was nothing new to mark."** For a card nobody filled in, that is simply false, and it tells the child the opposite of what they need to do.

The fix routes a blank card into `scan-rows-unmarked`, whose copy already names the rows to fill in — exactly the right instruction.

### Task B1: A blank card reports its unmarked live record

**Files:**
- Modify: `backend/src/3_applications/school/documents/ResolveCardScan.mjs:597`
- Test: `backend/src/3_applications/school/documents/ResolveCardScan.test.mjs`

**Interfaces:**
- Consumes: `execute({testId, testIdCandidates, answers})`
- Produces: `silentLiveRecords: [{recordId, documentId, rowRange: {start, end}, learnerId?}]` now present when a live record's rows are unmarked **regardless of whether any other row on the card was marked**

- [ ] **Step 1: Write the failing test**

Add to `ResolveCardScan.test.mjs`, beside the other allocation tests:

```javascript
it('a completely blank card still reports its live record as unmarked', async () => {
  // 2026-08-26 follow-up. A card with a live worksheet and NO marks anywhere
  // used to fall through every diagnostic: `unknownCard` and `deadCard` both
  // require answers, and `silentLiveRecords` required them too, so the one
  // outcome that could name the rows to fill in was never populated.
  const repository = fakeRepository();
  const allocationStore = fakeAllocationStore({ rng: Math.random });
  const source = sourceDoc('blank-quiz', [
    mcQuestion('bq-q1', 1, { choices: ['X', 'Y'], answer: 'X' }),
  ]);
  const { allocation } = await publishAndAllocate({
    repository, allocationStore, source, context: { freshCard: true },
  });

  const result = await useCaseExecute({ allocationStore, repository }, {
    testId: allocation.cardId, answers: {},
  });

  expect(result.results).toEqual([]);
  expect(result.silentLiveRecords).toHaveLength(1);
  expect(result.silentLiveRecords[0].rowRange).toEqual(allocation.rowRange);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run backend/src/3_applications/school/documents/ResolveCardScan.test.mjs -t 'completely blank card'
```

Expected: FAIL — `expected undefined to have length 1`, because `silentLiveRecords` is omitted entirely when empty.

- [ ] **Step 3: Drop the answered-rows precondition**

In `ResolveCardScan.mjs`, inside the `for (const record of eligible)` loop, change:

```javascript
        if (record.status === 'live' && ownedRows.length > 0 && answeredRows.size > 0) {
```

to:

```javascript
        // `answeredRows.size > 0` used to gate this (the "wrong-rows
        // signature": marks on the card, none in this record's rows). A
        // COMPLETELY blank card is the same fact with a smaller sample — the
        // live record got nothing — and it is the case where naming the rows
        // helps most, because the child has not started. Dropping the clause
        // routes both into the same `scan-rows-unmarked` ceremony.
        if (record.status === 'live' && ownedRows.length > 0) {
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npx vitest run backend/src/3_applications/school/documents/ResolveCardScan.test.mjs
```

Expected: all pass. Pay attention to any *other* test that newly fails — a test asserting a bare empty result for a blank feed is now legitimately wrong and should be updated to expect `silentLiveRecords`, but a test about a card with **no records at all** must still pass untouched (`eligible` is empty there, so the loop never runs).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/school/documents/ResolveCardScan.mjs \
        backend/src/3_applications/school/documents/ResolveCardScan.test.mjs
git commit -m "fix(school): a blank card names the rows it is waiting for

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task B2: The blank card gets the right words

**Files:**
- Test: `backend/src/5_composition/modules/schoolPrintScanConsumer.silentScan.test.mjs`

**Interfaces:**
- Consumes: `silentLiveRecords` from Task B1
- Produces: no production change — this task proves the consumer already routes it correctly and locks that in

- [ ] **Step 1: Write the failing test**

Add to the `'a live worksheet with blank rows still speaks'` describe block:

```javascript
  it('tells a child with a BLANK card what to fill in, not that it was already done', async () => {
    // `scan-not-recorded` reads "Already done — there was nothing new to
    // mark", which is false for a card nobody filled in and points the child
    // away from the one thing they need to do.
    const bus = build({
      outcome: {
        results: [],
        cardRecordCount: 7,
        silentLiveRecords: [{
          recordId: 'civilization/atlas/ws-today@rev1:v0:34-39',
          documentId: 'civilization/atlas/ws-today',
          rowRange: { start: 34, end: 39 },
          learnerId: 'milo',
        }],
      },
      recorder: duplicateRecorder(),
    });
    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(eventsNamed(bus, 'scan-rows-unmarked')).toHaveLength(1);
    expect(eventsNamed(bus, 'scan-not-recorded')).toHaveLength(0);
  });
```

- [ ] **Step 2: Run it**

```bash
npx vitest run backend/src/5_composition/modules/schoolPrintScanConsumer.silentScan.test.mjs
```

Expected: **PASS immediately.** This is the one place in this plan where a passing-on-first-run test is correct rather than a TDD violation: the consumer branch already exists (shipped in `b991be97b`) and Task B1 is what makes it reachable for a blank card. The test's job is to lock the routing in, and it would have failed before B1.

If it FAILS, B1 did not take effect — go back and check the loop condition.

- [ ] **Step 3: Commit**

```bash
git add backend/src/5_composition/modules/schoolPrintScanConsumer.silentScan.test.mjs
git commit -m "test(school): a blank card is told what to fill in

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task B3: Correct the F-5 claim in the bug report

**Files:**
- Modify: `docs/_wip/bugs/2026-08-26-school-scan-silent-on-unmarked-live-rows.md`

- [ ] **Step 1: Rewrite the F-5 section**

The current text says a fully blank card "exits silently by a different route". Replace it with what is actually true: F-3/F-4 already removed the silence (`scan-not-recorded` fires), the residual defect was misleading copy, and Track B routed it to `scan-rows-unmarked`. Leaving the stale claim in place would send a future reader hunting a silence that no longer exists.

- [ ] **Step 2: Update the status header** to note F-5 closed.

- [ ] **Step 3: Commit**

```bash
git add docs/_wip/bugs/2026-08-26-school-scan-silent-on-unmarked-live-rows.md
git commit -m "docs(school): F-5 was never silent after the funnel landed

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Track C — Test health

### Task C1: Stop `omrRelay.test.mjs` flaking under the full gate

**Files:**
- Modify: `backend/src/3_applications/hardware/omrRelay.test.mjs`

**Interfaces:**
- Consumes: nothing new
- Produces: a test that passes under parallel load

The file passes 4/4 in isolation but failed under a 1420-file gate run. It contains ~10 real `setTimeout` sleeps of 25–40 ms (lines 72, 137, 154, 174, 217, 227, 290, 305, 342) plus elapsed-time assertions. Under load a 40 ms budget is not enough for the work it is waiting on, so it fails intermittently — and an intermittently-red file trains everyone to ignore it, which is how a real regression hides.

- [ ] **Step 1: Reproduce the flake under load**

```bash
npm run test:unit:vitest 2>&1 | tail -20
```

Expected: `omrRelay.test.mjs` appears in the NEW-failing list, at least sometimes. If it does not appear, run again — that is the nature of the bug.

- [ ] **Step 2: Add a condition-based wait helper**

Near the top of the test file:

```javascript
/**
 * Polls until `predicate()` is truthy. Replaces fixed sleeps, which encode a
 * guess about how long work takes — a guess that is wrong under parallel load
 * and produces a test that is red for reasons unrelated to the code.
 */
async function until(predicate, { timeoutMs = 2000, intervalMs = 5 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`until(): condition not met within ${timeoutMs}ms`);
    await new Promise((r) => { setTimeout(r, intervalMs); });
  }
}
```

- [ ] **Step 3: Replace each sleep with the condition it was waiting for**

Convert, for example:

```javascript
    await new Promise((r) => setTimeout(r, 40));
    const recs = readRecords();
    expect(recs).toHaveLength(1);
```

into:

```javascript
    const recs = await until(() => {
      const found = readRecords();
      return found.length === 1 ? found : null;
    });
    expect(recs).toHaveLength(1);
```

Do this one sleep at a time, running the file after each, so a conversion that changes meaning is caught immediately.

The two elapsed-time assertions (`Date.now() - recorded.getTime() > 60_000` and the drift checks) are asserting on **injected** timestamps, not on how long the test took — leave those alone.

- [ ] **Step 4: Verify in isolation and under load**

```bash
npx vitest run backend/src/3_applications/hardware/omrRelay.test.mjs
npm run test:unit:vitest 2>&1 | tail -20
```

Expected: 32 passed in isolation; absent from the gate's NEW-failing list.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/hardware/omrRelay.test.mjs
git commit -m "test(omr): wait for the condition, not for 40 milliseconds

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task C2: Decide what to do about the two `node:test` files

**Files:**
- Modify: `vitest.config.mjs` (only if you choose to exclude)

`nfcTapIngress.shutdown.test.mjs` and `pianoGames.test.mjs` are `node:test` files. A directory-glob vitest run picks them up and reports "no test suite found", which is noise, not a failure.

- [ ] **Step 1: Confirm they are genuinely `node:test`**

```bash
head -5 backend/src/5_composition/modules/nfcTapIngress.shutdown.test.mjs
head -5 backend/src/5_composition/modules/pianoGames.test.mjs
```

Expected: `import { test } from 'node:test'` or similar — NOT `from 'vitest'`.

- [ ] **Step 2: Confirm they actually run under their own runner**

```bash
node --test backend/src/5_composition/modules/nfcTapIngress.shutdown.test.mjs
```

If they pass, they are healthy tests in the wrong glob. If they fail, that is a real bug and belongs in its own task — do not paper over it with an exclude.

- [ ] **Step 3: Exclude them from vitest's glob only if Step 2 passed**

Add to the `exclude` array in `vitest.config.mjs` (it currently ends with the `'**/_deleteme/**'` entry):

```javascript
      '**/_deleteme/**',
      // `node:test` files, not vitest ones. A directory-glob vitest run
      // collects them and reports "no test suite found", which reads as a
      // failure and trains everyone to skim past the gate's failing list —
      // the exact habit that lets a real regression through. They still run
      // under `node --test`; excluding them here fixes the reporting, not
      // the coverage. Converting them to vitest is a bigger change than the
      // noise justifies.
      '**/nfcTapIngress.shutdown.test.mjs',
      '**/pianoGames.test.mjs',
```

- [ ] **Step 4: Confirm the gate's failing list shrank**

```bash
npm run test:unit:vitest 2>&1 | tail -20
```

Expected: neither file appears. The total test count should be unchanged, since neither was contributing any.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.mjs
git commit -m "test: stop collecting two node:test files as vitest suites

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Track D — Complete the public-kiosk shutdown

Fully optional. Nothing else depends on it. See `docs/_wip/plans/2026-08-26-portal-keys-apk-rebuild-handoff.md` for the standalone version of this.

**The single most important rule in this track:** do not restore the `portal_keys` block in `shutdown/config.yml` until the APK is verified. `ShutdownService#syncPortal` deliberately does not advance its signature on failure so the 5-second reconciler retries — against an APK with no `/lockdown` route that is a failed request plus a `shutdown.portal_sync_failed` warn **every 5 seconds, forever**, armed or not.

### Task D1: Build the APK (Mac only)

**Files:**
- Modify: `_extensions/portal-keys/app/app/build.gradle`

Not buildable on the prod host: no Android SDK, no `adb`, and the system JDK is 21 — too new for Gradle 7.5.1.

- [ ] **Step 1: Bump the version**

In `_extensions/portal-keys/app/app/build.gradle`, change `versionCode 15` → `versionCode 16` and `versionName "0.15-control-center-toggle"` → `versionName "0.16-lockdown"`. `install -r` rejects a lower `versionCode`, and `versionName` is what `pkctl status` shows you.

- [ ] **Step 2: Build**

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@11/libexec/openjdk.jdk/Contents/Home
GRADLE=~/.gradle/wrapper/dists/gradle-7.5.1-bin/*/gradle-7.5.1/bin/gradle
cd _extensions/portal-keys/app && $GRADLE :app:assembleDebug --no-daemon
```

Expected: `app/app/build/outputs/apk/debug/app-debug.apk`.

This ships **two** unbuilt changes together — `30f48f2af` (the lockdown control plane) and `ace5058c4` (`isPanelLit()`). Verify both.

- [ ] **Step 3: Commit the version bump**

### Task D2: Install and verify

- [ ] **Step 1: Install**

```bash
adb connect 10.0.0.92:5555
adb -s 10.0.0.92:5555 install -r .../app-debug.apk
```

- [ ] **Step 2: Confirm the accessibility grant survived**

```bash
node _extensions/portal-keys/pkctl.mjs status
```

Expected: `serviceBound : ✓ yes`. If not, **append** to the enabled-services list — never overwrite. The Portal ships three of its own accessibility services and clobbering the list breaks them.

- [ ] **Step 3: Confirm the new control plane exists**

```bash
node _extensions/portal-keys/pkctl.mjs config
```

Expected: a `lockdownToken`-related key is now present. Before the rebuild this returned no such key and `lockdown-token` answered `{"error":"unknown key: lockdownToken"}`.

- [ ] **Step 4: Verify `isPanelLit()` on a dark panel**

With the display off, press **one** volume key. Expected: the panel WAKES. The old build fell through to the double-press SLEEP branch because `PowerManager.isInteractive()` did not track the backlight on this hardware.

### Task D3: Provision the token and restore the config

- [ ] **Step 1: Provision**

```bash
SECRET=$(sudo docker exec daylight-station sh -c \
  "node -e \"const y=require('js-yaml');console.log(y.load(require('fs').readFileSync('data/household/auth/portal-keys-lockdown.yml','utf8')).token)\"")
node _extensions/portal-keys/pkctl.mjs lockdown-token "$SECRET"
```

Expected: `✓ shutdown token provisioned`, and `lockdownTokenSet: true` in `pkctl config`.

- [ ] **Step 2: Restore the `portal_keys` block**

Only now. Uncomment the block already sitting in `household/shutdown/config.yml`:

```yaml
portal_keys:
  base_url: http://10.0.0.92:8771
  auth_ref: portal-keys-lockdown
```

Write the file with a heredoc — **never `sed -i`**, which mangles multi-line YAML. Then `chown node:node` it, because `docker exec` runs as root.

- [ ] **Step 3: Restart so the adapter picks up baseUrl and token**

`PortalKeysLockdownAdapter` is constructed **once at boot** from a single `readShutdownConfig()` call, so unlike the policy fields it does not hot-reload. Run the deploy gate (Task A2) first, then restart the container.

- [ ] **Step 4: Confirm no reconciler spam**

```bash
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query="shutdown.portal_sync_failed" AND _time:10m' -d 'limit=20'
```

Expected: **zero**. Any hits mean the APK still lacks the route — re-comment the block immediately, or it logs every 5 seconds indefinitely.

### Task D4: Re-enable the sleep gesture

`screenToggleEnabled` was set `false` on 2026-08-26 as an interim mitigation. Order matters here.

- [ ] **Step 1: Wake locks FIRST**

```bash
FKB_HOST=10.0.0.92:2323 node cli/fkb.cli.mjs keepawake
node _extensions/portal-keys/pkctl.mjs preflight
```

With the display off the Portal **drops WiFi**, taking FKB REST, `pkctl`, and ADB-over-WiFi with it — the panel becomes unmanageable until someone physically presses a button. This bit the household on 2026-07-21. `preflight` fails closed and refuses if the wake locks are not set.

- [ ] **Step 2: Enable**

```bash
node _extensions/portal-keys/pkctl.mjs config set screenToggleEnabled true
```

### Task D5: End-to-end shutdown test

- [ ] **Step 1: Arm it**

Scan card `04aa660fcb2a81` at the `study-omr` reader.

- [ ] **Step 2: Verify all four effects**

- School screen (`portal`) blacked out
- Piano tablet (`yellow-room-tablet`) blacked out
- `script.public_kiosk_shutdown_cue` fired in Home Assistant
- The Portal's **physical** volume keys inert — the half this whole track exists for

```bash
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query="shutdown.portal_synced" AND _time:5m' -d 'limit=5'
```

- [ ] **Step 3: Revoke**

```bash
sudo docker exec daylight-station sh -c 'ls -l data/household/shutdown/lockdown.yml'
```

`lockdown.yml` is the **only** authority on an active window. To end a shutdown early, move it to `data/_deleteme/` — never `rm` inside the data tree. The 5-second reconciler notices and releases.

- [ ] **Step 4: Confirm release**

Both screens return and `pkctl status` shows the keys live again.

---

## Execution order

```
A1 → A2 → A3 → A4 → A5 → A6          ← do this first, alone, today
        ↓
B1 → B2 → B3                          ← next deploy
C1, C2                                ← anytime, independent
D1 → D2 → D3 → D4 → D5                ← needs a Mac and someone at the Portal
```

Track A is the only one with a waiting child. B, C, and D can each wait for a convenient window; none of them gates A, and A does not gate them.
