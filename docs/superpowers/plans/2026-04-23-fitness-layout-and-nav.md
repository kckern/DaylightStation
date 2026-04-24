# Fitness Layout & Nav Implementation Plan (F1 + F2 + F3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three bug-bash fixes in the fitness UI:
- **F1** — Add an End Session button to bottom-right of `FitnessSidebar` (wired to `/api/v1/fitness/sessions/:id/end`, same contract as the existing chart-view button).
- **F2** — Mount the Fitness Music Player as a default, persistent component on the standalone Fitness Chart (`FitnessSessionApp`), NOT gated on `musicEnabled`.
- **F3** — After a video or voice memo ends, navigate to the Chart view (`currentView='users'` → `FitnessSessionApp`) instead of the Show Menu.

**Architecture:**
- F1 lives in `FitnessSidebar.jsx` + `FitnessSidebar.scss`. Reuses the same REST call. Exposed as a new sidebar prop so governance-disabled/standalone-chart contexts can opt out.
- F2 adds one `<FitnessMusicPlayer>` mount inside `FitnessSessionApp__chart`, independent of the existing music-player mount inside `FitnessSidebar`. Music persistence is intentionally independent of chart visibility.
- F3 changes `executeClose()` in `FitnessPlayer.jsx` to invoke a new `onSessionEndRedirect` callback supplied by `FitnessApp.jsx`. The callback sets `currentView='users'` + clears `activeModule/activeCollection/selectedShow`. Voice-memo and video both hit `executeClose`, so one hook covers both.

**Tech Stack:** React (frontend), Jest (`testEnvironment: 'node'`, no JSX transform — tests operate on extracted pure helpers), SCSS.

**Testability note:** Jest here is node-env and has no JSX/DOM transform. Every testable change is extracted into a pure helper, and tests target the helper, not JSX.

---

## File Structure

| File | Role | Change |
|---|---|---|
| `frontend/src/modules/Fitness/player/FitnessSidebar.jsx` | Sidebar JSX | Add End Session button slot (F1) |
| `frontend/src/modules/Fitness/player/FitnessSidebar.scss` | Sidebar layout | Bottom-right positioning class (F1) |
| `frontend/src/modules/Fitness/player/endSessionRequest.js` | NEW pure helper for End Session API-call builder (F1) | — |
| `tests/unit/fitness/endSessionRequest.test.mjs` | NEW unit tests for the builder (F1) | — |
| `frontend/src/modules/Fitness/widgets/FitnessSessionApp/FitnessSessionApp.jsx` | Standalone chart view | Mount persistent `<FitnessMusicPlayer>` (F2) |
| `frontend/src/modules/Fitness/widgets/FitnessSessionApp/FitnessSessionApp.scss` | Chart view layout | Reserve music-player slot (F2) |
| `frontend/src/modules/Fitness/player/postEpisodeRedirect.js` | NEW pure helper (F3) | — |
| `tests/unit/fitness/postEpisodeRedirect.test.mjs` | NEW unit tests (F3) | — |
| `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` | Player logic | Call redirect resolver in `executeClose` (F3) |
| `frontend/src/Apps/FitnessApp.jsx` | Top-level shell | Supply `onSessionEndRedirect` prop (F3) |

The existing End Session button in `FitnessSessionApp.jsx` is **kept** — it's the chart-view's own shortcut. F1 is a duplicate inside the sidebar so it's reachable while watching a video.

---

## Background — Key Call Sites

- `FitnessPlayer.jsx:122` — component signature; add `onSessionEndRedirect` here.
- `FitnessPlayer.jsx:901-913` — `executeClose()` is the single funnel for both video-end and voice-memo-end. Both paths invoke it.
- `FitnessPlayer.jsx:1556-1560` — chart overlay rendered inside `videoContent`, gated on `showChart && hasActiveItem`. Once `executeClose` sets `currentItem=null`, `hasActiveItem` becomes false and the video/chart DOM disappears, revealing whatever `currentView` is in `FitnessApp` — that's what users perceive as "Show Menu".
- `FitnessApp.jsx:44` — `currentView` state: `'screen' | 'menu' | 'users' | 'show' | 'module'`. The Chart is `'users'` (renders standalone `FitnessSessionApp` at line 1205-1206).
- `FitnessApp.jsx:1243-1260` — `FitnessPlayer` rendered as overlay only when `fitnessPlayQueue.length > 0`. When `executeClose` calls `setQueue([])`, overlay unmounts; surviving `currentView` is what user sees. So F3's fix: set `currentView='users'` *before* the queue empties.
- `FitnessSessionApp.jsx:39-70` — existing End Session: POST `/api/v1/fitness/sessions/${id}/end` with `{ endTime: Date.now() }`. F1 mirrors this.
- `FitnessSidebar.jsx:189-291` — sidebar JSX ends at line 292. Container is `display: flex; flex-direction: column`. No bottom-right slot exists.
- `FitnessMusicPlayer.jsx:63` — internally reads `musicEnabled` but does NOT early-return on false. Safe to mount unconditionally.

---

## Task 1: F1 RED — Pure helper for End Session request builder

**Files:**
- Create: `tests/unit/fitness/endSessionRequest.test.mjs`

- [ ] **Step 1: Create the failing test file**

```js
// tests/unit/fitness/endSessionRequest.test.mjs
import { describe, it, expect, beforeAll } from '@jest/globals';

let buildEndSessionRequest;

beforeAll(async () => {
  const mod = await import('#frontend/modules/Fitness/player/endSessionRequest.js');
  buildEndSessionRequest = mod.buildEndSessionRequest;
});

describe('buildEndSessionRequest', () => {
  it('builds a POST with the session id in the path and endTime in the body', () => {
    const req = buildEndSessionRequest('abc123', { now: () => 1700000000000 });
    expect(req).toEqual({
      path: 'api/v1/fitness/sessions/abc123/end',
      body: { endTime: 1700000000000 },
      method: 'POST',
    });
  });

  it('coerces numeric session ids to strings', () => {
    const req = buildEndSessionRequest(42, { now: () => 999 });
    expect(req.path).toBe('api/v1/fitness/sessions/42/end');
    expect(req.body.endTime).toBe(999);
    expect(req.method).toBe('POST');
  });

  it('returns null for a null session id', () => {
    expect(buildEndSessionRequest(null)).toBeNull();
  });

  it('returns null for an empty-string session id', () => {
    expect(buildEndSessionRequest('')).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(buildEndSessionRequest(undefined)).toBeNull();
  });

  it('uses Date.now() when no clock is injected', () => {
    const before = Date.now();
    const req = buildEndSessionRequest('x');
    const after = Date.now();
    expect(req.body.endTime).toBeGreaterThanOrEqual(before);
    expect(req.body.endTime).toBeLessThanOrEqual(after);
  });
});
```

- [ ] **Step 2: Run — expect import failure** (`Cannot find module ...endSessionRequest.js`)

```bash
cd /opt/Code/DaylightStation && npx jest tests/unit/fitness/endSessionRequest.test.mjs
```

- [ ] **Step 3: Commit failing tests**

```bash
cd /opt/Code/DaylightStation
git add tests/unit/fitness/endSessionRequest.test.mjs
git commit -m "test(fitness): failing tests for End Session request builder"
```

---

## Task 2: F1 GREEN — Implement the request builder

**Files:**
- Create: `frontend/src/modules/Fitness/player/endSessionRequest.js`

- [ ] **Step 1: Create the helper**

```js
/**
 * buildEndSessionRequest — pure helper that produces the { path, body, method }
 * triple for the "End current fitness session" REST call.
 *
 * @param {string|number|null|undefined} sessionId
 * @param {{ now?: () => number }} [options]
 * @returns {null | { path: string, body: { endTime: number }, method: 'POST' }}
 */
export function buildEndSessionRequest(sessionId, { now = Date.now } = {}) {
  if (sessionId === null || sessionId === undefined) return null;
  const asString = String(sessionId);
  if (asString === '') return null;
  return {
    path: `api/v1/fitness/sessions/${asString}/end`,
    body: { endTime: now() },
    method: 'POST',
  };
}

export default buildEndSessionRequest;
```

- [ ] **Step 2: Run — expect 6/6 PASS**

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Fitness/player/endSessionRequest.js
git commit -m "feat(fitness): add End Session request builder helper"
```

---

## Task 3: F1 — Add End Session button to FitnessSidebar

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessSidebar.jsx`
- Modify: `frontend/src/modules/Fitness/player/FitnessSidebar.scss`

- [ ] **Step 1: Add imports**

After the existing `FitnessGovernance` import (~line 11) and above the SCSS import (~line 12), add:

```jsx
import { DaylightAPI } from '@/lib/api.mjs';
import { buildEndSessionRequest } from './endSessionRequest.js';
```

In the destructure from `fitnessContext` (lines 29-45), add `fitnessSessionInstance`. Below that destructure add:

```jsx
  const [endingSession, setEndingSession] = useState(false);
  const [endSessionError, setEndSessionError] = useState(null);
  const activeSessionId = fitnessSessionInstance?.sessionId || null;

  const handleEndSession = React.useCallback(async (event) => {
    event?.stopPropagation?.();
    event?.preventDefault?.();
    const req = buildEndSessionRequest(activeSessionId);
    if (!req) return;
    if (endingSession) return;
    const confirmed = typeof window !== 'undefined'
      ? window.confirm('End this fitness session? Subsequent heart-rate readings will start a new session.')
      : true;
    if (!confirmed) return;
    setEndingSession(true);
    setEndSessionError(null);
    try {
      await DaylightAPI(req.path, req.body, req.method);
    } catch (err) {
      setEndSessionError(err?.message || 'Failed to end session');
    } finally {
      setEndingSession(false);
    }
  }, [activeSessionId, endingSession]);
```

- [ ] **Step 2: Add the button JSX** — just before the closing `</div>` of `fitness-sidebar-container` (~line 291):

```jsx
      {activeSessionId && (
        <div className="fitness-sidebar-end-session-slot">
          {endSessionError && (
            <div className="fitness-sidebar-end-session-error" role="alert">{endSessionError}</div>
          )}
          <button
            type="button"
            className="fitness-sidebar-end-session"
            onPointerDown={handleEndSession}
            disabled={endingSession}
            aria-label="End current fitness session"
            title="Force end the current session so it won't auto-merge with the next workout"
          >
            {endingSession ? 'Ending…' : 'End Session'}
          </button>
        </div>
      )}
```

- [ ] **Step 3: Add SCSS rules** — inside the `.fitness-sidebar-container` block:

```scss
  .fitness-sidebar-end-session-slot {
    position: absolute;
    bottom: 8px;
    right: 8px;
    z-index: 90;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    pointer-events: auto;
  }

  .fitness-sidebar-end-session {
    padding: 0.45rem 0.9rem;
    background: rgba(220, 53, 69, 0.92);
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
    transition: background 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease;

    &:active:not(:disabled) {
      transform: scale(0.97);
    }

    &:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
  }

  .fitness-sidebar-end-session-error {
    padding: 0.35rem 0.6rem;
    background: rgba(220, 53, 69, 0.95);
    color: #fff;
    border-radius: 6px;
    font-size: 0.75rem;
    max-width: 220px;
    line-height: 1.2;
  }
```

- [ ] **Step 4: Smoke check** — `npx jest tests/unit/fitness/`. Expect green.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Fitness/player/FitnessSidebar.jsx \
        frontend/src/modules/Fitness/player/FitnessSidebar.scss
git commit -m "feat(fitness): add End Session button to sidebar bottom-right (F1)"
```

---

## Task 4: F2 — Mount persistent music player on standalone chart

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionApp/FitnessSessionApp.jsx`
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionApp/FitnessSessionApp.scss`

- [ ] **Step 1: Mount `<FitnessMusicPlayer>` inside the chart area**

At line 6 (below `import FitnessChart`), add:

```jsx
import FitnessMusicPlayer from '@/modules/Fitness/player/panels/FitnessMusicPlayer.jsx';
```

In the JSX, find the `<div className="fitness-session-app__chart">` block (~line 122). Replace with:

```jsx
        <div className="fitness-session-app__chart">
          {/* F2: Music player is a default, persistent component on the chart. */}
          <div className="fitness-session-app__music">
            <FitnessMusicPlayer
              ref={fitnessCtx?.musicPlayerRef}
              selectedPlaylistId={fitnessCtx?.selectedPlaylistId}
              videoPlayerRef={null}
              videoVolume={null}
            />
          </div>
          <FitnessChart mode="standalone" onClose={() => {}} />
          {activeSessionId && !isFullscreen && (
            <button
              type="button"
              className="fitness-session-app__end-session"
              onPointerDown={handleEndSession}
              disabled={endingSession}
              title="Force end the current session so it won't auto-merge with the next workout"
            >
              {endingSession ? 'Ending…' : 'End Session'}
            </button>
          )}
          {endError && !isFullscreen && (
            <div className="fitness-session-app__end-error" role="alert">{endError}</div>
          )}
        </div>
```

Passing `videoPlayerRef={null}` is intentional — the standalone chart has no video player, so ducking logic in `FitnessMusicPlayer` simply no-ops.

- [ ] **Step 2: Add SCSS rules**

After the existing `.fitness-session-app__chart` block, add a sibling rule:

```scss
  &__music {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 8;
    max-width: min(360px, 40%);
    pointer-events: auto;
  }
```

In the `.fullscreen-mode` block (~line 99), inside `.fitness-session-app__main { .fitness-session-app__chart { ... } }`, add:

```scss
        .fitness-session-app__music {
          display: none;
        }
```

(Music keeps playing in fullscreen — only the panel is hidden.)

- [ ] **Step 3: Run fitness suite** — `npx jest tests/unit/fitness/`. Expect green.

- [ ] **Step 4: Manual smoke** — Navigate to `/fitness/users`. Music panel renders top-left of chart even with `musicEnabled === false`. Tap play/pause works independently. Fullscreen hides panel; audio continues.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Fitness/widgets/FitnessSessionApp/FitnessSessionApp.jsx \
        frontend/src/modules/Fitness/widgets/FitnessSessionApp/FitnessSessionApp.scss
git commit -m "feat(fitness): mount persistent music player on standalone chart (F2)"
```

---

## Task 5: F3 RED — Pure helper for post-episode redirect resolver

**Files:**
- Create: `tests/unit/fitness/postEpisodeRedirect.test.mjs`

- [ ] **Step 1: Create the failing test file**

```js
// tests/unit/fitness/postEpisodeRedirect.test.mjs
import { describe, it, expect, beforeAll } from '@jest/globals';

let resolvePostEpisodeRedirect;

beforeAll(async () => {
  const mod = await import('#frontend/modules/Fitness/player/postEpisodeRedirect.js');
  resolvePostEpisodeRedirect = mod.resolvePostEpisodeRedirect;
});

describe('resolvePostEpisodeRedirect', () => {
  it('routes to the chart (users view) when a session is active', () => {
    const result = resolvePostEpisodeRedirect({ hasActiveSession: true });
    expect(result).toEqual({
      view: 'users',
      clearActiveModule: true,
      clearActiveCollection: true,
      clearSelectedShow: true,
    });
  });

  it('returns null when no session is active', () => {
    expect(resolvePostEpisodeRedirect({ hasActiveSession: false })).toBeNull();
  });

  it('treats missing input conservatively — returns null', () => {
    expect(resolvePostEpisodeRedirect({})).toBeNull();
    expect(resolvePostEpisodeRedirect()).toBeNull();
    expect(resolvePostEpisodeRedirect(null)).toBeNull();
  });

  it('coerces truthy non-boolean hasActiveSession to "active"', () => {
    expect(resolvePostEpisodeRedirect({ hasActiveSession: 'some-session-id' })?.view).toBe('users');
  });

  it('coerces 0/"" falsy hasActiveSession to "no session"', () => {
    expect(resolvePostEpisodeRedirect({ hasActiveSession: 0 })).toBeNull();
    expect(resolvePostEpisodeRedirect({ hasActiveSession: '' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect 5 failures**

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation
git add tests/unit/fitness/postEpisodeRedirect.test.mjs
git commit -m "test(fitness): failing tests for post-episode redirect resolver"
```

---

## Task 6: F3 GREEN — Implement the redirect resolver

**Files:**
- Create: `frontend/src/modules/Fitness/player/postEpisodeRedirect.js`

- [ ] **Step 1: Create the helper**

```js
/**
 * resolvePostEpisodeRedirect — pure helper deciding where the app should land
 * after a video OR voice memo completes (bug bash F3).
 *
 * @param {{ hasActiveSession?: any }} [input]
 * @returns {null | { view: 'users', clearActiveModule: true,
 *                    clearActiveCollection: true, clearSelectedShow: true }}
 */
export function resolvePostEpisodeRedirect(input) {
  if (!input || typeof input !== 'object') return null;
  if (!input.hasActiveSession) return null;
  return {
    view: 'users',
    clearActiveModule: true,
    clearActiveCollection: true,
    clearSelectedShow: true,
  };
}

export default resolvePostEpisodeRedirect;
```

- [ ] **Step 2: Run tests — 5/5 PASS**

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Fitness/player/postEpisodeRedirect.js
git commit -m "feat(fitness): add post-episode redirect resolver helper"
```

---

## Task 7: F3 — Wire the redirect into FitnessPlayer + FitnessApp

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.jsx`
- Modify: `frontend/src/Apps/FitnessApp.jsx`

- [ ] **Step 1: Import in FitnessPlayer**

```jsx
import { resolvePostEpisodeRedirect } from './postEpisodeRedirect.js';
```

- [ ] **Step 2: Add `onSessionEndRedirect` prop and call in `executeClose`**

Change line 122 signature:

```jsx
const FitnessPlayer = ({ playQueue, setPlayQueue, viewportRef, nogovern = false, onSessionEndRedirect = null }) => {
```

Replace `executeClose` (lines 901-913) with:

```jsx
  const executeClose = useCallback(() => {
    statusUpdateRef.current.endSent = true;
    postEpisodeStatus({ naturalEnd: false, reason: 'close' });

    const redirect = resolvePostEpisodeRedirect({
      hasActiveSession: Boolean(fitnessSessionInstance?.sessionId)
    });
    if (redirect && typeof onSessionEndRedirect === 'function') {
      try {
        onSessionEndRedirect(redirect);
      } catch (err) {
        console.error('[FitnessPlayer] onSessionEndRedirect failed', err);
      }
    }

    if (setQueue) {
      setQueue([]);
    }
    if (currentItem?.grandparentId && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('fitness-show-refresh', { detail: { showId: currentItem.grandparentId } }));
    }
    setCurrentItem(null);
    pendingCloseRef.current = false;
  }, [postEpisodeStatus, setQueue, currentItem?.grandparentId, fitnessSessionInstance?.sessionId, onSessionEndRedirect]);
```

`fitnessSessionInstance` should already be in scope (line 930 uses it). Confirm with: `grep -n "fitnessSessionInstance" frontend/src/modules/Fitness/player/FitnessPlayer.jsx | head -5`.

- [ ] **Step 3: Pass `onSessionEndRedirect` from FitnessApp**

Find the `<FitnessPlayer>` render at lines 1253-1258. Replace with:

```jsx
                <FitnessPlayer
                  playQueue={fitnessPlayQueue}
                  setPlayQueue={setFitnessPlayQueue}
                  viewportRef={viewportRef}
                  nogovern={nogovern}
                  onSessionEndRedirect={(redirect) => {
                    if (!redirect) return;
                    if (redirect.clearActiveModule) setActiveModule(null);
                    if (redirect.clearActiveCollection) setActiveCollection(null);
                    if (redirect.clearSelectedShow) {
                      setSelectedShow(null);
                      setSelectedEpisodeId(null);
                    }
                    setCurrentView(redirect.view);
                    if (redirect.view === 'users') {
                      navigate('/fitness/users', { replace: true });
                    }
                  }}
                />
```

(Confirm setters are in scope: `grep -n "setActiveModule\|setActiveCollection\|setSelectedShow\|setSelectedEpisodeId\|setCurrentView\|const navigate" frontend/src/Apps/FitnessApp.jsx | head -10`.)

- [ ] **Step 4: Run helper tests + fitness suite** — expect green.

- [ ] **Step 5: Manual smoke**

BEFORE: from `/fitness/show/<id>`, play episode, finish/close → land back on episode list.
AFTER: same scenario → URL changes to `/fitness/users`, chart view shown.

Voice memo: same; on completion, redirect to `/fitness/users`.

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Fitness/player/FitnessPlayer.jsx \
        frontend/src/Apps/FitnessApp.jsx
git commit -m "feat(fitness): redirect to chart after video/voice-memo ends (F3)"
```

---

## Task 8: Final verification sweep

- [ ] `npx jest tests/unit/fitness/` — all green
- [ ] Manual end-to-end of F1, F2, F3 in dev

---

## Done

- **F1 End Session button (sidebar).** New helper `endSessionRequest.js` (6 tests) + button JSX + SCSS in `FitnessSidebar`. Reuses `/api/v1/fitness/sessions/:id/end`.
- **F2 Persistent music player on standalone chart.** `<FitnessMusicPlayer>` mounted inside `FitnessSessionApp__chart` independent of `musicEnabled`. Hidden in fullscreen (audio continues).
- **F3 Post-episode chart redirect.** New helper `postEpisodeRedirect.js` (5 tests). `executeClose()` invokes `onSessionEndRedirect`; `FitnessApp` sets `currentView='users'` and navigates to `/fitness/users`. One funnel covers both video-end and voice-memo-end paths.
- **Tests:** 11 new unit tests across two helper files. UI placement (F1 button, F2 mount) verified via manual smoke + import graph resolution.
