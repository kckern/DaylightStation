# Session-Detail Marker UI Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Polish the session-detail marker overlay to best-in-class: de-mud the duration fills (top bracket instead of smears), collision-proof the challenge badges, halo the indicator lines so they survive yellow-on-yellow, run indicators continuously through the x-axis strip, reserve the gutter only when video changes exist, and left-anchor video cards to their change line.

**Architecture:** All marker geometry stays in pure helpers (`timelineOverlay.js`, TDD'd) consumed by three renderers that share one tick axis: `FitnessChart.jsx` (top line chart, SVG `viewBox`), `MarkerGutter.jsx` (center band, pixel SVG + HTML cards), and `FitnessTimeline.jsx` (bottom HR-area lanes, pixel SVG). No data-model changes — everything reads `sessionData.timeline.events`.

**Tech Stack:** React 18 + SVG, SCSS (BEM), Vitest (run from `frontend/`), Playwright for visual verification against the local dev server.

---

## Context for the implementing engineer (read first)

- **Repo:** `/Users/kckern/Documents/GitHub/DaylightStation`. Work directly on `main` (house style: no PRs, commit per task, push at the end).
- **Run unit tests from `frontend/`:** `cd frontend && npx vitest run <paths>`. There is NO `npm test` shortcut for these.
- **`FitnessChart.jsx` is indented with TABS.** The Edit tool's `old_string` must match tabs exactly — if an edit fails to match, re-Read the exact lines first. Other files in `FitnessSessionDetailWidget/` use 2-space indents.
- **Visual verification** uses the local dev server (Vite on **3111**, proxying the backend on 3112 — both already running; check with `lsof -i :3111`). The reference session with challenges + a video change is `20260608191948`; deep-link URL: `http://localhost:3111/fitness/home/session-20260608191948`.
- **Do NOT commit:** `frontend/package-lock.json` (pre-existing unrelated modification) or any `tests/_tmp_*.mjs` scratch scripts.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

### Current marker architecture (as of commit `1b8eefc00`)

| File | Role |
|---|---|
| `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/timelineOverlay.js` | Pure geometry. `computeChallengeMarkers(events, opts)` → `[{x, xEnd, width, type, zoneId, result, label, requiredCount}]`; `computeVideoMarkers(events, opts)` → `[{x, episodeName, posterUrl, thumbUrl}]`. |
| `frontend/src/modules/Fitness/lib/activities/challengeTypeRegistry.js` | `getChallengeMarkerColor(marker)` → zone-tinted hex (warm `#ffd43b`, hot `#ff922b`, cycle `#f59e0b`). |
| `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx` | `RaceChartSvg` renders: race-bands group (~line 580, contains challenge fill rects opacity 0.12 + right-edge solid line), seams group (~line 668, contains video dashed lines), and challenge number badges (~line 779, circle r=11 at `m.xEnd`, `cy = overlay.top + 12`). `raceOverlay` useMemo (~line 1232) computes `challengeMarkers`/`videoMarkers` and `top`/`bottom`. |
| `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/MarkerGutter.jsx` | Pixel SVG drawing challenge rects (opacity 0.14) + right-edge lines + video dashed lines through the gutter; HTML video poster cards center-anchored (`translate(-50%, -50%)`). |
| `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.jsx` | Render order: bands → HR fills → challenge rects (opacity 0.14) + right-edge line → seams → video lines → avatars LAST (on top). |
| `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx` | `hasMarkers` (~line 290) gates the gutter; currently true for challenges OR video changes. |
| `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/useTimelineMarkers.js` | Shared hook: measures host, computes markers on the shared tick axis (`{ref, width, height, challengeMarkers, videoMarkers}`). |

---

### Task 1: Badge collision helper — failing tests

**Files:**
- Modify (test): `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/timelineOverlay.test.js`

**Step 1: Append the failing tests** at the end of the file:

```js
import { resolveBadgeXs, withBadgeXs } from './timelineOverlay.js';

describe('resolveBadgeXs', () => {
  it('leaves well-separated positions unchanged', () => {
    expect(resolveBadgeXs([10, 60, 120], { minGap: 24, min: 0, max: 200 }))
      .toEqual([10, 60, 120]);
  });
  it('pushes overlapping badges apart left-to-right', () => {
    expect(resolveBadgeXs([50, 55, 58], { minGap: 24, min: 0, max: 400 }))
      .toEqual([50, 74, 98]);
  });
  it('walks a crowded cluster back inside the right edge', () => {
    const xs = resolveBadgeXs([180, 190, 200], { minGap: 24, min: 0, max: 200 });
    expect(xs[2]).toBe(200);
    expect(xs[1]).toBe(176);
    expect(xs[0]).toBe(152);
  });
  it('clamps the left edge and re-spreads forward', () => {
    const xs = resolveBadgeXs([-10, 0, 5], { minGap: 24, min: 0, max: 400 });
    expect(xs[0]).toBe(0);
    expect(xs[1]).toBe(24);
    expect(xs[2]).toBe(48);
  });
});

describe('withBadgeXs', () => {
  it('adds badgeX without reordering markers, even when xEnd is unsorted', () => {
    // Marker 0 is an unfinished challenge whose xEnd extends past marker 1's.
    const markers = [
      { x: 10, xEnd: 300, width: 290, requiredCount: 1 },
      { x: 40, xEnd: 60, width: 20, requiredCount: 3 }
    ];
    const out = withBadgeXs(markers, { minGap: 24, min: 0, max: 300 });
    expect(out[0].requiredCount).toBe(1);          // order preserved
    expect(out[1].requiredCount).toBe(3);
    expect(out[0].badgeX).toBe(300);
    expect(out[1].badgeX).toBe(60);
    expect(markers[0].badgeX).toBeUndefined();      // input not mutated
  });
  it('separates two badges whose ends collide', () => {
    const out = withBadgeXs(
      [{ x: 0, xEnd: 100, width: 100 }, { x: 50, xEnd: 105, width: 55 }],
      { minGap: 24, min: 0, max: 400 }
    );
    expect(Math.abs(out[1].badgeX - out[0].badgeX)).toBeGreaterThanOrEqual(24);
  });
});
```

**Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/modules/Fitness/widgets/FitnessSessionDetailWidget/timelineOverlay.test.js`
Expected: FAIL — `resolveBadgeXs is not a function` (or export missing).

### Task 2: Badge collision helper — implementation

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/timelineOverlay.js` (append at end)

**Step 1: Implement**

```js
/**
 * Resolve 1-D badge positions so fixed-size badges never overlap.
 * Greedy left-to-right pass enforces minGap; if the last badge spills past
 * `max`, a right-to-left pass walks the cluster back; a final left clamp
 * re-spreads forward. Input must be ascending. Pure; returns a new array.
 */
export function resolveBadgeXs(desired, { minGap, min, max }) {
  const xs = [...desired];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] < xs[i - 1] + minGap) xs[i] = xs[i - 1] + minGap;
  }
  if (xs.length && xs[xs.length - 1] > max) {
    xs[xs.length - 1] = max;
    for (let i = xs.length - 2; i >= 0; i--) {
      if (xs[i] > xs[i + 1] - minGap) xs[i] = xs[i + 1] - minGap;
    }
  }
  if (xs.length && xs[0] < min) {
    xs[0] = min;
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] < xs[i - 1] + minGap) xs[i] = xs[i - 1] + minGap;
    }
  }
  return xs;
}

/**
 * Decorate challenge markers with a collision-free `badgeX` (anchored at each
 * marker's xEnd). Sorts by xEnd internally but preserves the input order and
 * does not mutate the input.
 */
export function withBadgeXs(markers, opts) {
  const order = markers.map((_, i) => i).sort((a, b) => markers[a].xEnd - markers[b].xEnd);
  const resolved = resolveBadgeXs(order.map((i) => markers[i].xEnd), opts);
  const out = markers.map((m) => ({ ...m }));
  order.forEach((mi, k) => { out[mi].badgeX = resolved[k]; });
  return out;
}
```

**Step 2: Run tests**

Run: `cd frontend && npx vitest run src/modules/Fitness/widgets/FitnessSessionDetailWidget/timelineOverlay.test.js`
Expected: PASS (all, including the 16 pre-existing).

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/timelineOverlay.js frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/timelineOverlay.test.js
git commit -m "feat(fitness): collision-free badgeX for challenge markers (resolveBadgeXs/withBadgeXs)"
```

### Task 3: Apply badgeX in the chart + connector tick

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx` (TABS!)

**Step 1: Import `withBadgeXs`.** Find (line ~18):

```js
import { computeRaceBands, computeSeamLines, computeChallengeMarkers, computeVideoMarkers } from '../FitnessSessionDetailWidget/timelineOverlay.js';
```

add `withBadgeXs` to that import list.

**Step 2: Decorate markers in `raceOverlay`** (~line 1240). Replace:

```js
			challengeMarkers: computeChallengeMarkers(events, opts),
```

with:

```js
			challengeMarkers: withBadgeXs(computeChallengeMarkers(events, opts), {
				minGap: 24, // badge diameter (22) + 2
				min: CHART_MARGIN.left + 11,
				max: CHART_MARGIN.left + innerWidth - 11
			}),
```

**Step 3: Use `badgeX` in the badge render** (~line 779). In the `co-badge-` block, change both `cx={m.xEnd}` and `x={m.xEnd}` to `m.badgeX ?? m.xEnd`, and add a 1px connector tick from the anchor when nudged (insert before `<circle …>`):

```jsx
						{m.badgeX != null && Math.abs(m.badgeX - m.xEnd) > 1 && (
							<line x1={m.xEnd} y1={cy + r} x2={m.badgeX} y2={cy + r} stroke={color} strokeWidth={1} opacity={0.5} />
						)}
```

(Note: with the anchor at `xEnd` and nudges small, a horizontal tick at the badge's underside is enough; no leader-line drama.)

**Step 4: Verify chart tests still pass**

Run: `cd frontend && npx vitest run src/modules/Fitness/widgets/FitnessChart src/modules/Fitness/widgets/FitnessSessionDetailWidget`
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx
git commit -m "feat(fitness): collision-nudged challenge badges with anchor tick in line chart"
```

### Task 4: De-mud the duration fills — top bracket in the chart

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx` (TABS!)

**Step 1:** In the race-bands group (~line 588), replace the challenge fill + line block body:

```jsx
						<g key={`co-chal-${i}`}>
							<rect x={m.x} y={overlay.top} width={Math.max(m.width, 2)} height={h} fill={color} opacity={0.12} />
							{/* solid edge on the RIGHT (challenge end) */}
								<line x1={m.xEnd} y1={overlay.top} x2={m.xEnd} y2={overlay.bottom} stroke={color} strokeWidth={1.5} opacity={0.9} />
						</g>
```

with:

```jsx
						<g key={`co-chal-${i}`}>
							{/* whisper fill — the bracket + edge line carry the duration signal */}
							<rect x={m.x} y={overlay.top} width={Math.max(m.width, 2)} height={h} fill={color} opacity={0.05} />
							{/* duration bracket hanging under the badge row: start → end */}
							<rect x={m.x} y={overlay.top + 25} width={Math.max(m.width, 2)} height={3} rx={1.5} fill={color} opacity={0.85} />
							{/* solid edge on the RIGHT (challenge end) */}
							<line x1={m.xEnd} y1={overlay.top} x2={m.xEnd} y2={overlay.bottom} stroke={color} strokeWidth={1.5} opacity={0.9} />
						</g>
```

(Badges sit at `cy = overlay.top + 12` with r=11, so a bracket at `top + 25` tucks just beneath them.)

**Step 2:** Quick smoke: `cd frontend && npx vitest run src/modules/Fitness/widgets/FitnessChart` → PASS.

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx
git commit -m "feat(fitness): duration bracket under badge row; whisper-opacity challenge fill in chart"
```

### Task 5: De-mud fills in the timeline + gutter

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.jsx`
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/MarkerGutter.jsx`

**Step 1:** In BOTH files, find the challenge `<rect … opacity={0.14} />` and change `0.14` → `0.06`. (Timeline: in the `timeline-challenge-marker` group. Gutter: in the `gl-chal-` group.)

**Step 2:** Run: `cd frontend && npx vitest run src/modules/Fitness/widgets/FitnessSessionDetailWidget` → PASS.

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.jsx frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/MarkerGutter.jsx
git commit -m "style(fitness): whisper-opacity challenge fills in timeline + gutter"
```

### Task 6: Dark halos under every indicator line

Yellow challenge lines vanish over warm-zone yellow HR fills. Give every vertical indicator a dark underlay drawn immediately beneath it (same coords, wider, dark).

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx` (TABS!)
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.jsx`
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/MarkerGutter.jsx`

**Step 1:** For each colored challenge edge line, insert a halo line directly before it (same x/y, `stroke="rgba(0,0,0,0.55)"`, `strokeWidth={3.5}`, no dash). Three sites:
- Chart race-bands group (the line added in Task 4).
- Timeline `timeline-challenge-marker` group.
- Gutter `gl-chal-` group.

Pattern (2-space files; use tabs in FitnessChart):

```jsx
<line x1={m.xEnd} y1={0} x2={m.xEnd} y2={plotHeight} stroke="rgba(0,0,0,0.55)" strokeWidth={3.5} />
<line x1={m.xEnd} y1={0} x2={m.xEnd} y2={plotHeight} stroke={color} strokeWidth={1.5} opacity={0.9} />
```

**Step 2:** Same for the white dashed video lines at all three sites — halo first with `stroke="rgba(0,0,0,0.55)"`, `strokeWidth={3.5}`, **`strokeDasharray="6 4"`** (matching dash so the halo gaps align):

```jsx
<line … stroke="rgba(0,0,0,0.55)" strokeWidth={3.5} strokeDasharray="6 4" />
<line … stroke="rgba(255,255,255,0.8)" strokeWidth={1.5} strokeDasharray="6 4" />
```

**Step 3:** Run: `cd frontend && npx vitest run src/modules/Fitness/widgets/FitnessChart src/modules/Fitness/widgets/FitnessSessionDetailWidget` → PASS.

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.jsx frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/MarkerGutter.jsx
git commit -m "style(fitness): dark halos under indicator lines (legible over warm-zone yellow)"
```

### Task 7: Run indicators through the x-axis strip

The chart's overlay stops at `overlay.bottom` (= `height - CHART_MARGIN.bottom`), leaving a dead band where the axis labels sit before the gutter resumes. Extend the lines through that strip **in the race-bands group only** (it renders BEFORE the axes group, so the labels stay painted on top and legible).

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx` (TABS!)

**Step 1:** In the race-bands group, change the challenge halo+edge lines' `y2` from `overlay.bottom` to `height` (the SVG prop already in scope in `RaceChartSvg`).

**Step 2:** Also in the race-bands group, ADD axis-strip extension segments for video markers (the main video lines stay in the seams group for z-order above the data paths; only the extension lives down here so labels overprint it):

```jsx
				{/* video-line extensions through the axis strip (labels paint on top) */}
				{(overlay.videoMarkers || []).map((m, i) => (
					<g key={`co-vid-ext-${i}`}>
						<line x1={m.x} x2={m.x} y1={overlay.bottom} y2={height} stroke="rgba(0,0,0,0.55)" strokeWidth={3.5} strokeDasharray="6 4" />
						<line x1={m.x} x2={m.x} y1={overlay.bottom} y2={height} stroke="rgba(255,255,255,0.8)" strokeWidth={1.5} strokeDasharray="6 4" />
					</g>
				))}
```

**Step 3:** Run: `cd frontend && npx vitest run src/modules/Fitness/widgets/FitnessChart` → PASS.

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx
git commit -m "feat(fitness): indicators run through the x-axis strip for a continuous cut"
```

### Task 8: Gutter only when video changes exist

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx` (~line 288)

**Step 1:** Replace the `hasMarkers` block:

```js
  // The center gutter only earns its vertical space when there are markers to show:
  // any challenge, or a video change (>1 non-audio media). Strava-map sessions have none.
  const events = sessionData?.timeline?.events;
  const hasMarkers = !header?.stravaHasMap && Array.isArray(events) && (
    events.some((e) => e?.type === 'challenge') ||
    events.filter((e) => e?.type === 'media' && e?.data?.contentType !== 'track' && !e?.data?.artist).length > 1
  );
```

with:

```js
  // The center gutter holds only video-change cards now (challenge badges live at the
  // top of the line chart), so it earns its 66px only when there IS a video change:
  // >1 non-audio media event. Strava-map sessions never show it.
  const events = sessionData?.timeline?.events;
  const hasVideoChanges = !header?.stravaHasMap && Array.isArray(events) &&
    events.filter((e) => e?.type === 'media' && e?.data?.contentType !== 'track' && !e?.data?.artist).length > 1;
```

**Step 2:** Update the render gate (`{hasMarkers && (` → `{hasVideoChanges && (`) on the `session-detail__gutter` block.

**Step 3:** Run: `cd frontend && npx vitest run src/modules/Fitness/widgets/FitnessSessionDetailWidget` → PASS.

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx
git commit -m "feat(fitness): reserve the marker gutter only for sessions with video changes"
```

### Task 9: Left-anchor video cards to the change line (with right-edge flip)

The dashed line is the *moment of change*; the card should start just right of it ("here's what started playing"), flipping to the left side near the right edge.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/MarkerGutter.jsx`
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/MarkerGutter.scss`

**Step 1 (JSX):** In the video-card map, compute the flip and add the modifier class:

```jsx
      {videoMarkers.map((m, i) => {
        const flip = width > 0 && m.x > width - 170; // card ≈160px wide; flip near the right edge
        return (
          <div
            key={`vid-${i}`}
            className={`marker-gutter__chip marker-gutter__chip--video${flip ? ' marker-gutter__chip--flip' : ''}`}
            style={{ left: `${m.x}px` }}
          >
            <div className="imgs">
              {m.posterUrl && <img className="poster" src={m.posterUrl} alt="" />}
              {m.thumbUrl && <img className="thumb" src={m.thumbUrl} alt="" />}
            </div>
            {m.episodeName && <div className="caption">{m.episodeName}</div>}
          </div>
        );
      })}
```

**Step 2 (SCSS):** Override the base chip centering for video cards:

```scss
  // Anchor the card's LEFT edge just right of the change line (the new video starts
  // there); flip to the left side when the line is near the right edge.
  &__chip--video {
    transform: translate(6px, -50%);

    &.marker-gutter__chip--flip {
      transform: translate(calc(-100% - 6px), -50%);
    }
  }
```

(Keep the existing `flex-direction: column; align-items: center;` and `.imgs`/`.caption` rules inside `&__chip--video` — only the transform changes/extends.)

**Step 3:** Run: `cd frontend && npx vitest run src/modules/Fitness/widgets/FitnessSessionDetailWidget` → PASS.

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/MarkerGutter.jsx frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/MarkerGutter.scss
git commit -m "feat(fitness): video cards left-anchored to the change line with right-edge flip"
```

### Task 10: Snap challenge end to the first visible zone tick

**Why (verified against session 20260608191948):** governance fires on per-second HR packets, but the saved zone series snapshots every 5s — so the zone band can turn warm 0–1.6 ticks AFTER the challenge-end line (felix: end tick 132.75, band flips at 134; end 162.41, band at 164). Fix: for zone challenges, slide the end line/badge right to the first tick where a met user's recorded zone shows the target zone (or higher), capped at 3 ticks; if none exists within the cap (possible — a user can spike between ticks and never show the color), keep the true time.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/timelineOverlay.js`
- Modify (test): `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/timelineOverlay.test.js`
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/useTimelineMarkers.js`
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.jsx`
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx` (TABS!)

**Step 1: Failing tests** — append to `timelineOverlay.test.js`:

```js
import { snapChallengeEndsToZoneTicks } from './timelineOverlay.js';

describe('snapChallengeEndsToZoneTicks', () => {
  const opts = { intervalMs: 5000, effectiveTicks: 121, plotWidth: 600, marginLeft: 0, sessionStartMs: 1_000_000 };
  // 5px per tick at this scale (600 / 120).
  const mk = (endTick, zoneId, metUsers) => ({
    x: 0, xEnd: endTick * 5, width: endTick * 5, type: 'zone', zoneId,
    result: 'success', metUsers, endMs: 1_000_000 + endTick * 5000
  });
  it('slides xEnd right to the first tick where a met user shows the zone', () => {
    // endTick 132.75-style case scaled down: end at tick 12.75, zone appears at tick 14
    const m = mk(12.75, 'warm', ['felix']);
    const zoneSeries = { felix: Array(20).fill('active') };
    zoneSeries.felix[14] = 'warm';
    const [out] = snapChallengeEndsToZoneTicks([m], zoneSeries, opts);
    expect(out.xEnd).toBeCloseTo(14 * 5, 5);
    expect(out.width).toBeCloseTo(out.xEnd - out.x, 5);
  });
  it('accepts a HIGHER zone than the target (hot counts for warm)', () => {
    const m = mk(10.2, 'warm', ['kc']);
    const zoneSeries = { kc: Array(20).fill('active') };
    zoneSeries.kc[11] = 'hot';
    const [out] = snapChallengeEndsToZoneTicks([m], zoneSeries, opts);
    expect(out.xEnd).toBeCloseTo(55, 5);
  });
  it('leaves xEnd unchanged when the zone never appears within the cap', () => {
    const m = mk(10.2, 'warm', ['kc']);
    const zoneSeries = { kc: Array(20).fill('active') }; // never warm
    const [out] = snapChallengeEndsToZoneTicks([m], zoneSeries, opts);
    expect(out.xEnd).toBeCloseTo(51, 5);
  });
  it('leaves cycle challenges and markers already inside the zone untouched', () => {
    const cyc = { ...mk(8, null, []), type: 'cycle', zoneId: null };
    const inZone = mk(6.0, 'warm', ['kc']);
    const zoneSeries = { kc: Array(20).fill('warm') };
    const out = snapChallengeEndsToZoneTicks([cyc, inZone], zoneSeries, opts);
    expect(out[0].xEnd).toBeCloseTo(40, 5);
    expect(out[1].xEnd).toBeCloseTo(30, 5); // tick 6 already warm -> snap to floor tick = 6
  });
});
```

**Step 2:** Run → expect FAIL (function missing).

**Step 3: Implement** in `timelineOverlay.js`. First, `computeChallengeMarkers` must also expose `metUsers` and `endMs` (add `metUsers: Array.isArray(d.metUsers) ? d.metUsers : []` — note `d` is `e.data` — and `endMs`) so the snap has what it needs. Then:

```js
const ZONE_RANK = { rest: 0, cool: 1, active: 2, warm: 3, hot: 4, fire: 5 };
const SNAP_CAP_TICKS = 3; // bounded by the sampling error we measured (max ~1.6 ticks)

/**
 * The governance engine fires on per-second HR packets, but the saved zone series
 * samples every 5s — the visible band can flip up to ~2 ticks after a challenge's
 * true end. For zone challenges, slide xEnd right to the first tick (within the cap)
 * where a met user's recorded zone reaches the target, so the line lands on the
 * visible band edge. Truthful fallback: no qualifying tick -> keep the true x.
 * @param {Array} markers - from computeChallengeMarkers (needs zoneId/metUsers/endMs)
 * @param {Object} zoneSeriesByUser - { userId: string[] } per-tick zone ids
 */
export function snapChallengeEndsToZoneTicks(markers, zoneSeriesByUser, opts) {
  if (!markers?.length || !zoneSeriesByUser) return markers || [];
  const targetRankOf = (zoneId) => ZONE_RANK[zoneId] ?? null;
  return markers.map((m) => {
    const rank = m.type === 'zone' ? targetRankOf(m.zoneId) : null;
    if (rank == null || !Number.isFinite(m.endMs) || !m.metUsers?.length) return m;
    const endTick = (m.endMs - opts.sessionStartMs) / opts.intervalMs;
    const from = Math.floor(endTick);
    let snapTick = null;
    for (let t = from; t <= from + SNAP_CAP_TICKS; t++) {
      const hit = m.metUsers.some((u) => {
        const z = zoneSeriesByUser[u]?.[t];
        return z != null && (ZONE_RANK[z] ?? -1) >= rank;
      });
      if (hit) { snapTick = t; break; }
    }
    if (snapTick == null) return m;
    const xEnd = Math.min(opts.marginLeft + opts.plotWidth, Math.max(m.x, msToTickX(snapTick * opts.intervalMs, opts)));
    return { ...m, xEnd, width: Math.max(0, xEnd - m.x) };
  });
}
```

(Check the "already inside the zone" test: end tick 6.0 with zone warm at tick 6 snaps to tick 6 → x=30, same as truth. Good.)

**Step 4:** Wire it up. In `useTimelineMarkers.js`, after computing `challengeMarkers`, build the zone lookup from the data source and snap:

```js
    const zoneSeriesByUser = {};
    for (const entry of roster || []) {
      const userId = entry.id || entry.profileId;
      zoneSeriesByUser[userId] = getSeries(userId, 'zone_id', { clone: false }) || getSeries(userId, 'zone', { clone: false }) || [];
    }
    // …
    challengeMarkers: snapChallengeEndsToZoneTicks(computeChallengeMarkers(events, opts), zoneSeriesByUser, opts),
```

In `FitnessTimeline.jsx`'s `overlay` useMemo, apply the same snap (it already has `getSeries`/`roster` in scope). In `FitnessChart.jsx`'s `raceOverlay`, the data source is `staticSource` — build the same lookup from `chartParticipants`/`chartGetSeries` and snap before `withBadgeXs` (snap first, then badge-collision-resolve, so badges anchor to snapped ends).

**Step 5:** Run the full widget + chart suites → PASS. Commit:

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/timelineOverlay.js frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/timelineOverlay.test.js frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/useTimelineMarkers.js frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.jsx frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx
git commit -m "fix(fitness): snap challenge-end markers to the first visible zone tick (bounded)"
```

### Task 11: Full test pass + live visual verification

**Step 1: Full fitness suite**

Run: `cd frontend && npx vitest run src/modules/Fitness src/Apps/fitnessSessionPersistence.test.js src/hooks/fitness`
Expected: PASS (0 failures).

**Step 2: Live visual check.** Confirm the dev server is up (`lsof -i :3111`; if not: `npm run dev` from repo root and wait for "ready"). Write `tests/_tmp_verify_polish.mjs`:

```js
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
mkdirSync('/tmp/polish-verify', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newContext({ viewport: { width: 1700, height: 1200 }, deviceScaleFactor: 2 }).then(c => c.newPage());
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:3111/fitness/home/session-20260608191948', { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(7000);
const info = await page.evaluate(() => ({
  badges: document.querySelectorAll('.race-chart__challenge-badge').length,
  gutter: !!document.querySelector('.session-detail__gutter'),
  flipCards: document.querySelectorAll('.marker-gutter__chip--flip').length,
  videoCards: document.querySelectorAll('.marker-gutter__chip--video').length,
}));
console.log('VERIFY:', JSON.stringify(info), 'ERRORS:', errors.slice(0, 5));
const el = await page.$('.session-detail');
if (el) await el.screenshot({ path: '/tmp/polish-verify/detail.png' });
await browser.close();
```

Run: `node tests/_tmp_verify_polish.mjs`
Expected: `badges: 7`, `gutter: true`, `videoCards: 1`, no errors.

**Step 3: READ the screenshot** (`/tmp/polish-verify/detail.png` via the Read tool) and confirm visually:
- No muddy wide rectangles — duration brackets visible under the badge row instead.
- Badges separated (no touching circles in the ~13:00 cluster).
- Challenge/video lines legible over yellow zone fills (halo visible).
- Lines continue through the axis-label strip.
- Video card starts to the right of its dashed line.

If anything looks off, fix before committing. **Do not skip the screenshot read** — metrics alone don't catch visual regressions.

**Step 4: Also verify the no-video case** (gutter absent): repeat with session `20260608060455` (plain HR session) — expect `gutter: false` and the chart flowing straight into the timeline.

**Step 5: Final commit + push**

```bash
git status --short   # confirm only intended files; leave package-lock + _tmp scripts out
git push origin main
```

Then tell KC the `tests/_tmp_verify_polish.mjs` scratch file needs manual deletion (`rm` is permission-blocked for the agent).

---

## Out of scope (noted, deliberately skipped — YAGNI)

- Leader-avatar clipping at the right plot edge (pre-existing `FitnessChart` layout).
- `LOG` chip crowding the y-axis labels (pre-existing).
- Hover/tooltip interactions on badges and cards (TV-first UI; no pointer).
