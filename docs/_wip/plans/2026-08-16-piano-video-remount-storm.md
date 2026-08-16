# Piano Video Remount Storm — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop the piano video player from remounting itself in an endless loop that spawns hundreds of Plex transcode sessions and leaves orphaned dash.js players streaming overlapping audio.

**Architecture:** Four independent defects compound into one failure. Fix the trigger (an unstable `play` prop in the piano player), the amplifier (media identity keyed on object identity instead of content), the missing brake (no rate limit on remounts), and the leak (dash cleanup wired to the wrong lifecycle). Each is a small, separately testable change; the first two alone stop the storm, the last two make it impossible for any future identity churn to reach Plex or double the audio.

**Tech Stack:** React 18, vitest + @testing-library/react (jsdom), dash.js via `dash-video-element`, Plex DASH transcode over the backend proxy.

---

## Evidence (2026-08-16, piano kiosk, test-user, lecture `plex:694719` "Introduction to Singing")

| Observation | Source |
|---|---|
| Video never played: overlay stuck `Starting…/Loading…` with `el:t=0` for 3m22s | `playback.overlay-summary`, 11:32:38→11:35:35 |
| Two audio tracks at once: two Plex transcode sessions served the same audio segment 86 ms apart | Plex log, `…/0e4fb446-…/1/9.m4s` 200 144117 bytes and `…/5d2e681e-…/1/9.m4s` at 11:32:59 |
| 495 distinct Plex session identifiers in 4 minutes; 73–93 `start.mpd` per minute | Plex log 11:33–11:36 |
| Storm continued with nothing playing (449 more `start.mpd` in 11:37–11:49) | Plex log |
| Retry backoff never escalated — every `playback.player-remount` logged `remountNonce: 0, attempt: 1` with a **different** `guid` | frontend log |

**Confirmed by probe (2026-08-16):** rendering `PianoVideoPlayer` and swapping the media element 3 times handed the shared `Player` **4 distinct `play` objects**. That is the loop.

### The loop

```
Player mounts → creates <dash-video> element E1
  → useResolvedMediaEl polls (100ms) and publishes mediaEl = E1
  → handlePlayerClear identity changes (it depends on mediaEl)
  → the memoized playerEl rebuilds → NEW inline play={{...}} object
  → Player: activeSource identity changed → ensureEntryGuid WeakMap MISS → new random guid
  → singlePlayerKey = `${guid}:${nonce}` changes → SinglePlayer REMOUNTS
  → new <dash-video> E2 → new Plex transcode session ─┐
                                                       │
  ←────────────────── mediaEl = E2, repeat ────────────┘
```

### The four defects

| ID | File | Defect |
|---|---|---|
| **D1** | `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx:131-134,140-154` | `handlePlayerClear` depends on `mediaEl`, so the memoized `playerEl` — and the inline `play={{…}}` literal inside it — is rebuilt on every media-element swap. Starts the loop. |
| **D2** | `frontend/src/modules/Player/Player.jsx:34-45,188-192` | `currentMediaGuid` comes from `ensureEntryGuid`, a WeakMap keyed on **object identity**. An equivalent-but-new `play` object mints a fresh random guid → `singlePlayerKey` changes → full remount. It also resets `remountState.nonce` to 0 (line 289), which defeats the exponential backoff and the 5-attempt cap. Amplifies the loop. |
| **D3** | `frontend/src/modules/Player/Player.jsx` (no such code) | Nothing rate-limits remounts. Any identity churn reaches Plex at render speed. |
| **D4** | `frontend/src/modules/Player/renderers/VideoPlayer.jsx:409-412` | The `cleanupDashElement` effect has `[]` deps, so it captures only the **first** `<dash-video>` and never re-runs when the element's React key (`${mediaUrl}:${bitrate}:${elementKey}`) changes. Every later element generation leaks a live dash.js `MediaPlayer` that keeps fetching audio segments. Produces the echo. |

`cleanupDashElement` (`frontend/src/modules/Player/lib/dashCleanup.js`) is already correct — it calls `api.destroy()`, pauses the inner media, and clears `src`. Only its wiring is wrong. `dash-video-element` has **no** `disconnectedCallback` (verified: 0 occurrences in `frontend/node_modules/dash-video-element/dist/dash-video-element.js`), so nothing else tears the player down.

---

## Task 0: Worktree off `origin/main`

Local `main` is 9 commits behind `origin/main`, and the working tree holds unrelated Piano game-chrome work. The homeserver deploy tree is an ancestor of `origin/main`, so `origin/main` is the single source of truth. All four target files are byte-identical between local `HEAD` and `origin/main`, so the analysis above holds at the tip.

**Step 1: Create the worktree**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
git fetch origin
git worktree add .worktrees/piano-remount-storm -b fix/piano-video-remount-storm origin/main
ln -s "$(pwd)/node_modules" .worktrees/piano-remount-storm/node_modules 2>/dev/null || true
```

**Step 2: Confirm the baseline is green**

```bash
cd .worktrees/piano-remount-storm
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/ frontend/src/modules/Player/
```
Expected: all pass. Record the file/test counts — Task 6 compares against them.

> All later commands assume cwd = `.worktrees/piano-remount-storm`.
> Note: `npx vitest run <path>` works; do **not** pass `--reporter=basic` (it fails to load in this repo).

---

## Task 1: Stabilize the `play` prop (D1)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.remount.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx:131-134,140-154`

**Step 1: Write the failing test**

Mirrors the mocking style of the sibling `PianoVideoPlayer.resume.test.jsx`.

```jsx
// PianoVideoPlayer.remount.test.jsx
//
// Regression coverage for the 2026-08-16 remount storm. `handlePlayerClear`
// depended on the polled media element, so every element swap rebuilt the
// memoized player element and handed the shared Player a brand-new `play`
// object. The Player keys its media identity on that object, so each new
// object remounted the video and opened another Plex transcode session —
// which produced another element swap. 495 Plex sessions in 4 minutes.
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

const apiMock = vi.fn().mockResolvedValue({});
vi.mock('../../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

// Player stub: records the `play` prop object identity on every render and
// hands back whatever element the test currently declares as the media el.
let fakeMedia = null;
const playPropSpy = vi.fn();
vi.mock('../../../../Player/Player.jsx', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    default: forwardRef(({ play }, ref) => {
      playPropSpy(play);
      useImperativeHandle(ref, () => ({
        getMediaElement: () => fakeMedia,
        getCurrentTime: () => 0,
        getDuration: () => 0,
        play: vi.fn(), pause: vi.fn(), toggle: vi.fn(), seek: vi.fn(),
      }), []);
      return <div data-testid="player-stub" />;
    }),
  };
});

beforeEach(() => {
  playPropSpy.mockClear();
  fakeMedia = null;
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

describe('PianoVideoPlayer — play prop identity', () => {
  it('hands the Player ONE `play` object across repeated media-element swaps', async () => {
    const lecture = { plex: '694719', label: 'Introduction to Singing', userPlayhead: 0 };
    render(<PianoVideoPlayer lecture={lecture} source="Course" onBack={vi.fn()} />);
    await screen.findByTestId('player-stub');

    // useResolvedMediaEl polls every 100ms; three swaps = what three remounts
    // would produce in production.
    for (let i = 0; i < 3; i += 1) {
      fakeMedia = document.createElement('video');
      await act(async () => { vi.advanceTimersByTime(150); });
    }

    const identities = new Set(playPropSpy.mock.calls.map((c) => c[0]));
    expect(identities.size).toBe(1);
  });

  it('still carries the right content and resume directive', async () => {
    const lecture = { plex: '694719', label: 'Introduction to Singing', userPlayhead: 42 };
    render(<PianoVideoPlayer lecture={lecture} source="Course" onBack={vi.fn()} />);
    await screen.findByTestId('player-stub');

    const play = playPropSpy.mock.calls.at(-1)[0];
    expect(play).toMatchObject({ contentId: 'plex:694719', seconds: 42, resume: false });
  });
});
```

**Step 2: Run it and verify it fails**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.remount.test.jsx
```
Expected: first test FAILS with `expected 4 to be 1`. Second test PASSES.

**Step 3: Make `handlePlayerClear` stable**

In `PianoVideoPlayer.jsx`, replace the `handlePlayerClear` definition (currently lines 131-134) with a ref-backed version. The file already uses this pattern for `onAutoAdvanceRef` (lines 94-95), so follow it.

Add the ref next to the existing `mediaEl` destructure (after line 38):

```jsx
  // Read through a ref, not a dep: `mediaEl` is republished by the 100ms poll
  // on every element swap, and a [mediaEl] dep on the clear callback rebuilds
  // the memoized player element below — which hands Player a new `play` object
  // and remounts the video. That loop is self-sustaining (2026-08-16 storm).
  const mediaElRef = useRef(null);
  mediaElRef.current = mediaEl;
```

Then:

```jsx
  const handlePlayerClear = useCallback(() => {
    if (mediaElRef.current?.ended && onAutoAdvanceRef.current) return;
    onBack();
  }, [onBack]);
```

**Step 4: Hoist the `play` object out of the memoized element**

Still in `PianoVideoPlayer.jsx`, add above `playerEl` (before current line 140):

```jsx
  // Own memo, keyed ONLY on content. The Player derives its media identity from
  // this object; a fresh object for the same lecture remounts the video and
  // opens a new Plex transcode session, so its identity must not ride along
  // with anything render-frequency.
  const playSpec = useMemo(
    () => ({ contentId, shader: 'focused', seconds: resumeSeconds, resume: false }),
    [contentId, resumeSeconds]
  );
```

And in `playerEl`, replace the inline literal with `playSpec` and update the deps:

```jsx
        <Player ref={playerRef} play={playSpec} clear={handlePlayerClear} />
```
```jsx
  ), [playSpec, handlePlayerClear, onBack]);
```

Leave the existing explanatory comment block above `<Player>` in place.

**Step 5: Run the test to verify it passes**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.remount.test.jsx
```
Expected: 2 passed.

**Step 6: Run the whole Videos suite for regressions**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/
```
Expected: all pass.

**Step 7: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx \
        frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.remount.test.jsx
git commit -m "fix(piano): a polled element swap no longer rebuilds the play prop

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Derive media identity from content, not object identity (D2)

Task 1 fixes one caller. This fixes the trap itself: every consumer that passes an inline `play={{…}}` literal is currently a remount landmine.

**Files:**
- Modify: `frontend/src/modules/Player/utils/mediaIdentity.js`
- Create: `frontend/src/modules/Player/utils/mediaIdentity.test.js`
- Modify: `frontend/src/modules/Player/Player.jsx:34-45,188-192`

**Step 1: Write the failing unit test**

```js
// mediaIdentity.test.js
import { describe, it, expect } from 'vitest';
import { resolveSourceContentKey } from './mediaIdentity.js';

describe('resolveSourceContentKey', () => {
  it('gives two equivalent-but-distinct source objects the same key', () => {
    const a = { contentId: 'plex:694719', shader: 'focused', seconds: 0, resume: false };
    const b = { contentId: 'plex:694719', shader: 'focused', seconds: 0, resume: false };
    expect(a).not.toBe(b);
    expect(resolveSourceContentKey(a)).toBe(resolveSourceContentKey(b));
  });

  it('gives different content different keys', () => {
    expect(resolveSourceContentKey({ contentId: 'plex:694719' }))
      .not.toBe(resolveSourceContentKey({ contentId: 'plex:694720' }));
  });

  it('prefers an explicit guid over every other field', () => {
    expect(resolveSourceContentKey({ guid: 'abc', contentId: 'plex:1' })).toBe('guid:abc');
  });

  it('falls back through the identity fields the Player already understands', () => {
    expect(resolveSourceContentKey({ plex: '694719' })).toBe('plex:694719');
    expect(resolveSourceContentKey({ mediaUrl: '/x.mp4' })).toBe('mediaUrl:/x.mp4');
  });

  it('returns null when no field identifies the content', () => {
    expect(resolveSourceContentKey({ shader: 'focused' })).toBeNull();
    expect(resolveSourceContentKey(null)).toBeNull();
    expect(resolveSourceContentKey('a-string')).toBeNull();
  });
});
```

**Step 2: Run it and verify it fails**

```bash
npx vitest run frontend/src/modules/Player/utils/mediaIdentity.test.js
```
Expected: FAIL — `resolveSourceContentKey is not a function`.

**Step 3: Add the helper**

Append to `frontend/src/modules/Player/utils/mediaIdentity.js`:

```js
/**
 * Fields that identify WHAT is playing, in precedence order. `contentId` is
 * first among the non-guid fields because piano/kiosk callers pass only that.
 * `resolveMediaIdentity` deliberately omits it — that function answers "which
 * Plex asset", this one answers "is this the same source object, semantically".
 */
const SOURCE_CONTENT_FIELDS = ['guid', 'contentId', 'assetId', 'key', 'plex', 'media', 'id', 'mediaUrl'];

/**
 * Stable content key for a play/queue source object.
 *
 * The Player used to identify a source by OBJECT IDENTITY (a WeakMap keyed on
 * the object), so a caller re-creating an equivalent `play` literal on re-render
 * minted a new media guid, changed the player key, and remounted the video —
 * each remount opening a fresh Plex transcode session (2026-08-16: 495 sessions
 * in 4 minutes). Keying on content instead makes an equivalent object a no-op.
 *
 * @returns {string|null} e.g. "contentId:plex:694719", or null if unidentifiable.
 */
export const resolveSourceContentKey = (source) => {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  for (const field of SOURCE_CONTENT_FIELDS) {
    const value = source[field];
    if (value != null && value !== '') return `${field}:${value}`;
  }
  return null;
};
```

**Step 4: Run the test to verify it passes**

```bash
npx vitest run frontend/src/modules/Player/utils/mediaIdentity.test.js
```
Expected: 5 passed.

**Step 5: Wire it into `Player.jsx`**

`currentMediaGuid` flows into `plexClientSession` (line 1136) and log fields, so keep its **shape** — a short opaque token — and just make it deterministic. Reuse the existing FNV hash rather than inventing one.

Add to the imports near line 19:

```js
import { resolveMediaIdentity, resolveSourceContentKey } from './utils/mediaIdentity.js';
import { getLogWaitKey } from './lib/waitKeyLabel.js';
```
(`resolveMediaIdentity` is already imported — extend that line rather than adding a second import. Check whether `getLogWaitKey` is already imported before adding it.)

Replace `ensureEntryGuid` (lines 35-45) with:

```js
const ensureEntryGuid = (source) => {
  if (!source) return null;
  if (source.guid) return source.guid;
  // Content-derived and deterministic: an equivalent-but-new source object must
  // NOT mint a new identity (that remounts the video — see 2026-08-16 storm).
  // Hashed, not raw, so the token keeps the opaque short shape that
  // plexClientSession and the logs expect.
  const contentKey = resolveSourceContentKey(source);
  if (contentKey) return getLogWaitKey(contentKey);
  // Unidentifiable source: fall back to the old per-object random identity.
  if (typeof source !== 'object') return guid();
  if (!entryGuidCache) return guid();
  if (entryGuidCache.has(source)) return entryGuidCache.get(source);
  const value = guid();
  entryGuidCache.set(source, value);
  return value;
};
```

**Step 6: Run the Player suite**

```bash
npx vitest run frontend/src/modules/Player/
```
Expected: all pass. If a test asserts a literal 10-char random guid shape, note that `getLogWaitKey` also returns 10 chars (hex) — update the assertion only if it pins randomness, and say so in the commit.

**Step 7: Commit**

```bash
git add frontend/src/modules/Player/utils/mediaIdentity.js \
        frontend/src/modules/Player/utils/mediaIdentity.test.js \
        frontend/src/modules/Player/Player.jsx
git commit -m "fix(player): identify a source by its content, not its object identity

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Circuit breaker on remount storms (D3)

Tasks 1 and 2 close the known loop. This makes any *future* identity churn cost a log line instead of 495 Plex transcode sessions. Pure module, so it tests without React.

**Files:**
- Create: `frontend/src/modules/Player/lib/remountStormGuard.js`
- Create: `frontend/src/modules/Player/lib/remountStormGuard.test.js`
- Modify: `frontend/src/modules/Player/Player.jsx` (`singlePlayerKey` memo, line 574-581)

**Step 1: Write the failing test**

```js
// remountStormGuard.test.js
import { describe, it, expect } from 'vitest';
import { createRemountStormGuard } from './remountStormGuard.js';

describe('createRemountStormGuard', () => {
  it('allows normal remounts', () => {
    const g = createRemountStormGuard({ maxMounts: 5, windowMs: 30000 });
    expect(g.admit('k1', 0)).toBe(true);
    expect(g.admit('k2', 1000)).toBe(true);
    expect(g.tripped()).toBe(false);
  });

  it('trips once the mount count exceeds the cap inside the window', () => {
    const g = createRemountStormGuard({ maxMounts: 3, windowMs: 10000 });
    expect(g.admit('a', 0)).toBe(true);
    expect(g.admit('b', 100)).toBe(true);
    expect(g.admit('c', 200)).toBe(true);
    expect(g.admit('d', 300)).toBe(false);
    expect(g.tripped()).toBe(true);
  });

  it('does not trip when the mounts are spread beyond the window', () => {
    const g = createRemountStormGuard({ maxMounts: 3, windowMs: 1000 });
    expect(g.admit('a', 0)).toBe(true);
    expect(g.admit('b', 2000)).toBe(true);
    expect(g.admit('c', 4000)).toBe(true);
    expect(g.admit('d', 6000)).toBe(true);
    expect(g.tripped()).toBe(false);
  });

  it('repeating the SAME key is free — only new keys count as remounts', () => {
    const g = createRemountStormGuard({ maxMounts: 2, windowMs: 10000 });
    expect(g.admit('same', 0)).toBe(true);
    expect(g.admit('same', 1)).toBe(true);
    expect(g.admit('same', 2)).toBe(true);
    expect(g.tripped()).toBe(false);
  });

  it('reset clears the trip', () => {
    const g = createRemountStormGuard({ maxMounts: 1, windowMs: 10000 });
    g.admit('a', 0);
    g.admit('b', 1);
    expect(g.tripped()).toBe(true);
    g.reset();
    expect(g.tripped()).toBe(false);
    expect(g.admit('c', 2)).toBe(true);
  });
});
```

**Step 2: Run it and verify it fails**

```bash
npx vitest run frontend/src/modules/Player/lib/remountStormGuard.test.js
```
Expected: FAIL — module not found.

**Step 3: Implement**

```js
// remountStormGuard.js
/**
 * Rate limiter for player-key changes.
 *
 * Every change of the SinglePlayer React key tears down the media element and
 * builds a new one — for Plex DASH that means a brand-new transcode session.
 * On 2026-08-16 an identity-churn bug turned that into 495 sessions in four
 * minutes against one lecture, with two of them streaming audio at once.
 *
 * The guard admits key changes until more than `maxMounts` distinct keys appear
 * inside `windowMs`, then trips. A tripped guard stays tripped until `reset()`
 * (called when the content genuinely changes), so the caller can freeze the key
 * and surface an error instead of hammering the media server.
 *
 * Time is passed in rather than read, so this is deterministic under test.
 */
export function createRemountStormGuard({ maxMounts = 6, windowMs = 30000 } = {}) {
  let stamps = [];
  let lastKey = null;
  let isTripped = false;

  return {
    /**
     * @param {string} key - the candidate player key
     * @param {number} now - milliseconds (Date.now() in production)
     * @returns {boolean} true if the key change may proceed
     */
    admit(key, now) {
      if (isTripped) return false;
      if (key === lastKey) return true;   // re-render with the same key is free
      lastKey = key;
      stamps = stamps.filter((t) => now - t < windowMs);
      stamps.push(now);
      if (stamps.length > maxMounts) {
        isTripped = true;
        return false;
      }
      return true;
    },
    tripped() { return isTripped; },
    reset() { stamps = []; lastKey = null; isTripped = false; },
  };
}

export default createRemountStormGuard;
```

**Step 4: Run the test to verify it passes**

```bash
npx vitest run frontend/src/modules/Player/lib/remountStormGuard.test.js
```
Expected: 5 passed.

**Step 5: Wire it into `Player.jsx`**

Import it alongside the other `lib/` imports, then hold one guard per Player instance and reset it when the content changes:

```jsx
  const stormGuardRef = useRef(null);
  if (!stormGuardRef.current) stormGuardRef.current = createRemountStormGuard();
  const lastAdmittedKeyRef = useRef('player-idle');

  // A genuine content change is not a storm — start the window over.
  useEffect(() => {
    stormGuardRef.current?.reset();
  }, [currentMediaGuid]);
```

Then gate `singlePlayerKey` (replacing the memo at lines 574-581):

```jsx
  const singlePlayerKey = useMemo(() => {
    const candidate = !singlePlayerProps
      ? 'player-idle'
      : activeSource?.mediaType === 'image'
        // Stable key for image→image transitions so ImageFrame persists (cross-dissolve)
        ? `image-slideshow:${remountState.nonce}`
        : `${currentMediaGuid || 'entry'}:${remountState.nonce}`;

    // Storm brake: if key churn outruns the cap, freeze on the last admitted
    // key. Remounting faster than media can start never recovers — it only
    // opens transcode sessions and stacks overlapping audio.
    if (!stormGuardRef.current.admit(candidate, Date.now())) {
      if (!stormLoggedRef.current) {
        stormLoggedRef.current = true;
        playbackLog('player-remount-storm', {
          frozenKey: lastAdmittedKeyRef.current,
          rejectedKey: candidate,
          guid: currentMediaGuid,
        }, { level: 'error' });
      }
      return lastAdmittedKeyRef.current;
    }
    stormLoggedRef.current = false;
    lastAdmittedKeyRef.current = candidate;
    return candidate;
  }, [singlePlayerProps, currentMediaGuid, remountState.nonce, activeSource?.mediaType]);
```

Declare `const stormLoggedRef = useRef(false);` next to the other refs.

> Note the deliberate deviation from the skill's "no side effects in a memo": `playbackLog` is a logger call already used throughout this file, and gating it on `stormLoggedRef` keeps it to one line per storm. If the executing engineer prefers, move the log into an effect keyed on `singlePlayerKey === lastAdmittedKeyRef.current` — behavior is the same.

**Step 6: Run the Player suite**

```bash
npx vitest run frontend/src/modules/Player/
```
Expected: all pass.

**Step 7: Commit**

```bash
git add frontend/src/modules/Player/lib/remountStormGuard.js \
        frontend/src/modules/Player/lib/remountStormGuard.test.js \
        frontend/src/modules/Player/Player.jsx
git commit -m "fix(player): brake runaway remounts before they reach the media server

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Clean up every dash element generation, not just the first (D4)

This is the one that produced the echo. `cleanupDashElement` is already correct; it is simply never called for the 2nd..Nth element.

**Files:**
- Create: `frontend/src/modules/Player/renderers/VideoPlayer.dashCleanup.test.jsx`
- Modify: `frontend/src/modules/Player/renderers/VideoPlayer.jsx:409-412` and the two `key={…}` expressions at lines 766 and 775

**Step 1: Write the failing test**

Render a minimal harness that reproduces the lifecycle: one component, an element whose key changes, and a cleanup that must fire per generation.

```jsx
// VideoPlayer.dashCleanup.test.jsx
//
// The <dash-video> element's React key includes mediaUrl, so a url/bitrate/
// elementKey change destroys the element and builds a new one WITHOUT
// unmounting VideoPlayer. The cleanup effect had [] deps, so it captured only
// the first element: every later dash.js MediaPlayer leaked and kept fetching
// segments. On 2026-08-16 two of them streamed the same lecture's audio
// simultaneously — the "echo" the family reported.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { cleanupDashElement } from '../lib/dashCleanup.js';

vi.mock('../lib/dashCleanup.js', () => ({ cleanupDashElement: vi.fn() }));

// Mirrors the fixed wiring in VideoPlayer.jsx: the cleanup effect is keyed on
// the SAME composite that keys the element.
function Harness({ dashElementKey }) {
  const containerRef = useRef(null);
  useEffect(() => {
    const el = containerRef.current;
    return () => { cleanupDashElement(el); };
  }, [dashElementKey]);
  return <div key={dashElementKey} ref={containerRef} data-testid="dash-el" />;
}

beforeEach(() => { cleanupDashElement.mockClear(); });

describe('dash element cleanup', () => {
  it('cleans up each element generation as it is replaced', () => {
    const { rerender, unmount } = render(<Harness dashElementKey="url-a:unlimited:k0" />);
    expect(cleanupDashElement).toHaveBeenCalledTimes(0);

    rerender(<Harness dashElementKey="url-b:unlimited:k0" />);
    expect(cleanupDashElement).toHaveBeenCalledTimes(1);

    rerender(<Harness dashElementKey="url-b:unlimited:k1" />);
    expect(cleanupDashElement).toHaveBeenCalledTimes(2);

    unmount();
    expect(cleanupDashElement).toHaveBeenCalledTimes(3);
  });

  it('cleans up a DIFFERENT element each time, never the same one twice', () => {
    const { rerender, unmount } = render(<Harness dashElementKey="a" />);
    rerender(<Harness dashElementKey="b" />);
    rerender(<Harness dashElementKey="c" />);
    unmount();
    const cleaned = cleanupDashElement.mock.calls.map((c) => c[0]);
    expect(cleaned).toHaveLength(3);
    expect(new Set(cleaned).size).toBe(3);
  });
});
```

**Step 2: Run it and verify it fails**

The harness above already encodes the FIX. To see the defect first, temporarily change the harness's effect deps to `[]` and run:

```bash
npx vitest run frontend/src/modules/Player/renderers/VideoPlayer.dashCleanup.test.jsx
```
Expected with `[]`: FAIL — `expected 0 to be 1` on the first rerender, and the second test cleans one element instead of three. Restore the `[dashElementKey]` deps before continuing.

**Step 3: Extract the composite element key in `VideoPlayer.jsx`**

The key expression is duplicated at lines 766 and 775. Hoist it once (place it after `const { grandparentTitle, parentTitle, title, mediaUrl } = media;`, currently line 414):

```jsx
  // SSOT for "which <dash-video> generation is this". Both the element key and
  // the cleanup effect below must read the same value, or a replaced element
  // leaks its dash.js MediaPlayer (it keeps fetching audio segments — there is
  // no disconnectedCallback in dash-video-element to save us).
  const dashElementKey = `${mediaUrl || ''}:${media?.maxVideoBitrate ?? 'unlimited'}:${elementKey}`;
```

Replace both `key={...}` expressions at lines 766 and 775 with `key={dashElementKey}`.

**Step 4: Re-key the cleanup effect**

Replace lines 409-412:

```jsx
  // Clean up DASH resources per element generation. `[]` deps here captured only
  // the FIRST <dash-video>: because the element's key includes mediaUrl, a url or
  // bitrate change replaces the element WITHOUT unmounting this component, and
  // every later dash.js MediaPlayer leaked — still fetching segments, still
  // playing audio over the live one (2026-08-16 echo).
  useEffect(() => {
    const el = containerRef.current;
    return () => { cleanupDashElement(el); };
  }, [dashElementKey]);
```

`dashElementKey` must be declared **above** this effect — move the declaration from Step 3 up next to the `media` destructure if the effect currently sits earlier in the file.

**Step 5: Run the tests**

```bash
npx vitest run frontend/src/modules/Player/renderers/VideoPlayer.dashCleanup.test.jsx
npx vitest run frontend/src/modules/Player/
```
Expected: all pass.

**Step 6: Commit**

```bash
git add frontend/src/modules/Player/renderers/VideoPlayer.jsx \
        frontend/src/modules/Player/renderers/VideoPlayer.dashCleanup.test.jsx
git commit -m "fix(player): tear down every dash element generation, not just the first

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4b: DROPPED — the premise did not survive verification

Added 2026-08-16 from the observability sweep, then **withdrawn the same day before implementation**. Recorded here rather than deleted, because the reasoning is the useful part.

**The claim was:** `playheadProgress.js` returns `{ advanced: true }` with no baseline, so after every remount the first tick reports progress, calls `recordSuccess()`, and zeroes the retry cap — a third independent mechanism defeating the backoff.

**Why it is wrong.** The baseline is `lastSuccessPosRef`, a ref inside `useMediaResilience`. That hook is called from exactly one place — `Player.jsx:887` — which sits **above** the `singlePlayerKey` boundary (the keyed child renders around `:1198`). A remount tears down the child; the hook never re-runs, so its refs survive. The ref is nulled at exactly one site, `useMediaResilience.js:112`, inside the effect that fires when `playbackSessionKey` changes — a genuine media change, which in the same effect also calls `releaseSession`.

So the no-baseline branch is only ever reached when the ledger has just been released and has **nothing to zero**. The false progress lands on an empty session. Impact: none.

The audit labelled this one as inference (*"Verified in code; that this fired during the incident is inference"*), and the inference did not hold. Two mechanisms defeat the retry cap, not three — both closed by Task 2.

**The one case where it would bite** is a fresh Player sharing a `playbackSessionKey` with an already-running sibling: its first tick would zero the sibling's accumulated attempts. That is the sibling-collision bug, fixed at the root in Task 3, so a change here would be treating a symptom of something already handled.

**Do not implement.** Changing the branch would also risk the documented recovery semantics the module exists for — distinguishing genuine motion from the nudge strategy's `currentTime -= 0.001` — for no measurable gain.

---

## Task 5: Full frontend regression sweep

**Step 1: Run the Player and Piano suites**

```bash
npx vitest run frontend/src/modules/Player/ frontend/src/modules/Piano/
```
Expected: all pass; counts ≥ the Task 0 baseline.

**Step 2: Run the vitest ratchet**

```bash
node scripts/gate-vitest.mjs
```

**Revised pass criterion (2026-08-16): "no NEW failures", not "exit 0".** The gate currently exits 1 on roughly 24 pre-existing failing files that have nothing to do with this branch — school datastores, laser printer, jamcorder, gaming, admin, Life. Two independent agents confirmed this by running the same files in the main checkout at a different commit and reproducing the failures there. The NEW-vs-baseline count also *fell* from 26 to 24 across a rebase (`e01046cd8` fixed `GetCourseProgress.char.test.mjs`), which is the behavior of a stale baseline, not of anything this branch did.

So: record the NEW count, compare it to the count measured on the branch point, and require that it has not increased. **Never run `--update`** — that would bake this branch's state into the baseline and hide a real regression later.

**Also expect load-flakiness in full sweeps.** Identical runs of the same ~4,300-test sweep have produced 0, 7 and 12 failures, all `Test timed out in 5000ms`, in files unrelated to any change — matching the pool flakiness documented in `vitest.config.mjs`. Before concluding a failure is real, re-run the affected file in isolation. A full-sweep number alone is not evidence.

**Step 3: Commit if anything changed**

```bash
git status --porcelain
```
Expected: clean. If not, commit the fixes before proceeding.

---

## Task 6: Verify on the kiosk (this is the real gate)

Unit tests prove the loop is closed in jsdom. Only the tablet proves it against Plex.

**Step 1: Merge and deploy**

```bash
git checkout main && git pull --ff-only origin main
git merge --no-ff fix/piano-video-remount-storm
git push origin main
```
Then deploy from the homeserver tree per the normal flow (`ssh homeserver.local`, pull, rebuild the container).

**Step 2: Capture the "before" rate for comparison**

```bash
ssh homeserver.local 'docker exec plex sh -lc "cat \"/config/Library/Application Support/Plex Media Server/Logs/Plex Media Server.log\" > /tmp/pms.txt; grep -a -c \"Request:.*start.mpd\" /tmp/pms.txt"'
```

**Step 3: Play the lecture on the tablet**

Open `/piano/videos/694718/plex:694719` on the piano kiosk and let it run for 3 minutes.

**Step 4: Count new transcode sessions**

```bash
ssh homeserver.local 'docker exec plex sh -lc "for m in \$(date +%H:%M -d \"3 min ago\" 2>/dev/null || echo); do :; done; grep -a -oE \"^[A-Za-z]+ [0-9]+, [0-9]+ [0-9]{2}:[0-9]{2}\" /tmp/pms.txt | tail -1"'
# Then, for the three minutes you just watched:
ssh homeserver.local 'docker exec plex sh -lc "cat \"/config/Library/Application Support/Plex Media Server/Logs/Plex Media Server.log\" | grep -a -E \"^Aug .., 2026 HH:MM\" | grep -a -c start.mpd"'
```
Substitute the three actual `HH:MM` values.

**Pass criteria:**
- **≤ 3** `start.mpd` requests total for the whole session (was 73–93 *per minute*).
- Exactly **one** transcode session UUID appears in `…/session/<uuid>/1/*.m4s` audio-segment requests — never two at overlapping timestamps.
- Frontend log shows `playback.video-ready` and `dash.playback-started`, and `playback.overlay-summary` reports `status:playing` with `el:t=` advancing past 0.
- No `playback.player-remount-storm` events (if one appears, the brake worked but something upstream is still churning — investigate before closing).

**Step 5: Record the outcome**

Append a "Verified" section to this plan with the measured numbers, then move it to `docs/_archive/` if it is fully closed.

---

## Out of scope (worth filing separately)

- `useResolvedMediaEl` polls at 100 ms forever, for every consumer. It works, but it is the mechanism that turned one unstable callback into a storm. An event-driven registration (the Player already has `onRegisterMediaAccess`) would remove the whole class of problem.
- `resolveMediaIdentity` does not know about `contentId`, so `mediaIdentity` is `null` for every piano lecture and `resolvedWaitKey` silently falls back. Harmless today, confusing in logs.
- The startup watchdog reported `el:t=0 r=n/a n=n/a` for three minutes — it was reading a wrapper element whose `readyState`/`networkState` are undefined. It never had the signal it needed to judge startup, which is why it kept declaring `startup-deadline-exceeded` while audio was in fact streaming.
