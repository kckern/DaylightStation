# Fitness Session Auto-Merge: Data Repair + Code Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the three fragmented fitness sessions from 2026-04-28 into a single session, then fix the bugs that caused the auto-merge to silently fail so it doesn't recur.

**Architecture:** Two phases. Phase A is a one-shot data repair using the existing `POST /api/v1/fitness/sessions/merge` endpoint. Phases B–D fix the bugs identified during the audit (`docs/_wip/audits/2026-04-28-fitness-session-merge-failure.md`):

- **Bug 1 (latent):** `_checkResumable` calls `DaylightAPI.get(url)` — but `DaylightAPI` is a function, not an object with a `.get` method, so the call would always throw `TypeError` if it ever ran. It hasn't been throwing because Bug 2 prevents it from running.
- **Bug 2 (active):** `_startWithResumeCheck` reads `contentId` from `this.snapshot.mediaPlaylists.video[0]`, but `updateSnapshot` short-circuits with `if (!this.sessionId) return` so the snapshot is empty before the session starts. `_getCurrentContentId()` always returns `null` at the moment the resume check fires, so `_checkResumable` is never called.
- **Observability gap:** Neither the frontend resume flow nor the backend `findResumable` log enough detail to diagnose failures. Today's investigation only got this far via on-disk YAML inspection.

**Tech Stack:** Node.js / Express backend (DDD layers), React 18 frontend, YAML datastore, custom structured logger (`frontend/src/lib/logging/`), Vitest/Jest unit tests, Docker deployment.

---

## File Structure

| Phase | File | Responsibility |
|---|---|---|
| A | `cli/merge-fitness-sessions.cli.mjs` (NEW) | One-shot script: calls merge endpoint twice, verifies result |
| B | `frontend/src/hooks/fitness/FitnessSession.js:1386-1395` | Fix `DaylightAPI.get` typo |
| B | `frontend/src/hooks/fitness/__tests__/FitnessSession.resumable.test.js` (NEW) | Unit test that fails before fix, passes after |
| C | `backend/src/3_applications/fitness/services/SessionService.mjs:319-376` | Add structured logging to `findResumable` |
| C | `frontend/src/hooks/fitness/FitnessSession.js:1386-1503` | Add structured logging to `_checkResumable` and `_startWithResumeCheck` |
| C | `frontend/src/lib/api.mjs:11-49` | Surface HTTP error body when fetch fails (don't lose response info) |
| D | `frontend/src/hooks/fitness/FitnessSession.js` | Add `setPendingContentId(id)` method; `_getCurrentContentId()` falls back to pending value |
| D | `frontend/src/context/FitnessContext.jsx:2100-2119` | Push `playQueue[0].contentId` into the session via `setPendingContentId` whenever the queue head changes — even before session starts |
| D | `frontend/src/hooks/fitness/__tests__/FitnessSession.contentId.test.js` (NEW) | Unit test confirming contentId fallback works pre-session |

---

## Conventions Used in This Plan

- **Working dir:** `/opt/Code/DaylightStation` (this is `kckern-server`, the prod host).
- **Backend port:** 3111 (Docker container `daylight-station`).
- **Reading data files:** `sudo docker exec daylight-station sh -c '...'` — `claude` user can't read the bind-mounted data volume directly.
- **Backend logger:** `logger.info('event-name', { data })` (note: backend uses `logger.info?.(...)` defensively in some places — match the surrounding style).
- **Frontend logger:** `getLogger().info('event-name', { data })` per `CLAUDE.md` Logging section.
- **Commits:** Land each task as one commit. Do not push or deploy until the full plan is done and the user reviews.

---

## Phase A — One-shot Data Repair

### Task 1: Verify the three sessions are merge-eligible

**Files:**
- Read: `data/household/history/fitness/2026-04-28/{20260428122815,20260428123501,20260428124229}.yml` (via docker exec)

The backend `mergeSessions` refuses to merge if either side has `finalized: true` (`SessionService.mjs:403`). We confirmed during the audit that none of these YAMLs have a top-level `finalized:` field, but verify it again before mutating data.

- [ ] **Step 1: Confirm `finalized` field is absent on all three sessions**

Run:
```bash
sudo docker exec daylight-station sh -c 'for f in 20260428122815 20260428123501 20260428124229; do echo "=== $f ==="; grep -E "^finalized:" data/household/history/fitness/2026-04-28/$f.yml || echo "(no top-level finalized field)"; done'
```

Expected output (all three):
```
(no top-level finalized field)
```

If any session shows `finalized: true`, STOP and surface to user before continuing — that session was explicitly ended by the user and must not be auto-merged.

- [ ] **Step 2: Snapshot the three files for safety**

Run:
```bash
sudo docker exec daylight-station sh -c 'mkdir -p /tmp/fitness-merge-backup-2026-04-28 && cp data/household/history/fitness/2026-04-28/20260428122815.yml data/household/history/fitness/2026-04-28/20260428123501.yml data/household/history/fitness/2026-04-28/20260428124229.yml /tmp/fitness-merge-backup-2026-04-28/'
```

Then verify:
```bash
sudo docker exec daylight-station sh -c 'ls -la /tmp/fitness-merge-backup-2026-04-28/'
```

Expected: three files listed, each non-empty.

- [ ] **Step 3: Commit nothing yet — Phase A only mutates data, no code changes**

(No git commit for this task. Backups live in container `/tmp` until verified post-merge.)

---

### Task 2: First merge — `20260428122815` into `20260428123501`

**Files:**
- API: `POST http://localhost:3111/api/v1/fitness/sessions/merge` (route at `backend/src/4_api/v1/routers/fitness.mjs:447`)
- Affected data: `data/household/history/fitness/2026-04-28/20260428122815.yml` (deleted), `20260428123501.yml` (rewritten with merged content)

The merge contract: source is the EARLIER session, target is the LATER one (target keeps its ID). Source file is deleted. The earlier timeline is prepended with a null-padded gap to the later timeline. Coins, events, participants, treasureBox.totalCoins are summed/unioned.

For our case: 122815 (12:28:15–12:34:50) is earlier, 123501 (12:35:01–12:42:16) is later → 11 sec gap → ~3 nulls prepended at 5 sec interval.

- [ ] **Step 1: Call the merge endpoint**

Run:
```bash
curl -s -X POST http://localhost:3111/api/v1/fitness/sessions/merge \
  -H "Content-Type: application/json" \
  -d '{"sourceSessionId":"20260428122815","targetSessionId":"20260428123501"}'
```

Expected response (one line of JSON, ID and timestamps may vary in exact ms):
```json
{"merged":true,"sessionId":"20260428123501","startTime":1777404495752,"endTime":1777404936771,"durationMs":441019}
```

`startTime` should equal the EARLIER session's start (12:28:15.752 PT = 1777404495752 ms).
`durationMs` should equal `(endTime - earlier startTime)` ≈ 441 sec ≈ 7m 21s.

If the call returns `{"error": "..."}`, STOP and report. Common failures:
- 404 + "Session not found" → wrong filename / wrong household
- 500 + "Cannot merge a finalized session" → re-check Task 1 Step 1

- [ ] **Step 2: Verify the source file was deleted and target was rewritten**

Run:
```bash
sudo docker exec daylight-station sh -c 'ls -la data/household/history/fitness/2026-04-28/20260428122815.yml data/household/history/fitness/2026-04-28/20260428123501.yml 2>&1'
```

Expected:
- `20260428122815.yml` → "No such file or directory"
- `20260428123501.yml` → exists, mtime updated to now, file size larger than the original 3494 bytes (now contains both sessions' data)

- [ ] **Step 3: Spot-check merged content**

Run:
```bash
sudo docker exec daylight-station sh -c 'head -10 data/household/history/fitness/2026-04-28/20260428123501.yml'
```

Expected output (timestamps and exact ID may vary slightly):
```yaml
version: 3
sessionId: '20260428123501'
session:
  id: '20260428123501'
  date: '2026-04-28'
  start: '2026-04-28 12:28:15.752'
  end: '2026-04-28 12:42:16.771'
  duration_seconds: 441
timezone: America/Los_Angeles
```

The `start` field MUST be `12:28:15.752` (from the earlier session). If it still shows `12:35:01.771`, the merge did not work — STOP and investigate.

- [ ] **Step 4: Commit nothing — still data-only**

---

### Task 3: Second merge — `20260428123501` (now containing both prior sessions) into `20260428124229`

**Files:**
- API: `POST http://localhost:3111/api/v1/fitness/sessions/merge`
- Affected data: `data/household/history/fitness/2026-04-28/20260428123501.yml` (deleted), `20260428124229.yml` (rewritten as the final merged session)

After this, only `20260428124229.yml` remains, containing the full ~37-minute workout.

- [ ] **Step 1: Call the merge endpoint**

Run:
```bash
curl -s -X POST http://localhost:3111/api/v1/fitness/sessions/merge \
  -H "Content-Type: application/json" \
  -d '{"sourceSessionId":"20260428123501","targetSessionId":"20260428124229"}'
```

Expected response (timestamps may vary):
```json
{"merged":true,"sessionId":"20260428124229","startTime":1777404495752,"endTime":1777406724470,"durationMs":2228718}
```

`durationMs` should be ≈ 2,228,718 ms ≈ 37m 8s — the full workout reunited.

- [ ] **Step 2: Verify final state**

Run:
```bash
sudo docker exec daylight-station sh -c 'ls data/household/history/fitness/2026-04-28/ | grep -E "^2026042812"'
```

Expected:
```
20260428124229.yml
```

(Only one file remaining for the workout block.)

- [ ] **Step 3: Verify session totals look right**

Run:
```bash
sudo docker exec daylight-station sh -c 'grep -A 20 "^summary:" data/household/history/fitness/2026-04-28/20260428124229.yml | head -30'
```

Expected: `summary.coins.total` should be approximately the sum of the three originals (58 + 88 + 348 = 494). It may not be exactly 494 because the merge re-derives summaries — values within ±10% are acceptable. The key check is that totals are roughly the union, not just the third session's solo total of 348.

- [ ] **Step 4: Verify in the UI**

This step is manual. Reload the fitness history view in any browser pointing at `daylightlocal.kckern.net`. The 2026-04-28 entry should show ONE workout of ~37 min instead of three back-to-back ones.

If the UI still shows three sessions, something is cached — hard refresh first. If it still shows three after a hard refresh, the merge didn't propagate to whatever index/list endpoint serves the UI — STOP and investigate.

- [ ] **Step 5: Commit nothing for Phase A**

(Phase A is data-only. No code commits.)

- [ ] **Step 6: Optionally clean up the safety backups**

Once the user has confirmed the merged session looks right (Step 4):
```bash
sudo docker exec daylight-station sh -c 'rm -rf /tmp/fitness-merge-backup-2026-04-28'
```

DO NOT run this until the user has explicitly confirmed Phase A succeeded.

---

## Phase B — Fix the `DaylightAPI.get` typo

### Task 4: Add a unit test that fails because of the typo

**Files:**
- Create: `frontend/src/hooks/fitness/__tests__/FitnessSession.resumable.test.js`

The test mocks `fetch` and asserts that `_checkResumable` actually invokes it (proving `DaylightAPI(url)` is called rather than throwing `TypeError`). With the current code (`DaylightAPI.get(...)`), the call throws immediately and `fetch` is never invoked.

- [ ] **Step 1: Confirm the test runner**

Run:
```bash
sudo docker exec daylight-station sh -c 'grep -E "\"test\":" package.json' 2>/dev/null || cat /opt/Code/DaylightStation/package.json | grep -E '"test":'
```

Note the test command. The repo uses Jest at root (per `CLAUDE.md` reference to "jest"). If Jest, use Jest test syntax. If Vitest, swap `describe/it/expect` (they're shape-compatible).

If unclear: check `/opt/Code/DaylightStation/jest.config.*` or `/opt/Code/DaylightStation/vitest.config.*`. The plan assumes Jest below; if it's Vitest, the only adjustment is import line `import { describe, it, expect, vi } from 'vitest'` and `vi.fn()` instead of `jest.fn()`.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/hooks/fitness/__tests__/FitnessSession.resumable.test.js`:

```javascript
import { jest } from '@jest/globals';

// Mock the API module BEFORE importing FitnessSession
const mockDaylightAPI = jest.fn();
jest.unstable_mockModule('../../../lib/api.mjs', () => ({
  DaylightAPI: mockDaylightAPI
}));

const { FitnessSession } = await import('../FitnessSession.js');

describe('FitnessSession._checkResumable', () => {
  beforeEach(() => {
    mockDaylightAPI.mockReset();
  });

  it('calls DaylightAPI as a function (not DaylightAPI.get)', async () => {
    mockDaylightAPI.mockResolvedValue({ resumable: false });

    // Construct a minimal session — _checkResumable doesn't depend on lifecycle
    const session = new FitnessSession({});
    const result = await session._checkResumable('plex:606203');

    expect(mockDaylightAPI).toHaveBeenCalledTimes(1);
    expect(mockDaylightAPI).toHaveBeenCalledWith(
      expect.stringContaining('api/v1/fitness/resumable?contentId=plex%3A606203')
    );
    expect(result).toEqual({ resumable: false });
  });

  it('returns { resumable: false } when contentId is empty', async () => {
    const session = new FitnessSession({});
    const result = await session._checkResumable('');
    expect(result).toEqual({ resumable: false });
    expect(mockDaylightAPI).not.toHaveBeenCalled();
  });

  it('swallows network errors and returns { resumable: false }', async () => {
    mockDaylightAPI.mockRejectedValue(new Error('Network down'));
    const session = new FitnessSession({});
    const result = await session._checkResumable('plex:606203');
    expect(result).toEqual({ resumable: false });
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run from project root:
```bash
cd /opt/Code/DaylightStation && npx jest frontend/src/hooks/fitness/__tests__/FitnessSession.resumable.test.js 2>&1 | tail -30
```

Expected: the first test (`calls DaylightAPI as a function`) FAILS with a message like `TypeError: DaylightAPI.get is not a function` (or the test's expectation fails because `mockDaylightAPI` was not called).

If the test passes, the typo is somehow not present — STOP and re-confirm by reading `frontend/src/hooks/fitness/FitnessSession.js:1389`.

If the test errors with module-resolution problems (e.g., `unstable_mockModule` not supported), see if the project uses CommonJS — adjust to `jest.mock(...)` style. Don't proceed to Step 4 until the test runs and shows the targeted failure.

- [ ] **Step 4: Commit the failing test**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/hooks/fitness/__tests__/FitnessSession.resumable.test.js && git commit -m "test(fitness): add failing test for _checkResumable API call shape"
```

---

### Task 5: Fix the `DaylightAPI.get` typo

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:1389`

`DaylightAPI` is exported from `frontend/src/lib/api.mjs:11` as `const DaylightAPI = async (path, data, method) => ...` — a function. There is no `.get` property. The call needs to be `DaylightAPI(url)`.

- [ ] **Step 1: Apply the fix**

Edit `frontend/src/hooks/fitness/FitnessSession.js`. Change line 1389 from:
```javascript
      const resp = await DaylightAPI.get(`api/v1/fitness/resumable?contentId=${encodeURIComponent(contentId)}`);
```
to:
```javascript
      const resp = await DaylightAPI(`api/v1/fitness/resumable?contentId=${encodeURIComponent(contentId)}`);
```

- [ ] **Step 2: Run the test and confirm all three pass**

Run:
```bash
cd /opt/Code/DaylightStation && npx jest frontend/src/hooks/fitness/__tests__/FitnessSession.resumable.test.js 2>&1 | tail -20
```

Expected: all 3 tests PASS.

- [ ] **Step 3: Commit the fix**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/hooks/fitness/FitnessSession.js && git commit -m "fix(fitness): call DaylightAPI as function in _checkResumable

DaylightAPI is exported as a function, not an object. The .get(url)
form would always throw TypeError, which was caught silently by the
try/catch and reported as { resumable: false }. This bug is latent —
it only manifests when _getCurrentContentId() returns a non-null id,
which Bug 2 (Phase D) prevents from ever happening."
```

---

## Phase C — Add diagnostic logging

### Task 6: Backend `findResumable` — log entry, candidates, and result

**Files:**
- Modify: `backend/src/3_applications/fitness/services/SessionService.mjs:319-376`

Currently `findResumable` is silent. Without these logs we cannot diagnose why a resume failed — the audit relied entirely on on-disk YAML inspection.

- [ ] **Step 1: Locate the logger reference inside SessionService**

Read the constructor of `SessionService`. If it accepts a `logger` dep, use it. If it doesn't (look at lines around 121–125), the class must be updated to accept one:

```bash
sed -n '120,135p' /opt/Code/DaylightStation/backend/src/3_applications/fitness/services/SessionService.mjs
```

If the constructor signature is `constructor({ sessionStore, defaultHouseholdId = null })`, extend it to `constructor({ sessionStore, defaultHouseholdId = null, logger = null })` and store `this.logger = logger`.

Then update the bootstrap site that constructs SessionService to pass the logger. Find it:
```bash
grep -rn "new SessionService\b\|SessionService({" /opt/Code/DaylightStation/backend/src/ 2>/dev/null
```

At each site, pass `logger` from the surrounding scope (every bootstrap function in this codebase already has a `logger` in scope per the patterns visible in `app.mjs`).

- [ ] **Step 2: Add the three log lines**

In `findResumable`, after `if (!contentId) return { resumable: false };`:

```javascript
    this.logger?.info?.('fitness.resumable.check.start', { contentId, householdId: hid, today });
```

After the filter, before the `if (candidates.length === 0)`:

```javascript
    this.logger?.info?.('fitness.resumable.check.candidates', {
      contentId,
      totalSessions: sessions.length,
      candidateCount: candidates.length,
      rejected: sessions.length - candidates.length,
      candidateIds: candidates.map(c => c.sessionId || c.session?.id).filter(Boolean)
    });
```

After the `const match = candidates[0];` line:

```javascript
    this.logger?.info?.('fitness.resumable.check.match', {
      contentId,
      matchedSessionId: sessionId,
      finalized: !!fullSession.finalized,
      ageMs: now - (typeof match.endTime === 'number' ? match.endTime : (match.startTime + (match.durationMs || 0)))
    });
```

And replace the existing `if (candidates.length === 0) return { resumable: false };` with:

```javascript
    if (candidates.length === 0) {
      this.logger?.info?.('fitness.resumable.check.no_match', { contentId });
      return { resumable: false };
    }
```

- [ ] **Step 3: Manually verify the new logs fire**

After the change rebuilds (in dev: nodemon picks it up; in container: rebuild image — see `CLAUDE.local.md` Build & Deploy), call the endpoint:

```bash
curl -s 'http://localhost:3111/api/v1/fitness/resumable?contentId=plex:606203' | head -c 500
```

Then check logs:
```bash
sudo docker logs daylight-station 2>&1 --since 1m | grep "fitness.resumable" | head -10
```

Expected: at minimum `fitness.resumable.check.start` and either `fitness.resumable.check.candidates` + (`.match` or `.no_match`).

- [ ] **Step 4: Commit**

```bash
cd /opt/Code/DaylightStation && git add backend/src/3_applications/fitness/services/SessionService.mjs backend/src/0_system/bootstrap.mjs backend/src/app.mjs && git commit -m "feat(fitness): instrument findResumable with structured logs

Adds entry/candidates/match/no_match events so future resume failures
are diagnosable from logs alone. Also wires the logger through the
SessionService constructor."
```

(If only one of `bootstrap.mjs` / `app.mjs` was modified for the constructor wiring, drop the other from `git add`.)

---

### Task 7: Frontend `_checkResumable` and `_startWithResumeCheck` — log decisions

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:1386-1503`

- [ ] **Step 1: Log entry / decision points in `_startWithResumeCheck`**

In `frontend/src/hooks/fitness/FitnessSession.js`, change the body of `_startWithResumeCheck` from:

```javascript
  async _startWithResumeCheck(reason) {
    const contentId = this._getCurrentContentId();

    if (!contentId) {
      if (!this.sessionId) this.ensureStarted({ reason, force: true });
      return;
    }

    const result = await this._checkResumable(contentId);

    if (!result.resumable) {
      if (!this.sessionId) this.ensureStarted({ reason, force: true });
      return;
    }

    if (result.finalized) {
      // Session was explicitly ended — needs user prompt
      this._pendingResumePrompt = result.session;
      this._notifyResumePromptNeeded(result.session);
      return;
    }

    // Auto-resume silently
    this.ensureStarted({ reason: 'resumed', force: true });
    this._hydrateFromSession(result.session);
  }
```

to:

```javascript
  async _startWithResumeCheck(reason) {
    const contentId = this._getCurrentContentId();
    getLogger().info('fitness.session.resume_check.start', { reason, contentId });

    if (!contentId) {
      getLogger().info('fitness.session.resume_check.no_content', { reason });
      if (!this.sessionId) this.ensureStarted({ reason, force: true });
      return;
    }

    const result = await this._checkResumable(contentId);
    getLogger().info('fitness.session.resume_check.result', {
      contentId,
      resumable: !!result.resumable,
      finalized: !!result.finalized,
      matchedSessionId: result.session?.sessionId || result.session?.session?.id || null
    });

    if (!result.resumable) {
      if (!this.sessionId) this.ensureStarted({ reason, force: true });
      return;
    }

    if (result.finalized) {
      getLogger().info('fitness.session.resume_check.finalized_prompt', { contentId });
      this._pendingResumePrompt = result.session;
      this._notifyResumePromptNeeded(result.session);
      return;
    }

    getLogger().info('fitness.session.resume_check.auto_resume', { contentId });
    this.ensureStarted({ reason: 'resumed', force: true });
    this._hydrateFromSession(result.session);
  }
```

- [ ] **Step 2: Log non-2xx responses in `_checkResumable`**

Currently `_checkResumable` swallows the entire error path through DaylightAPI's thrown exception. The `DaylightAPI` function throws `new Error('HTTP ${status}: ...')` on non-2xx (`api.mjs:43`), and `_checkResumable` catches that and logs only `error.message`. Make the log more informative by including the contentId and explicitly tagging HTTP failures vs. JS errors:

Change the catch block in `_checkResumable` from:
```javascript
    } catch (err) {
      getLogger().warn('fitness.session.resumable_check_failed', { contentId, error: err?.message });
      return { resumable: false };
    }
```

to:

```javascript
    } catch (err) {
      const message = err?.message || String(err);
      const isHttpError = message.startsWith('HTTP ');
      getLogger().warn('fitness.session.resumable_check_failed', {
        contentId,
        error: message,
        kind: isHttpError ? 'http' : 'js'
      });
      return { resumable: false };
    }
```

- [ ] **Step 3: Verify logs fire (deferred until Phase D landed; smoke-test now)**

For now, just confirm the file parses (no syntax error) by re-running the Phase B test:
```bash
cd /opt/Code/DaylightStation && npx jest frontend/src/hooks/fitness/__tests__/FitnessSession.resumable.test.js 2>&1 | tail -10
```

Expected: 3 PASS.

- [ ] **Step 4: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/hooks/fitness/FitnessSession.js && git commit -m "feat(fitness): instrument resume-check path with structured logs

Adds resume_check.start/no_content/result/finalized_prompt/auto_resume
events so we can see exactly which decision branch the resume flow
takes. Also tags resumable_check_failed events as http vs js to
distinguish backend outages from client bugs."
```

---

## Phase D — Fix the contentId source

### Task 8: Add `setPendingContentId` and make `_getCurrentContentId()` fall back to it

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js`
- Create: `frontend/src/hooks/fitness/__tests__/FitnessSession.contentId.test.js`

Root cause of the audit: `updateSnapshot` short-circuits with `if (!this.sessionId) return` (line 1716), so `snapshot.mediaPlaylists.video` is empty before the session starts. `_getCurrentContentId()` reads from that empty array and returns `null`. The resume check is never called.

Fix: introduce `setPendingContentId(id)` which stores a contentId hint outside the snapshot (so it isn't gated by `sessionId`). `_getCurrentContentId()` falls back to that hint when the snapshot is empty.

- [ ] **Step 1: Write a failing test**

Create `frontend/src/hooks/fitness/__tests__/FitnessSession.contentId.test.js`:

```javascript
import { jest } from '@jest/globals';

const mockDaylightAPI = jest.fn();
jest.unstable_mockModule('../../../lib/api.mjs', () => ({
  DaylightAPI: mockDaylightAPI
}));

const { FitnessSession } = await import('../FitnessSession.js');

describe('FitnessSession._getCurrentContentId pre-session fallback', () => {
  it('returns null when no session, no snapshot, no pending id', () => {
    const session = new FitnessSession({});
    expect(session._getCurrentContentId()).toBeNull();
  });

  it('returns the pending contentId when set, even before session starts', () => {
    const session = new FitnessSession({});
    session.setPendingContentId('plex:606203');
    expect(session._getCurrentContentId()).toBe('plex:606203');
  });

  it('prefers snapshot.mediaPlaylists.video[0].contentId when populated', () => {
    const session = new FitnessSession({});
    session.setPendingContentId('plex:000000'); // hint that should lose
    session.snapshot.mediaPlaylists.video = [{ contentId: 'plex:606203' }];
    expect(session._getCurrentContentId()).toBe('plex:606203');
  });

  it('clearing pending id resets fallback to null', () => {
    const session = new FitnessSession({});
    session.setPendingContentId('plex:606203');
    session.setPendingContentId(null);
    expect(session._getCurrentContentId()).toBeNull();
  });
});
```

Run it and confirm it FAILS with `TypeError: session.setPendingContentId is not a function`:

```bash
cd /opt/Code/DaylightStation && npx jest frontend/src/hooks/fitness/__tests__/FitnessSession.contentId.test.js 2>&1 | tail -20
```

- [ ] **Step 2: Add the method and field**

In `frontend/src/hooks/fitness/FitnessSession.js`, find the constructor (around line 280–410 — there's a long initialization block that sets `this._pendingResumePrompt = null;` etc). Add a sibling field:

```javascript
    this._pendingContentId = null;
```

Then add the setter as a class method. Find a logical place — co-locate it with `_getCurrentContentId` (around line 1505–1515). Insert just BEFORE `_getCurrentContentId`:

```javascript
  /**
   * Set a content-id hint that survives even before the session starts.
   * The React layer should call this whenever the play queue changes so
   * that the resume check has something to work with at buffer-threshold time.
   * @param {string|null} id
   */
  setPendingContentId(id) {
    this._pendingContentId = id || null;
  }
```

Then change `_getCurrentContentId` from:

```javascript
  _getCurrentContentId() {
    const playlist = this.snapshot?.mediaPlaylists?.video;
    if (Array.isArray(playlist) && playlist.length > 0) {
      return playlist[0]?.contentId || playlist[0]?.id || null;
    }
    return null;
  }
```

to:

```javascript
  _getCurrentContentId() {
    const playlist = this.snapshot?.mediaPlaylists?.video;
    if (Array.isArray(playlist) && playlist.length > 0) {
      const id = playlist[0]?.contentId || playlist[0]?.id;
      if (id) return id;
    }
    return this._pendingContentId || null;
  }
```

- [ ] **Step 3: Run the test, expect all 4 PASS**

```bash
cd /opt/Code/DaylightStation && npx jest frontend/src/hooks/fitness/__tests__/FitnessSession.contentId.test.js 2>&1 | tail -15
```

If any test fails, re-read the diff. Common mistake: forgetting to initialize `this._pendingContentId = null` in the constructor.

- [ ] **Step 4: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/hooks/fitness/FitnessSession.js frontend/src/hooks/fitness/__tests__/FitnessSession.contentId.test.js && git commit -m "feat(fitness): pre-session contentId fallback for resume check

updateSnapshot returns early when sessionId is unset, leaving
snapshot.mediaPlaylists.video empty at buffer-threshold time. The
resume check therefore had no contentId and short-circuited to a
fresh start. setPendingContentId() lets the React layer push the
intended contentId before the session begins."
```

---

### Task 9: Wire `setPendingContentId` from FitnessContext to FitnessSession

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx:2100-2119`

The React layer already has access to `fitnessPlayQueue` (the next-up content). Push its head contentId into the session continuously, regardless of whether the session has started.

- [ ] **Step 1: Read the surrounding code to confirm the queue shape**

```bash
sed -n '1060,1095p' /opt/Code/DaylightStation/frontend/src/context/FitnessContext.jsx
```

Note: at line 1072 the existing code reads `const currentItem = fitnessPlayQueue[0];`. Use the same shape — items have at least a `contentId` field (verify by reading a few callers if uncertain).

- [ ] **Step 2: Add the wiring effect**

In `frontend/src/context/FitnessContext.jsx`, just BEFORE the `useEffect` at line 2100 (the one that calls `session.updateSnapshot(...)`), add:

```javascript
  useEffect(() => {
    const session = fitnessSessionRef.current;
    if (!session || typeof session.setPendingContentId !== 'function') return;
    const head = Array.isArray(fitnessPlayQueue) ? fitnessPlayQueue[0] : null;
    const id = head?.contentId || head?.id || null;
    session.setPendingContentId(id);
  }, [fitnessPlayQueue]);
```

- [ ] **Step 3: Smoke-test in the running container**

This is a frontend change — to test it live, the Vite-built bundle must be rebuilt and the container restarted (per `CLAUDE.local.md` Build & Deploy). DO NOT do that automatically — the user must approve a deploy.

For now, the test that proves wiring works lives in the integration realm and is best validated post-deploy by replaying the bug:
1. Open the fitness page with `queue=plex:606203` (any short kettlebell-academy video).
2. Wait for buffer threshold met → session starts.
3. Close the browser tab before content finishes.
4. Re-open the same URL within 30 minutes.
5. Watch logs:
   ```bash
   sudo docker logs daylight-station -f 2>&1 | grep -E "(fitness\.session\.resume_check|fitness\.resumable)"
   ```
6. Expect to see: `resume_check.start` (with non-null contentId), then `resumable.check.candidates` (count >= 1), then `resume_check.auto_resume`.

If the logs show `resume_check.no_content`, the queue head wasn't populated yet — the React effect needs to run before buffer-threshold. Investigate further.

- [ ] **Step 4: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/context/FitnessContext.jsx && git commit -m "feat(fitness): push play-queue head into session as pending contentId

Lets the resume check run with a real contentId before the session
formally starts. Without this, _getCurrentContentId always returned
null at buffer-threshold time and the resume path silently no-op'd."
```

---

## Phase E — Cleanup and verification

### Task 10: Update the audit document with the resolution

**Files:**
- Modify: `docs/_wip/audits/2026-04-28-fitness-session-merge-failure.md`

The audit currently lists multiple hypotheses. Now that we know the root cause (Bug 1 + Bug 2), update it to reflect what we actually found and shipped.

- [ ] **Step 1: Append a "Resolution" section**

Add at the end of the audit file:

```markdown
---

## Resolution (2026-04-28, later same day)

**Root cause confirmed: Bug 1 + Bug 2 stacked.**

- **Bug 2 (active cause for these three sessions):** `updateSnapshot` (`FitnessSession.js:1716`) returns early when `!this.sessionId`, so `snapshot.mediaPlaylists.video` was empty at buffer-threshold time. `_getCurrentContentId()` returned `null`, and `_startWithResumeCheck` short-circuited to a fresh start without ever calling the backend. Confirmed by absence of `fitness.session.resumable_check_failed` events in the session logs (the catch block would have fired if `_checkResumable` had been called).
- **Bug 1 (latent, would have fired the moment Bug 2 was fixed in isolation):** `_checkResumable` called `DaylightAPI.get(url)` (`FitnessSession.js:1389`) but `DaylightAPI` is a function, not an object — the call would always throw `TypeError`.

Both fixed in plan `docs/_wip/plans/2026-04-28-fitness-session-merge-fix.md`. Phase D adds `setPendingContentId(id)` which the FitnessContext effect feeds from the play-queue head, so the resume check has a contentId to work with even before the session starts. Phase B fixes the typo. Phase C adds structured logs at every decision point so future failures are diagnosable from logs alone.

The three fragmented sessions from this incident were merged via `POST /api/v1/fitness/sessions/merge` (Phase A) — final session is `data/household/history/fitness/2026-04-28/20260428124229.yml`.

**Adjacent issue (NOT addressed in this plan):** the multi-client session-id collision is still open. Two browsers on the same fitness page within the same second produce identical session IDs and race to write the same file. Tracked as a separate concern.
```

- [ ] **Step 2: Commit**

```bash
cd /opt/Code/DaylightStation && git add docs/_wip/audits/2026-04-28-fitness-session-merge-failure.md && git commit -m "docs(audit): add resolution section to fitness merge failure audit"
```

---

### Task 11: Final verification

- [ ] **Step 1: Run the full frontend test suite**

```bash
cd /opt/Code/DaylightStation && npx jest frontend/src/hooks/fitness/__tests__/ 2>&1 | tail -20
```

Expected: all tests in the fitness hooks PASS. If unrelated tests in `__tests__/` fail, check whether they failed before this plan started (compare to `git stash; npx jest ...; git stash pop`).

- [ ] **Step 2: Run any existing tests for SessionService**

```bash
cd /opt/Code/DaylightStation && find tests/ backend/tests/ -name "*SessionService*" -o -name "*session*service*" 2>/dev/null | head -5
```

If anything turns up, run it:
```bash
npx jest <path-from-above> 2>&1 | tail -20
```

Expected: PASS (the only behavior change in SessionService is added logging — no logic changed).

- [ ] **Step 3: Hand off to user**

Surface a one-paragraph summary:

> Phase A merged the three 2026-04-28 sessions into `20260428124229.yml` (~37 min total).
> Phases B/C/D fixed two stacked bugs: the `DaylightAPI.get` typo and the empty-snapshot-pre-session contentId problem.
> Diagnostic logs are now in place at every decision point.
> All commits are local — no deploy yet. Review the diff and run a Docker rebuild + deploy when ready (see `CLAUDE.local.md` Build & Deploy).
> Replay the bug post-deploy to confirm: open a Kettlebell Academy video, let it buffer-threshold, close + reopen the tab within 30 min, watch logs for `fitness.session.resume_check.auto_resume`.

---

## Self-Review

**Spec coverage:**
- "One-shot merge the 3 sessions" → Phase A (Tasks 1–3)
- "Fix the code that failed to merge them" → Phase B (typo) + Phase D (contentId source). Phase C adds the logging that makes future failures diagnosable, which the audit explicitly recommended.

**Placeholder scan:** No "TBD" / "TODO" / "implement later" / "add error handling" lines. Every code change shows the exact code. Every command shows the exact invocation and expected output.

**Type / name consistency:**
- `setPendingContentId(id)` is referenced consistently across Tasks 8 and 9 and the contextual test.
- `_pendingContentId` field name matches between constructor init and the setter and the getter.
- `fitness.resumable.check.{start,candidates,match,no_match}` log event names match between Task 6 Steps 2 and 3 and the verification command.
- `fitness.session.resume_check.{start,no_content,result,finalized_prompt,auto_resume}` log event names match between Task 7 Step 1 and the smoke-test in Task 9 Step 3.
- `fitness.session.resumable_check_failed` (existing event name) is preserved exactly in Task 7 Step 2 — only the payload is enriched.
