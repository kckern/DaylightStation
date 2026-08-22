# MediaApp Cast-Failure Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the failure chain that made the 2026-08-21 19:49–19:56 PDT MediaApp session fail — three identical 38-second cast failures to `yellow-room-tablet` plus a phone search flow that destroyed the user's typed query — add the observability the incident lacked, and implement the approved mobile search/dispatch taxonomy redesign (`docs/superpowers/specs/2026-08-21-media-search-taxonomy-design.md`).

**Architecture:** Phase 1 (Tasks 1–6): prod-data fix (stale FKB password), backend adapter fixes (FKB error-envelope detection, foreground-verify fallback), combobox Enter policy, search settle logging/retry, pull-to-refresh guard. Phase 2 (Tasks 8–16): the taxonomy redesign — scope default-All, chips, stream status line, scoped-empty fallback, destination line, mobile Search Mode, tap grammar, browse dispatch header, Home/mini-player cleanup. Task 7 (deploy + live verification) runs LAST, after both phases.

**Tech Stack:** Node ESM backend (`.mjs`), React frontend (Mantine), vitest (isolated + component tests), Playwright (flow test), FKB REST API.

## Diagnostic Summary (evidence — corrected 2026-08-21 during execution)

**Incident:** User tried to cast "A Boy From The Moon" (`plex:696251`) to `yellow-room-tablet` (the piano tablet, FKB at `10.0.0.245:2323`, `auth_ref: fullykiosk-piano`). Three dispatches each failed after ~38s at the `prepare` step with `"Could not bring Fully Kiosk to foreground"`. Before that, phone search discarded the correctly-typed title twice and the app remounted mid-session, losing all state.

> **CORRECTION NOTICE.** The first two backend "root causes" in the original draft of this
> plan were WRONG and have been removed. They were produced by a broken probe: a shell
> variable assigned without `export`, read back via `process.env.FKB_PW`, sent the literal
> string `"undefined"` as the password — which is what actually produced the
> `{"status":"Error","statustext":"Please login"}` response, not a stale credential.
> Re-probed correctly (password passed via argv): the tablet ACCEPTS the configured
> password (`deviceName: "Galaxy Tab A (2018, 10.5)"`), and the two auth files' passwords
> hash identically (`sha256[0:12] = 94cec458d1ae`) and always did. A second re-probe polled
> `getDeviceInfo` 8× and found the `foreground` key present every time with value
> `de.ozerov.fully`, across screen-on/off and keyguard-locked — so "this FKB variant never
> emits `foreground`" is also false. The former Task 1 (password rewrite) is VOID.

**Root cause of the cast failure (the evidence that survives):**

1. **The adapter cannot tell an unusable payload from a real "wrong app in foreground" reading.** During the incident, 45 consecutive `getDeviceInfo` calls yielded `foreground: null` with **zero** `sendCommand.error` events — so HTTP succeeded, but what came back was not a usable device-info object. FKB returns HTTP 200 for several non-device-info shapes: an `{status:'Error', statustext}` envelope (auth failure or lockout), or the HTML admin dashboard (which `JSON.parse` leaves as a *string*, so `.foreground` is `undefined`). `#sendCommand` checks only the HTTP status, so all of these return `ok: true`, and `#verifyForeground` then reads `info.data?.foreground`, gets `undefined`, and logs it as evidence that the wrong app is in the foreground. It is not evidence of anything.
2. **The failure mode is self-amplifying.** On each unusable read the loop retries — 15 attempts × 1s × (toForeground + getDeviceInfo) = ~90 rapid remote-admin requests in ~4 minutes across the three dispatches. FKB's remote-admin interface throttles under hammering, so the retry strategy plausibly sustains the very condition it is retrying against, then hard-fails a dispatch that `toForeground` had been acking `{"status":"OK"}` for the whole time.
3. **Nothing recorded what actually came back.** `#sendCommand`'s request/response detail is `debug`-level, which never ships (memory: `reference_debug_logs_never_shipped`), and no code path logged the payload on anomaly. That is why diagnosing this needed live device probes and user recollection instead of one log query — and why the first attempt at that diagnosis got it wrong.

**Root causes of the search/UX failures (unchanged — these came from driving the real UI, not from the FKB probes):**

4. **Search was scoped to "Ambient" and never fell back.** (User-confirmed.) The scope select persists the last-used scope in localStorage (`SearchProvider`, `STORAGE_KEYS.SCOPE_LAST`) — the session opened stuck on `music-ambient` (`source=plex&plex.libraryId=21`), so "Boy from the moon" deterministically returned zero results. Nothing in the empty state names the active scope, and a scoped zero-result search does not widen to other libraries. On top of that, `decideCommit` (comboboxMachine.js:118) returns `dismiss` on Enter after a settled-zero search in `allowFreeform: false` contexts — box closes, typed text discarded. The user typed the correct title twice and lost it both times.
5. **The scope select is unusable on the phone — and disappears exactly when needed.** `MediaShell.scss`: on mobile the select is capped at 96px/13px, and the `:has(.media-search-bar:focus-within)` rule sets it `display: none` while the search field is focused — so during an empty-result search there is no visible scope control at all. The user had to enable Chrome's request-desktop-site mode to reach it. (Note: the session first read as "desktop" was the phone in desktop mode — 980×300 layout viewport, devicePixelRatio 3, X11 UA. The whole incident happened on one phone.)
6. **The piano tablet wasn't offered on the first cast surface the user reached.** `useDevices.filterPlaybackSurfaces` includes any device with `content_control`, so `yellow-room-tablet` IS in the fleet list — but the user had to go to the devices/peek page to dispatch to it. Which surface omitted it is **not recoverable from logs** (see observability gaps); the remediation task reproduces at 360px and fixes the surface it finds.
7. **No pull-to-refresh guard.** The phone app remounted at 19:51:05, losing state; portrait Chrome on Android triggers pull-to-refresh on overscroll and `.media-app` sets no `overscroll-behavior`.

**Observability gaps (a remediation target in their own right):**
- FKB responses are invisible: request/response detail is debug-level (never shipped) and payload shape is never logged on anomaly. This is what made the first diagnosis wrong.
- Search events carry no scope: `search.dispatch` logs text+mode only; nothing records that the query ran against `music-ambient`.
- No settle event: result counts and per-source stream errors (`sourceErrors`) are received and silently dropped.
- No cast-surface events: nothing records which cast picker/affordance was opened or which device ids it offered — failure mode 6 is invisible in the log store.

Non-bug, for the record: the dispatch pipeline's `power`/`verify` steps reporting instant "done" is correct — the tablet is self-powered (no `device_control`), so those steps are legitimate no-ops. Everything real happens in `prepare`.


## Global Constraints

- Execute from a **fresh worktree off `origin/main`** (create via superpowers:using-git-worktrees). Do NOT build on `feat/surround-containers` — it is 6 commits behind and mid-flight with school work.
- Isolated tests run with **vitest**, from the worktree using the main repo's binary: `node /opt/Code/DaylightStation/node_modules/.bin/vitest run <paths>`. The worktree needs BOTH `node_modules` and `frontend/node_modules` symlinked to the main checkout — `@mantine/*` lives in `frontend/node_modules`, and without that symlink every Mantine-importing test file fails to load.
- **Verified baseline before Task 2:** 54 files / 536 tests passing, exit 0.
- **Pass secrets to `node -e` via argv, never an unexported shell variable.** `FKB_PW=… node -e "process.env.FKB_PW"` reads `undefined` and sends the literal string `"undefined"` — this produced a false "stale password" root cause in the first draft of this plan.
- **Never `rm` in the data tree**; edit data files via `sudo docker exec daylight-station sh -c "cat > ... <<'EOF'"` (full-file writes, never `sed -i`).
- Deploy is allowed on this host **only after the garage/player gate check** (CLAUDE.local.md): zero recurring `playback.render_fps`, no `videoState:"playing"`, `sessionActive:false`, `rosterSize:0`. The gate is its own halting step, never chained.
- Frontend logging goes through the structured framework (`log.info(...)` child loggers), never raw console.

---

### Task 1: VOID — no work

The original Task 1 rewrote `data/household/auth/fullykiosk-piano.yml` on the premise of a stale password. **That premise was false** (see the Correction Notice above): the configured password is correct and identical to the shared one. The file was rewritten during execution with a byte-identical value and its ownership is unchanged (`node:node`), so prod data is in its original state. **Do not dispatch this task.** Skip to Task 2.

---

### Task 2: `#sendCommand` classifies the response shape

**Files:**
- Modify: `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs:594-611` (the HTTP-2xx success branch)
- Test: `tests/isolated/adapter/devices/FullyKioskContentAdapter.prepare.test.mjs` (create)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `#sendCommand` no longer returns `ok: true` for HTTP-200 responses that are not usable payloads. It returns:
  - `{ ok: false, error, authError: true, unusablePayload: true }` — for an `{status:'Error', statustext}` envelope whose `statustext` matches `/login/i`.
  - `{ ok: false, error, authError: false, unusablePayload: true }` — for any other `{status:'Error'}` envelope.
  - `{ ok: false, error: 'FKB returned a non-JSON response', unusablePayload: true, snippet }` — when the body could not be parsed as JSON and looks like markup (trimmed body starts with `<`), i.e. the HTML admin dashboard. `snippet` is the first 200 chars.
  - `{ ok: true, data }` — unchanged for everything else, including `{status:'OK'}` acks and the big device-info object (which carries no `status` key).
  Task 3 consumes `authError` and `unusablePayload`.

- [ ] **Step 1: Write the failing tests**

Create `tests/isolated/adapter/devices/FullyKioskContentAdapter.prepare.test.mjs`, following the mock conventions of the existing `FullyKioskContentAdapter.load.test.mjs` in the same directory:

```javascript
import { vi } from 'vitest';
import { FullyKioskContentAdapter } from '#adapters/devices/FullyKioskContentAdapter.mjs';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeHttpClient(handler) {
  return {
    get: vi.fn(async (url) => {
      const match = url.match(/\bcmd=([^&]+)/);
      return handler(match ? match[1] : null, url);
    })
  };
}

function makeAdapter(handler, logger = makeLogger()) {
  return new FullyKioskContentAdapter(
    { host: '10.0.0.245', port: 2323, password: 'x', daylightHost: 'https://example.com' },
    { httpClient: makeHttpClient(handler), logger }
  );
}

describe('FullyKioskContentAdapter response-shape classification', () => {
  test('auth-error envelope aborts prepare immediately instead of walking the retry loop', async () => {
    const logger = makeLogger();
    const adapter = makeAdapter(() => (
      { status: 200, data: { status: 'Error', statustext: 'Please login' } }
    ), logger);
    const result = await adapter.prepareForContent({ skipCameraCheck: true });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/login/i);
    // Must not have hammered the device: the old code sent 15 toForeground +
    // 15 getDeviceInfo before failing.
    expect(logger.warn).toHaveBeenCalledWith('fullykiosk.sendCommand.rejected', expect.objectContaining({ authError: true }));
  });

  test('non-auth Error envelope fails the command that received it', async () => {
    const adapter = makeAdapter((cmd) => {
      if (cmd === 'screenOn') return { status: 200, data: { status: 'Error', statustext: 'Something broke' } };
      return { status: 200, data: { status: 'OK' } };
    });
    const result = await adapter.prepareForContent({ skipCameraCheck: true });
    expect(result.ok).toBe(false);
    expect(result.step).toBe('screenOn');
    expect(result.error).toMatch(/Something broke/);
  });

  test('HTML dashboard body is reported as an unusable payload, not as success', async () => {
    const logger = makeLogger();
    const adapter = makeAdapter((cmd) => {
      if (cmd === 'screenOn') return { status: 200, data: '<!DOCTYPE html><html><body>Fully Kiosk admin</body></html>' };
      return { status: 200, data: { status: 'OK' } };
    }, logger);
    const result = await adapter.prepareForContent({ skipCameraCheck: true });
    expect(result.ok).toBe(false);
    expect(result.step).toBe('screenOn');
    expect(logger.warn).toHaveBeenCalledWith(
      'fullykiosk.sendCommand.nonJsonResponse',
      expect.objectContaining({ cmd: 'screenOn', snippet: expect.stringContaining('DOCTYPE') })
    );
  });

  test('normal OK acks and device-info payloads still succeed', async () => {
    const adapter = makeAdapter((cmd) => {
      if (cmd === 'getDeviceInfo' || cmd === 'deviceInfo') {
        return { status: 200, data: { foreground: 'de.ozerov.fully', screenOn: true } };
      }
      return { status: 200, data: { status: 'OK' } };
    });
    const result = await adapter.prepareForContent({ skipCameraCheck: true });
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node /opt/Code/DaylightStation/node_modules/.bin/vitest run tests/isolated/adapter/devices/FullyKioskContentAdapter.prepare.test.mjs`
Expected: the first three FAIL (all these shapes currently return `ok: true`). The auth test may also surface as a timeout because the current code walks the 15-attempt loop — that still counts as failing.

- [ ] **Step 3: Implement the classification in `#sendCommand`**

In the 2xx branch, after the existing `JSON.parse` attempt and before `return { ok: true, data }`:

```javascript
        // FKB answers HTTP 200 with several shapes that are NOT usable payloads.
        // Treating them as success is what let a dispatch spend 38s reading
        // `foreground` off an object that never had one (2026-08-21 incident).
        if (typeof data === 'string' && data.trim().startsWith('<')) {
          const snippet = data.slice(0, 200);
          this.#logger.warn?.('fullykiosk.sendCommand.nonJsonResponse', { cmd, snippet, elapsedMs });
          return { ok: false, error: 'FKB returned a non-JSON response', unusablePayload: true, snippet };
        }
        if (data && typeof data === 'object' && data.status === 'Error') {
          const authError = /login/i.test(data.statustext || '');
          this.#logger.warn?.('fullykiosk.sendCommand.rejected', {
            cmd, statustext: data.statustext, authError, elapsedMs
          });
          return { ok: false, error: data.statustext || 'FKB error', authError, unusablePayload: true };
        }
```

- [ ] **Step 4: Run the isolated adapter suite**

Run: `node /opt/Code/DaylightStation/node_modules/.bin/vitest run tests/isolated/adapter/devices/`
Expected: the three new shape tests PASS and the pre-existing `.load` tests still PASS. The auth-abort test's "did not hammer" assertion passes only once Task 3 lands; if it still fails here on timing, note it and carry it into Task 3 rather than loosening the assertion.

- [ ] **Step 5: Commit**

```bash
git add tests/isolated/adapter/devices/FullyKioskContentAdapter.prepare.test.mjs backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs
git commit -m "fix(devices): classify FKB HTTP-200 error envelopes and HTML bodies as failures"
```

---

### Task 3: `#verifyForeground` — never infer from an unusable payload; back off; trust the ack

**Files:**
- Modify: `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs:635-659` (`#verifyForeground`) and its call-site constants at lines 86-87 (`MAX_FOREGROUND_ATTEMPTS`, `FOREGROUND_RETRY_MS`)
- Test: `tests/isolated/adapter/devices/FullyKioskContentAdapter.prepare.test.mjs` (extend)

**Interfaces:**
- Consumes: `#sendCommand`'s `{ ok, data, error, authError, unusablePayload }` from Task 2.
- Produces: `#verifyForeground` returns
  - `{ ok: false, step: 'toForeground', error: 'FKB rejected credentials: …' }` immediately (no further attempts) when any call reports `authError`;
  - `{ ok: true }` when a usable device-info payload reports `foreground === fkPackage`;
  - `{ ok: true, assumed: true }` when the loop exhausts having received **zero** usable device-info payloads while `toForeground` acked at least once — the incident's exact shape;
  - `{ ok: false, step: 'toForeground', error: 'Could not bring Fully Kiosk to foreground' }` when usable payloads were received and consistently named a different foreground app.
- Constants change to `MAX_FOREGROUND_ATTEMPTS = 6` and `FOREGROUND_RETRY_MS = 700`, with the per-attempt delay `Math.min(FOREGROUND_RETRY_MS * attempt, 5000)` — ~15s worst case instead of ~38s, and 12 requests instead of 30.

- [ ] **Step 1: Write the failing tests (extend the Task 2 file)**

```javascript
describe('FullyKioskContentAdapter foreground verification', () => {
  test('assumes foreground when no usable device-info ever arrives but toForeground acks', async () => {
    // The 2026-08-21 incident shape: 45 reads, every one lacking `foreground`,
    // while toForeground acked OK the whole time.
    const logger = makeLogger();
    const adapter = makeAdapter((cmd) => {
      if (cmd === 'getDeviceInfo' || cmd === 'deviceInfo') {
        return { status: 200, data: { screenOn: true, isInScreensaver: false, packageName: 'de.ozerov.fully' } };
      }
      return { status: 200, data: { status: 'OK' } };
    }, logger);
    const result = await adapter.prepareForContent({ skipCameraCheck: true });
    expect(result.ok).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      'fullykiosk.prepareForContent.foregroundAssumed',
      expect.objectContaining({ attempts: 6 })
    );
  }, 30_000);

  test('still fails when usable payloads name a different foreground app', async () => {
    const adapter = makeAdapter((cmd) => {
      if (cmd === 'getDeviceInfo' || cmd === 'deviceInfo') {
        return { status: 200, data: { foreground: 'com.netflix.ninja', screenOn: true } };
      }
      return { status: 200, data: { status: 'OK' } };
    });
    const result = await adapter.prepareForContent({ skipCameraCheck: true });
    expect(result.ok).toBe(false);
    expect(result.step).toBe('toForeground');
  }, 30_000);

  test('an unusable payload is logged as unverifiable, not as a foreground reading', async () => {
    const logger = makeLogger();
    const adapter = makeAdapter((cmd) => {
      if (cmd === 'getDeviceInfo' || cmd === 'deviceInfo') return { status: 200, data: { screenOn: true } };
      return { status: 200, data: { status: 'OK' } };
    }, logger);
    await adapter.prepareForContent({ skipCameraCheck: true });
    expect(logger.warn).toHaveBeenCalledWith(
      'fullykiosk.prepareForContent.foregroundUnverifiable',
      expect.objectContaining({ attempt: 1 })
    );
    expect(logger.warn).not.toHaveBeenCalledWith(
      'fullykiosk.prepareForContent.notInForeground',
      expect.anything()
    );
  }, 30_000);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node /opt/Code/DaylightStation/node_modules/.bin/vitest run tests/isolated/adapter/devices/FullyKioskContentAdapter.prepare.test.mjs`
Expected: the "assumes foreground" and "unverifiable" tests FAIL (current code loops then errors, and logs `notInForeground` for missing fields). The "different app" test should already PASS — it pins behavior that must survive.

- [ ] **Step 3: Rewrite `#verifyForeground` and its constants**

At lines 86-87 set `const MAX_FOREGROUND_ATTEMPTS = 6;` and `const FOREGROUND_RETRY_MS = 700;`. Then:

```javascript
  async #verifyForeground(fkPackage, maxAttempts, retryMs, startTime) {
    let acked = false;
    let usableReads = 0;
    let lastAnomaly = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const fgCmd = await this.#sendCommand('toForeground');
      if (fgCmd.authError) {
        this.#logger.error?.('fullykiosk.prepareForContent.authRejected', { cmd: 'toForeground', error: fgCmd.error });
        return { ok: false, step: 'toForeground', error: `FKB rejected credentials: ${fgCmd.error}` };
      }
      if (fgCmd.ok) acked = true;

      // Backoff: the old fixed 1s x 15 sent ~30 admin requests per dispatch and
      // FKB throttles under that load — the retry strategy was sustaining the
      // condition it retried against.
      await new Promise(r => setTimeout(r, Math.min(retryMs * attempt, 5000)));

      const info = await this.#sendCommand('getDeviceInfo', { type: 'json' });
      if (info.authError) {
        this.#logger.error?.('fullykiosk.prepareForContent.authRejected', { cmd: 'getDeviceInfo', error: info.error });
        return { ok: false, step: 'toForeground', error: `FKB rejected credentials: ${info.error}` };
      }

      // Only a real device-info object carrying the field says anything about
      // which app is in front. Anything else is a transport/state anomaly and
      // must NOT be recorded as "the wrong app is in the foreground".
      const usable = info.ok && info.data && typeof info.data === 'object' && 'foreground' in info.data;
      if (usable) {
        usableReads++;
        if (info.data.foreground === fkPackage) {
          this.#logger.info?.('fullykiosk.prepareForContent.foregroundConfirmed', {
            attempt, elapsedMs: Date.now() - startTime
          });
          return { ok: true };
        }
        this.#logger.warn?.('fullykiosk.prepareForContent.notInForeground', {
          attempt, foreground: info.data.foreground, expected: fkPackage
        });
        continue;
      }

      lastAnomaly = info.unusablePayload
        ? (info.snippet ?? info.error)
        : 'device-info payload carried no foreground field';
      this.#logger.warn?.('fullykiosk.prepareForContent.foregroundUnverifiable', {
        attempt, reason: lastAnomaly, dataType: typeof info.data
      });
    }

    // Never got a usable reading, but FKB acknowledged the foreground request:
    // trust the ack rather than failing a dispatch that works. Failing here is
    // what cost the 2026-08-21 session three 38s dead ends.
    if (usableReads === 0 && acked) {
      this.#logger.info?.('fullykiosk.prepareForContent.foregroundAssumed', {
        attempts: maxAttempts, reason: lastAnomaly, elapsedMs: Date.now() - startTime
      });
      return { ok: true, assumed: true };
    }

    this.#logger.error?.('fullykiosk.prepareForContent.foregroundFailed', {
      attempts: maxAttempts, usableReads, elapsedMs: Date.now() - startTime
    });
    return { ok: false, step: 'toForeground', error: 'Could not bring Fully Kiosk to foreground' };
  }
```

- [ ] **Step 4: Run the full isolated adapter suite**

Run: `node /opt/Code/DaylightStation/node_modules/.bin/vitest run tests/isolated/adapter/devices/`
Expected: ALL PASS — the three Task 3 tests, the four Task 2 shape tests (including the auth-abort timing assertion), and the pre-existing `.load` tests.

- [ ] **Step 5: Commit**

```bash
git add tests/isolated/adapter/devices/FullyKioskContentAdapter.prepare.test.mjs backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs
git commit -m "fix(devices): never infer foreground from an unusable payload; back off and trust the ack"
```

---

### Task 4: Combobox — Enter with settled-zero results must not destroy input

**Files:**
- Modify: `frontend/src/modules/Content/combobox/comboboxMachine.js:117-119` (`decideCommit`)
- Test: `frontend/src/modules/Content/combobox/comboboxMachine.test.js` (extend)

**Interfaces:**
- Consumes: nothing from other tasks. `decideCommit` is pure.
- Produces: in `allowFreeform: false` contexts (dispatch-to-play), Enter after a settled zero-result search returns `{ action: 'open' }` (box stays open, text intact, empty state visible) instead of `{ action: 'dismiss' }`. Freeform contexts keep the `literal` commit. The RC4 dismiss for content-id-like strings (line 115) and the `<2 chars` dismiss (line 93) are deliberately unchanged.

- [ ] **Step 1: Write the failing test**

Add to `comboboxMachine.test.js`, matching its existing `decideCommit` test style (read the file first for the argument-builder helpers it uses; the raw call shape is below):

```javascript
import { decideCommit, isContainer } from './comboboxMachine.js';

test('enter with settled zero results in dispatch context keeps the box open (no input destruction)', () => {
  // 2026-08-21 incident: user typed a correct title on the phone, a transient
  // empty result set settled, Enter discarded the whole query and closed the box.
  const decision = decideCommit({
    reason: 'enter',
    search: 'Boy from the moon',
    value: '',
    results: [],
    highlightIdx: -1,
    userNavigated: false,
    selectContainers: false,
    searchSettled: true,
    isContainer,
    allowFreeform: false,
  });
  expect(decision.action).toBe('open');
});

test('enter with settled zero results in freeform context still commits the literal', () => {
  const decision = decideCommit({
    reason: 'enter',
    search: 'files:clips/some-video.mp4',
    value: '',
    results: [],
    highlightIdx: -1,
    userNavigated: false,
    selectContainers: false,
    searchSettled: true,
    isContainer,
    allowFreeform: true,
  });
  expect(decision.action).toBe('literal');
});
```

- [ ] **Step 2: Run to verify the first test fails**

Run: `node /opt/Code/DaylightStation/node_modules/.bin/vitest run frontend/src/modules/Content/combobox/comboboxMachine.test.js`
Expected: first test FAILS (`dismiss` !== `open`); second PASSES (pins existing freeform behavior).

- [ ] **Step 3: Change the zero-results branch**

At comboboxMachine.js:117-119, change:

```javascript
  if (results.length === 0) {
    if (searchSettled) return allowFreeform ? { action: 'literal', value: search } : { action: 'dismiss' };
    return { action: 'open' };
  }
```

to:

```javascript
  if (results.length === 0) {
    // Settled-empty + Enter in a dispatch context used to 'dismiss' — closing the
    // box AND discarding the typed query. A transient empty result set then costs
    // the user their whole input (2026-08-21 phone incident). Stay open instead:
    // the text survives and the empty state explains itself.
    if (searchSettled) return allowFreeform ? { action: 'literal', value: search } : { action: 'open' };
    return { action: 'open' };
  }
```

- [ ] **Step 4: Run the combobox suites**

Run: `node /opt/Code/DaylightStation/node_modules/.bin/vitest run frontend/src/modules/Content/combobox/`
Expected: ALL PASS. If an existing test pinned the old `dismiss` behavior, read it — if it exists it encodes RC4's intent, so update that test's expectation to `open` and say so in the commit message.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Content/combobox/comboboxMachine.js frontend/src/modules/Content/combobox/comboboxMachine.test.js
git commit -m "fix(combobox): keep box open on enter with settled-zero results in dispatch contexts"
```

---

### Task 5: Search settle observability + one-shot retry on source errors

**Files:**
- Modify: `frontend/src/modules/Content/combobox/useContentCombobox.js` (near line 610, where `searchSettled` is computed; `sourceErrors` already arrives from `useStreamingSearch` at line 207; `streamSearch`/`doBatchSearch` are in scope from lines 208/222)

**Interfaces:**
- Consumes: existing `searchSettled` boolean, `state.results`, `rawResultCount`, `sourceErrors` (object keyed by source), `queryRef`, `streamSearch`, `doBatchSearch`, `supportsSSE()`, and the hook's `log` child logger.
- Produces: a `search.settled` info event `{ textLength, resultCount, rawResultCount, sourceErrors: [names] }` exactly once per settle; a `search.source_error` warn per errored source; and — when a search settles with **zero results and at least one errored source** — a single automatic re-dispatch of the same query (`search.retry_after_source_error`). Without the retry, Task 4 only preserves the user's text: nothing re-runs the search until they edit it. With it, the 2026-08-21 phone scenario (transient adapter error → settled empty) self-heals in-flow, and only persistent failures surface as an empty state. The one-shot guard (per query text) prevents retry loops when a source is genuinely down.

- [ ] **Step 1: Add the settle-logging effect**

In `useContentCombobox.js`, immediately after the `searchSettledRef` mirror (line ~616):

```javascript
  // Observability: the 2026-08-21 incident (phone search settled empty for a
  // title that existed) was undiagnosable because nothing recorded what a
  // search settled WITH. Log each settle transition once, with result counts
  // and any per-source stream errors.
  const settleLoggedForRef = useRef(null);
  useEffect(() => {
    if (!searchSettled) return;
    const text = queryRef.current;
    if (settleLoggedForRef.current === text) return;
    settleLoggedForRef.current = text;
    const erroredSources = Object.keys(sourceErrors || {});
    log.info('search.settled', {
      textLength: text.length,
      resultCount: stateRef.current.results.length,
      rawResultCount,
      sourceErrors: erroredSources,
    });
    for (const source of erroredSources) {
      log.warn('search.source_error', { source, error: String(sourceErrors[source]?.message ?? sourceErrors[source]) });
    }
  }, [searchSettled, sourceErrors, rawResultCount, log]);
```

(If `sourceErrors` is an array or Map rather than an object, adapt the two reads — check its shape in `useStreamingSearch` before writing.)

- [ ] **Step 1b: Add the one-shot retry on settled-empty-with-source-errors**

Immediately after the settle-logging effect from Step 1:

```javascript
  // One-shot recovery: a transient source error can settle a search at zero
  // results for a title that exists (2026-08-21 phone incident). Task 4 keeps
  // the user's text, but nothing re-runs the search until they edit it —
  // so re-dispatch the same query once. Guarded per query text: a source
  // that is genuinely down must not retry-loop.
  const retriedForRef = useRef(null);
  useEffect(() => {
    if (!searchSettled) return;
    const text = queryRef.current;
    const erroredSources = Object.keys(sourceErrors || {});
    if (erroredSources.length === 0) return;
    if (stateRef.current.results.length > 0) return;
    if (retriedForRef.current === text) return;
    retriedForRef.current = text;
    log.info('search.retry_after_source_error', { textLength: text.length, sourceErrors: erroredSources });
    if (supportsSSE()) streamSearch(text);
    else doBatchSearch(text);
  }, [searchSettled, sourceErrors, streamSearch, doBatchSearch, log]);
```

Note the ordering dependency: this effect reads `searchSettled`, which is computed at line ~610 — both effects from this task must live **after** that computation. `retriedForRef` intentionally never resets for the same text: one retry per query, ever, per mount.

- [ ] **Step 2: Run the combobox hook tests to confirm no regression**

Run: `node /opt/Code/DaylightStation/node_modules/.bin/vitest run frontend/src/modules/Content/combobox/`
Expected: ALL PASS (the effect only adds log calls; existing tests use mocked loggers).

- [ ] **Step 3: Verify the event fires in a dev session**

Start the dev server if not running (check `ss -tlnp | grep 3113` first — kckern-server dev ports are 3112/3113), open `/media`, type a query, and confirm a `search.settled` line with a `resultCount` appears in the browser console (set `window.DAYLIGHT_LOG_LEVEL = 'debug'` if needed).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Content/combobox/useContentCombobox.js
git commit -m "feat(combobox): log search settles, and auto-retry once when a source error settles a search empty"
```

---

### Task 6: Block pull-to-refresh on the MediaApp

**Files:**
- Modify: `frontend/src/Apps/MediaApp.scss`

**Interfaces:**
- Consumes/Produces: nothing programmatic. Prevents Chrome-Android overscroll pull-to-refresh from remounting the app mid-session (the 19:51:05 remount that wiped the phone user's state).

- [ ] **Step 1: Add the overscroll guard**

In `MediaApp.scss`, on the `.media-app` root rule (add the rule block if the file styles it differently — read the file first):

```scss
.media-app {
  // Chrome Android turns downward overscroll into pull-to-refresh, which
  // remounts the app and destroys search/session state mid-flow
  // (2026-08-21 incident). Contain it; inner scrollers keep their behavior.
  overscroll-behavior-y: none;
  touch-action: pan-x pan-y;
}
```

- [ ] **Step 2: Verify in dev**

With the dev server up, open `/media` in desktop Chrome device-emulation (Android profile), scroll to the top and drag down: the page must not show the refresh spinner. Also confirm normal inner-list scrolling still works.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/Apps/MediaApp.scss
git commit -m "fix(media): block pull-to-refresh remount on mobile"
```

---

### Task 7: Deploy and end-to-end live verification — RUNS LAST, after Tasks 8–16

**Files:** none (operations).

**Interfaces:**
- Consumes: all prior tasks (Phases 1 AND 2) merged to `main` (merge directly, delete the worktree branch per CLAUDE.md branch rules; record it in `docs/_archive/deleted-branches.md`).

- [ ] **Step 1: Full test pass before merge**

Run: `node /opt/Code/DaylightStation/node_modules/.bin/vitest run tests/isolated/adapter/devices/ frontend/src/modules/Content/combobox/`
Expected: ALL PASS. Capture the actual exit code (`echo $?`), don't infer from output.

- [ ] **Step 2: Merge to main, build**

```bash
git checkout main && git pull && git merge --no-ff <branch> && ./scripts/build-daylight.sh
```

- [ ] **Step 3: Deploy gate — HALT here until clear**

Run the two gate commands from CLAUDE.local.md (`render_fps`/`videoState` count and `sessionActive`/`rosterSize` grep). This step HALTS the task until both gates read clear. Only then:

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

- [ ] **Step 4: Re-run the failed user journey end-to-end — at phone size**

From headless Playwright at 360×740 (per `reference_headless_playwright_screenshot`), open `/media`: tap the dock search launcher → Search Mode opens → chips show All selected → type "Boy from the moon" → result paints → tap the destination line, pick `yellow-room-tablet` from the sheet (verify EVERY content_control device is listed) → tap the result. Also verify the scoped-empty fallback once: select the Music › Ambient chip, search the same title, confirm the "showing results from everywhere" fallback appears. Then verify in the log store:

```bash
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query=("fullykiosk.prepareForContent.foregroundConfirmed" OR "fullykiosk.prepareForContent.foregroundAssumed" OR "fullykiosk.load.acknowledged" OR "dispatch.failed") AND _time:15m' -d 'limit=20'
```

Expected: a `foregroundAssumed` (or `foregroundConfirmed`) and a `load.acknowledged` for the dispatch; **no** `dispatch.failed`. The tablet should be visibly playing the video.

- [ ] **Step 5: Restore the piano kiosk**

The verification dispatch hijacked the piano tablet. Send it back to its start URL:

```bash
PIANO_PW=$(sudo docker exec daylight-station sh -c "node -e \"const y=require('js-yaml');console.log(y.load(require('fs').readFileSync('data/household/auth/fullykiosk-piano.yml','utf8')).password)\"")
node -e "
const qs = new URLSearchParams({cmd:'loadStartURL', password: process.argv[1], type:'json'}).toString();
fetch('http://10.0.0.245:2323/?' + qs).then(r=>r.text()).then(console.log);
" "$PIANO_PW"
```

- [ ] **Step 6: Confirm the piano screensaver path recovered**

The screensaver's `screenOn`/`screenOff` were silently auth-failing (root cause 2). Watch for successful screen control after the fix:

```bash
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query="fullykiosk.sendCommand.rejected" AND _time:1h' -d 'limit=10'
```

Expected: zero `rejected` events for host 10.0.0.245 after deploy. (Any that do appear now name the exact command and `statustext` — which is the observability this incident lacked.)

---

---

## Phase 2 — Search & Dispatch Taxonomy Redesign

Implements `docs/superpowers/specs/2026-08-21-media-search-taxonomy-design.md` (D1–D7). Read the spec before starting any Phase 2 task. All component tests follow the conventions of the neighboring existing `*.test.jsx` files — read the sibling test first, reuse its render/provider harness. Mobile breakpoint = the existing `mobile-only` mixin in `MediaShell.scss`.

### Task 8: Scope state — default All, session-only (spec D5 state layer)

**Files:**
- Modify: `frontend/src/modules/Media/search/SearchProvider.jsx` (lines 25–42: load effect and `setScopeKey`)
- Modify: `docs/reference/media/search-scopes.md` (§App Behavior, §Persistence)
- Test: `frontend/src/modules/Media/search/SearchProvider.test.jsx` (extend)

**Interfaces:**
- Produces: `useSearchContext()` unchanged shape `{ scopes, currentScopeKey, currentScope, scopeError, setScopeKey }`, plus new `resetScope()` that returns to the default key. `currentScopeKey` initializes to the FIRST scope in config (`all`) on every mount — no localStorage read/write. Tasks 9/11/13 consume this.

- [ ] **Step 1: Write the failing test** — in `SearchProvider.test.jsx`, following its existing mock of `DaylightAPI`:

```jsx
test('ignores a stored legacy scope key and defaults to the first scope', async () => {
  localStorage.setItem('media-scope-last', 'music-ambient'); // legacy key must be inert
  render(<SearchProvider><Probe /></SearchProvider>); // Probe: existing test helper exposing context
  await waitFor(() => expect(screen.getByTestId('scope-key').textContent).toBe('all'));
});

test('setScopeKey does not persist across provider remounts', async () => {
  const { unmount } = render(<SearchProvider><Probe /></SearchProvider>);
  await waitFor(() => screen.getByTestId('scope-key'));
  act(() => screen.getByTestId('set-ambient').click()); // Probe button calling setScopeKey('music-ambient')
  unmount();
  render(<SearchProvider><Probe /></SearchProvider>);
  await waitFor(() => expect(screen.getByTestId('scope-key').textContent).toBe('all'));
});
```

- [ ] **Step 2: Run to verify failure** — `node /opt/Code/DaylightStation/node_modules/.bin/vitest run frontend/src/modules/Media/search/SearchProvider.test.jsx` — both FAIL (stored key currently wins; setScopeKey writes localStorage).

- [ ] **Step 3: Implement** — in `SearchProvider.jsx`: delete the `localStorage.getItem(SCOPE_KEY_LAST)` read and validity check (init to `loaded[0]?.key ?? null`); delete the `localStorage.setItem` in `setScopeKey`; add `resetScope = useCallback(() => setCurrentScopeKey(scopesRef→first key))` and expose it. Keep `SCOPE_KEY_LAST` exported only if something else imports it — if nothing does, delete the constant and its `STORAGE_KEYS` entry.

- [ ] **Step 4: Run the search suite** — `… vitest run frontend/src/modules/Media/search/` — ALL PASS. Update `search-scopes.md`: persistence section now says scope is session-only, catalog-wide default each entry; remove the `media-scope-last` table row.

- [ ] **Step 5: Commit** — `git commit -m "feat(media): search scope defaults to All every session; retire media-scope-last persistence"`

### Task 9: ScopeChips component (spec D5 UI)

**Files:**
- Create: `frontend/src/modules/Media/search/ScopeChips.jsx`, `frontend/src/modules/Media/search/ScopeChips.test.jsx`
- Modify: `frontend/src/modules/Media/search/Search.scss` (chip styles: 44px min touch target, horizontal scroll row, `overscroll-behavior-x: contain`)
- Modify: `frontend/src/modules/Media/search/MediaContentSearch.jsx` (desktop: replace the `<select>` with chips in the popover header per D5; the `<select>` and its optgroup rendering are deleted)

**Interfaces:**
- Consumes: `useSearchContext()` from Task 8.
- Produces: `<ScopeChips />` — renders top-level scopes as chips, `(All)` first and selected by default; tapping a parent with children expands a second chip row of its children; tapping any chip calls `setScopeKey(key)` and logs `search.scope_selected { scopeKey, viaFallback: false }`. No props (context-driven), so SearchMode (Task 13) and the desktop popover mount it identically.

- [ ] **Step 1: Failing tests** — render with a mocked context provider (follow `MediaContentSearch.test.jsx` harness):

```jsx
test('renders top-level scopes as chips with All selected', …);        // chips: All, Video, Music, Books; All has aria-pressed=true
test('tapping a parent with children reveals the child chip row', …);  // tap Music → Library/Hymns/Children's/Ambient chips appear
test('tapping a chip calls setScopeKey with its key', …);
```

- [ ] **Step 2: Verify failure, Step 3: implement, Step 4: suite passes** — buttons with `aria-pressed`, not Mantine Chips if the existing module avoids them; match `Search.scss` idiom. Desktop `MediaContentSearch` renders `<ScopeChips />` where the `<select>` was; delete the select + `scopeError` indicator moves beside the chips.

- [ ] **Step 5: Commit** — `git commit -m "feat(media): scope chips replace the scope select"`

### Task 10: Stream status line (spec D3)

**Files:**
- Create: `frontend/src/modules/Media/search/StreamStatusLine.jsx` + test
- Modify: `frontend/src/modules/Content/combobox/ContentCombobox.jsx` — remove the per-source "Searching:" badge-cloud block; render nothing in its place (the status line is mounted by the SURFACES: Task 13's SearchMode and Task 9's revised desktop popover header)

**Interfaces:**
- Consumes: `pending` (array of source names still searching) and `sourceErrors` from `useStreamingSearch` — already exposed through `useContentCombobox`'s return (`pendingSources`); thread them out if not already returned.
- Produces: `<StreamStatusLine pending={[]} sourceErrors={{}} onRetry={fn} />` — renders `null` when settled and error-free; "Searching N sources…" + spinner while pending; "‹source› didn't answer · Retry" per errored source when settled. Single line, fixed height, never taller.

- [ ] **Step 1: Failing tests** — three states: pending renders count line; settled+clean renders null; settled+error renders source name and Retry button wired to `onRetry(source)`.
- [ ] **Step 2–4: fail → implement → suite passes.** Verify the badge cloud is gone from `ContentCombobox` and no other consumer of the combobox (Admin pickers) breaks — run `… vitest run frontend/src/modules/Content/combobox/ frontend/src/modules/Media/`.
- [ ] **Step 5: Commit** — `git commit -m "feat(media): one-line stream status replaces the source badge cloud"`

### Task 11: Scoped-empty fallback to All (spec D5 fallback)

**Files:**
- Modify: `frontend/src/modules/Content/combobox/useContentCombobox.js` (builds directly on Phase 1 Task 5's settle effect)
- Modify: `frontend/src/modules/Media/search/SearchEmptyState.jsx` (label: "Nothing in ‹scope label› — showing N results from everywhere" / plain empty state when even All is empty)
- Test: `frontend/src/modules/Content/combobox/useContentCombobox.test.jsx` (extend)

**Interfaces:**
- Consumes: Task 8's context (scope label + params), Task 5's settle detection, the hook's `searchParams` prop and a new optional `fallbackSearchParams` prop.
- Produces: when a search settles empty AND `searchParams !== fallbackSearchParams` (non-nullish), the hook re-dispatches the same text with `fallbackSearchParams` exactly once per query text, marks state `fellBackToAll: true` (exposed in the hook return), and logs it on `search.settled { scopeKey, fellBackToAll: true }`. Surfaces (Tasks 9/13) pass `fallbackSearchParams` = the `all` scope's params and render the D5 label when `fellBackToAll` is set.

- [ ] **Step 1: Failing test** — scoped params + empty settle → expect a second `streamSearch` dispatch with fallback params and `fellBackToAll === true`; a second empty settle at fallback params does NOT loop.
- [ ] **Step 2–4: fail → implement → suites pass.** The one-shot guard composes with Task 5's source-error retry: retry (same params) first if sources errored; fallback (wider params) only on a clean empty settle.
- [ ] **Step 5: Commit** — `git commit -m "feat(media): scoped search falls back to catalog-wide on empty settle"`

### Task 12: Destination line + device sheet + named toasts (spec D4)

**Files:**
- Create: `frontend/src/modules/Media/cast/DestinationLine.jsx` + test
- Modify: `frontend/src/modules/Media/cast/DispatchTargetPicker.jsx` (reused as the sheet body; verify it lists ALL `fleet.devices` — it does today — and add `mediaLog` call on open: `cast.sheet_opened { offeredDeviceIds }`)
- Modify: `frontend/src/modules/Media/search/useContentDispatch.js` (dispatch confirmation toast names title + destination; failure toast names device + specific error from Phase 1's adapter fixes, with Retry re-invoking the same dispatch)
- Modify: `frontend/src/modules/Media/logging/mediaLog.js` (new events: `castSheetOpened`, `destinationChanged`)

**Interfaces:**
- Consumes: `useCastTarget()` / `CastTargetProvider` state (targetIds, mode) — single source of truth shared with the dock chip.
- Produces: `<DestinationLine />` — "▶ Playing to: **‹name›**" (resolves target id → device name via fleet; "This browser" when no remote target); tap opens the device sheet; changing logs `dispatch.destination_changed { from, to, surface }`. Mounted by SearchMode (Task 13) and the container dispatch header (Task 15).

- [ ] **Step 1: Failing tests** — renders "This browser" with no target; renders device name with a target; tap opens sheet; sheet pick updates the shared CastTargetProvider state (assert via context probe).
- [ ] **Step 2–4: fail → implement → suites pass** (`… vitest run frontend/src/modules/Media/cast/`).
- [ ] **Step 5: Commit** — `git commit -m "feat(media): visible dispatch destination line with full device sheet and named toasts"`

### Task 13: Mobile Search Mode + dock launcher (spec D1–D2)

**Files:**
- Create: `frontend/src/modules/Media/search/SearchMode.jsx` + `SearchMode.test.jsx` + styles in `Search.scss`
- Modify: `frontend/src/modules/Media/shell/Dock.jsx` (mobile: full-width launcher button reading "Search media…" + settings gear only; fleet indicator and cast chip removed at mobile widths — fleet badge moves to the Devices tab in `PrimaryNav.jsx`)
- Modify: `frontend/src/modules/Media/shell/PrimaryNav.jsx` (Devices tab badge from `useFleetSummary`)
- Modify: `frontend/src/modules/Media/logging/mediaLog.js` (`searchModeEntered/Exited`)
- Modify: `docs/reference/media/media-app.md` (dock/shell section: mobile search-as-mode, destination line)

**Interfaces:**
- Consumes: Tasks 8–12 components (`ScopeChips`, `StreamStatusLine`, `DestinationLine`), `useContentCombobox` (with `allowFreeform:false`, `fallbackSearchParams`), `useContentDispatch`.
- Produces: full-screen overlay surface — layout per spec D2 ASCII: ✕ + input (autofocus), DestinationLine, ScopeChips, StreamStatusLine, results list filling the rest. Exits on ✕, browser back (pushes a history entry on open; popstate closes), or successful dispatch (with toast). Scope resets to All on every open (`resetScope()` from Task 8). Container/leaf row behavior comes from Task 14.

- [ ] **Step 1: Failing tests** — opens from dock launcher tap; autofocuses input; renders chips with All selected on every open (open→select Ambient→close→open→All again); ✕ closes; a `select` of a leaf result calls dispatch and closes.
- [ ] **Step 2–4: fail → implement → suites pass.** The surface reuses the combobox HOOK, not the popover component — results render as a plain list owned by SearchMode. Verify desktop is untouched at ≥ tablet widths (existing `MediaContentSearch` path).
- [ ] **Step 5: Commit** — `git commit -m "feat(media): full-screen mobile search mode; dock becomes search launcher"`

### Task 14: Tap grammar on result rows (spec D6)

**Files:**
- Create: `frontend/src/modules/Media/search/ResultRow.jsx` + test (shared by SearchMode list and desktop dropdown rows)
- Modify: `frontend/src/modules/Media/search/useContentDispatch.js` (route: leaf tap → play-now to destination; container tap → browse view; new `playContainerAsQueue(id)` for the ▶ verb)
- Modify: `frontend/src/modules/Content/combobox/comboboxMachine.js` ONLY if the existing `isContainer` predicate needs export — the grammar itself lives in `ResultRow`/`useContentDispatch`, NOT in the machine.

**Interfaces:**
- Consumes: `isContainer(item)` (existing predicate), `useContentDispatch`, Task 12 toasts.
- Produces: `<ResultRow item onTap onPlayAll onMore />` — leaf: tap=dispatch play-now, trailing ⋯ opens the four queue verbs (Play Now / Play Next / Up Next / Add to Queue — wire to the existing queue action functions used by BrowseView rows; read `BrowseView.jsx` for their names) + "Open detail". Container: tap=browse into it, trailing ▶ = play-as-queue on destination.

- [ ] **Step 1: Failing tests** — leaf tap calls dispatch with play-now; container tap routes to browse; container ▶ calls `playContainerAsQueue`; leaf ⋯ shows the four verbs.
- [ ] **Step 2–4: fail → implement → suites pass** across `frontend/src/modules/Media/`.
- [ ] **Step 5: Commit** — `git commit -m "feat(media): unified tap grammar — leaves play, containers browse, explicit verbs on rows"`

### Task 15: Container browse dispatch header (spec D6 addendum)

**Files:**
- Modify: `frontend/src/modules/Media/browse/BrowseView.jsx` (container header: **▶ Play · 🔀 Shuffle · + Queue** + inline `<DestinationLine />`)
- Test: create `frontend/src/modules/Media/browse/BrowseView.dispatch-header.test.jsx`

**Interfaces:**
- Consumes: Task 12 `DestinationLine`, Task 14 `playContainerAsQueue` (Shuffle = same with shuffle flag — read how existing queue dispatch passes shuffle; the `?queue=…&shuffle=1` deep-link contract in J9 shows the param exists end-to-end).
- Produces: every container browse view opens with the dispatch header directly under the title; all three verbs act on the whole container against the visible destination.

- [ ] **Step 1: Failing test** — rendering BrowseView for a container shows Play/Shuffle/Queue and the destination name; Play invokes container-as-queue dispatch with the container id.
- [ ] **Step 2–4: fail → implement → suites pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(media): prominent play/shuffle/queue dispatch header on container browse views"`

### Task 16: Home cleanup + idle mini player (spec D7)

**Files:**
- Modify: `frontend/src/modules/Media/browse/HomeView.jsx` (remove the four "Browse X" cards; Recent leads)
- Modify: `frontend/src/modules/Media/shell/MiniPlayer.jsx` (render `null` when no local session exists — read its existing session probe; extend `MiniPlayer.test.jsx` with an idle-renders-nothing case)

**Interfaces:** self-contained; nothing downstream consumes these.

- [ ] **Step 1: Failing tests** — HomeView renders no "Browse" cards; MiniPlayer with an idle/empty session renders nothing (no "Idle" text, zero height).
- [ ] **Step 2–4: fail → implement → suites pass** (`… vitest run frontend/src/modules/Media/`).
- [ ] **Step 5: Commit** — `git commit -m "feat(media): home leads with recent, idle mini player hidden"`

## Execution Order

Task 1 is **VOID** (its premise was disproven during execution — see the Correction Notice). Run **2 → 6** (Phase 1), then **8 → 16** (Phase 2), then **7** (deploy + live verification) LAST. Tasks 2–3 together are the cast fix: 2 stops the adapter from believing unusable payloads, 3 stops it from inferring "wrong app in foreground" from them and from hammering the device.

## Self-Review Notes

- **Incident root causes → tasks:** unusable FKB payloads read as success → 2; foreground inferred from those payloads + retry hammering → 3; Enter destroying input → 4; zero-result blindness → 5 (+11 for the real cause, scope); pull-to-refresh remount → 6; scope stuck on Ambient → 8+11; unusable/vanishing scope control → 9+13; results buried under the badge cloud → 10; invisible cast destination + device-sheet uncertainty → 12; devices-page workaround → 12+14+15. Task 7 replays the whole journey at 360px. (Former root cause "stale password" was disproven and its task voided.)
- **Spec coverage (D1–D7):** D1 → 13; D2 → 13; D3 → 10; D4 → 12; D5 → 8, 9, 11; D6 → 14, 15; D7 → 16. Spec observability events → 12 (`cast.sheet_opened`, `dispatch.destination_changed`), 13 (`search.mode_entered/exited`), 9 (`search.scope_selected`), 11 (`fellBackToAll` on `search.settled`). Spec doc-update requirements → 8 (search-scopes.md) and 13 (media-app.md).
- **Deliberately out of scope, with reasons:** RC4's content-id-like dismiss (comboboxMachine.js:115) keeps its intent — changing it needs its own design pass; per-row multi-target casting is explicitly a spec non-goal (the modal destination model is retained); desktop restyling beyond chips/status-line/tap-grammar inheritance is out.
- **Type consistency:** `authError` (Task 2) → consumed Task 3; `assumed: true` additive, nothing switches on it; Task 4's `open` action already handled by `commit()`'s `case 'open'`; `resetScope()` (Task 8) → called by Task 13; `fallbackSearchParams`/`fellBackToAll` (Task 11) → passed/read by Tasks 9 and 13; `DestinationLine` (Task 12) → mounted by Tasks 13 and 15; `playContainerAsQueue` (Task 14) → called by Task 15.
- **Known open detail for the implementer, not a placeholder:** Task 14's queue-action function names and Task 15's shuffle-flag parameter must be read off `BrowseView.jsx` before writing those tasks' code — the plan names the file and the contract (the four Plex-style verbs; `shuffle=1` exists end-to-end per J9) rather than guessing signatures.
