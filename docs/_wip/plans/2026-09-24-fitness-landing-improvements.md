# Fitness Landing Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two gaps a post-merge review found in the direct post-session landing (commits `42b48097b7`, `cc76623364`): a localStorage cache that trusts a payload from an older build, and a URL that can say "no session" while the detail pane still shows one.

**Architecture:** (1) `ScreenDataProvider`'s stale-while-revalidate cache stamps each entry with a per-build version and only trusts entries whose version matches the running bundle; the storage key stays stable so one entry per source is ever kept. (2) `FitnessSessionsWidget` treats the URL as authoritative for *closing*: when the path has no `/session-{id}` segment but the widget's pane is open, it closes the pane and clears the selection.

**Tech Stack:** React 18, react-router-dom, Vite 7 (`frontend/vite.config.js`), Vitest 4 + Testing Library (happy-dom), Mantine.

**Spec:** Post-merge Fable review of `42b48097b7` + `cc76623364` (findings reproduced verbatim under Global Constraints). Background: `docs/reference/core/screen-framework.md` (Data Coordination, Replacing a node at runtime) and `docs/reference/fitness/fitness-system-architecture.md` (Leaving the player → the session just finished).

## Global Constraints

- Finding 1 (verbatim): "`readCache` validates only the URL. A deploy that changes the sessions response shape will render the old-shape payload for one frame (until the fetch lands), and a widget that dereferences a renamed field would throw at first paint. Suggest adding a `CACHE_VERSION` constant (or the `/build.txt` hash) to the storage key."
- Finding 2 (verbatim): "when `redirect.sessionId` is null (no session at close) and the player was launched from home with pane A open, the URL becomes `/fitness/home` while pane A and `selectedSessionId` stay A. Reload then shows no detail. … if you want URL↔pane parity, clear the selection in that branch."
- Do NOT put the version in the storage key: each deploy would leave a ~328 KB orphan entry behind and fill the ~5 MB localStorage quota within ~15 deploys. Version goes INSIDE the entry; key stays `screenData:{persistKey}:{key}`.
- Frontend logging: use the structured logger (`getLogger().child(...)`), never raw `console.*` (CLAUDE.md → Logging).
- Docs change with code: update the two reference docs named in **Spec** in the same task as the code.
- Worktree: all work in `/opt/Code/DaylightStation/.claude/worktrees/fitness-landing-improve` (branch `fix/fitness-landing-improve`). `node_modules`, `frontend/node_modules`, `backend/node_modules` are already symlinked there — needed for vitest AND for the pre-commit hook.
- Commit with explicit pathspecs (`git commit -m ... -- <paths>`); never bare `git commit -a`, never `git stash`.
- Every commit message ends with: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`

## Review Focus

1. **A deploy with an unchanged response shape** — the first home load after it is a normal cold load (skeleton, then data), never an error; the next load is instant again. (Task 1: version-mismatch test asserts `null` then data, and that the entry is rewritten with the new version.)
2. **The row-click toggle-off path** — clicking the selected row navigates to the bare path and reverts; the new URL effect must not double-revert or fight it. (Task 2: toggle-off test.)
3. **Opening a session by row click** — the click sets selection and navigates to `/session-x` in one event; the URL effect must not see an intermediate bare path and close the just-opened pane. (Task 2: click-open test.)
4. **An outside selection at mount while the path is still bare** (player launched from home: the ScreenProvider was already mounted) — the URL effect must not close the pane the selection effect just opened in the same commit. (Task 2: the existing `swaps the pane…` and `opens the detail pane for an outside selection with no seed` tests, which mount at `/fitness/home`, must stay green.)
5. **Browser Back from `/fitness/home/session-s1` to `/fitness/home`** — the pane closes and the row un-highlights (same mechanism as Finding 2). (Task 2: navigate-to-bare-path test.)

---

## File Structure

- `frontend/vite.config.js` — expose the existing per-build `buildId` to bundle code as `import.meta.env.VITE_BUILD_ID` (compute it once, share with the HTML plugin).
- `frontend/src/screen-framework/data/ScreenDataProvider.jsx` — `cacheVersion` prop (default: the build id, `'dev'` when absent); entries carry `version`; reads reject mismatches.
- `frontend/src/screen-framework/data/ScreenDataProvider.test.jsx` — version tests; existing persistence tests pin an explicit `cacheVersion`.
- `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx` — URL→pane close effect.
- `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.selection.test.jsx` — URL parity tests.
- `docs/reference/core/screen-framework.md`, `docs/reference/fitness/fitness-system-architecture.md` — doc updates.

---

### Task 1: Version-stamp the screen-data cache

**Files:**
- Modify: `frontend/vite.config.js:71-80` (the `defineConfig` callback's top and `plugins`)
- Modify: `frontend/src/screen-framework/data/ScreenDataProvider.jsx` (the `CACHE_PREFIX`/`readCache`/`writeCache` helpers and the `ScreenDataProvider` signature/body)
- Test: `frontend/src/screen-framework/data/ScreenDataProvider.test.jsx` (the `describe('ScreenDataProvider persistence (stale-while-revalidate)'` block)
- Docs: `docs/reference/core/screen-framework.md` (the **Stale-while-revalidate cache** paragraph)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `ScreenDataProvider` prop `cacheVersion?: string` (defaults to `import.meta.env.VITE_BUILD_ID || 'dev'`). Cache entry JSON shape becomes `{ url: string, version: string, savedAt: number, data: any }`. Storage key unchanged: `screenData:{persistKey}:{key}`.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/screen-framework/data/ScreenDataProvider.test.jsx`, inside the persistence `describe`, change `persistWrapper` so every existing persistence test pins a version, and update the two tests that pre-seed localStorage to include `version: 'v1'`:

```jsx
  function persistWrapper(extra = {}) {
    return function Wrapper({ children }) {
      return (
        <ScreenDataProvider sources={sources} persistKey="fitness:home" persist={['sessions']} cacheVersion="v1" {...extra}>
          {children}
        </ScreenDataProvider>
      );
    };
  }
```

```jsx
    localStorage.setItem(cacheKey, JSON.stringify({ url: sources.sessions.source, version: 'v1', savedAt: 1, data: { sessions: ['old'] } }));
```
(in `renders the cached payload on the first render, then replaces it with the fetch`)

```jsx
    localStorage.setItem(cacheKey, JSON.stringify({ url: '/api/v1/fitness/sessions?since=30d', version: 'v1', savedAt: 1, data: { sessions: ['old'] } }));
```
(in `ignores a cached payload fetched from a different URL`)

Then add these two tests at the end of the same `describe`:

```jsx
  it('ignores a cached payload written by a different build, then rewrites it for this build', async () => {
    localStorage.setItem(cacheKey, JSON.stringify({ url: sources.sessions.source, version: 'v0', savedAt: 1, data: { sessions: ['old-shape'] } }));
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ sessions: ['new'] }) });

    const { result } = renderHook(() => useScreenData('sessions'), { wrapper: persistWrapper() });

    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toEqual({ sessions: ['new'] }));
    const entry = JSON.parse(localStorage.getItem(cacheKey));
    expect(entry.version).toBe('v1');
    expect(entry.data).toEqual({ sessions: ['new'] });
  });

  it('keeps exactly one storage entry per source across versions', async () => {
    localStorage.setItem(cacheKey, JSON.stringify({ url: sources.sessions.source, version: 'v0', savedAt: 1, data: {} }));
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ sessions: [] }) });

    renderHook(() => useScreenData('sessions'), { wrapper: persistWrapper() });

    await waitFor(() => expect(JSON.parse(localStorage.getItem(cacheKey)).version).toBe('v1'));
    expect(Object.keys(localStorage).filter((k) => k.startsWith('screenData:'))).toEqual([cacheKey]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from the worktree root): `npx vitest run frontend/src/screen-framework/data/ScreenDataProvider.test.jsx`
Expected: FAIL — `ignores a cached payload written by a different build…` fails because `result.current` is `{ sessions: ['old-shape'] }` instead of `null` (and the rewritten entry has no `version`).

- [ ] **Step 3: Implement**

In `frontend/src/screen-framework/data/ScreenDataProvider.jsx`, replace the `readCache`/`writeCache` helpers and their comment with:

```js
// Changes once per build (vite.config.js defines it). A cached payload from an
// older bundle may have an older response shape, so it is never trusted — the
// first load after a deploy is an ordinary cold load, and it rewrites the entry.
const DEFAULT_CACHE_VERSION = import.meta.env?.VITE_BUILD_ID || 'dev';

// A cached payload is only trusted for the exact URL AND build it was written
// by. The version lives inside the entry, not the key, so each source keeps a
// single entry instead of one orphaned ~300 KB copy per deploy.
function readCache(persistKey, key, url, version) {
  try {
    const raw = localStorage.getItem(cacheStorageKey(persistKey, key));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || entry.url !== url || entry.version !== version || entry.data === undefined) return null;
    return entry;
  } catch {
    return null;
  }
}

function writeCache(persistKey, key, url, version, data) {
  try {
    localStorage.setItem(
      cacheStorageKey(persistKey, key),
      JSON.stringify({ url, version, savedAt: Date.now(), data }),
    );
  } catch (err) {
    logger().warn('screendataprovider.cache-write-failed', { key, error: err?.message });
  }
}
```

Add the prop to the JSDoc block above `ScreenDataProvider` (after the `persist` line):

```js
 * @param {string} [props.cacheVersion] - Cache entries from any other version are
 *   ignored. Defaults to the build id, so a deploy never renders an old-shape payload.
```

Change the signature and the two call sites:

```js
export function ScreenDataProvider({ sources = {}, persistKey, persist, cacheVersion = DEFAULT_CACHE_VERSION, actionsRef, children }) {
```

```js
      const entry = url ? readCache(persistKey, key, url, cacheVersion) : null;
```

```js
      if (persistSet.has(key)) writeCache(persistKey, key, url, cacheVersion, data);
    } catch (err) {
      logger().warn('screendataprovider.fetch-failed', { key, url, error: err.message });
    }
  }, [persistKey, persistSet, cacheVersion]);
```

In `frontend/vite.config.js`, compute the id once and expose it (keep the existing `buildId`/`buildIdHtmlPlugin` functions unchanged):

```js
export default defineConfig(({ mode }) => {
  // Load env from root .env (one level up from frontend/)
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');
  const ports = getPortsFromConfig(env);
  // One id per build, shared by the HTML asset busting and bundle code
  // (ScreenDataProvider versions its localStorage cache with it).
  const id = buildId(env);

  return {
    define: {
      'import.meta.env.VITE_BUILD_ID': JSON.stringify(id),
    },
    plugins: [
      react(),
      buildIdHtmlPlugin(id),
    ],
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run frontend/src/screen-framework/data/ScreenDataProvider.test.jsx`
Expected: PASS (all tests in the file, including the pre-existing non-persistence ones).

Then confirm the define reaches the bundle: `cd frontend && npx vite build --logLevel error >/dev/null && grep -l "screenData" dist/assets/*.js | xargs grep -c '"dev"' ; cd ..`
Expected: the build succeeds. (The `"dev"` count is informational only — the real check is that the build does not fail; do not commit `frontend/dist`.) If `frontend/dist` did not exist before, remove it afterwards with `rm -rf frontend/dist` (or `mv` it to `_deleteme/` if `rm` is blocked).

- [ ] **Step 5: Update the doc**

In `docs/reference/core/screen-framework.md`, in the **Stale-while-revalidate cache** paragraph, replace the sentence `A cache entry is only used when its stored URL equals the source's current URL.` with:

```markdown
A cache entry is only used when its stored URL equals the source's current URL
**and** its `version` equals the running build's (`cacheVersion` prop, defaulting
to `import.meta.env.VITE_BUILD_ID`, which `frontend/vite.config.js` sets per
build). So the first load after a deploy is a normal cold load — an old-shape
payload never reaches a widget — and it rewrites the entry. The version lives in
the entry, not the key: one entry per source, no orphans piling up per deploy.
```

- [ ] **Step 6: Commit**

```bash
git add frontend/vite.config.js frontend/src/screen-framework/data/ScreenDataProvider.jsx frontend/src/screen-framework/data/ScreenDataProvider.test.jsx docs/reference/core/screen-framework.md
git commit -m "fix(screen-framework): version the screen-data cache per build

A cached payload was trusted on URL alone, so the first frame after a deploy
that changed a response shape could hand a widget an old-shape object.
Entries now carry the build id (VITE_BUILD_ID, defined in vite.config.js)
and a mismatch is a cold load that rewrites the entry. The version is stored
inside the entry so the key — and the ~300 KB payload — never multiplies.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- frontend/vite.config.js frontend/src/screen-framework/data/ScreenDataProvider.jsx frontend/src/screen-framework/data/ScreenDataProvider.test.jsx docs/reference/core/screen-framework.md
```

---

### Task 2: URL without a session closes the detail pane

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx` (add one effect after the existing "detail pane closes itself" effect, ~line 362)
- Test: `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.selection.test.jsx`
- Docs: `docs/reference/fitness/fitness-system-architecture.md` (section `### Leaving the player → the session just finished`)

**Interfaces:**
- Consumes: existing widget internals — `openRef` (`{ sessionId, revert, committed }` or `null`), `location` from `useLocation()`, `setSelectedSessionId` from `useFitnessScreen()`. Existing test helpers in the test file: `layout`, `Probe`, `renderHome`, `sessionDetailSeed`, `SESSION_DETAIL_NODE_ID`, `ScreenContext`, `MantineProvider`, `MemoryRouter`, `FitnessScreenProvider`, `ScreenProvider`.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Write the failing tests**

Append to `FitnessSessionsWidget.selection.test.jsx`, inside the top-level `describe` (before its closing `});`). Also change the react-router import at the top of the file to `import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';` and delete the separate `import { useLocation } from 'react-router-dom';` line.

```jsx
  // Mounts the seeded home at /fitness/home/session-s1 and exposes the router's
  // navigate + current path, like the post-session redirect / browser Back would drive them.
  function renderSeededWithRouter() {
    const states = [];
    const nav = {};
    function RouterHandle() {
      nav.navigate = useNavigate();
      nav.path = useLocation().pathname;
      return null;
    }
    const utils = render(
      <MantineProvider><MemoryRouter initialEntries={['/fitness/home/session-s1']}>
        <FitnessScreenProvider initialSelectedSessionId="s1" onSelectedSessionConsumed={() => {}}>
          <ScreenProvider config={layout} initialReplacements={sessionDetailSeed('s1')}>
            <FitnessSessionsWidget />
            <Probe onState={(s) => states.push(s)} />
            <RouterHandle />
          </ScreenProvider>
        </FitnessScreenProvider>
      </MemoryRouter></MantineProvider>,
    );
    return { states, nav, ...utils };
  }

  it('closes the pane and clears the selection when the URL drops the session (no-session redirect, browser Back)', () => {
    const { states, nav, container } = renderSeededWithRouter();
    expect(states.at(-1)).toHaveLength(1);

    act(() => nav.navigate('/fitness/home', { replace: true }));

    expect(states.at(-1)).toHaveLength(0);
    expect(nav.path).toBe('/fitness/home');
    expect(container.querySelector('.session-row--selected')).toBeNull();
  });

  it('keeps the seeded pane open on mount at /fitness/home/session-s1', () => {
    const { states, nav } = renderSeededWithRouter();
    expect(states.every((stack) => stack.length === 1)).toBe(true);
    expect(nav.path).toBe('/fitness/home/session-s1');
  });

  it('switching to another session URL does not close the pane', () => {
    const { states, nav } = renderSeededWithRouter();
    act(() => nav.navigate('/fitness/home/session-s9', { replace: true }));
    // The URL still names a session, so the URL effect leaves the pane alone.
    expect(states.at(-1)).toHaveLength(1);
  });
```

Also add a row-click round trip, which needs rows. Add this helper and test in the same `describe`:

```jsx
  it('opening a row by click and toggling it off both survive the URL effect', async () => {
    const { ScreenDataContext } = await import('@/screen-framework/data/ScreenDataProvider.jsx');
    const sessions = { sessions: [{ sessionId: 's7', date: '2026-09-24', startTime: Date.now(), media: [], participants: {} }] };
    const states = [];
    const nav = {};
    function RouterHandle() { nav.path = useLocation().pathname; return null; }
    const { container } = render(
      <MantineProvider><MemoryRouter initialEntries={['/fitness/home']}>
        <ScreenDataContext.Provider value={{ sessions }}>
          <FitnessScreenProvider onSelectedSessionConsumed={() => {}}>
            <ScreenProvider config={layout}>
              <FitnessSessionsWidget />
              <Probe onState={(s) => states.push(s)} />
              <RouterHandle />
            </ScreenProvider>
          </FitnessScreenProvider>
        </ScreenDataContext.Provider>
      </MemoryRouter></MantineProvider>,
    );
    const row = container.querySelector('.session-row:not(.session-row--skeleton)');
    expect(row).not.toBeNull();

    act(() => { row.click(); });
    expect(nav.path).toBe('/fitness/home/session-s7');
    expect(states.at(-1)).toHaveLength(1);

    act(() => { container.querySelector('.session-row--selected').click(); });
    expect(nav.path).toBe('/fitness/home');
    expect(states.at(-1)).toHaveLength(0);
    expect(container.querySelector('.session-row--selected')).toBeNull();
  });
```

If the row does not render with that fixture (the `SessionsCard` row markup may need other fields), open `FitnessSessionsWidget.jsx` `SessionsCard` (~line 72) and add to the fixture exactly the fields it dereferences without optional chaining — do NOT change `SessionsCard` to make the test pass.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.selection.test.jsx`
Expected: FAIL — `closes the pane and clears the selection when the URL drops the session…` fails with `expected [ …1 item ] to have a length of +0` (pane still open). The other new tests may already pass; that is fine — they pin behavior the new effect must not break.

- [ ] **Step 3: Implement**

In `FitnessSessionsWidget.jsx`, immediately after the effect that begins with the comment `// The detail pane closes itself (its × / back buttons call restore()).`, add:

```jsx
  // The URL is authoritative for CLOSING: when it CHANGES to a path that names
  // no session while this widget's pane is open — a post-session redirect with
  // no session id, or browser Back from /session-{id} — close the pane and drop
  // the selection, so a reload shows what the screen shows. Opening stays
  // selection-driven.
  // Acts on a pathname CHANGE only, never on mount: at mount an outside
  // selection may open the pane (effect above, same commit) while the path is
  // still bare. A row click sets the selection and navigates in one batch, so a
  // change to a bare path with the pane open only happens on a real close.
  const prevPathRef = useRef(location.pathname);
  useEffect(() => {
    const prev = prevPathRef.current;
    prevPathRef.current = location.pathname;
    if (prev === location.pathname) return;
    if (/\/session-[^/]+$/.test(location.pathname)) return;
    const open = openRef.current;
    if (!open) return;
    openRef.current = null;
    open.revert();
    setSelectedSessionId(null);
    // Only a URL change should re-run this; the refs and setter are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/FitnessSessionsWidget frontend/src/screen-framework`
Expected: PASS, including the pre-existing `adopts a pane seeded at mount instead of pushing a duplicate`, `swaps the pane when the outside selection changes to another session`, and `clears the selection and URL when the pane is closed from outside (detail × button)`.

The pre-existing `swaps the pane…` and `opens the detail pane for an outside selection with no seed` tests mount at bare `/fitness/home` with an outside selection — they are the regression guard for the mount-skip above. If either fails, the `prev === location.pathname` early return is missing or misplaced; do not change the tests.

- [ ] **Step 5: Update the doc**

In `docs/reference/fitness/fitness-system-architecture.md`, at the end of section `### Leaving the player → the session just finished`, append:

```markdown
The URL stays authoritative for closing: whenever the path has no
`/session-{id}` segment while the sessions widget's pane is open (a close with no
active session, or browser Back from a session URL), the widget closes the pane
and clears the selection, so a reload always shows what the screen showed.
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.selection.test.jsx docs/reference/fitness/fitness-system-architecture.md
git commit -m "fix(fitness): a session-less URL closes the session detail pane

A close with no active session (or browser Back from /session-{id}) left the
URL at /fitness/home while the previous session's detail stayed open and
selected, so a reload showed something different. The sessions widget now
closes its pane when the path names no session.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.selection.test.jsx docs/reference/fitness/fitness-system-architecture.md
```

---

## After all tasks (controller, not a subagent)

1. Whole-branch review, then run `npx vitest run frontend/src/screen-framework frontend/src/modules/Fitness frontend/src/Apps/FitnessApp` in the worktree — expect 0 failures.
2. Merge `fix/fitness-landing-improve` into `main` (no PR), record the branch in `docs/_archive/deleted-branches.md`, delete the branch and worktree.
3. `./scripts/deploy-gate.sh` (must exit 0) → `./scripts/build-daylight.sh` → gate again → `sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight`; confirm `/build.txt` shows the merge commit.
4. Reload the garage kiosk by window NAME (CLAUDE.local.md), confirm a fresh `screendataprovider.fetched` from the garage in the log store, then a second load logs `screendataprovider.cache-hydrated`.
5. Headless check: `/fitness/home/session-{latest}` shows the detail; navigating to `/fitness/home` (history back) closes it.
