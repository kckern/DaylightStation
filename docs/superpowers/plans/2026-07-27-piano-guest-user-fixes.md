# Piano Kiosk Guest/User Integration Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the remaining findings (F1–F6, F9) of `docs/_wip/audits/2026-07-27-piano-kiosk-user-integration.md`: guests must never silently lose work, guest selection must not fire guaranteed-400 requests, an explicit Guest state must survive reloads, the roster fetch must retry, and the Who's-Playing picker timeout must extend on interaction.

**Architecture:** One tiny shared predicate (`isPersistentUser`) added next to the existing `GUEST_PROFILE` becomes the single gate every per-user surface uses. Hooks short-circuit for guests (no network), UI surfaces show explicit "pick a player" affordances instead of silently failing, and `PianoUserContext` learns two behaviors: honoring a persisted `'guest'` selection and retrying the roster fetch with bounded backoff.

**Tech Stack:** React 18 (jsx/js, no TypeScript), Vitest + @testing-library/react (happy-dom), existing structured logging framework (`lib/logging/Logger.js`).

## Global Constraints

- Run all tests from the frontend dir: `cd /opt/Code/DaylightStation/frontend`, then `npx vitest run <path>` (paths below are relative to `frontend/`).
- NEVER use raw `console.log/debug/warn/error` — use the structured logger (`getLogger().child({ component })`) exactly as the surrounding file already does.
- Never write the bare string `'guest'` in new comparison logic — always `GUEST_PROFILE.id` or `isPersistentUser(...)` from `src/modules/Piano/PianoKiosk/pianoUser.js`.
- User-visible copy must be used verbatim as written in each task (these strings are asserted by tests).
- KNOWN PRE-EXISTING FAILURE (do not fix, do not be alarmed): `src/Apps/PianoApp.test.jsx` → "shows the connect gate when Web MIDI is unavailable" fails on main (connect-gate bridge-timing drift). Every other test must pass.
- Commit after each task with the exact message given. Work directly on `main` in `/opt/Code/DaylightStation` (no worktree needed; tasks are small and serialized).
- Do NOT deploy — the orchestrator handles build/deploy after all tasks land.

---

### Task 1: `isPersistentUser` shared predicate

**Files:**
- Modify: `src/modules/Piano/PianoKiosk/pianoUser.js`
- Test: `src/modules/Piano/PianoKiosk/pianoUser.test.js` (exists — append)

**Interfaces:**
- Consumes: existing `GUEST_PROFILE = { id: 'guest', name: 'Guest' }` in the same file.
- Produces: `isPersistentUser(id: string|null|undefined) => boolean` — true only for a truthy id that is not `GUEST_PROFILE.id`. Every later task imports this exact name from `pianoUser.js`.

- [ ] **Step 1: Write the failing test** — append to `pianoUser.test.js` (add `isPersistentUser` to the existing import from `./pianoUser.js`):

```js
describe('isPersistentUser', () => {
  it('is true for a roster id', () => {
    expect(isPersistentUser('kc')).toBe(true);
  });
  it('is false for the guest identity', () => {
    expect(isPersistentUser('guest')).toBe(false);
  });
  it('is false for null / undefined / empty', () => {
    expect(isPersistentUser(null)).toBe(false);
    expect(isPersistentUser(undefined)).toBe(false);
    expect(isPersistentUser('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/modules/Piano/PianoKiosk/pianoUser.test.js` — expect FAIL (`isPersistentUser` is not exported).

- [ ] **Step 3: Implement** — append to `pianoUser.js`:

```js
/**
 * True only for an identity whose data persists server-side: a real roster id.
 * Guest (and "no user yet") must never hit the per-user endpoints — the backend
 * 400s them (only MIDI history accepts guest). This is THE gate every per-user
 * fetch/save runs through.
 */
export const isPersistentUser = (id) => !!id && id !== GUEST_PROFILE.id;
```

- [ ] **Step 4: Run to verify it passes** — same command, expect all PASS.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Piano/PianoKiosk/pianoUser.js frontend/src/modules/Piano/PianoKiosk/pianoUser.test.js
git commit -m "feat(piano): isPersistentUser predicate for guest gating (audit F1-F5 groundwork)"
```

---

### Task 2: Restore a persisted Guest selection (F3)

**Files:**
- Modify: `src/modules/Piano/PianoKiosk/PianoUserContext.jsx` (the roster-restore effect, ~lines 30–39)
- Create: `src/modules/Piano/PianoKiosk/PianoUserContext.test.jsx`

**Interfaces:**
- Consumes: `GUEST_PROFILE` from `./pianoUser.js` (add to the existing `resolveProfile` import).
- Produces: no API change — `usePianoUser()` still returns `{ users, currentUser, currentProfile, setCurrentUser }`; behavior change only (saved `'guest'` survives reload).

- [ ] **Step 1: Write the failing tests** — create `PianoUserContext.test.jsx`:

```jsx
import { renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

let rosterResponses = [];
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => {
    const next = rosterResponses.length ? rosterResponses.shift() : { users: [] };
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }),
}));
import { DaylightAPI } from '../../../lib/api.mjs';
import { PianoUserProvider, usePianoUser } from './PianoUserContext.jsx';

const ROSTER = { users: [{ id: 'kc', name: 'KC' }, { id: 'alice', name: 'Alice' }] };
const wrapper = ({ children }) => createElement(PianoUserProvider, { pianoId: 'test' }, children);

beforeEach(() => {
  localStorage.clear();
  rosterResponses = [ROSTER];
  DaylightAPI.mockClear();
});

describe('PianoUserContext restore', () => {
  it('defaults to the first roster user when nothing is saved', async () => {
    const { result } = renderHook(() => usePianoUser(), { wrapper });
    await waitFor(() => expect(result.current.currentUser).toBe('kc'));
  });

  it('restores a saved roster id', async () => {
    localStorage.setItem('piano:user:test', 'alice');
    const { result } = renderHook(() => usePianoUser(), { wrapper });
    await waitFor(() => expect(result.current.currentUser).toBe('alice'));
  });

  it('restores a saved Guest selection instead of silently crediting users[0] (F3)', async () => {
    localStorage.setItem('piano:user:test', 'guest');
    const { result } = renderHook(() => usePianoUser(), { wrapper });
    await waitFor(() => expect(result.current.currentUser).toBe('guest'));
    expect(result.current.currentProfile).toEqual({ id: 'guest', name: 'Guest' });
  });

  it('ignores a saved id that is not on the roster', async () => {
    localStorage.setItem('piano:user:test', 'stranger');
    const { result } = renderHook(() => usePianoUser(), { wrapper });
    await waitFor(() => expect(result.current.currentUser).toBe('kc'));
  });
});
```

- [ ] **Step 2: Run to verify the F3 test fails** — `npx vitest run src/modules/Piano/PianoKiosk/PianoUserContext.test.jsx` — expect exactly one FAIL ("restores a saved Guest selection…", got `'kc'`); the other three PASS (they pin current behavior).

- [ ] **Step 3: Implement** — in `PianoUserContext.jsx`, change the import and the restore effect:

```js
import { resolveProfile, GUEST_PROFILE } from './pianoUser.js';
```

```js
  // Restore the last player for this piano once the roster loads. A persisted
  // 'guest' is a deliberate "stepping away" state (screen-off / dismissed
  // prompt) and must survive reloads — falling back to users[0] here would
  // silently credit the first roster user (audit F3).
  useEffect(() => {
    if (!users.length) return;
    let saved = null;
    try { saved = localStorage.getItem(storeKey); } catch { /* private mode */ }
    const known = (id) => id === GUEST_PROFILE.id || users.some((u) => u.id === id);
    setCurrent((prev) => {
      if (prev && known(prev)) return prev;
      if (saved && known(saved)) return saved;
      return users[0].id;
    });
  }, [users, storeKey]);
```

- [ ] **Step 4: Run to verify all pass** — same command, expect 4 PASS.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Piano/PianoKiosk/PianoUserContext.jsx frontend/src/modules/Piano/PianoKiosk/PianoUserContext.test.jsx
git commit -m "fix(piano): persisted Guest selection survives reload (audit F3)"
```

---

### Task 3: Roster fetch retry with bounded backoff (F6)

**Files:**
- Modify: `src/modules/Piano/PianoKiosk/PianoUserContext.jsx` (the mount fetch effect, ~lines 21–27)
- Test: `src/modules/Piano/PianoKiosk/PianoUserContext.test.jsx` (from Task 2 — append)

**Interfaces:**
- Consumes: Task 2's test harness (`rosterResponses` queue where an `Error` entry rejects).
- Produces: no API change; the provider retries failed roster fetches at 2s, 5s, 15s, 30s, then gives up. Logs `piano.user.roster-retry` (warn) per retry via the existing `getLogger()` import.

- [ ] **Step 1: Write the failing tests** — append to `PianoUserContext.test.jsx` (add `afterEach` to the vitest import):

```jsx
describe('PianoUserContext roster retry (F6)', () => {
  afterEach(() => vi.useRealTimers());

  it('retries a failed roster fetch and recovers', async () => {
    vi.useFakeTimers();
    rosterResponses = [new Error('boom'), ROSTER];
    const { result } = renderHook(() => usePianoUser(), { wrapper });
    await vi.advanceTimersByTimeAsync(0);       // flush the initial rejection
    expect(result.current.users).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);    // first backoff slot
    expect(result.current.users).toHaveLength(2);
    expect(DaylightAPI).toHaveBeenCalledTimes(2);
  });

  it('gives up after the backoff schedule is exhausted', async () => {
    vi.useFakeTimers();
    rosterResponses = [new Error('a'), new Error('b'), new Error('c'), new Error('d'), new Error('e')];
    const { result } = renderHook(() => usePianoUser(), { wrapper });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000 + 5000 + 15000 + 30000 + 1000);
    expect(DaylightAPI).toHaveBeenCalledTimes(5); // initial + 4 retries, then stop
    expect(result.current.users).toEqual([]);
    await vi.advanceTimersByTimeAsync(60000);
    expect(DaylightAPI).toHaveBeenCalledTimes(5); // no further attempts
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/modules/Piano/PianoKiosk/PianoUserContext.test.jsx` — expect the two new tests FAIL (only 1 API call ever happens); Task 2's tests still PASS.

- [ ] **Step 3: Implement** — replace the mount fetch effect in `PianoUserContext.jsx`:

```js
  // Load the roster, retrying transient failures: kiosks reload exactly when
  // the backend restarts (deploys), and a single failed fetch used to leave
  // the tab userless until a manual reload (audit F6). Bounded backoff, then
  // give up (the tab is likely offline for good).
  const RETRY_DELAYS_MS = [2000, 5000, 15000, 30000];
  useEffect(() => {
    let cancelled = false;
    let timer = null;
    let attempt = 0;
    const load = () => {
      DaylightAPI('api/v1/piano/users')
        .then((r) => { if (!cancelled) setUsers(Array.isArray(r?.users) ? r.users : []); })
        .catch(() => {
          if (cancelled || attempt >= RETRY_DELAYS_MS.length) return;
          const delay = RETRY_DELAYS_MS[attempt];
          attempt += 1;
          getLogger().child({ component: 'piano-user' }).warn('piano.user.roster-retry', { attempt, delay });
          timer = setTimeout(load, delay);
        });
    };
    load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once fetch loop
  }, []);
```

(`RETRY_DELAYS_MS` may live at module scope above the component — either placement is fine.)

- [ ] **Step 4: Run to verify all pass** — same command, expect 6 PASS.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Piano/PianoKiosk/PianoUserContext.jsx frontend/src/modules/Piano/PianoKiosk/PianoUserContext.test.jsx
git commit -m "fix(piano): roster fetch retries with bounded backoff (audit F6)"
```

---

### Task 4: Guest short-circuit in usePianoPreferences (F4)

**Files:**
- Modify: `src/modules/Piano/PianoKiosk/usePianoPreferences.js`
- Test: `src/modules/Piano/PianoKiosk/usePianoPreferences.test.js` (exists — append; it already has a mutable `mockUser` for the user mock and a `calls` array recording every `DaylightAPI` call)

**Interfaces:**
- Consumes: `isPersistentUser`, `GUEST_PROFILE` from `./pianoUser.js` (Task 1).
- Produces: unchanged hook shape `{ prefs, loaded, getPref, setPref }`. For guest: no GET (loaded=true immediately), `setPref` updates local state but never PUTs.

- [ ] **Step 1: Write the failing tests** — append inside the existing `describe('usePianoPreferences', …)`:

```js
  it('guest: performs no GET and reports loaded immediately (F4)', async () => {
    mockUser = 'guest';
    const { result } = renderHook(() => usePianoPreferences());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(calls).toHaveLength(0);
  });

  it('guest: setPref applies session-locally but never PUTs (F4)', async () => {
    mockUser = 'guest';
    const { result } = renderHook(() => usePianoPreferences());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => { await result.current.setPref('topPaneLayout', 'triptych'); });
    expect(result.current.getPref('topPaneLayout', 'staff')).toBe('triptych');
    expect(calls).toHaveLength(0);
  });
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/modules/Piano/PianoKiosk/usePianoPreferences.test.js` — expect the two new tests FAIL (a GET to `api/v1/piano/users/guest/preferences` is recorded).

- [ ] **Step 3: Implement** — in `usePianoPreferences.js`, add the import and change the load effect and `setPref`:

```js
import { isPersistentUser, GUEST_PROFILE } from './pianoUser.js';
```

```js
  useEffect(() => {
    if (!isPersistentUser(currentUser)) {
      // Guest has no server blob (the backend 400s it) — loaded immediately.
      // No user yet (roster resolving) stays un-loaded.
      setPrefs({});
      setLoaded(currentUser === GUEST_PROFILE.id);
      return undefined;
    }
    let cancelled = false;
    setLoaded(false);
    DaylightAPI(`api/v1/piano/users/${currentUser}/preferences`)
      .then((r) => {
        if (!cancelled) {
          setPrefs(r && typeof r === 'object' ? r : {});
          setLoaded(true);
          logger().debug('preferences.load', { user: currentUser });
        }
      })
      .catch((e) => {
        if (!cancelled) { setPrefs({}); setLoaded(true); }
        logger().warn('preferences.load.fail', { user: currentUser, error: e?.message });
      });
    return () => { cancelled = true; };
  }, [currentUser]);
```

```js
  const setPref = useCallback(async (key, value) => {
    const user = userRef.current;
    if (!user) return;
    setPrefs((prev) => ({ ...prev, [key]: value })); // optimistic (session-only for guests)
    if (!isPersistentUser(user)) return; // guest: never PUT — the backend rejects it
    try {
      await DaylightAPI(`api/v1/piano/users/${user}/preferences`, { [key]: value }, 'PUT');
      logger().info('preferences.save', { user, key });
    } catch (e) {
      logger().error('preferences.save.fail', { user, key, error: e?.message });
    }
  }, []);
```

- [ ] **Step 4: Run to verify all pass** — same command, expect all PASS.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Piano/PianoKiosk/usePianoPreferences.js frontend/src/modules/Piano/PianoKiosk/usePianoPreferences.test.js
git commit -m "fix(piano): preferences hook short-circuits for Guest (audit F4)"
```

---

### Task 5: Guest short-circuit + `canSave` in usePianoPreset (F4)

**Files:**
- Modify: `src/modules/Piano/PianoKiosk/usePianoPreset.js`
- Test: `src/modules/Piano/PianoKiosk/usePianoPreset.test.js` (exists — append; same mutable `mockUser` + `calls` harness as Task 4's file)

**Interfaces:**
- Consumes: `isPersistentUser` from `./pianoUser.js` (Task 1).
- Produces: context value becomes `{ preset, saveDefault, addFavorite, canSave }` where `canSave: boolean` is `isPersistentUser(currentUser)`. Task 6's SoundPanel reads `canSave`. `saveDefault`/`addFavorite` become no-ops (no state change, no PUT) for guests.

- [ ] **Step 1: Write the failing tests** — append inside the existing top-level describe:

```js
  it('guest: performs no GET and leaves the current sound alone (F4)', async () => {
    mockUser = 'guest';
    const { result } = renderHook(() => usePianoPreset(), { wrapper });
    await waitFor(() => expect(result.current.canSave).toBe(false));
    expect(calls).toHaveLength(0);
    expect(applyBundle).not.toHaveBeenCalled();
  });

  it('guest: saveDefault and addFavorite are no-ops (F4)', async () => {
    mockUser = 'guest';
    const { result } = renderHook(() => usePianoPreset(), { wrapper });
    await waitFor(() => expect(result.current.canSave).toBe(false));
    await act(async () => { await result.current.saveDefault({ voice: { pc: 1 } }); });
    await act(async () => { await result.current.addFavorite({ voice: { pc: 2 } }); });
    expect(calls).toHaveLength(0);
    expect(result.current.preset).toEqual({});
  });

  it('roster user: canSave is true', async () => {
    const { result } = renderHook(() => usePianoPreset(), { wrapper });
    await waitFor(() => expect(result.current.canSave).toBe(true));
  });
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/modules/Piano/PianoKiosk/usePianoPreset.test.js` — expect the three new tests FAIL (`canSave` is undefined; guest GET recorded).

- [ ] **Step 3: Implement** — in `usePianoPreset.js`:

```js
import { isPersistentUser } from './pianoUser.js';
```

In the load effect, replace `if (!currentUser) return undefined;` with:

```js
    if (!isPersistentUser(currentUser)) return undefined; // guest/null: no server blob (backend 400s guests)
```

At the top of BOTH `saveDefault` and `addFavorite`, replace `if (!user) return;` with:

```js
    if (!isPersistentUser(user)) return; // guests can't persist sounds — UI hides the buttons too
```

Change the return of `usePianoPresetState`:

```js
  return { preset, saveDefault, addFavorite, canSave: isPersistentUser(currentUser) };
```

- [ ] **Step 4: Run to verify all pass** — same command, expect all PASS.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Piano/PianoKiosk/usePianoPreset.js frontend/src/modules/Piano/PianoKiosk/usePianoPreset.test.js
git commit -m "fix(piano): preset hook short-circuits for Guest, exposes canSave (audit F4)"
```

---

### Task 6: SoundPanel hides save affordances for Guest (F4)

**Files:**
- Modify: `src/modules/Piano/PianoKiosk/SoundPanel.jsx` (footer, ~lines 262–270)
- Test: `src/modules/Piano/PianoKiosk/SoundPanel.test.jsx` (exists — its `vi.mock('./usePianoPreset.js', …)` returns a fixed object; make it read a mutable `canSave` variable)

**Interfaces:**
- Consumes: `canSave` from `usePianoPreset()` (Task 5).
- Produces: UI only. Copy strings (verbatim, tested): `Save as my default`, `Add to favorites`, `Pick a player to save sounds`.

- [ ] **Step 1: Update the mock + write the failing test** — in `SoundPanel.test.jsx`, change the preset mock to:

```js
let canSave = true;
vi.mock('./usePianoPreset.js', () => ({
  usePianoPreset: () => ({ preset: { favorites: [favoriteBundle] }, saveDefault, addFavorite, canSave }),
}));
```

Add `canSave = true;` to the existing `beforeEach`. Then add inside the main describe (the file renders the panel directly, e.g. `render(<SoundPanel open onClose={vi.fn()} />)`):

```js
  it('guest (canSave=false): save buttons are hidden, note shown (F4)', () => {
    canSave = false;
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.queryByText('Save as my default')).toBeNull();
    expect(screen.queryByText('Add to favorites')).toBeNull();
    expect(screen.getByText('Pick a player to save sounds')).toBeTruthy();
  });
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/modules/Piano/PianoKiosk/SoundPanel.test.jsx` — expect the new test FAIL (save buttons render).

- [ ] **Step 3: Implement** — in `SoundPanel.jsx`, add `canSave` to the destructure (`const { preset, saveDefault, addFavorite, canSave } = usePianoPreset();` — match the file's actual destructure line) and replace the footer:

```jsx
        {/* ── Save: snapshot the current bundle onto the active user ── */}
        {canSave ? (
          <footer className="piano-sound-panel__foot">
            <button type="button" className="piano-sound-panel__save" onClick={() => saveDefault(currentBundle)}>
              Save as my default
            </button>
            <button type="button" className="piano-sound-panel__favorite" onClick={() => addFavorite(currentBundle)}>
              Add to favorites
            </button>
          </footer>
        ) : (
          <footer className="piano-sound-panel__foot piano-sound-panel__foot--guest">
            <span className="piano-sound-panel__guest-note">Pick a player to save sounds</span>
          </footer>
        )}
```

- [ ] **Step 4: Run to verify all pass** — same command, expect all PASS.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Piano/PianoKiosk/SoundPanel.jsx frontend/src/modules/Piano/PianoKiosk/SoundPanel.test.jsx
git commit -m "fix(piano): SoundPanel hides save affordances for Guest (audit F4)"
```

---

### Task 7: PianoFlashcards guest guards (F4)

**Files:**
- Modify: `src/modules/Piano/PianoFlashcards/PianoFlashcards.jsx` (two spots: the one-shot pref-load effect ~line 40, and `handleLevelSelect` ~line 64)

**Interfaces:**
- Consumes: `isPersistentUser` from `../PianoKiosk/pianoUser.js` (Task 1).
- Produces: no API change. Guests get default levels with zero network.

No new test: both changes are one-line guards on the Task-1-tested predicate, and the component harness would need canvas/game stubs disproportionate to the change. Verification is the existing suite staying green.

- [ ] **Step 1: Implement** — add the import:

```js
import { isPersistentUser } from '../PianoKiosk/pianoUser.js';
```

In the pref-load effect, change `if (!currentUser || prefAppliedRef.current) return undefined;` to:

```js
    if (!isPersistentUser(currentUser) || prefAppliedRef.current) return undefined;
```

In `handleLevelSelect`, change `if (currentUser && levels[idx]?.name) {` to:

```js
    if (isPersistentUser(currentUser) && levels[idx]?.name) {
```

- [ ] **Step 2: Run the flashcards + kiosk suites** — `npx vitest run src/modules/Piano/PianoFlashcards src/modules/Piano/PianoKiosk/pianoUser.test.js` — expect all PASS.

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Piano/PianoFlashcards/PianoFlashcards.jsx
git commit -m "fix(piano): flashcards skip per-user pref calls for Guest (audit F4)"
```

---

### Task 8: Studio guest gating — no silent take loss (F1)

**Files:**
- Modify: `src/modules/Piano/PianoKiosk/modes/Studio/Studio.jsx`
- Test: `src/modules/Piano/PianoKiosk/modes/Studio/Studio.test.jsx` (exists — its user mock is `vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: 'test-user' }) }))`; make it mutable)

**Interfaces:**
- Consumes: `isPersistentUser` from `../../pianoUser.js` (Task 1). Existing: `RecordButton({ recording, elapsedMs, onToggle })`, `DaylightAPI` mock in the test file records calls.
- Produces: UI only. Copy string (verbatim, tested): `Pick a player to record`.

- [ ] **Step 1: Make the user mock mutable + write the failing tests** — in `Studio.test.jsx`, replace the user mock with:

```js
let mockUser = 'test-user';
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: mockUser }) }));
```

Add a `beforeEach` (import it from vitest if not present) resetting `mockUser = 'test-user';` and clearing the `DaylightAPI` mock (`DaylightAPI.mockClear()` — import it: `import { DaylightAPI } from '../../../../../lib/api.mjs';`). Then append:

```js
describe('Studio as Guest (F1)', () => {
  it('hides the Record button and shows the pick-a-player note', async () => {
    mockUser = 'guest';
    await renderAt('/studio');
    expect(screen.queryByRole('button', { name: /Start recording/i })).toBeNull();
    expect(screen.getByText('Pick a player to record')).toBeTruthy();
  });

  it('does not fetch takes for guest (the backend 400s it)', async () => {
    mockUser = 'guest';
    await renderAt('/studio');
    const studioCalls = DaylightAPI.mock.calls.filter(([p]) => String(p).includes('/studio'));
    expect(studioCalls).toHaveLength(0);
  });
});
```

(Use this file's existing `renderAt` helper and `screen` import; add `screen` to the testing-library import if missing.)

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/modules/Piano/PianoKiosk/modes/Studio/Studio.test.jsx` — expect the two new tests FAIL (Record renders; a `/users/guest/studio` GET is recorded).

- [ ] **Step 3: Implement** — in `Studio.jsx`:

```js
import { isPersistentUser } from '../../pianoUser.js';
```

After the `const { currentUser } = usePianoUser();` line:

```js
  // Guests can play but can't persist takes (backend 400s /users/guest/studio;
  // audit F1: a guest take was recorded, "kept", and silently lost). Gate BOTH
  // the API base (kills the guaranteed-400 list fetch) and the Record entry
  // point. The always-on MIDI history still captures guest play at household
  // level, so nothing is truly lost by hiding explicit recording.
  const canRecord = isPersistentUser(currentUser);
```

Change the `studioBase` line to:

```js
  const studioBase = canRecord ? `api/v1/piano/users/${currentUser}/studio` : null;
```

In the tab-bar JSX, replace the `{!onPlaybackRoute && (<RecordButton …/>)}` block with (the `|| recording` keeps Stop reachable if the player flips to Guest mid-take):

```jsx
        {!onPlaybackRoute && ((canRecord || recording) ? (
          <RecordButton recording={recording} elapsedMs={elapsedMs} onToggle={onRecordToggle} />
        ) : (
          <span className="piano-studio__guest-note">Pick a player to record</span>
        ))}
```

- [ ] **Step 4: Run to verify all pass** — same command, expect all PASS.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Piano/PianoKiosk/modes/Studio/Studio.jsx frontend/src/modules/Piano/PianoKiosk/modes/Studio/Studio.test.jsx
git commit -m "fix(piano): Studio gates recording for Guest instead of silently losing takes (audit F1)"
```

---

### Task 9: Composer guest gating — no silent song loss (F2)

**Files:**
- Modify: `src/modules/Piano/PianoKiosk/modes/Composer/Composer.jsx`
- Test: `src/modules/Piano/PianoKiosk/modes/Composer/Composer.test.jsx` (exists — its user mock is fixed to `'kc'`; make it mutable, same pattern as Task 8)

**Interfaces:**
- Consumes: `isPersistentUser` from `../../pianoUser.js` (Task 1); existing `useCompositionsApi(userId, logger)` returning `{ list, get, create, save, remove }` (all async).
- Produces: UI only. Copy strings (verbatim, tested): `Playing as Guest — songs won't be saved. Tap the face in the top bar to pick a player.` and `Pick a player to see saved songs.`

- [ ] **Step 1: Make the user mock mutable + write the failing tests** — in `Composer.test.jsx`, replace the user mock with:

```js
let mockUser = 'kc';
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: mockUser }) }));
```

Add/extend `beforeEach` to reset `mockUser = 'kc';` (import `beforeEach` from vitest if missing). Append:

```js
describe('Composer as Guest (F2)', () => {
  it('shows the guest banner over the editor', async () => {
    mockUser = 'guest';
    render(<Composer />);
    await waitFor(() => expect(document.querySelector('.composer-editor')).toBeInTheDocument());
    expect(screen.getByText("Playing as Guest — songs won't be saved. Tap the face in the top bar to pick a player.")).toBeInTheDocument();
  });

  it('gallery shows the pick-a-player notice instead of listing (no guest list call)', async () => {
    mockUser = 'guest';
    render(<Composer />);
    await waitFor(() => expect(screen.getByRole('button', { name: /your songs/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /your songs/i }));
    await waitFor(() => expect(screen.getByText('Pick a player to see saved songs.')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /new song/i })).not.toBeInTheDocument();
  });

  it('no banner for a roster user', async () => {
    render(<Composer />);
    await waitFor(() => expect(document.querySelector('.composer-editor')).toBeInTheDocument());
    expect(screen.queryByText(/Playing as Guest/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/modules/Piano/PianoKiosk/modes/Composer/Composer.test.jsx` — expect the two guest tests FAIL (no banner; gallery renders).

- [ ] **Step 3: Implement** — in `Composer.jsx`:

```js
import { isPersistentUser } from '../../pianoUser.js';
```

At module scope (above the component):

```js
// Guests can doodle on the staff, but nothing persists (the backend 400s all
// guest composition writes — audit F2). A stub API keeps the editor alive with
// ZERO network: reads come back empty, writes reject so the editor's status
// chip honestly shows "Couldn't save" (the banner explains why).
const GUEST_API = {
  list: async () => [],
  get: async () => { throw new Error('guest-no-persist'); },
  create: async () => { throw new Error('guest-no-persist'); },
  save: async () => { throw new Error('guest-no-persist'); },
  remove: async () => { throw new Error('guest-no-persist'); },
};
```

In the component, replace `const api = useCompositionsApi(currentUser, logger);` with:

```js
  const persistent = isPersistentUser(currentUser);
  const realApi = useCompositionsApi(currentUser, logger);
  const api = persistent ? realApi : GUEST_API;
```

In the returned JSX, insert the banner immediately BEFORE the `{view === 'editor' && (` block:

```jsx
      {view === 'editor' && !persistent && currentUser && (
        <p className="composer-guest-note">Playing as Guest — songs won't be saved. Tap the face in the top bar to pick a player.</p>
      )}
```

Change the gallery branch condition from `currentUser ? (` to `persistent ? (` and its placeholder from `'Loading…'` to:

```jsx
          <p className="piano-mode__placeholder">{currentUser ? 'Pick a player to see saved songs.' : 'Loading…'}</p>
```

- [ ] **Step 4: Run to verify all pass** — same command, expect all PASS.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Piano/PianoKiosk/modes/Composer/Composer.jsx frontend/src/modules/Piano/PianoKiosk/modes/Composer/Composer.test.jsx
git commit -m "fix(piano): Composer gates persistence for Guest with an explicit banner (audit F2)"
```

---

### Task 10: Videos course playable — guest falls back to device-level endpoint (F5)

**Files:**
- Modify: `src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.js`
- Test: `src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.test.js` (exists — append)

**Interfaces:**
- Consumes: `isPersistentUser` from `../../pianoUser.js` (Task 1).
- Produces: unchanged hook signature `usePianoCoursePlayable(courseId, userId)`; `'guest'` now behaves exactly like `null` (fitness device-level endpoint — watchable, no per-user credit) instead of a 400 dead end.

- [ ] **Step 1: Write the failing test** — append inside the existing `describe('usePianoCoursePlayable', …)` (the file already defines the `api` mock fn and imports `renderHook`/`waitFor`):

```js
  it('falls back to the fitness endpoint for guest — never a guest-userId piano call (F5)', async () => {
    api.mockResolvedValue({ items: [], info: {} });
    const { result } = renderHook(() => usePianoCoursePlayable('12345', 'guest'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api).toHaveBeenCalledWith('api/v1/fitness/show/12345/playable');
    expect(api).not.toHaveBeenCalledWith(expect.stringContaining('userId=guest'));
  });
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.test.js` — expect the new test FAIL (piano URL with `userId=guest` is called).

- [ ] **Step 3: Implement** — in `usePianoCoursePlayable.js`:

```js
import { isPersistentUser } from '../../pianoUser.js';
```

At the top of the hook body:

```js
  // Guest behaves like "no user": the piano endpoint 400s unknown users
  // (audit F5 — guests got a dead 'No lectures found'), while the fitness
  // device-level endpoint lets them watch without per-user credit.
  const effectiveUserId = isPersistentUser(userId) ? userId : null;
```

Replace both uses of `userId` inside the effect (the `url` ternary and the dependency array) with `effectiveUserId`.

- [ ] **Step 4: Run to verify all pass** — same command, expect all PASS.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.js frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.test.js
git commit -m "fix(piano): course playable falls back to device endpoint for Guest (audit F5)"
```

---

### Task 11: ProfilePicker timeout extends on interaction (F9)

**Files:**
- Modify: `src/lib/identity/ProfilePicker.jsx`
- Test: `src/lib/identity/ProfilePicker.test.jsx` (exists — already uses `vi.useFakeTimers()` in `beforeEach`; append)

**Interfaces:**
- Consumes: nothing new.
- Produces: behavior only — any `pointerdown` inside the sheet restarts the `timeoutMs` auto-dismiss countdown. Backdrop clicks still dismiss immediately (unchanged).

- [ ] **Step 1: Write the failing test** — append to the existing describe:

```jsx
  it('interaction inside the sheet restarts the auto-dismiss countdown (F9)', () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <ProfilePicker open users={users} onPick={() => {}} onDismiss={onDismiss} timeoutMs={30000} />
    );
    act(() => { vi.advanceTimersByTime(20000); });
    fireEvent.pointerDown(container.querySelector('.piano-userpicker__sheet'));
    act(() => { vi.advanceTimersByTime(20000); }); // 40s total, but only 20s since the tap
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(10000); }); // 30s since the tap
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/identity/ProfilePicker.test.jsx` — expect the new test FAIL (dismissed at the 30s mark despite the tap).

- [ ] **Step 3: Implement** — in `ProfilePicker.jsx`, add state next to the existing `page` state:

```js
  // Any interaction inside the sheet restarts the auto-dismiss countdown —
  // browsing pages must not eat the timeout budget and land on a surprise
  // Guest dismiss (audit F9).
  const [interactionEpoch, setInteractionEpoch] = useState(0);
```

Add `interactionEpoch` to the auto-dismiss effect's dependency array:

```js
  useEffect(() => {
    if (!open || !(timeoutMs > 0)) return undefined;
    const t = setTimeout(() => onDismissRef.current?.(), timeoutMs);
    return () => clearTimeout(t);
  }, [open, timeoutMs, interactionEpoch]);
```

Add the handler to the sheet div (NOT the scrim — backdrop taps still dismiss):

```jsx
      <div className="piano-userpicker__sheet" onPointerDown={() => setInteractionEpoch((e) => e + 1)}>
```

- [ ] **Step 4: Run to verify all pass** — same command, expect all PASS.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/lib/identity/ProfilePicker.jsx frontend/src/lib/identity/ProfilePicker.test.jsx
git commit -m "fix(identity): ProfilePicker auto-dismiss restarts on in-sheet interaction (audit F9)"
```

---

### Task 12: Audit doc close-out + full sweep

**Files:**
- Modify: `docs/_wip/audits/2026-07-27-piano-kiosk-user-integration.md`

**Interfaces:** none — documentation + verification only.

- [ ] **Step 1: Annotate the audit** — under each of F1, F2, F3, F4, F5, F6, F9 (immediately after that finding's `*Recommendation:*` paragraph), add a bold fixed line following the exact style already present under F7/F8, e.g. for F1:

```markdown
**FIXED 2026-07-27:** Studio gates the Record button + API base on
`isPersistentUser` (guests see "Pick a player to record"); guest play is still
captured by the always-on household MIDI history.
```

Write an equivalent 1–2 line summary for each of the other six findings, naming the actual mechanism used (F2: GUEST_API stub + banner; F3: restore honors saved guest; F4: hooks short-circuit + SoundPanel/flashcards gating; F5: effectiveUserId fallback; F6: bounded-backoff retry; F9: interactionEpoch timer restart).

- [ ] **Step 2: Full sweep** — run:

```bash
cd /opt/Code/DaylightStation/frontend
npx vitest run src/modules/Piano src/lib/identity src/Apps/PianoApp.test.jsx
```

Expected: everything passes EXCEPT the one known pre-existing failure (`PianoApp.test.jsx` → "shows the connect gate when Web MIDI is unavailable"). Any other failure must be fixed before committing.

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation
git add docs/_wip/audits/2026-07-27-piano-kiosk-user-integration.md
git commit -m "docs(piano): close out guest/user integration audit findings F1-F6, F9"
```

---

## Post-plan (orchestrator only — NOT a subagent task)

Build (`./scripts/build-daylight.sh`), gate-check (no active video/fitness session), `sudo deploy-daylight`, verify `/build.txt`, push `main`, and reload the piano tablet FKB (`loadStartURL`). These are operational steps the orchestrating session performs after all tasks are merged.
