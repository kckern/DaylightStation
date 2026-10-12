# Player Progress Bar — Data + Glide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Player progress bar validates its own playback data, works for audio as well as video, and glides through every discontinuity (seek, pause/resume, rate, duration change) instead of jump-cutting.

**Architecture:** A pure model module (`progressModel.js`) turns raw props into a validated fraction, classifies what changed between renders, and builds Web Animations keyframes (eased glide from the *visible* position, then linear to the end). `ProgressBar.jsx` keeps one persistent fill element and one `Animation` — pausing/playing it in place, rebuilding it with a glide only on real discontinuities. Without `element.animate` it falls back to a CSS-transitioned `scaleX`.

**Tech Stack:** React 18, Web Animations API, SCSS, vitest + @testing-library/react (jsdom).

**Spec:** In-chat design approved 2026-10-11 (bounded change) — summarized here:
1. Audio passes `durationSeconds`, `offsetSeconds`, `paused={isPaused || isStalled}`, `playbackRate` like video.
2. Bar computes from duration/offset itself; unknown/0/∞ duration → no bogus fill; offset clamped to `[0, duration]`; duration change re-anchors smoothly.
3. WAAPI on one persistent element: linear run to end; ~250 ms ease-out glide from the visible fraction on seek/rate/duration; pause/stall/resume pause and play the same animation; resume re-syncs (gliding) only past the seek threshold.
4. SCSS: `scaleX` everywhere, transitioned fallback, `prefers-reduced-motion` → instant.
5. Fallback when `element.animate` is missing; sampled `progress.reanchor` debug log.

## Global Constraints

- Logging only via `frontend/src/lib/logging/Logger.js` (lazy module logger); `progress.reanchor` at debug, sampled `maxPerMinute: 20`.
- Seek thresholds unchanged: back > 0.25 s, forward > 1.5 s. Glide 250 ms.
- No change to `handleProgressClick` or seek semantics.
- Keep `ProgressBar`'s existing prop names; `percent` stays accepted (fallback when no timing data).
- Fill is always driven by `transform: scaleX()` — never `width`.

## Review Focus

1. Seek **while paused** → bar moves to the new spot (glide) and stays there; does not resume running.
2. Duration arrives late (first render `duration=0`, then real value) → no glide from 0 on first real anchor; just starts at the right spot.
3. Offset beyond duration (end-of-file overshoot) → clamped to full, no keyframe with scale > 1.
4. Component unmount mid-animation → animation cancelled, no leaked Animation.
5. `paused` toggling rapidly (stall flapping) → same Animation object reused, never rebuilt.

---

### Task 1: `progressModel.js` — pure data + keyframes

**Files:**
- Create: `frontend/src/modules/Player/components/progressModel.js`
- Test: `frontend/src/modules/Player/components/progressModel.test.js`

**Interfaces — Produces:**
- `SEEK_BACK_EPS = 0.25`, `SEEK_FWD_EPS = 1.5`, `GLIDE_MS = 250`
- `normalizeProgress({ durationSeconds, offsetSeconds, percent }) → { mode: 'timed'|'percent'|'none', duration: number, offset: number, fraction: number }`
- `classifyChange(prev, next) → null | 'initial'|'seek'|'pause'|'resume'|'rate'|'duration'` where both are `{ offset, running, rate, duration }` (prev may be null)
- `buildFillKeyframes({ fromFraction, fraction, duration, rate, glideMs, running }) → { keyframes: Keyframe[], timing: KeyframeAnimationOptions, kind: 'run'|'hold' }`
- `parseScaleX(transformString) → number|null`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import {
  normalizeProgress, classifyChange, buildFillKeyframes, parseScaleX, GLIDE_MS,
} from './progressModel.js';

describe('normalizeProgress', () => {
  it('uses duration/offset when both are usable, clamping the offset', () => {
    expect(normalizeProgress({ durationSeconds: 200, offsetSeconds: 50 }))
      .toEqual({ mode: 'timed', duration: 200, offset: 50, fraction: 0.25 });
    expect(normalizeProgress({ durationSeconds: 200, offsetSeconds: 250 }).fraction).toBe(1);
    expect(normalizeProgress({ durationSeconds: 200, offsetSeconds: -3 }).fraction).toBe(0);
  });
  it('falls back to percent (string or number), clamped', () => {
    expect(normalizeProgress({ percent: '12.5' })).toEqual({ mode: 'percent', duration: 0, offset: 0, fraction: 0.125 });
    expect(normalizeProgress({ durationSeconds: Infinity, offsetSeconds: 4, percent: 140 }).fraction).toBe(1);
  });
  it('shows nothing when there is no usable data', () => {
    expect(normalizeProgress({ durationSeconds: 0, offsetSeconds: null, percent: 'NaN' }))
      .toEqual({ mode: 'none', duration: 0, offset: 0, fraction: 0 });
  });
});

describe('classifyChange', () => {
  const base = { offset: 10, running: true, rate: 1, duration: 100 };
  it('names each discontinuity', () => {
    expect(classifyChange(null, base)).toBe('initial');
    expect(classifyChange(base, { ...base, offset: 10.4 })).toBeNull();
    expect(classifyChange(base, { ...base, offset: 9.5 })).toBe('seek');
    expect(classifyChange(base, { ...base, offset: 12 })).toBe('seek');
    expect(classifyChange(base, { ...base, running: false })).toBe('pause');
    expect(classifyChange({ ...base, running: false }, base)).toBe('resume');
    expect(classifyChange(base, { ...base, rate: 1.5 })).toBe('rate');
    expect(classifyChange(base, { ...base, duration: 130 })).toBe('duration');
  });
  it('treats a duration arriving from nothing as initial', () => {
    expect(classifyChange({ ...base, duration: 0 }, base)).toBe('initial');
  });
});

describe('buildFillKeyframes', () => {
  it('runs linearly to the end when there is nothing to glide', () => {
    const { keyframes, timing, kind } = buildFillKeyframes({
      fromFraction: 0.5, fraction: 0.5, duration: 100, rate: 1, glideMs: GLIDE_MS, running: true,
    });
    expect(kind).toBe('run');
    expect(keyframes).toEqual([{ transform: 'scaleX(0.5)' }, { transform: 'scaleX(1)' }]);
    expect(timing).toEqual({ duration: 50000, easing: 'linear', fill: 'forwards' });
  });
  it('glides from the visible spot, then continues linearly, accounting for playback during the glide', () => {
    const { keyframes, timing } = buildFillKeyframes({
      fromFraction: 0.2, fraction: 0.5, duration: 100, rate: 2, glideMs: 250, running: true,
    });
    // during 250ms at 2x, playback advances 0.5s => lands at 0.505
    expect(keyframes[0]).toEqual({ transform: 'scaleX(0.2)', offset: 0, easing: 'ease-out' });
    expect(keyframes[1].transform).toBe('scaleX(0.505)');
    expect(keyframes[2]).toEqual({ transform: 'scaleX(1)', offset: 1 });
    expect(timing.duration).toBeCloseTo(250 + (49.5 / 2) * 1000, 5);
    expect(keyframes[1].offset).toBeCloseTo(250 / timing.duration, 8);
  });
  it('holds at the target when paused (glide only, no run)', () => {
    const { keyframes, timing, kind } = buildFillKeyframes({
      fromFraction: 0.2, fraction: 0.6, duration: 100, rate: 1, glideMs: 250, running: false,
    });
    expect(kind).toBe('hold');
    expect(keyframes).toEqual([{ transform: 'scaleX(0.2)' }, { transform: 'scaleX(0.6)' }]);
    expect(timing).toEqual({ duration: 250, easing: 'ease-out', fill: 'forwards' });
  });
  it('never emits a scale above 1', () => {
    const { keyframes } = buildFillKeyframes({
      fromFraction: 0.9, fraction: 0.999, duration: 100, rate: 4, glideMs: 250, running: true,
    });
    for (const k of keyframes) expect(parseScaleX(k.transform)).toBeLessThanOrEqual(1);
  });
});

describe('parseScaleX', () => {
  it('reads scaleX() and matrix() transforms', () => {
    expect(parseScaleX('scaleX(0.25)')).toBe(0.25);
    expect(parseScaleX('matrix(0.4, 0, 0, 1, 0, 0)')).toBe(0.4);
    expect(parseScaleX('none')).toBeNull();
    expect(parseScaleX('')).toBeNull();
  });
});
```

- [ ] **Step 2:** `npx vitest run frontend/src/modules/Player/components/progressModel.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// frontend/src/modules/Player/components/progressModel.js
/**
 * Pure model behind the Player progress bar: validates playback data, names
 * what changed between renders, and builds Web Animations keyframes that glide
 * from where the fill VISIBLY is rather than cutting to the new spot.
 */
export const SEEK_BACK_EPS = 0.25; // s: offset moving backward beyond this ⇒ a seek
export const SEEK_FWD_EPS = 1.5;   // s: offset jumping forward beyond this ⇒ a seek
export const GLIDE_MS = 250;       // ms: ease-out glide on a discontinuity
const DURATION_EPS = 0.5;          // s: duration change worth re-anchoring for
const GLIDE_MIN = 0.002;           // fraction: closer than this is not worth a glide

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const round = (v) => Math.round(v * 1e6) / 1e6;
const scale = (f) => `scaleX(${round(clamp01(f))})`;

export function normalizeProgress({ durationSeconds, offsetSeconds, percent } = {}) {
  if (Number.isFinite(durationSeconds) && durationSeconds > 0 && Number.isFinite(offsetSeconds)) {
    const offset = Math.min(durationSeconds, Math.max(0, offsetSeconds));
    return { mode: 'timed', duration: durationSeconds, offset, fraction: offset / durationSeconds };
  }
  const pct = Number(percent);
  if (percent !== null && percent !== undefined && percent !== '' && Number.isFinite(pct)) {
    return { mode: 'percent', duration: 0, offset: 0, fraction: clamp01(pct / 100) };
  }
  return { mode: 'none', duration: 0, offset: 0, fraction: 0 };
}

export function classifyChange(prev, next) {
  if (!prev || !(prev.duration > 0)) return 'initial';
  if (Math.abs(next.duration - prev.duration) > DURATION_EPS) return 'duration';
  if (next.rate !== prev.rate) return 'rate';
  if (next.running !== prev.running) return next.running ? 'resume' : 'pause';
  if (next.offset < prev.offset - SEEK_BACK_EPS || next.offset > prev.offset + SEEK_FWD_EPS) return 'seek';
  return null;
}

export function buildFillKeyframes({ fromFraction, fraction, duration, rate, glideMs, running }) {
  const r = rate > 0 ? rate : 1;
  const from = Number.isFinite(fromFraction) ? clamp01(fromFraction) : clamp01(fraction);
  const target = clamp01(fraction);
  const glide = glideMs > 0 && Math.abs(from - target) >= GLIDE_MIN ? glideMs : 0;

  if (!running) {
    return {
      kind: 'hold',
      keyframes: [{ transform: scale(from) }, { transform: scale(target) }],
      timing: { duration: glide, easing: 'ease-out', fill: 'forwards' },
    };
  }
  if (!glide) {
    return {
      kind: 'run',
      keyframes: [{ transform: scale(target) }, { transform: 'scaleX(1)' }],
      timing: { duration: ((duration * (1 - target)) / r) * 1000, easing: 'linear', fill: 'forwards' },
    };
  }
  // Playback keeps moving during the glide, so land where it will be.
  const landing = clamp01(target + (glide / 1000) * r / duration);
  const total = glide + ((duration * (1 - landing)) / r) * 1000;
  return {
    kind: 'run',
    keyframes: [
      { transform: scale(from), offset: 0, easing: 'ease-out' },
      { transform: scale(landing), offset: glide / total, easing: 'linear' },
      { transform: 'scaleX(1)', offset: 1 },
    ],
    timing: { duration: total, fill: 'forwards' },
  };
}

export function parseScaleX(transform) {
  if (typeof transform !== 'string' || !transform || transform === 'none') return null;
  const m = transform.match(/^scaleX\(([-\d.e]+)\)$/) || transform.match(/^matrix\(([-\d.e]+),/);
  const v = m ? Number(m[1]) : NaN;
  return Number.isFinite(v) ? v : null;
}
```

- [ ] **Step 4:** re-run → PASS.
- [ ] **Step 5:** commit `feat(player): progress bar model — validated data + glide keyframes`.

### Task 2: `ProgressBar.jsx` on one persistent Animation + SCSS

**Files:**
- Modify: `frontend/src/modules/Player/components/ProgressBar.jsx` (rewrite body; same props)
- Modify: `frontend/src/modules/Player/styles/Player.scss:122-139` (remove `@keyframes playerProgressFill`, add transition + reduced motion)
- Modify: `frontend/src/modules/Player/components/ProgressBar.playState.test.jsx` (replace keyframe-style assertions)

**Interfaces — Consumes:** everything from Task 1. **Produces:** `<ProgressBar percent onClick durationSeconds offsetSeconds paused playbackRate />` (unchanged signature).

- [ ] **Step 1: Write the failing test** (replace the file's contents)

```jsx
import { render, cleanup } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { ProgressBar } from './ProgressBar.jsx';

const fill = (c) => c.querySelector('.progress');
let created;
let visible;

function fakeAnimation(keyframes, timing) {
  return { keyframes, timing, pause: vi.fn(), play: vi.fn(), cancel: vi.fn() };
}

beforeEach(() => {
  created = [];
  visible = null;
  Element.prototype.animate = vi.fn(function animate(keyframes, timing) {
    const a = fakeAnimation(keyframes, timing);
    created.push(a);
    return a;
  });
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({ transform: visible ?? 'none' }));
});
afterEach(() => {
  cleanup();
  delete Element.prototype.animate;
  vi.restoreAllMocks();
});

const bar = (props) => <ProgressBar percent={0} durationSeconds={100} offsetSeconds={10} paused={false} {...props} />;

describe('ProgressBar — Web Animations', () => {
  it('starts a linear run at the current spot, without a glide', () => {
    render(bar());
    expect(created).toHaveLength(1);
    expect(created[0].keyframes).toEqual([{ transform: 'scaleX(0.1)' }, { transform: 'scaleX(1)' }]);
  });

  it('ignores steady ticks', () => {
    const { rerender } = render(bar());
    rerender(bar({ offsetSeconds: 10.4 }));
    rerender(bar({ offsetSeconds: 10.8 }));
    expect(created).toHaveLength(1);
  });

  it('glides from the visible fraction on a seek', () => {
    const { rerender } = render(bar());
    visible = 'matrix(0.12, 0, 0, 1, 0, 0)';
    rerender(bar({ offsetSeconds: 60 }));
    expect(created).toHaveLength(2);
    expect(created[0].cancel).toHaveBeenCalled();
    expect(created[1].keyframes[0]).toEqual({ transform: 'scaleX(0.12)', offset: 0, easing: 'ease-out' });
    expect(created[1].keyframes.at(-1)).toEqual({ transform: 'scaleX(1)', offset: 1 });
  });

  it('pauses and resumes the same animation in place (stall flapping never rebuilds)', () => {
    const { rerender } = render(bar());
    visible = 'scaleX(0.1)';
    for (let i = 0; i < 3; i++) {
      rerender(bar({ paused: true }));
      rerender(bar({ paused: false }));
    }
    expect(created).toHaveLength(1);
    expect(created[0].pause).toHaveBeenCalledTimes(3);
    expect(created[0].play).toHaveBeenCalledTimes(3);
  });

  it('a seek while paused glides to the new spot and holds there', () => {
    const { rerender } = render(bar({ paused: true }));
    visible = 'scaleX(0.1)';
    rerender(bar({ paused: true, offsetSeconds: 70 }));
    const last = created.at(-1);
    expect(last.keyframes).toEqual([{ transform: 'scaleX(0.1)' }, { transform: 'scaleX(0.7)' }]);
    expect(last.timing.easing).toBe('ease-out');
  });

  it('resuming after a held seek rebuilds a running animation', () => {
    const { rerender } = render(bar({ paused: true }));
    visible = 'scaleX(0.1)';
    rerender(bar({ paused: true, offsetSeconds: 70 }));
    visible = 'scaleX(0.7)';
    rerender(bar({ paused: false, offsetSeconds: 70 }));
    expect(created.at(-1).keyframes).toEqual([{ transform: 'scaleX(0.7)' }, { transform: 'scaleX(1)' }]);
  });

  it('starts at the right spot when the duration arrives late', () => {
    const { rerender } = render(bar({ durationSeconds: 0, offsetSeconds: 0 }));
    expect(created).toHaveLength(0);
    rerender(bar({ durationSeconds: 200, offsetSeconds: 50 }));
    expect(created).toHaveLength(1);
    expect(created[0].keyframes[0]).toEqual({ transform: 'scaleX(0.25)' });
  });

  it('cancels the animation on unmount', () => {
    const { unmount } = render(bar());
    unmount();
    expect(created[0].cancel).toHaveBeenCalled();
  });
});

describe('ProgressBar — fallback', () => {
  it('uses a transitioned scaleX when there is no timing data', () => {
    const { container } = render(<ProgressBar percent={40} />);
    expect(fill(container).style.transform).toBe('scaleX(0.4)');
    expect(fill(container).className).toContain('progress--stepped');
    expect(created).toHaveLength(0);
  });

  it('shows an empty bar for unusable data', () => {
    const { container } = render(<ProgressBar percent="NaN" durationSeconds={Infinity} offsetSeconds={3} />);
    expect(fill(container).style.transform).toBe('scaleX(0)');
  });

  it('uses the stepped fill when element.animate is unavailable', () => {
    delete Element.prototype.animate;
    const { container } = render(bar({ offsetSeconds: 25 }));
    expect(fill(container).style.transform).toBe('scaleX(0.25)');
    expect(fill(container).className).toContain('progress--stepped');
  });
});
```

- [ ] **Step 2:** `npx vitest run frontend/src/modules/Player/components/ProgressBar.playState.test.jsx` → FAIL.

- [ ] **Step 3: Implement** — `ProgressBar.jsx`

```jsx
import React, { useEffect, useLayoutEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import getLogger from '../../../lib/logging/Logger.js';
import {
  GLIDE_MS, SEEK_FWD_EPS, normalizeProgress, classifyChange, buildFillKeyframes, parseScaleX,
} from './progressModel.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'progress-bar' });
  return _logger;
}

const prefersReducedMotion = () => {
  try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/**
 * Media progress bar. With timing data and the Web Animations API, one
 * persistent fill element runs one Animation: linear to the end on the
 * compositor clock, paused/played in place on pause and stalls, and rebuilt
 * only on a real discontinuity (seek, rate, duration) — gliding from where the
 * fill VISIBLY is, so it never jump-cuts. Otherwise it falls back to a
 * CSS-transitioned scaleX. See progressModel.js.
 */
export function ProgressBar({ percent, onClick, durationSeconds = 0, offsetSeconds = null, paused = false, playbackRate = 1 }) {
  const model = normalizeProgress({ durationSeconds, offsetSeconds, percent });
  const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  const fillRef = useRef(null);
  const animRef = useRef(null);   // { animation, kind: 'run'|'hold' }
  const stateRef = useRef(null);  // last anchored { offset, running, rate, duration }
  const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
  const animated = canAnimate && model.mode === 'timed';

  useLayoutEffect(() => {
    const el = fillRef.current;
    if (!el || !animated) {
      animRef.current?.animation.cancel();
      animRef.current = null;
      stateRef.current = null;
      return;
    }
    const next = { offset: model.offset, running: !paused, rate, duration: model.duration };
    const reason = classifyChange(stateRef.current, next);
    if (!reason) { stateRef.current.offset = next.offset; return; }

    const current = animRef.current;
    const visible = parseScaleX(window.getComputedStyle(el).transform);
    if (current && reason === 'pause') {
      current.animation.pause();
      stateRef.current = next;
      return;
    }
    if (current && reason === 'resume' && current.kind === 'run'
      && visible !== null && Math.abs(visible - model.fraction) * model.duration <= SEEK_FWD_EPS) {
      current.animation.play();
      stateRef.current = next;
      return;
    }

    const glideMs = reason === 'initial' || prefersReducedMotion() ? 0 : GLIDE_MS;
    const { keyframes, timing, kind } = buildFillKeyframes({
      fromFraction: visible ?? model.fraction, fraction: model.fraction, duration: model.duration,
      rate, glideMs, running: next.running,
    });
    current?.animation.cancel();
    animRef.current = { animation: el.animate(keyframes, timing), kind };
    stateRef.current = next;
    logger().sampled('progress.reanchor', {
      reason, from: visible, to: Math.round(model.fraction * 1000) / 1000, kind, glide: glideMs > 0,
    }, { maxPerMinute: 20, aggregate: true });
  }, [animated, model.offset, model.duration, model.fraction, paused, rate]);

  useEffect(() => () => { animRef.current?.animation.cancel(); }, []);

  // Before the first animation frame (and in the fallback) the inline
  // transform is what shows; once an Animation runs it overrides it.
  const style = { transform: `scaleX(${model.fraction})` };
  return (
    <div className="progress-bar" onClick={onClick} style={onClick ? { cursor: 'pointer' } : {}}>
      <div ref={fillRef} className={animated ? 'progress' : 'progress progress--stepped'} style={style} />
    </div>
  );
}

ProgressBar.propTypes = {
  /** Fallback fill (0–100) when duration/offset are not usable. */
  percent: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  onClick: PropTypes.func,
  /** Total media duration (s). With a finite offset, enables the animated fill. */
  durationSeconds: PropTypes.number,
  /** Current playhead (s); clamped to [0, durationSeconds]. */
  offsetSeconds: PropTypes.number,
  /** Paused or stalled — freezes the fill in place. */
  paused: PropTypes.bool,
  /** Playback rate; the fill tracks fast/slow play. */
  playbackRate: PropTypes.number,
};
```

Note: the inline `transform` updates on every steady tick (React re-renders anyway); while an Animation with `fill: 'forwards'` runs it overrides inline style, so this costs nothing visible.

SCSS — replace `Player.scss` lines 122–139 (the `.progress` block and `@keyframes playerProgressFill`) with:

```scss
.player .progress-bar > .progress{
    height: 100%;
    width: 100%;
    z-index: var(--player-layer-progress-fill, 21);
    background-color: #2a9d8f99;
    /* The fill is ALWAYS a scaleX transform, never width: a GPU transform on
       the compositor, no layout. ProgressBar drives it with one Web Animation
       (linear run + eased glides on seeks); see progressModel.js. */
    transform-origin: left center;
    will-change: transform;
}

/* Fallback when there is no timing data or no Web Animations API: each tick's
   new scaleX is eased in rather than cut to. */
.player .progress-bar > .progress.progress--stepped{
    transition: transform 250ms ease-out;
}

@media (prefers-reduced-motion: reduce){
    .player .progress-bar > .progress.progress--stepped{ transition: none; }
}
```

- [ ] **Step 4:** run the test file → PASS; run `npx vitest run frontend/src/modules/Player` → no new failures vs a baseline taken before Step 3.
- [ ] **Step 5:** commit `feat(player): progress bar glides through seeks/pauses on one Web Animation`.

### Task 3: Audio passes full timing data; verify in a real browser

**Files:**
- Modify: `frontend/src/modules/Player/renderers/AudioPlayer.jsx` (destructure `isPaused`, `isStalled`; pass props at `:274`)

- [ ] **Step 1:** In the `useCommonMediaController` destructure add `isPaused, isStalled,`. Replace the bar with:

```jsx
      <ProgressBar
        percent={percent}
        onClick={handleProgressClick}
        durationSeconds={Number.isFinite(duration) ? duration : 0}
        offsetSeconds={Number.isFinite(seconds) ? seconds : null}
        paused={isPaused || isStalled}
        playbackRate={playbackRate || media.playbackRate || 1}
      />
```

- [ ] **Step 2:** `npx vitest run frontend/src/modules/Player` → no new failures vs baseline.
- [ ] **Step 3:** Build + gated deploy (`./scripts/deploy-gate.sh` chained with the build/deploy, per CLAUDE.local.md).
- [ ] **Step 4:** Real-browser check (headless Playwright on the prod URL, not a kiosk): play an audio track and a video; screenshot the bar at t, then seek via click and capture several frames over ~300 ms — the fill must show intermediate widths (glide), not a single-frame jump; pause for 2 s — width constant; resume — continues from the same width. Check the log store for `progress.reanchor` with `reason: seek`.
- [ ] **Step 5:** commit `feat(player): audio progress bar gets full timing data`; update `frontend/src/modules/Player/README.md` progress-bar notes if present.
