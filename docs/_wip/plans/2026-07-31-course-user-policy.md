# Per-User Course Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Piano course viewing gets a per-user policy defined in `piano.yml`: by default the engagement gate runs (press-a-key-to-continue on sequential courses) and a finished lecture returns to the menu; user `kckern` gets no gate (passive watching permitted) and auto-advance to the next episode.

**Architecture:** A new `videos.user_policies` map in `data/household/config/piano.yml` rides the existing whole-node `videos` passthrough in `resolvePianoConfig` (PianoConfig.jsx:124) — no backend or resolver changes. A tiny `coursePolicy.js` resolves `{ engagementGate, autoAdvance }` per user. `PianoVideoPlayer` gains two props: `engagementGateEnabled` (ANDed into the gate's `isSequential`) and `onAutoAdvance` (fired once from the media element's `ended` event). `LecturePlayerRoute` (Videos.jsx) wires policy + next-lecture navigation, and guards its `goBack` against the shared Player's own end-of-content `clear` call so the two never race (Player fires `clear` when `ended` fires — see PianoVideoPlayer.jsx:126-131 comment).

**Tech Stack:** React, react-router relative navigation, vitest + @testing-library/react (jsdom, fake timers), YAML config in the Docker data volume.

## Global Constraints

- **Never edit** `frontend/src/lib/Player/`, `frontend/src/modules/Player/`, or `frontend/src/lib/keyboard/`.
- **Do not touch `resolvePianoConfig`** (PianoConfig.jsx) — the `videos` node already passes through whole; adding keys there is unnecessary and out of scope.
- **No raw `console.*`** — logging via `getLogger().child(...)`, events at `info`.
- **Run vitest from `frontend/`** with `./node_modules/.bin/vitest run <paths>`.
- **Working directory:** git worktree `/opt/Code/DaylightStation/.claude/worktrees/sheetmusic-wave3`. Task 1 Step 1 creates branch `feature/course-user-policy` from current HEAD. Before EVERY commit: `git rev-parse --show-toplevel && git branch --show-current` must show the worktree and that branch. Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Policy semantics (the spec):** default = `{ engagementGate: true, autoAdvance: false }`. A `videos.user_policies.<userId>` entry may set `engagement_gate: false` and/or `auto_advance: true`. Only the gate is affected — sequential lecture locking and the seek-forward lock are NOT changed by this feature.
- **YAML lives in the data volume** (`data/household/config/piano.yml` inside the container) — never write it with `sed -i`; use line-anchored insertion via a temp file (Task 4).
- **Deploy gate (Task 4) must HALT as its own step** — never chain the gate check with `docker stop`/`rm`/`deploy-daylight`.

---

### Task 1: `coursePolicy.js` — policy + next-lecture helpers

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/coursePolicy.js`
- Create (test): `frontend/src/modules/Piano/PianoKiosk/modes/Videos/coursePolicy.test.js`

**Interfaces:**
- Produces: `resolveCoursePolicy(videosConfig, userId)` → `{ engagementGate: boolean, autoAdvance: boolean }` (defaults true/false; tolerates null/undefined config and user). `nextLectureAfter(items, currentLectureId)` → the next item after the current one (matched via `lectureContentId`) that itself has a playable contentId, or `null` at end-of-course / when the current id isn't found. Tasks 2–3 consume both.

- [ ] **Step 1: Create the branch, then write the failing tests**

```bash
cd /opt/Code/DaylightStation/.claude/worktrees/sheetmusic-wave3 && git checkout -b feature/course-user-policy
```

Create `coursePolicy.test.js`:

```js
// coursePolicy.test.js — per-user course policy resolution + auto-advance target.
import { describe, it, expect } from 'vitest';
import { resolveCoursePolicy, nextLectureAfter } from './coursePolicy.js';

describe('resolveCoursePolicy', () => {
  const cfg = {
    user_policies: {
      kckern: { engagement_gate: false, auto_advance: true },
      learner4: { engagement_gate: true },
    },
  };

  it('defaults: gate on, no auto-advance', () => {
    expect(resolveCoursePolicy(cfg, 'learner3')).toEqual({ engagementGate: true, autoAdvance: false });
  });

  it('kckern: gate off, auto-advance on', () => {
    expect(resolveCoursePolicy(cfg, 'kckern')).toEqual({ engagementGate: false, autoAdvance: true });
  });

  it('partial entry only overrides what it names', () => {
    expect(resolveCoursePolicy(cfg, 'learner4')).toEqual({ engagementGate: true, autoAdvance: false });
  });

  it('tolerates missing config and missing user', () => {
    expect(resolveCoursePolicy(null, 'kckern')).toEqual({ engagementGate: true, autoAdvance: false });
    expect(resolveCoursePolicy({}, null)).toEqual({ engagementGate: true, autoAdvance: false });
  });
});

describe('nextLectureAfter', () => {
  const items = [
    { plex: '100', label: 'One' },
    { plex: '101', label: 'Two' },
    { label: 'Broken (no id)' },
    { plex: '103', label: 'Four' },
  ];

  it('returns the next item in delivered order', () => {
    expect(nextLectureAfter(items, 'plex:100')?.plex).toBe('101');
  });

  it('skips items without a playable contentId', () => {
    expect(nextLectureAfter(items, 'plex:101')?.plex).toBe('103');
  });

  it('returns null at the end of the course', () => {
    expect(nextLectureAfter(items, 'plex:103')).toBe(null);
  });

  it('returns null when the current lecture is not in the list or the list is empty', () => {
    expect(nextLectureAfter(items, 'plex:999')).toBe(null);
    expect(nextLectureAfter(null, 'plex:100')).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && ./node_modules/.bin/vitest run src/modules/Piano/PianoKiosk/modes/Videos/coursePolicy.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `coursePolicy.js`**

```js
// coursePolicy.js — per-user course-viewing policy (piano.yml videos.user_policies).
//
// House default is the strict one: the engagement gate runs on sequential
// courses, and a finished lecture returns to the menu. A per-user entry can
// relax either — engagement_gate: false permits passive watching (no
// play-a-note prompt), auto_advance: true rolls a finished lecture straight
// into the next episode. Only the gate/end behavior is per-user; sequential
// locking and the seek-forward lock are untouched.
import { lectureContentId } from './lectureMeta.js';

export function resolveCoursePolicy(videosConfig, userId) {
  const entry = (userId && videosConfig?.user_policies?.[userId]) || {};
  return {
    engagementGate: entry.engagement_gate !== false,
    autoAdvance: entry.auto_advance === true,
  };
}

/**
 * The lecture auto-advance lands on: the next item after `currentLectureId`
 * (in the course's delivered order) that has a playable contentId, or null at
 * the end. In a sequential course the next linear episode is exactly the one
 * that finishing the current lecture unlocks, so this never jumps a lock.
 */
export function nextLectureAfter(items, currentLectureId) {
  const list = Array.isArray(items) ? items : [];
  const idx = list.findIndex((l) => String(lectureContentId(l)) === String(currentLectureId));
  if (idx < 0) return null;
  for (let i = idx + 1; i < list.length; i += 1) {
    if (lectureContentId(list[i])) return list[i];
  }
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && ./node_modules/.bin/vitest run src/modules/Piano/PianoKiosk/modes/Videos/coursePolicy.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git rev-parse --show-toplevel && git branch --show-current  # worktree + feature/course-user-policy
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/coursePolicy.js \
        frontend/src/modules/Piano/PianoKiosk/modes/Videos/coursePolicy.test.js
git commit -m "feat(piano): coursePolicy — per-user gate/auto-advance resolution + next-lecture pick

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: PianoVideoPlayer — `engagementGateEnabled` + `onAutoAdvance`

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx`
- Create (test): `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.policy.test.jsx`

**Interfaces:**
- Consumes: nothing new (policy resolution happens in Task 3's route).
- Produces: `<PianoVideoPlayer engagementGateEnabled={bool} onAutoAdvance={fn|null} …>`. `engagementGateEnabled` defaults `true`; `false` prevents the gate from ever opening (gate's `isSequential` input becomes `isSequential && engagementGateEnabled`). `onAutoAdvance`, when provided, fires exactly once per lecture from the media `ended` event; when null/omitted, `ended` behaves exactly as today (the shared Player's own end-of-content `clear` handles the exit).

- [ ] **Step 1: Write the failing tests**

Create `PianoVideoPlayer.policy.test.jsx` (harness mirrors `PianoVideoPlayer.resume.test.jsx` — same context mocks and Player stub):

```jsx
// PianoVideoPlayer.policy.test.jsx — per-user policy hooks on the lecture player:
// engagementGateEnabled=false must keep the anti-AFK gate closed forever, and
// onAutoAdvance must fire exactly once from the media `ended` event.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import PianoVideoPlayer from './PianoVideoPlayer.jsx';

const midiState = { activeNotes: new Map(), pressNote: vi.fn(), releaseNote: vi.fn() };
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => midiState,
  usePianoMidiNotes: () => midiState,
}));
vi.mock('../../PianoPlaybackContext.jsx', () => ({
  usePianoPlayback: () => ({ setPlaying: vi.fn(), setVideoActive: vi.fn(), playing: false, videoActive: false }),
}));
vi.mock('../../PianoMixContext.jsx', () => ({
  usePianoMix: () => ({ mediaLevel: 1, setMediaLevel: vi.fn() }),
}));
vi.mock('../../PianoBreadcrumbContext.jsx', () => ({ usePianoBreadcrumb: () => {} }));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: 'user_1' }) }));
vi.mock('../../../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({}) }));

let fakeMedia = null;
vi.mock('../../../../Player/Player.jsx', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    default: forwardRef((props, ref) => {
      useImperativeHandle(ref, () => ({
        getMediaElement: () => fakeMedia,
        getCurrentTime: () => fakeMedia?.currentTime || 0,
        getDuration: () => fakeMedia?.duration || 0,
        play: vi.fn(),
        pause: vi.fn(),
        toggle: vi.fn(),
        seek: vi.fn(),
      }), []);
      return <div data-testid="player-stub" />;
    }),
  };
});

const lecture = { plex: '243203', label: 'Lecture 3', userWatched: false, userPlayhead: 0 };

beforeEach(() => {
  fakeMedia = document.createElement('video');
});
afterEach(() => { vi.useRealTimers(); });

const gateQuery = () => screen.queryByText(/Still there\?/i);

describe('PianoVideoPlayer — per-user policy', () => {
  it('engagementGateEnabled=false keeps the gate closed on a sequential lecture', async () => {
    vi.useFakeTimers();
    render(
      <PianoVideoPlayer
        lecture={lecture}
        source="Course"
        onBack={vi.fn()}
        isSequential
        engagementTimeoutSeconds={90}
        engagementGateEnabled={false}
      />,
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(gateQuery()).toBe(null);
  });

  it('the gate still opens by default (control)', async () => {
    vi.useFakeTimers();
    render(
      <PianoVideoPlayer
        lecture={lecture}
        source="Course"
        onBack={vi.fn()}
        isSequential
        engagementTimeoutSeconds={90}
      />,
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(gateQuery()).not.toBe(null);
  });

  it('onAutoAdvance fires exactly once from the media ended event', async () => {
    const onAutoAdvance = vi.fn();
    render(
      <PianoVideoPlayer
        lecture={lecture}
        source="Course"
        onBack={vi.fn()}
        onAutoAdvance={onAutoAdvance}
      />,
    );
    await screen.findByTestId('player-stub');
    await act(async () => { fakeMedia.dispatchEvent(new Event('ended')); });
    await act(async () => { fakeMedia.dispatchEvent(new Event('ended')); });
    expect(onAutoAdvance).toHaveBeenCalledTimes(1);
  });

  it('ended without onAutoAdvance is a no-op (no crash)', async () => {
    render(<PianoVideoPlayer lecture={lecture} source="Course" onBack={vi.fn()} />);
    await screen.findByTestId('player-stub');
    await act(async () => { fakeMedia.dispatchEvent(new Event('ended')); });
    expect(screen.getByTestId('player-stub')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd frontend && ./node_modules/.bin/vitest run src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.policy.test.jsx`
Expected: FAIL — `engagementGateEnabled=false` test fails (gate opens anyway) and the onAutoAdvance test fails (never called). The control and no-op tests may already pass. NOTE: `useResolvedMediaEl` polls for the media element — if `findByTestId` alone leaves `mediaEl` unresolved under fake timers, advance timers briefly (`await vi.advanceTimersByTimeAsync(2_000)` inside act) before dispatching `ended`; apply the same warm-up in Step 1's tests before the long advance.

- [ ] **Step 3: Implement in PianoVideoPlayer.jsx**

3a. Signature:

```jsx
export default function PianoVideoPlayer({ lecture, source, onBack, isSequential = false, engagementTimeoutSeconds = 90, engagementGateEnabled = true, onAutoAdvance = null }) {
```

3b. Gate wiring — in the existing `useEngagementGate({...})` call, change the `isSequential` line to:

```jsx
    // Per-user policy (piano.yml videos.user_policies): a user with
    // engagement_gate:false watches passively — the anti-AFK gate never opens.
    isSequential: isSequential && engagementGateEnabled,
```

3c. Auto-advance — add refs near the other refs (below `engagedRef`):

```jsx
  // Per-user auto-advance: fire once per lecture from the `ended` event. The
  // shared Player ALSO reacts to `ended` (its end-of-content advance calls
  // `clear` → onBack); the route's goBack ignores that call while an
  // auto-advance navigation is in flight (see Videos.jsx LecturePlayerRoute).
  const onAutoAdvanceRef = useRef(onAutoAdvance);
  onAutoAdvanceRef.current = onAutoAdvance;
  const endedHandledRef = useRef(false);
  useEffect(() => { endedHandledRef.current = false; }, [contentId]);
```

(place AFTER `const contentId = lectureContentId(lecture);` so `contentId` is in scope).

3d. In the existing "Mirror media-element state into React" effect, add alongside the other handlers:

```jsx
    const onEnded = () => {
      if (!onAutoAdvanceRef.current || endedHandledRef.current) return;
      endedHandledRef.current = true;
      getLogger().child({ component: 'piano-video-player' }).info('piano.video.auto-advance', { contentId });
      onAutoAdvanceRef.current();
    };
```

with `mediaEl.addEventListener('ended', onEnded);` and the matching `removeEventListener` in the cleanup. NOTE: `contentId` is referenced inside the effect — add it to that effect's dependency array (`[mediaEl, contentId]`).

- [ ] **Step 4: Run the policy + resume suites**

Run: `cd frontend && ./node_modules/.bin/vitest run src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.policy.test.jsx src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.resume.test.jsx`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git rev-parse --show-toplevel && git branch --show-current
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx \
        frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.policy.test.jsx
git commit -m "feat(piano): PianoVideoPlayer policy props — gate disable + once-only ended advance

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: LecturePlayerRoute wiring — policy, next lecture, race-guarded goBack

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.jsx`
- Create (test): `frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.policy.test.jsx`

**Interfaces:**
- Consumes: Task 1's `resolveCoursePolicy`/`nextLectureAfter`; Task 2's player props.
- Produces: `LecturePlayerRoute` becomes an exported function (currently module-private) so it is directly testable; passes `engagementGateEnabled` and `onAutoAdvance` per the current user's policy.

- [ ] **Step 1: Write the failing tests**

Create `Videos.policy.test.jsx`:

```jsx
// Videos.policy.test.jsx — LecturePlayerRoute wires the per-user course policy:
// gate flag + auto-advance callback reach the player, auto-advance navigates to
// the next lecture, and the shared Player's racing end-clear (onBack fired in
// the same tick) must NOT yank the user back to the course menu.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { LecturePlayerRoute } from './Videos.jsx';

const state = {
  user: 'kckern',
  config: {
    videos: {
      engagement_timeout_seconds: 90,
      user_policies: { kckern: { engagement_gate: false, auto_advance: true } },
    },
  },
  playable: {
    items: [
      { plex: '100', label: 'One' },
      { plex: '101', label: 'Two' },
    ],
    info: { title: 'Test Course' },
    isSequential: true,
  },
};

vi.mock('../../PianoConfig.jsx', () => ({ usePianoKioskConfig: () => ({ config: state.config }) }));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: state.user }) }));
vi.mock('./usePianoCoursePlayable.js', () => ({ usePianoCoursePlayable: () => state.playable }));
vi.mock('../../PianoPlaybackContext.jsx', () => ({ usePianoPlayback: () => ({ playing: false }) }));
vi.mock('../../usePianoScreensaver.jsx', () => ({ useKeepScreenAwake: () => {} }));

function StubPlayer({ lecture, onBack, engagementGateEnabled, onAutoAdvance }) {
  return (
    <div>
      <div data-testid="lecture">{lecture.label}</div>
      <div data-testid="gate-enabled">{String(engagementGateEnabled)}</div>
      <div data-testid="has-advance">{String(Boolean(onAutoAdvance))}</div>
      <button type="button" onClick={() => onAutoAdvance?.()}>advance</button>
      {/* Simulates the production race: media `ended` triggers our advance AND
          the shared Player's end-of-content clear (onBack) in the same tick. */}
      <button type="button" onClick={() => { onAutoAdvance?.(); onBack(); }}>ended-race</button>
      <button type="button" onClick={onBack}>back</button>
    </div>
  );
}

const renderAt = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/videos/:courseId" element={<div data-testid="course-detail" />} />
      <Route path="/videos/:courseId/:lectureId" element={<LecturePlayerRoute PlayerComponent={StubPlayer} />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  state.user = 'kckern';
});

describe('LecturePlayerRoute — per-user policy wiring', () => {
  it('kckern gets gate disabled and an auto-advance callback', () => {
    renderAt('/videos/c1/plex:100');
    expect(screen.getByTestId('gate-enabled').textContent).toBe('false');
    expect(screen.getByTestId('has-advance').textContent).toBe('true');
  });

  it('a default user gets the gate and no auto-advance', () => {
    state.user = 'learner3';
    renderAt('/videos/c1/plex:100');
    expect(screen.getByTestId('gate-enabled').textContent).toBe('true');
    expect(screen.getByTestId('has-advance').textContent).toBe('false');
  });

  it('auto-advance navigates to the next lecture', () => {
    renderAt('/videos/c1/plex:100');
    fireEvent.click(screen.getByText('advance'));
    expect(screen.getByTestId('lecture').textContent).toBe('Two');
  });

  it('the Player’s racing end-clear cannot yank the user back during an auto-advance', () => {
    renderAt('/videos/c1/plex:100');
    fireEvent.click(screen.getByText('ended-race'));
    expect(screen.queryByTestId('course-detail')).toBe(null);
    expect(screen.getByTestId('lecture').textContent).toBe('Two');
  });

  it('on the LAST lecture, auto-advance falls back to the course menu', () => {
    renderAt('/videos/c1/plex:101');
    fireEvent.click(screen.getByText('advance'));
    expect(screen.getByTestId('course-detail')).toBeTruthy();
  });

  it('a plain back tap still leaves normally', () => {
    renderAt('/videos/c1/plex:100');
    fireEvent.click(screen.getByText('back'));
    expect(screen.getByTestId('course-detail')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && ./node_modules/.bin/vitest run src/modules/Piano/PianoKiosk/modes/Videos/Videos.policy.test.jsx`
Expected: FAIL — `LecturePlayerRoute` is not exported (import is undefined).

- [ ] **Step 3: Wire the route**

In `Videos.jsx`:

3a. Imports: extend the react import to `import { useMemo, useCallback, useRef, useEffect } from 'react';` and add:

```jsx
import { resolveCoursePolicy, nextLectureAfter } from './coursePolicy.js';
```

3b. Export the route: change `function LecturePlayerRoute({ PlayerComponent = PianoVideoPlayer }) {` to `export function LecturePlayerRoute({ PlayerComponent = PianoVideoPlayer }) {`.

3c. Inside `LecturePlayerRoute`, replace the existing `goBack` definition with:

```jsx
  // Per-user course policy (piano.yml videos.user_policies): gate on/off and
  // end-of-lecture behavior.
  const policy = useMemo(() => resolveCoursePolicy(config.videos, currentUser), [config, currentUser]);
  const nextLecture = useMemo(() => nextLectureAfter(lectures, lectureId), [lectures, lectureId]);

  // The shared Player reacts to `ended` too — its end-of-content advance calls
  // clear → this goBack. While an auto-advance navigation is in flight that
  // call must be a no-op, or the user gets yanked to the menu instead of the
  // next episode. The flag resets once the route lands on the new lecture.
  const advancingRef = useRef(false);
  useEffect(() => { advancingRef.current = false; }, [lectureId]);

  // Stable so PianoVideoPlayer can memoize the heavy Player element on it
  // (an unstable onBack would defeat the memo and remount the video).
  const goBack = useCallback(() => {
    if (advancingRef.current) return;
    navigate('..', { relative: 'path' });
  }, [navigate]);

  const handleAutoAdvance = useCallback(() => {
    if (!nextLecture) {
      getLogger().child({ component: 'piano-videos' }).info('piano.video.auto-advance-end-of-course', { courseId });
      navigate('..', { relative: 'path' });
      return;
    }
    advancingRef.current = true;
    const nextId = lectureContentId(nextLecture);
    getLogger().child({ component: 'piano-videos' }).info('piano.video.auto-advance-next', { from: lectureId, to: nextId });
    navigate(`../${nextId}`, { relative: 'path' });
  }, [nextLecture, navigate, lectureId, courseId]);
```

3d. Pass the props at the bottom of the route:

```jsx
  return (
    <PlayerComponent
      lecture={lecture}
      source={source}
      onBack={goBack}
      isSequential={isSequential}
      engagementTimeoutSeconds={config.videos?.engagement_timeout_seconds ?? 90}
      engagementGateEnabled={policy.engagementGate}
      onAutoAdvance={policy.autoAdvance ? handleAutoAdvance : null}
    />
  );
```

- [ ] **Step 4: Run the policy + full Videos suites**

Run: `cd frontend && ./node_modules/.bin/vitest run src/modules/Piano/PianoKiosk/modes/Videos/`
Expected: ALL PASS (the new suites plus every pre-existing Videos-mode test).

- [ ] **Step 5: Run the Singalong suites (SingalongPlayer shares this route via PlayerComponent)**

Run: `cd frontend && ./node_modules/.bin/vitest run src/modules/Piano/PianoKiosk/modes/Singalong/`
Expected: ALL PASS — SingalongPlayer simply ignores the two new props (karaoke has no gate; its own end behavior is unchanged because `source`-backed flows pass `PlayerComponent={SingalongPlayer}` and the singalong config carries no `user_policies`, so `onAutoAdvance` is null).

- [ ] **Step 6: Commit**

```bash
git rev-parse --show-toplevel && git branch --show-current
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.jsx \
        frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.policy.test.jsx
git commit -m "feat(piano): per-user course policy wired — gate flag, auto-advance nav, race-guarded back

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: piano.yml policy entry, merge, deploy, verify

**Files:**
- Modify (data volume, inside container): `data/household/config/piano.yml`
- Modify (main checkout): merge `feature/course-user-policy` into main; record + delete branch.

- [ ] **Step 1: Insert the YAML (line-anchored, via temp file — NEVER `sed -i` structural edits)**

```bash
sudo docker exec daylight-station sh -c '
awk "{print} /^  engagement_timeout_seconds: 90$/ && !done {done=1; print \"  # ── Per-user course policy ──────────────────────────────────────\"; print \"  # Keys are kiosk user ids. Everyone else gets the defaults: the\"; print \"  # engagement gate runs on sequential courses, and a finished lecture\"; print \"  # returns to the course menu.\"; print \"  #   engagement_gate: false  -> passive watching permitted (no gate)\"; print \"  #   auto_advance: true      -> a finished lecture rolls into the next\"; print \"  user_policies:\"; print \"    kckern:\"; print \"      engagement_gate: false\"; print \"      auto_advance: true\"}" \
  data/household/config/piano.yml > /tmp/piano.yml.new \
&& grep -c "user_policies" /tmp/piano.yml.new \
&& cp /tmp/piano.yml.new data/household/config/piano.yml'
```

Expected: prints `1` (the key was inserted exactly once). Verify the block landed inside the `videos:` node with correct 2-space indent:

```bash
sudo docker exec daylight-station sh -c 'grep -n -B2 -A6 "user_policies" data/household/config/piano.yml'
```

Expected: the block sits directly after `engagement_timeout_seconds: 90`, `user_policies:` at 2-space indent, `kckern:` at 4, flags at 6.

- [ ] **Step 2: Merge into main**

```bash
git -C /opt/Code/DaylightStation pull --ff-only
git -C /opt/Code/DaylightStation merge --no-edit feature/course-user-policy
git -C /opt/Code/DaylightStation log --oneline -3
```

- [ ] **Step 3: Build the Docker image**

`cd /opt/Code/DaylightStation && ./scripts/build-daylight.sh` (NOT under `sudo`). Expected: `naming to docker.io/kckern/daylight-station:latest done`.

- [ ] **Step 4: Deploy gate — its own halting step**

```bash
sudo docker logs --since 75s daylight-station 2>&1 | grep -c '"event":"playback.render_fps"'
sudo docker logs --since 75s daylight-station 2>&1 | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
```

Clear ONLY IF: render_fps count 0, no `videoState:"playing"`, `sessionActive:false`, `rosterSize:0`. If active, WAIT and re-check. Never chain with the deploy commands.

- [ ] **Step 5: Deploy (only after Step 4 is clear) and confirm**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

```bash
until curl -s -m 3 http://localhost:3111/build.txt | grep -q Commit; do sleep 2; done; curl -s http://localhost:3111/build.txt
```

Expected: `Commit:` ends with the Step 2 merge SHA. (The restart also reloads the cached piano.yml — no separate reload needed.)

- [ ] **Step 6: Verify the policy is served**

```bash
curl -s http://localhost:3111/api/v1/admin/apps/piano/config | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d['parsed']['videos'].get('user_policies'), indent=1))"
```

Expected: prints the `kckern` entry with `engagement_gate: false`, `auto_advance: true`. (The endpoint returns `{appId, configPath, raw, parsed, …}` — the YAML lives under `parsed`; a `null` here means the YAML edit didn't land, not that the endpoint shape changed.)

- [ ] **Step 7: Branch cleanup + push**

Append to `/opt/Code/DaylightStation/docs/_archive/deleted-branches.md`:

```markdown
| 2026-07-31 | feature/course-user-policy | <task-3 commit sha> | per-user course policy (engagement gate opt-out + auto-advance) |
```

```bash
git -C /opt/Code/DaylightStation add docs/_archive/deleted-branches.md
git -C /opt/Code/DaylightStation commit -m "docs: record merged course-user-policy branch

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git -C /opt/Code/DaylightStation/.claude/worktrees/sheetmusic-wave3 checkout --detach
git -C /opt/Code/DaylightStation branch -d feature/course-user-policy
git -C /opt/Code/DaylightStation push
```

- [ ] **Step 8: Report**

State: deployed SHA, the served `user_policies` JSON, and the behavior contract — kckern opens any course lecture: no "Still there?" gate ever, and a finished episode rolls into the next one (menu return only after the last episode). Everyone else: unchanged. Piano tablet picks the change up on next reload. Live end-to-end confirmation is a manual step for the user (watch a lecture end as kckern).

---

## Self-Review

- **Spec coverage:** YAML definition (Task 4 Step 1) ✓; config handler — rides the existing `videos` whole-node passthrough, verified served (Task 4 Step 6) ✓; default = gate + menu-return (policy defaults, control tests) ✓; kckern = no gate (Task 2 gate-disable + Task 3 wiring tests) + auto-advance (Task 2 ended-once + Task 3 navigation tests, end-of-course fallback) ✓; Player untouched, race with its end-clear guarded and tested ✓.
- **Placeholder scan:** all code verbatim; the one adaptive step (Task 4 Step 6 response shape) states the exact assertion to hold.
- **Type consistency:** `resolveCoursePolicy → { engagementGate, autoAdvance }` matches Task 3's `policy.engagementGate`/`policy.autoAdvance`; `nextLectureAfter(items, lectureId)` matches the route's `lectures`/`lectureId`; player props `engagementGateEnabled`/`onAutoAdvance` identical across Tasks 2 and 3; `lectureContentId` used for both the URL segment and the next-lecture match, as the route already does.
