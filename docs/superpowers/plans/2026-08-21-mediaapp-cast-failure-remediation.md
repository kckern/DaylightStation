# MediaApp Cast-Failure Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the failure chain that made the 2026-08-21 19:49–19:56 PDT MediaApp session fail — three identical 38-second cast failures to `yellow-room-tablet` plus a phone search flow that destroyed the user's typed query — and add the observability that made this incident take a live-probe investigation to diagnose.

**Architecture:** One prod-data fix (stale FKB password), two backend adapter fixes (FKB error-envelope detection, foreground-verify fallback), two frontend fixes (combobox Enter policy, pull-to-refresh guard), one observability addition (search settle/error logging). Each is independently shippable.

**Tech Stack:** Node ESM backend (`.mjs`), React frontend, vitest (isolated tests), FKB REST API.

## Diagnostic Summary (evidence, verified 2026-08-21)

**Incident:** User tried to cast "A Boy From The Moon" (`plex:696251`) to `yellow-room-tablet` (the piano tablet, FKB at `10.0.0.245:2323`, `auth_ref: fullykiosk-piano`). Three dispatches each failed after ~38s at the `prepare` step with `"Could not bring Fully Kiosk to foreground"`. Before that, phone search discarded the correctly-typed title twice and the app remounted mid-session, losing all state.

**Root causes, confirmed by live probes:**

1. **Stale password in `data/household/auth/fullykiosk-piano.yml`.** The tablet's FKB rejects it (`{"status":"Error","statustext":"Please login"}`) but accepts the shared `data/household/auth/fullykiosk.yml` password (verified live: `getDeviceInfo` succeeds with the shared password, fails with the piano one).
2. **`FullyKioskContentAdapter.#sendCommand` treats FKB error envelopes as success.** FKB returns HTTP 200 for auth failures; `#sendCommand` only checks HTTP status, so `{"status":"Error"}` responses come back `ok: true`. Every command in the prepare flow (screenOn, setBooleanSetting, toForeground) silently no-opped. This also means the piano screensaver's `screenOn`/`screenOff` calls (same adapter, same auth) have been silently failing whenever FKB is up — the 45 `notInForeground` log entries all show `foreground: null` because `getDeviceInfo` was returning the error envelope, not device info.
3. **`#verifyForeground` requires a `foreground` field this FKB variant does not emit.** Verified live with the working password: the tablet's `getDeviceInfo` payload has ~75 keys but **no `foreground` key** (the Shield's FKB has it — that's why the same code path confirmed foreground 17× for the living room in the same 24h). Even after fixing the password, dispatch to this tablet would still burn 15 attempts × ~2.4s and fail.
4. **Search was scoped to "Ambient" and never fell back.** (User-confirmed; corrects an earlier "transient SSE error" hypothesis.) The scope select persists the last-used scope in localStorage (`SearchProvider`, `STORAGE_KEYS.SCOPE_LAST`) — the session opened stuck on `music-ambient` (`source=plex&plex.libraryId=21`), so "Boy from the moon" deterministically returned zero results. Nothing in the empty state names the active scope, and a scoped zero-result search does not widen to other libraries. On top of that, `decideCommit` (comboboxMachine.js:118) returns `dismiss` on Enter after a settled-zero search in `allowFreeform: false` contexts — box closes, typed text discarded. The user typed the correct title twice and lost it both times.
5. **The scope select is unusable on the phone — and disappears exactly when needed.** `MediaShell.scss`: on mobile the select is capped at 96px/13px, and the `:has(.media-search-bar:focus-within)` rule sets it `display: none` while the search field is focused — so during an empty-result search there is no visible scope control at all. The user had to enable Chrome's request-desktop-site mode to reach it. (Note: the session I first read as "desktop" was the phone in desktop mode — 980×300 layout viewport, devicePixelRatio 3, X11 UA. The whole incident happened on one phone.)
6. **The piano tablet wasn't offered on the first cast surface the user reached.** `useDevices.filterPlaybackSurfaces` includes any device with `content_control`, so `yellow-room-tablet` IS in the fleet list — but the user had to go to the devices/peek page to dispatch to it. Which surface omitted it is **not recoverable from logs** (see observability gaps); the remediation task reproduces at 360px and fixes the surface it finds.
7. **No pull-to-refresh guard.** The phone app remounted at 19:51:05, losing state; portrait Chrome on Android triggers pull-to-refresh on overscroll and `.media-app` sets no `overscroll-behavior`.

**Observability gaps (a remediation target in their own right — diagnosing this incident required live device probes and user memory):**
- Search events carry no scope: `search.dispatch` logs text+mode only; nothing records that the query ran against `music-ambient`.
- No settle event: result counts and per-source stream errors (`sourceErrors`) are received and silently dropped.
- No cast-surface events: nothing records which cast picker/affordance was opened or which device ids it offered — failure mode 6 is invisible in the log store.
- FKB request/response detail is debug-level, which never ships (see memory `reference_debug_logs_never_shipped`), and the error envelope wasn't detected at all — 45 `notInForeground` warns all said `foreground: null` while the true signal ("Please login") appeared in no shipped event.

Non-bug, for the record: the dispatch pipeline's `power`/`verify` steps reporting instant "done" is correct — the tablet is self-powered (no `device_control`), so those steps are legitimate no-ops. Everything real happens in `prepare`.

## Global Constraints

- Execute from a **fresh worktree off `origin/main`** (create via superpowers:using-git-worktrees). Do NOT build on `feat/surround-containers` — it is 6 commits behind and mid-flight with school work.
- Isolated tests run with **vitest**, from the worktree using the main repo's binary (see memory: `reference_vitest_in_worktree`): `node /opt/Code/DaylightStation/node_modules/.bin/vitest run <path> --root <worktree>` — or symlink `node_modules` per `reference_worktree_exec_and_stale_env_header`.
- **Never `rm` in the data tree**; edit data files via `sudo docker exec daylight-station sh -c "cat > ... <<'EOF'"` (full-file writes, never `sed -i`).
- Deploy is allowed on this host **only after the garage/player gate check** (CLAUDE.local.md): zero recurring `playback.render_fps`, no `videoState:"playing"`, `sessionActive:false`, `rosterSize:0`. The gate is its own halting step, never chained.
- Frontend logging goes through the structured framework (`log.info(...)` child loggers), never raw console.

---

### Task 1: Fix the stale FKB password (prod data — do this first, no code)

**Files:**
- Modify (in container data volume): `data/household/auth/fullykiosk-piano.yml`

**Interfaces:**
- Produces: a working `fullykiosk-piano` auth_ref. Tasks 2–3 are still required (they fix the *silent* part of the failure and the missing-field verify), but this alone restores dispatch-ability and the piano screensaver's screen control.

- [ ] **Step 1: Capture the current (broken) file for rollback**

```bash
sudo docker exec daylight-station sh -c 'cat data/household/auth/fullykiosk-piano.yml'
# Record the output in the task notes. Expected: password: "nNbeoezeXt3EY2cLm2YN" (rejected by the tablet)
```

- [ ] **Step 2: Write the working password**

The tablet currently accepts the shared household FKB password. Keep the separate auth file (it allows future divergence per device) but set it to the value the device actually accepts:

```bash
SHARED_PW=$(sudo docker exec daylight-station sh -c "node -e \"const y=require('js-yaml');console.log(y.load(require('fs').readFileSync('data/household/auth/fullykiosk.yml','utf8')).password)\"")
sudo docker exec daylight-station sh -c "cat > data/household/auth/fullykiosk-piano.yml << 'EOF'
password: \"$SHARED_PW\"
EOF"
```

(If the heredoc quoting fights you, write the file with a small `node -e` inside the container instead — never `sed -i`.)

- [ ] **Step 3: Verify live against the tablet**

```bash
PIANO_PW=$(sudo docker exec daylight-station sh -c "node -e \"const y=require('js-yaml');console.log(y.load(require('fs').readFileSync('data/household/auth/fullykiosk-piano.yml','utf8')).password)\"")
node -e "
const qs = new URLSearchParams({cmd:'getDeviceInfo', password: process.argv[1], type:'json'}).toString();
fetch('http://10.0.0.245:2323/?' + qs, {signal: AbortSignal.timeout(8000)})
  .then(r=>r.json()).then(j => console.log(j.status === 'Error' ? 'STILL REJECTED: '+JSON.stringify(j) : 'OK — deviceName='+j.deviceName+' screenOn='+j.screenOn));
" "$PIANO_PW"
```

Expected: `OK — deviceName=... screenOn=...`

- [ ] **Step 4: Restart the backend so any cached adapter picks up the new password**

Config/auth is read at adapter construction. Restart the container **after the deploy gate check** (see Global Constraints), or fold this into Task 7's deploy. If deferring: note that dispatches to the tablet keep failing until restart.

---

### Task 2: `#sendCommand` detects FKB error envelopes

**Files:**
- Modify: `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs:594-611` (the HTTP-2xx success branch)
- Test: `tests/isolated/adapter/devices/FullyKioskContentAdapter.prepare.test.mjs` (create)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `#sendCommand` returns `{ ok: false, error: string, authError?: true }` when FKB responds with an `{status: 'Error', statustext}` envelope. `authError: true` iff `statustext` matches `/login/i`. Task 3 relies on the `authError` flag. Successful `{status: 'OK'}` envelopes and payload responses (deviceInfo has no `status` key — verified) are unaffected.

- [ ] **Step 1: Write the failing tests**

Create `tests/isolated/adapter/devices/FullyKioskContentAdapter.prepare.test.mjs`, following the mock conventions of the existing `FullyKioskContentAdapter.load.test.mjs` (same directory):

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

describe('FullyKioskContentAdapter error-envelope detection', () => {
  test('prepareForContent fails fast on "Please login" envelope (auth error)', async () => {
    const adapter = makeAdapter(() => (
      { status: 200, data: { status: 'Error', statustext: 'Please login' } }
    ));
    const start = Date.now();
    const result = await adapter.prepareForContent({ skipCameraCheck: true });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/login/i);
    // The old behavior burned ~38s in the verify loop; auth failure must abort immediately.
    expect(Date.now() - start).toBeLessThan(2000);
  });

  test('non-auth Error envelope also fails the failing command', async () => {
    const adapter = makeAdapter((cmd) => {
      if (cmd === 'screenOn') return { status: 200, data: { status: 'Error', statustext: 'Something broke' } };
      return { status: 200, data: { status: 'OK' } };
    });
    const result = await adapter.prepareForContent({ skipCameraCheck: true });
    expect(result.ok).toBe(false);
    expect(result.step).toBe('screenOn');
    expect(result.error).toMatch(/Something broke/);
  });

  test('OK envelopes still succeed', async () => {
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
Expected: first two tests FAIL (the envelope currently comes back `ok: true`; the first test also times out the 38s loop — vitest's default 5s test timeout will surface it as a timeout failure, which is fine as "fails").

- [ ] **Step 3: Implement envelope detection in `#sendCommand`**

In the 2xx branch of `#sendCommand` (after the JSON.parse block, before `return { ok: true, data }`):

```javascript
        // FKB signals failures inside an HTTP-200 envelope: {status:'Error', statustext}.
        // Auth rejection ("Please login") otherwise masquerades as success and every
        // command silently no-ops (2026-08-21 yellow-room dispatch incident).
        if (data && typeof data === 'object' && data.status === 'Error') {
          const authError = /login/i.test(data.statustext || '');
          this.#logger.warn?.('fullykiosk.sendCommand.rejected', {
            cmd, statustext: data.statustext, authError, elapsedMs
          });
          return { ok: false, error: data.statustext || 'FKB error', authError };
        }
```

- [ ] **Step 4: Run the full adapter test suite**

Run: `node /opt/Code/DaylightStation/node_modules/.bin/vitest run tests/isolated/adapter/devices/`
Expected: new tests PASS except the fail-fast timing test, which still fails until Task 3 aborts the verify loop on `authError` — if so, note it and proceed to Task 3 before committing both together. If it passes already (because `screenOn` now fails first and prepare returns before the loop), commit here.

- [ ] **Step 5: Commit**

```bash
git add tests/isolated/adapter/devices/FullyKioskContentAdapter.prepare.test.mjs backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs
git commit -m "fix(devices): detect FKB HTTP-200 error envelopes in sendCommand"
```

---

### Task 3: `#verifyForeground` — abort on auth error, fall back when `foreground` is absent

**Files:**
- Modify: `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs:635-659` (`#verifyForeground`)
- Test: `tests/isolated/adapter/devices/FullyKioskContentAdapter.prepare.test.mjs` (extend)

**Interfaces:**
- Consumes: `#sendCommand`'s `{ ok, data, error, authError }` shape from Task 2.
- Produces: `#verifyForeground` returns `{ ok: true, assumed: true }` when the device's `getDeviceInfo` succeeds but its payload has no `foreground` key and `toForeground` was acknowledged OK; returns `{ ok: false, step: 'toForeground', error }` immediately (no retry loop) on `authError`.

- [ ] **Step 1: Write the failing tests (extend the Task 2 file)**

```javascript
describe('FullyKioskContentAdapter foreground verification', () => {
  test('accepts FKB variants whose deviceInfo lacks a foreground field', async () => {
    // The yellow-room tablet's FKB deviceInfo has ~75 keys but no `foreground`
    // (verified live 2026-08-21). toForeground acks OK — trust it.
    const adapter = makeAdapter((cmd) => {
      if (cmd === 'getDeviceInfo' || cmd === 'deviceInfo') {
        return { status: 200, data: { screenOn: true, isInScreensaver: false, packageName: 'de.ozerov.fully' } };
      }
      return { status: 200, data: { status: 'OK' } };
    });
    const result = await adapter.prepareForContent({ skipCameraCheck: true });
    expect(result.ok).toBe(true);
  });

  test('still fails when foreground is reported and is a different app', async () => {
    const adapter = makeAdapter((cmd) => {
      if (cmd === 'getDeviceInfo' || cmd === 'deviceInfo') {
        return { status: 200, data: { foreground: 'com.netflix.ninja', screenOn: true } };
      }
      return { status: 200, data: { status: 'OK' } };
    });
    const result = await adapter.prepareForContent({ skipCameraCheck: true });
    expect(result.ok).toBe(false);
    expect(result.step).toBe('toForeground');
  }, 60_000); // this path legitimately walks the retry loop
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node /opt/Code/DaylightStation/node_modules/.bin/vitest run tests/isolated/adapter/devices/FullyKioskContentAdapter.prepare.test.mjs`
Expected: "lacks a foreground field" FAILS (current code loops 15× then errors). The "different app" test should already pass — it pins existing behavior.

- [ ] **Step 3: Rewrite `#verifyForeground`**

```javascript
  async #verifyForeground(fkPackage, maxAttempts, retryMs, startTime) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const fgCmd = await this.#sendCommand('toForeground');
      if (fgCmd.authError) {
        this.#logger.error?.('fullykiosk.prepareForContent.authRejected', { cmd: 'toForeground', error: fgCmd.error });
        return { ok: false, step: 'toForeground', error: `FKB rejected credentials: ${fgCmd.error}` };
      }
      await new Promise(r => setTimeout(r, retryMs));

      const info = await this.#sendCommand('getDeviceInfo', { type: 'json' });
      if (info.authError) {
        this.#logger.error?.('fullykiosk.prepareForContent.authRejected', { cmd: 'getDeviceInfo', error: info.error });
        return { ok: false, step: 'toForeground', error: `FKB rejected credentials: ${info.error}` };
      }
      const foreground = info.data?.foreground;

      if (foreground === fkPackage) {
        this.#logger.info?.('fullykiosk.prepareForContent.foregroundConfirmed', {
          attempt, elapsedMs: Date.now() - startTime
        });
        return { ok: true };
      }

      // Some FKB variants (yellow-room tablet, 2026-08-21) never emit a
      // `foreground` key in deviceInfo. When the payload is a real device-info
      // object without that key and toForeground was acknowledged, trust the ack
      // instead of looping to a false failure.
      if (info.ok && info.data && typeof info.data === 'object'
          && !('foreground' in info.data) && fgCmd.ok) {
        this.#logger.info?.('fullykiosk.prepareForContent.foregroundAssumed', {
          attempt, elapsedMs: Date.now() - startTime
        });
        return { ok: true, assumed: true };
      }

      this.#logger.warn?.('fullykiosk.prepareForContent.notInForeground', {
        attempt, foreground, expected: fkPackage
      });
    }

    this.#logger.error?.('fullykiosk.prepareForContent.foregroundFailed', {
      attempts: maxAttempts, elapsedMs: Date.now() - startTime
    });
    return { ok: false, step: 'toForeground', error: 'Could not bring Fully Kiosk to foreground' };
  }
```

- [ ] **Step 4: Run the full isolated adapter suite**

Run: `node /opt/Code/DaylightStation/node_modules/.bin/vitest run tests/isolated/adapter/devices/`
Expected: ALL PASS, including Task 2's fail-fast timing test and the pre-existing `.load` tests.

- [ ] **Step 5: Commit**

```bash
git add tests/isolated/adapter/devices/FullyKioskContentAdapter.prepare.test.mjs backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs
git commit -m "fix(devices): fail fast on FKB auth rejection; accept FKB variants without foreground reporting"
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

### Task 7: Deploy and end-to-end live verification

**Files:** none (operations).

**Interfaces:**
- Consumes: all prior tasks merged to `main` (merge directly, delete the worktree branch per CLAUDE.md branch rules; record it in `docs/_archive/deleted-branches.md`).

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

- [ ] **Step 4: Re-run the failed user journey end-to-end**

From a browser (or headless Playwright per `reference_headless_playwright_screenshot`), open `/media`, search "Boy from the moon", select "A Boy From The Moon", dispatch to `yellow-room-tablet`. Then verify in the log store:

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

## Self-Review Notes

- Root causes 1–5 map to Tasks 1–6; Task 7 proves the original user journey end-to-end. The instant power/verify "done" needed no task (correct no-op for self-powered devices).
- Deliberately out of scope, with reasons: RC4's content-id-like dismiss (line 115) keeps its intent — changing it needs its own design pass; the dispatch-failure toast UX was not redesigned — after Tasks 2–3 the error text becomes specific ("FKB rejected credentials: Please login") which is the actionable part; the phone's transient zero-results cannot be reproduced retroactively — Task 5 makes the next occurrence self-heal (one automatic retry) and diagnosable in one log query if it persists.
- Type check: `authError` produced in Task 2 is consumed in Task 3; `assumed: true` is additive and nothing downstream switches on it; Task 4's `open` action is already handled by `commit()`'s existing `case 'open'`.
