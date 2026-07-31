# Karaoke Key-Shift Engine Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the karaoke key-change stepper actually produce transposed sound in production, and make any future engine failure degrade to "key change unavailable" instead of dead silence.

**Architecture:** The bug: Vite/esbuild bundling corrupts `signalsmith-stretch`, which builds its AudioWorklet script by stringifying its own functions (`Function.toString` returns post-build source; esbuild's class-field lowering hoists a `__publicField` helper the worklet scope doesn't have, and minification renames a closure variable the blob wrapper supplies under its original name). The processor constructor throws on the render thread, the ready handshake never posts, and the library's init promise pends forever — after `createMediaElementSource()` has already muted the element. Fix: serve the pristine npm ESM file as an untransformed Vite asset (`?url` import + `/* @vite-ignore */` dynamic import) via a tiny loader module, and add a rejecting init timeout + dry-path reroute + stepper disable so failure is audible-but-flagged, never silent.

**Tech Stack:** React hook (frontend/src/modules/Piano/PianoKiosk/modes/Singalong/), Vite 5 `?url` asset imports, Web Audio API, vitest (+ @testing-library/react, jsdom), Playwright (host-installed) for deployed-origin verification, Docker deploy on kckern-server.

## Global Constraints

- **Never edit the shared Player** (`frontend/src/lib/Player/`, `frontend/src/modules/Player/`) — the key-shift attaches from the consumer side only.
- **Never use raw `console.*`** — all diagnostics go through `frontend/src/lib/logging/` (`getLogger().child({ component: 'karaoke-keyshift' })`); events at `info` or above (the transport floor is `info`).
- **Run vitest from `frontend/`** with `./node_modules/.bin/vitest run <files>` (worktree has its own binary; do not use `npx vitest` from repo root).
- **Working directory:** the git worktree `/opt/Code/DaylightStation/.claude/worktrees/sheetmusic-wave3`, branch `fix/keyshift-telemetry`. Before EVERY commit run `git rev-parse --show-toplevel && git branch --show-current` and confirm they print that worktree path and that branch. Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Deploy gate (Task 4) must HALT as its own step** — never chain the gate check with `docker stop`/`rm`/`deploy-daylight` in one command.
- **`signalsmith-stretch` stays at 1.3.2** (latest published; do not attempt upgrades).
- **Touch UI rules:** discrete tap targets only; no new text or unicode glyph faces on the stepper (ASCII/SVG only).

---

### Task 1: Loader module that serves the pristine engine file

The bundler must never transform `SignalsmithStretch.mjs`. A `?url` import makes Vite emit the file as a verbatim asset; a `/* @vite-ignore */` dynamic import makes the browser load that pristine ESM at runtime. The package is fully self-contained (WASM inlined as base64 data URI, zero imports), so this is safe. This pattern was validated through a real Vite 5.3.3 build with this app's node_modules: the emitted asset was byte-identical to the npm file and the engine initialized in ~33ms under prod-identical COOP/COEP headers.

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Singalong/loadStretchEngine.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Singalong/useKeyShift.js` (the dynamic import inside the effect, currently `await import('signalsmith-stretch')` around line 109)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Singalong/useKeyShift.test.jsx` (the `vi.mock('signalsmith-stretch', ...)` at line 51)

**Interfaces:**
- Produces: `loadStretchEngine()` → `Promise<SignalsmithStretch>` where `SignalsmithStretch(audioContext)` → `Promise<stretchNode>` (the same callable the package's default export is today). Task 2 mocks `./loadStretchEngine.js` in tests and calls the returned function with an AudioContext.

- [ ] **Step 1: Repoint the test mock to the (not-yet-existing) loader — the failing test**

In `frontend/src/modules/Piano/PianoKiosk/modes/Singalong/useKeyShift.test.jsx`, replace line 51:

```js
vi.mock('signalsmith-stretch', () => ({ default: h.factory }));
```

with:

```js
// The hook loads the engine through loadStretchEngine.js (which serves the
// pristine npm file as a ?url asset — the bundler corrupts the package's
// self-stringifying worklet). Mock the loader, not the package.
vi.mock('./loadStretchEngine.js', () => ({ default: vi.fn(async () => h.factory) }));
```

Also update the file's header comment (lines 1–10) sentence "The stretch engine and AudioContext are mocked" to "The stretch engine loader and AudioContext are mocked".

- [ ] **Step 2: Run the suite to verify it fails**

Run: `cd frontend && ./node_modules/.bin/vitest run src/modules/Piano/PianoKiosk/modes/Singalong/useKeyShift.test.jsx`
Expected: FAIL — the mock target `./loadStretchEngine.js` does not exist yet (resolution error), or if vitest tolerates that, the hook still dynamic-imports the real `signalsmith-stretch`, whose init errors against the fake AudioContext (no `audioWorklet`), so no stretches are ever created and `waitFor(... stretches.length ...)` times out.

- [ ] **Step 3: Create the loader module**

Create `frontend/src/modules/Piano/PianoKiosk/modes/Singalong/loadStretchEngine.js`:

```js
// loadStretchEngine.js — load signalsmith-stretch WITHOUT letting the bundler
// touch it. The library builds its AudioWorklet script by stringifying its own
// functions (Function.toString of post-build source); Vite/esbuild class-field
// lowering and minifier renames plant references (__publicField helper, renamed
// closure vars) that don't exist inside the AudioWorkletGlobalScope blob, so the
// processor constructor throws silently and the init handshake never arrives —
// dead air after createMediaElementSource. `?url` emits the pristine npm file as
// a verbatim asset; `@vite-ignore` keeps Rollup from bundling the dynamic import
// so the browser evaluates that exact file. The package is self-contained (WASM
// inlined as base64), so nothing else needs to travel with it.
import stretchUrl from 'signalsmith-stretch/SignalsmithStretch.mjs?url';

export default async function loadStretchEngine() {
  const { default: SignalsmithStretch } = await import(/* @vite-ignore */ stretchUrl);
  return SignalsmithStretch;
}
```

- [ ] **Step 4: Repoint the hook to the loader**

In `frontend/src/modules/Piano/PianoKiosk/modes/Singalong/useKeyShift.js`:

Add to the imports at the top (after the `getLogger` import):

```js
import loadStretchEngine from './loadStretchEngine.js';
```

Replace the line inside the effect's async IIFE:

```js
      const { default: SignalsmithStretch } = await import('signalsmith-stretch');
```

with:

```js
      const SignalsmithStretch = await loadStretchEngine();
```

(The `stage = 'import'` assignment just above it stays.)

- [ ] **Step 5: Run the suite to verify it passes**

Run: `cd frontend && ./node_modules/.bin/vitest run src/modules/Piano/PianoKiosk/modes/Singalong/useKeyShift.test.jsx`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git rev-parse --show-toplevel && git branch --show-current  # must be the sheetmusic-wave3 worktree + fix/keyshift-telemetry
git add frontend/src/modules/Piano/PianoKiosk/modes/Singalong/loadStretchEngine.js \
        frontend/src/modules/Piano/PianoKiosk/modes/Singalong/useKeyShift.js \
        frontend/src/modules/Piano/PianoKiosk/modes/Singalong/useKeyShift.test.jsx
git commit -m "fix(piano): keyshift engine hang — serve pristine signalsmith file, bundler-untouched

signalsmith-stretch stringifies its own functions into the worklet blob;
esbuild class-field lowering (__publicField hoisted to chunk scope) and
minifier renames (_scriptName -> q) leave the processor constructor
throwing inside AudioWorkletGlobalScope. addModule resolves, the ready
handshake never posts, init pends forever — after createMediaElementSource
already muted the element. A/B-proven: pristine file inits in ~33ms under
prod COOP/COEP; the bundled chunk hangs even with no headers.

loadStretchEngine.js serves the npm ESM verbatim (?url asset + @vite-ignore
dynamic import). Tests mock the loader instead of the package.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Fail audible — rejecting init timeout, dry reroute, disabled stepper

Today a `stretch-load` failure leaves the captured source connected to nothing (silence) and the `.catch` only logs. Make the init reject on timeout, reroute the captured source straight to the speakers on ANY failure, and surface the failure so `KeyControl` disables its buttons.

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Singalong/useKeyShift.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Singalong/KeyControl.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Singalong/useKeyShift.test.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Singalong/KeyControl.test.jsx`

**Interfaces:**
- Consumes: `loadStretchEngine()` from Task 1 (mocked in tests via `vi.mock('./loadStretchEngine.js', ...)`).
- Produces: `useKeyShift(mediaEl, semitones)` now **returns a boolean** `engineFailed` (was `undefined`). Exports `const STRETCH_INIT_TIMEOUT_MS = 6000`. `KeyControl` disables all three buttons when the hook returns `true`.

- [ ] **Step 1: Write the failing hook tests**

Append to the `describe('useKeyShift', ...)` block in `useKeyShift.test.jsx`:

```js
  it('reroutes the captured source to the speakers and reports failure when the engine rejects', async () => {
    h.factory.mockRejectedValueOnce(new Error('engine exploded'));
    const el = video();
    const { result } = renderHook(() => useKeyShift(el, 2));
    await waitFor(() => expect(result.current).toBe(true));
    const source = lastCtx().createMediaElementSource.mock.results.at(-1).value;
    // Fail AUDIBLE: captured-but-chainless audio must be wired to the speakers.
    expect(source.disconnect).toHaveBeenCalled();
    expect(source.connect).toHaveBeenLastCalledWith(lastCtx().destination);
    expect(h.state.stretches.length).toBe(0);
  });

  it('a hung engine init rejects at the timeout instead of pending forever', async () => {
    vi.useFakeTimers();
    try {
      h.factory.mockImplementationOnce(() => new Promise(() => {})); // never settles
      const el = video();
      const { result } = renderHook(() => useKeyShift(el, 1));
      await vi.advanceTimersByTimeAsync(STRETCH_INIT_TIMEOUT_MS + 100);
      expect(result.current).toBe(true);
      const source = lastCtx().createMediaElementSource.mock.results.at(-1).value;
      expect(source.connect).toHaveBeenLastCalledWith(lastCtx().destination);
    } finally {
      vi.useRealTimers();
    }
  });
```

And add `STRETCH_INIT_TIMEOUT_MS` to the hook import at the top of the test file:

```js
import useKeyShift, { STRETCH_INIT_TIMEOUT_MS } from './useKeyShift.js';
```

Note: `h.factory` is the engine function itself (the loader mock resolves to it), so `mockRejectedValueOnce`/`mockImplementationOnce` shape the engine init directly. The default implementation (`async () => makeStretch()`) is restored automatically since these are `...Once` variants.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd frontend && ./node_modules/.bin/vitest run src/modules/Piano/PianoKiosk/modes/Singalong/useKeyShift.test.jsx`
Expected: the two new tests FAIL — `STRETCH_INIT_TIMEOUT_MS` is not exported (import is `undefined`), `result.current` stays `undefined`, and no reroute happens on rejection. The seven pre-existing tests still pass.

- [ ] **Step 3: Implement in the hook**

In `frontend/src/modules/Piano/PianoKiosk/modes/Singalong/useKeyShift.js`:

3a. Change the react import line to include `useState`:

```js
import { useEffect, useRef, useState } from 'react';
```

3b. Add the exported constant right below the imports (above the logger block):

```js
// A stretch-engine init that neither resolves nor rejects is heard as dead
// silence (the element is already captured). Convert hangs into rejections.
export const STRETCH_INIT_TIMEOUT_MS = 6000;
```

3c. Inside `useKeyShift`, add state next to the existing refs and return it at the end of the hook body:

```js
  const [engineFailed, setEngineFailed] = useState(false);
```

(and as the last line of the hook body, after the teardown effect:)

```js
  return engineFailed;
```

3d. Replace the stretch-load await:

```js
        stage = 'stretch-load';
        const stretch = await SignalsmithStretch(ac);
```

with:

```js
        stage = 'stretch-load';
        const stretch = await Promise.race([
          SignalsmithStretch(ac),
          new Promise((_, reject) => {
            setTimeout(
              () => reject(new Error(`engine init timed out after ${STRETCH_INIT_TIMEOUT_MS}ms`)),
              STRETCH_INIT_TIMEOUT_MS,
            );
          }),
        ]);
```

3e. Replace the whole `.catch` handler:

```js
    })().catch((e) => {
      clearTimeout(watchdog);
      logger().warn('keyshift.error', {
        stage,
        message: e?.message,
        name: e?.name,
        stack: e?.stack?.split('\n').slice(0, 4).join(' <- '),
      });
    });
```

with:

```js
    })().catch((e) => {
      clearTimeout(watchdog);
      // Fail AUDIBLE: if this element was captured but its chain never
      // finished, the graph is source → nothing. Reroute straight to the
      // speakers and flag the engine so the stepper greys out instead of
      // muting the song.
      const chain = chainRef.current;
      if (!chain || chain.el !== mediaEl) {
        const source = sourceByEl.get(mediaEl);
        if (source) {
          try {
            source.disconnect();
            source.connect(ctx().destination);
            logger().info('keyshift.failed-audible-reroute', {});
          } catch { /* context torn down */ }
        }
      }
      setEngineFailed(true);
      logger().warn('keyshift.error', {
        stage,
        message: e?.message,
        name: e?.name,
        stack: e?.stack?.split('\n').slice(0, 4).join(' <- '),
      });
    });
```

- [ ] **Step 4: Run the hook suite to verify it passes**

Run: `cd frontend && ./node_modules/.bin/vitest run src/modules/Piano/PianoKiosk/modes/Singalong/useKeyShift.test.jsx`
Expected: PASS (9 tests)

- [ ] **Step 5: Write the failing KeyControl test**

Append to the `describe('KeyControl', ...)` block in `KeyControl.test.jsx`:

```js
  it('disables every button when the audio engine has failed', () => {
    useKeyShiftSpy.mockReturnValue(true);
    render(<KeyControl mediaEl={null} />);
    expect(screen.getByRole('button', { name: 'Raise key' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Lower key' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset key' })).toBeDisabled();
    useKeyShiftSpy.mockReturnValue(undefined);
  });
```

Run: `cd frontend && ./node_modules/.bin/vitest run src/modules/Piano/PianoKiosk/modes/Singalong/KeyControl.test.jsx`
Expected: the new test FAILS (buttons are not disabled); the six existing tests pass.

- [ ] **Step 6: Wire the flag through KeyControl**

In `frontend/src/modules/Piano/PianoKiosk/modes/Singalong/KeyControl.jsx`:

Replace:

```js
  const [shift, setShift] = useState(0);
  useKeyShift(mediaEl, shift);
```

with:

```js
  const [shift, setShift] = useState(0);
  // true = the stretch engine failed for this song; the audio was rerouted
  // dry, so the stepper must grey out rather than pretend to work.
  const engineFailed = useKeyShift(mediaEl, shift);
```

Then update the three buttons:
- "Lower key" `TransportButton`: `disabled={engineFailed || shift <= KEY_SHIFT_MIN}`
- value-face `<button>`: add `disabled={engineFailed}`
- "Raise key" `TransportButton`: `disabled={engineFailed || shift >= KEY_SHIFT_MAX}`

- [ ] **Step 7: Run the KeyControl suite to verify it passes**

Run: `cd frontend && ./node_modules/.bin/vitest run src/modules/Piano/PianoKiosk/modes/Singalong/KeyControl.test.jsx`
Expected: PASS (7 tests)

- [ ] **Step 8: Run the full Singalong + Karaoke test set**

Run: `cd frontend && ./node_modules/.bin/vitest run src/modules/Piano/PianoKiosk/modes/Singalong/ src/modules/Piano/PianoKiosk/modes/Karaoke/`
Expected: ALL PASS (includes `SingalongPlayer.keycontrol.test.jsx`, `keyShift.test.js`, `karaokeBrowse.test.js`)

- [ ] **Step 9: Commit**

```bash
git rev-parse --show-toplevel && git branch --show-current  # must be the sheetmusic-wave3 worktree + fix/keyshift-telemetry
git add frontend/src/modules/Piano/PianoKiosk/modes/Singalong/useKeyShift.js \
        frontend/src/modules/Piano/PianoKiosk/modes/Singalong/useKeyShift.test.jsx \
        frontend/src/modules/Piano/PianoKiosk/modes/Singalong/KeyControl.jsx \
        frontend/src/modules/Piano/PianoKiosk/modes/Singalong/KeyControl.test.jsx
git commit -m "feat(piano): keyshift fails audible — init timeout, dry reroute, disabled stepper

A captured-but-chainless element is dead air. Any engine failure now (a)
rejects instead of pending (6s Promise.race on init), (b) reroutes the
captured source straight to the destination, and (c) surfaces engineFailed
from the hook so KeyControl greys out all three buttons — key change
unavailable, song keeps playing.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Prove the built asset is pristine

The whole fix rests on Vite emitting `SignalsmithStretch.mjs` byte-identical to the npm file. Verify locally before any Docker build.

**Files:**
- No source changes. Build output only (`frontend/dist/` is disposable).

**Interfaces:**
- Consumes: Task 1's `?url` import (it's what makes Vite emit the asset).
- Produces: confidence + the emitted asset filename pattern (`SignalsmithStretch.mjs` hashed asset) used again in Task 4's deployed-origin check.

- [ ] **Step 1: Build the frontend locally**

Run: `cd frontend && npm run build 2>&1 | tail -15`
Expected: build completes without errors. If Vite fails to resolve `signalsmith-stretch/SignalsmithStretch.mjs?url` (exports-map restriction), change the import in `loadStretchEngine.js` to a relative node_modules path — `import stretchUrl from '../../../../../../node_modules/signalsmith-stretch/SignalsmithStretch.mjs?url';` — re-run the Task 1 test suite, amend the Task 1 commit, and rebuild. (Count the directory depth from `frontend/src/modules/Piano/PianoKiosk/modes/Singalong/` up to `frontend/`: six levels.)

- [ ] **Step 2: Byte-compare the emitted asset against the npm file**

Run:

```bash
cd frontend
ASSET=$(ls dist/assets/ | grep -i '^SignalsmithStretch.*\.mjs$')
echo "emitted: $ASSET"
cmp dist/assets/"$ASSET" node_modules/signalsmith-stretch/SignalsmithStretch.mjs && echo "BYTE-IDENTICAL"
```

Expected: prints the hashed asset name and `BYTE-IDENTICAL`. If `cmp` reports a difference, STOP — the bundler is still transforming the file; do not proceed to deploy. (Check that the `?url` suffix survived and that no Vite plugin rewrites `.mjs` assets.)

- [ ] **Step 3: Confirm the old bundled chunk is gone**

Run: `ls frontend/dist/assets/ | grep -i signalsmith`
Expected: only the `.mjs` verbatim asset (plus its content hash) — no `SignalsmithStretch-*.js` transformed chunk. A leftover `.js` chunk means something still imports the bare package specifier; grep `frontend/src/` for `from 'signalsmith-stretch'` / `import('signalsmith-stretch')` and repoint it through `loadStretchEngine.js`.

- [ ] **Step 4: Commit the plan checkboxes (no source changes in this task)**

No commit needed — build output is gitignored. Mark this task's checkboxes in the plan document only.

---

### Task 4: Merge, deploy, and verify on the deployed origin

**Files:**
- Modify (main checkout, not the worktree): merge `fix/keyshift-telemetry` into `main` at `/opt/Code/DaylightStation`
- Create (scratchpad): `keyshift-verify.mjs` (headless Playwright verification script, content below)

**Interfaces:**
- Consumes: everything above, plus the existing telemetry events (`keyshift.chain-built`, `keyshift.set`, `keyshift.stalled`, `keyshift.error`).
- Produces: the fix live on `daylightlocal.kckern.net` with logged proof.

- [ ] **Step 1: Merge the branch into main**

```bash
git -C /opt/Code/DaylightStation pull --ff-only
git -C /opt/Code/DaylightStation merge --no-edit fix/keyshift-telemetry
git -C /opt/Code/DaylightStation log --oneline -3
```

Expected: merge commit created; the Task 1 + Task 2 commits appear in the log.

- [ ] **Step 2: Build the Docker image**

Run: `cd /opt/Code/DaylightStation && ./scripts/build-daylight.sh` (NOT under `sudo` — the script invokes `sudo docker` itself; running the whole script under sudo fails on the password prompt). This takes several minutes.
Expected: ends with `naming to docker.io/kckern/daylight-station:latest done`.

- [ ] **Step 3: Deploy gate — its own halting step**

```bash
sudo docker logs --since 75s daylight-station 2>&1 | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
```

Clear to deploy ONLY IF: first count is `0`, no `videoState:"playing"`, `sessionActive:false`, `rosterSize:0`. If any gate is active, WAIT and re-check — do not proceed. Do not chain this command with the deploy commands.

- [ ] **Step 4: Deploy (only after Step 3 is clear)**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

Then wait for health and confirm the new commit is live:

```bash
sleep 20 && curl -s http://localhost:3111/build.txt
```

Expected: `Commit:` URL ends with the merge commit SHA from Step 1.

- [ ] **Step 5: Verify the deployed asset is pristine**

```bash
ASSET=$(sudo docker exec daylight-station sh -c 'ls /usr/src/app/frontend/dist/assets/' | grep -i '^SignalsmithStretch.*\.mjs$')
echo "deployed asset: $ASSET"
curl -sk "https://daylightlocal.kckern.net/assets/$ASSET" \
  | cmp - /opt/Code/DaylightStation/frontend/node_modules/signalsmith-stretch/SignalsmithStretch.mjs \
  && echo "DEPLOYED BYTE-IDENTICAL"
```

Expected: `DEPLOYED BYTE-IDENTICAL`.

- [ ] **Step 6: Headless end-to-end verification on the deployed origin**

Write the scratchpad script `keyshift-verify.mjs` (scratchpad directory per session env; any writable temp dir works):

```js
// keyshift-verify.mjs — drive /piano/singalong, shift key, expect chain-built.
import pkg from '/opt/Code/DaylightStation/node_modules/playwright/index.js';
const { chromium } = pkg;

const b = await chromium.launch({
  args: ['--no-sandbox', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
const p = await ctx.newPage();
const hits = [];
p.on('console', (m) => {
  const t = m.text();
  if (/keyshift\./.test(t)) { hits.push(t.slice(0, 200)); console.log('[console]', t.slice(0, 200)); }
});

await p.goto('https://daylightlocal.kckern.net/piano/singalong', { waitUntil: 'networkidle', timeout: 30000 });
await p.waitForTimeout(2000);
const gate = p.getByText(/continue without piano/i);
if (await gate.isVisible().catch(() => false)) { await gate.click(); await p.waitForTimeout(5000); }
const tile = p.locator('[class*="tile"], [class*="card"], [class*="song"]').first();
await tile.click({ timeout: 10000 });
await p.waitForTimeout(6000);
const raise = p.getByLabel('Raise key');
await raise.click({ timeout: 10000 });
await p.waitForTimeout(8000); // past both the 4s watchdog and the 6s init timeout

const joined = hits.join('\n');
const built = /keyshift\.chain-built/.test(joined);
const set = /keyshift\.set/.test(joined);
const stalled = /keyshift\.stalled/.test(joined);
const errored = /keyshift\.error/.test(joined);
console.log(JSON.stringify({ built, set, stalled, errored }));
if (!built || !set || stalled || errored) { console.log('VERIFY: FAIL'); process.exitCode = 1; }
else console.log('VERIFY: PASS');
await b.close();
```

Run it: `cd /opt/Code/DaylightStation && node <scratchpad>/keyshift-verify.mjs 2>&1 | grep -vE 'bridge\.|ERR_CONNECTION_REFUSED' | tail -12`

Expected: `keyshift.chain-built {"engine":"signalsmith-stretch","buildMs":<under ~2000>,...}`, `keyshift.set {...,"path":"wet",...}`, then `{"built":true,"set":true,"stalled":false,"errored":false}` and `VERIFY: PASS`. **Capture the real exit status** — do not trust the pipeline's exit code (it is the grep/tail's); judge by the printed `VERIFY: PASS`.

- [ ] **Step 7: Confirm the events landed in container telemetry**

```bash
sudo docker logs --since 5m daylight-station 2>&1 | grep -E 'keyshift\.(chain-built|set|stalled|error)' | tail -8
```

Expected: `keyshift.chain-built` and `keyshift.set` present; NO new `keyshift.stalled` or `keyshift.error` from the verification run.

- [ ] **Step 8: Branch cleanup**

Per repo rules, record then delete the merged branch. Append to `docs/_archive/deleted-branches.md` (in the MAIN checkout, committed to main):

```markdown
| 2026-07-31 | fix/keyshift-telemetry | <task-2 commit sha> | keyshift telemetry + pristine-engine fix + fail-audible degrade |
```

```bash
git -C /opt/Code/DaylightStation add docs/_archive/deleted-branches.md
git -C /opt/Code/DaylightStation commit -m "docs: record merged keyshift branch

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git -C /opt/Code/DaylightStation branch -d fix/keyshift-telemetry
```

Note: the worktree `sheetmusic-wave3` had this branch checked out; if `branch -d` complains the branch is checked out there, first detach the worktree (`git -C /opt/Code/DaylightStation/.claude/worktrees/sheetmusic-wave3 checkout --detach`).

- [ ] **Step 9: Report**

State plainly: deployed commit SHA, `DEPLOYED BYTE-IDENTICAL` result, the `VERIFY: PASS/FAIL` line, and the container-log evidence. The piano tablet kiosk serves this UI — note for the user that the tablet picks up the fix on its next reload (do not force-reload a device someone may be using). If any verification failed, say so with the actual output — no hedging.

---

## Self-Review

- **Spec coverage:** pristine-file loader (Task 1) = the agent's primary fix; rejecting timeout + dry reroute + disabled stepper (Task 2) = layered defense (d); byte-identity proof local (Task 3) and deployed (Task 4 Step 5) = verification plan items 1–2; headless origin repro (Task 4 Step 6) = verification item 2; unit-mock repointing (Task 1 Step 1) = verification item 5. Explicit non-goals honored: no package bump, no COOP/COEP changes, no engine swap, no Player edits.
- **Placeholder scan:** all steps carry exact code/commands; the one conditional (exports-map fallback in Task 3 Step 1) includes the exact alternative import line.
- **Type consistency:** `loadStretchEngine()` → engine function; hook returns bare boolean; `STRETCH_INIT_TIMEOUT_MS` exported from `useKeyShift.js` and imported by its test; `h.factory` remains the engine callable in tests (loader mock resolves to it).
