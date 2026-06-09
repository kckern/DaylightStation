# Fitness Session-Detail Timeline Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new marker layers to the session-detail timeline: (A) a dashed video-change marker with a poster+thumbnail card for each mid-session video, and (B) a dotted challenge marker whose flag shows the challenge type, driven by a central challenge-type registry.

**Architecture:** The timeline is a tick-indexed SVG (`FitnessTimeline.jsx`) with pure overlay geometry helpers (`timelineOverlay.js`). Marker timestamps live on `timeline.events` as absolute epoch ms, so we add a `sessionStartMs` origin to the overlay options and rebase event times onto the tick axis with the existing `msToTickX`. The video card (rich HTML) renders in an absolutely-positioned overlay layer above the SVG. Challenge markers read a new `challengeTypeRegistry`; we also persist the challenge `type` (currently dropped) so cycle-vs-zone is reliable.

**Tech Stack:** React/SVG, vitest. Co-located `*.test.js` next to source.

**Audit reference:** `docs/_wip/audits/2026-06-08-bug-bash-fitness-multi-issue-audit.md` (Item 1).

**Marker rules locked for this plan:**
- Video markers: render one per video **except the first** (the opening slot — whether a warm-up or the hero — gets no flag; videos 2, 3, … do). This satisfies both audit scenarios without cross-referencing the hero flag.
- Video marker line: **dashed**. Challenge marker line: **dotted** (distinct from the existing dashed seam line).

---

## File Structure

| File | Responsibility | New/Modify |
|------|----------------|------------|
| `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/sessionDetailUtils.js` | `mediaDisplayUrl`, `resolveSessionStartMs` (shared by header + timeline) | Create |
| `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/sessionDetailUtils.test.js` | Tests for the shared utils | Create |
| `frontend/src/modules/Fitness/lib/activities/challengeTypeRegistry.js` | Enumerated challenge types → `{label,color,icon}` | Create |
| `frontend/src/modules/Fitness/lib/activities/challengeTypeRegistry.test.js` | Registry + `resolveChallengeMarkerType` tests | Create |
| `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/timelineOverlay.js` | `computeVideoMarkers`, `computeChallengeMarkers` | Modify |
| `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/timelineOverlay.test.js` | Tests for the new compute helpers | Modify |
| `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.jsx` | Wire markers into the overlay; render lines + card | Modify |
| `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.scss` | Marker line + flag-card styles | Modify |
| `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx` | Use shared `mediaDisplayUrl`/`resolveSessionStartMs` | Modify |
| `frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx` | Persist challenge `type` in event payload | Modify |
| `frontend/src/hooks/fitness/PersistenceManager.js` | Carry `type` through challenge consolidation | Modify |

---

## Task 1: Shared session-detail utils (origin + display URL)

Extract `mediaDisplayUrl` (currently private to the widget) and add `resolveSessionStartMs`, so the timeline can rebase event epochs onto the tick axis using the exact same origin the header uses.

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/sessionDetailUtils.js`
- Create: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/sessionDetailUtils.test.js`
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx:30` (`mediaDisplayUrl`), `:216` (start derivation)

- [ ] **Step 1: Write the failing utils test**

Create `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/sessionDetailUtils.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { mediaDisplayUrl, resolveSessionStartMs } from './sessionDetailUtils.js';

describe('mediaDisplayUrl', () => {
  it('builds a source-qualified display url', () => {
    expect(mediaDisplayUrl('plex:674287')).toBe('/api/v1/display/plex/674287');
  });
  it('defaults bare ids to plex', () => {
    expect(mediaDisplayUrl('674287')).toBe('/api/v1/display/plex/674287');
  });
  it('returns null for empty input', () => {
    expect(mediaDisplayUrl(null)).toBeNull();
  });
});

describe('resolveSessionStartMs', () => {
  it('prefers session.start (ISO)', () => {
    expect(resolveSessionStartMs({ session: { start: '2026-06-08T19:19:48.000Z' } }))
      .toBe(Date.parse('2026-06-08T19:19:48.000Z'));
  });
  it('falls back to root .start then numeric startTime', () => {
    expect(resolveSessionStartMs({ start: '2026-06-08T19:19:48.000Z' }))
      .toBe(Date.parse('2026-06-08T19:19:48.000Z'));
    expect(resolveSessionStartMs({ startTime: 1780971588000 })).toBe(1780971588000);
  });
  it('returns null when no start is available', () => {
    expect(resolveSessionStartMs({})).toBeNull();
    expect(resolveSessionStartMs(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/sessionDetailUtils.test.js`
Expected: FAIL — cannot resolve `./sessionDetailUtils.js`.

- [ ] **Step 3: Implement the utils**

Create `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/sessionDetailUtils.js`:

```javascript
/** Build a display image URL from a (possibly source-qualified) content id. */
export function mediaDisplayUrl(contentId) {
  if (!contentId) return null;
  const str = String(contentId);
  if (str.includes(':')) {
    const [source, id] = str.split(':', 2);
    return `/api/v1/display/${source}/${id}`;
  }
  return `/api/v1/display/plex/${str}`;
}

/**
 * Resolve the session start as epoch ms — the origin for rebasing timeline
 * event timestamps onto the tick axis. Mirrors the header's derivation:
 * group detail puts start at the root; normal sessions nest it under .session.
 */
export function resolveSessionStartMs(sessionData) {
  if (!sessionData) return null;
  const session = sessionData.session || {};
  if (session.start) return new Date(session.start).getTime();
  if (sessionData.start != null) return new Date(sessionData.start).getTime();
  if (Number.isFinite(sessionData.startTime)) return sessionData.startTime;
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/sessionDetailUtils.test.js`
Expected: PASS — `Tests 6 passed`.

- [ ] **Step 5: Use the shared util in the widget (no behavior change)**

In `FitnessSessionDetailWidget.jsx`, delete the local `mediaDisplayUrl` function (`:30-38`) and import it instead. Add to the imports:

```javascript
import { mediaDisplayUrl, resolveSessionStartMs } from './sessionDetailUtils.js';
```

The header's existing `startMs` computation (`:216-218`) can stay; `resolveSessionStartMs` is imported now for the timeline to use (Task 5). Confirm the file still references `mediaDisplayUrl` at `:248-249` (it does).

- [ ] **Step 6: Run the widget's existing tests to confirm no regression**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.refresh.test.jsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/sessionDetailUtils.js \
        frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/sessionDetailUtils.test.js \
        frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx
git commit -m "refactor(fitness): extract shared session-detail utils (mediaDisplayUrl, resolveSessionStartMs)"
```

---

## Task 2: Persist the challenge `type`

The runtime knows cycle-vs-zone (`challenge.type === 'cycle'`) but the persisted event drops it. Add it at the source and carry it through consolidation so challenge markers can be classified reliably.

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx:35` (`buildChallengeEventPayload`) — also export it for testing
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js:441-453` (consolidation)
- Create: `frontend/src/modules/Fitness/player/buildChallengeEventPayload.test.js`

- [ ] **Step 1: Write the failing payload test**

Create `frontend/src/modules/Fitness/player/buildChallengeEventPayload.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { buildChallengeEventPayload } from './FitnessPlayerOverlay.jsx';

describe('buildChallengeEventPayload', () => {
  it('persists the cycle type', () => {
    const payload = buildChallengeEventPayload({ id: 'c1', type: 'cycle' }, 'pending');
    expect(payload.type).toBe('cycle');
  });

  it('persists null type for an HR/zone challenge', () => {
    const payload = buildChallengeEventPayload({ id: 'c2', zone: 'warm', requiredCount: 1 }, 'pending');
    expect(payload.type).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/buildChallengeEventPayload.test.js`
Expected: FAIL — `buildChallengeEventPayload` is not exported (import is `undefined`).

- [ ] **Step 3: Export the builder and add `type`**

In `FitnessPlayerOverlay.jsx`, change the declaration (`:35`) to a named export and add `type` to the returned object (next to `challengeId`/`zoneId`):

```javascript
export const buildChallengeEventPayload = (challenge, statusOverride = null) => {
```

Inside the returned payload object, add (mirroring the existing `zoneId` line `:41`):

```javascript
    type: challenge.type || null,
```

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/buildChallengeEventPayload.test.js`
Expected: PASS — `Tests 2 passed`.

- [ ] **Step 5: Carry `type` through consolidation**

In `PersistenceManager.js`, in the challenge consolidation `data` object (`:441-453`), add `type` (mirroring the `zoneId` passthrough at `:443`):

```javascript
      data: {
        challengeId: id,
        type: s.type || e.type || null,
        zoneId: s.zoneId || e.zoneId || null,
        zoneLabel: s.zoneLabel || e.zoneLabel || null,
        // ...rest unchanged...
```

- [ ] **Step 6: Confirm no regression in the persistence/widget tests**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/buildChallengeEventPayload.test.js`
Expected: PASS. (The consolidation change is a pure passthrough identical in shape to the adjacent `zoneId` field.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx \
        frontend/src/modules/Fitness/player/buildChallengeEventPayload.test.js \
        frontend/src/hooks/fitness/PersistenceManager.js
git commit -m "feat(fitness): persist challenge type (cycle vs zone) through to the timeline"
```

---

## Task 3: Challenge-type registry + marker-type classifier

Add a central registry of challenge types (the audit found icon/color knowledge scattered) and a classifier that prefers the persisted `type` with a heuristic fallback for old sessions.

**Files:**
- Create: `frontend/src/modules/Fitness/lib/activities/challengeTypeRegistry.js`
- Create: `frontend/src/modules/Fitness/lib/activities/challengeTypeRegistry.test.js`

- [ ] **Step 1: Write the failing registry test**

Create `frontend/src/modules/Fitness/lib/activities/challengeTypeRegistry.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { getChallengeTypeDisplay, resolveChallengeMarkerType } from './challengeTypeRegistry.js';

describe('getChallengeTypeDisplay', () => {
  it('returns the cycle descriptor', () => {
    const d = getChallengeTypeDisplay('cycle');
    expect(d.label).toBe('Cycle');
    expect(d.icon).toBe('🚴');
    expect(typeof d.color).toBe('string');
  });
  it('returns the zone descriptor', () => {
    expect(getChallengeTypeDisplay('zone').label).toBe('Zone');
  });
  it('falls back to a generic descriptor for unknown types', () => {
    const d = getChallengeTypeDisplay('mystery');
    expect(d).toBeTruthy();
    expect(typeof d.color).toBe('string');
  });
});

describe('resolveChallengeMarkerType', () => {
  it('prefers an explicit persisted type', () => {
    expect(resolveChallengeMarkerType({ data: { type: 'cycle', zoneId: 'warm' } })).toBe('cycle');
  });
  it('heuristically treats a missing zoneId as cycle (legacy events)', () => {
    expect(resolveChallengeMarkerType({ data: { type: null, zoneId: null } })).toBe('cycle');
  });
  it('heuristically treats a present zoneId as zone (legacy events)', () => {
    expect(resolveChallengeMarkerType({ data: { type: null, zoneId: 'warm' } })).toBe('zone');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/activities/challengeTypeRegistry.test.js`
Expected: FAIL — cannot resolve `./challengeTypeRegistry.js`.

- [ ] **Step 3: Implement the registry**

Create `frontend/src/modules/Fitness/lib/activities/challengeTypeRegistry.js`:

```javascript
/**
 * Central registry of in-session challenge types → marker presentation.
 * Consolidates icon/color knowledge that was previously scattered across
 * buildChallengeToast (emoji), cycleOverlayVisuals (ring colors), and
 * ZONE_COLOR_MAP. Used by the session-detail timeline challenge markers.
 *
 * Each entry: { label, color (hex), icon (emoji/string) }.
 */
const REGISTRY = {
  cycle: { label: 'Cycle', color: '#f59e0b', icon: '🚴' },
  zone:  { label: 'Zone',  color: '#3ba776', icon: '🎯' }
};

const FALLBACK = { label: 'Challenge', color: '#94a3b8', icon: '🏆' };

/** Presentation descriptor for a challenge type (never null). */
export function getChallengeTypeDisplay(type) {
  return REGISTRY[type] || FALLBACK;
}

/**
 * Classify a persisted challenge event as 'cycle' or 'zone'. Prefers the
 * persisted `data.type`; for legacy events without it, a missing zoneId implies
 * a cycle challenge (cycle challenges carry no zone).
 */
export function resolveChallengeMarkerType(event) {
  const d = event?.data || {};
  if (d.type === 'cycle' || d.type === 'zone') return d.type;
  if (d.type) return d.type;
  return d.zoneId == null ? 'cycle' : 'zone';
}

export default { getChallengeTypeDisplay, resolveChallengeMarkerType };
```

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/activities/challengeTypeRegistry.test.js`
Expected: PASS — `Tests 6 passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/activities/challengeTypeRegistry.js \
        frontend/src/modules/Fitness/lib/activities/challengeTypeRegistry.test.js
git commit -m "feat(fitness): central challenge-type registry + marker-type classifier"
```

---

## Task 4: Pure marker-geometry helpers

Add `computeVideoMarkers` and `computeChallengeMarkers` to `timelineOverlay.js`, rebasing absolute event epochs onto the tick axis.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/timelineOverlay.js`
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/timelineOverlay.test.js`

- [ ] **Step 1: Write the failing helper tests**

Append to `timelineOverlay.test.js` (it already imports from `./timelineOverlay.js` and defines `OPTS`):

```javascript
import { computeVideoMarkers, computeChallengeMarkers } from './timelineOverlay.js';

const MARKER_OPTS = { intervalMs: 5000, effectiveTicks: 121, plotWidth: 600, marginLeft: 0, sessionStartMs: 1_000_000 };

const videoEvent = (startOffsetSec, over = {}) => ({
  type: 'media',
  data: { contentId: 'plex:1', title: 'Ep', grandparentId: 'plex:9', start: 1_000_000 + startOffsetSec * 1000, ...over }
});

describe('computeVideoMarkers', () => {
  it('omits the first video (opening slot) and marks the rest', () => {
    const events = [videoEvent(0, { title: 'Warmup' }), videoEvent(300, { title: 'Hero', contentId: 'plex:2' })];
    const markers = computeVideoMarkers(events, MARKER_OPTS);
    expect(markers).toHaveLength(1);
    expect(markers[0].episodeName).toBe('Hero');
    expect(markers[0].thumbUrl).toBe('/api/v1/display/plex/2');
    expect(markers[0].posterUrl).toBe('/api/v1/display/plex/9');
    expect(markers[0].x).toBeGreaterThan(0);
  });

  it('returns no markers for a single-video session', () => {
    expect(computeVideoMarkers([videoEvent(0)], MARKER_OPTS)).toHaveLength(0);
  });

  it('ignores audio (track) media', () => {
    const events = [videoEvent(0), { type: 'media', data: { contentId: 'plex:3', artist: 'X', start: 1_300_000 } }];
    expect(computeVideoMarkers(events, MARKER_OPTS)).toHaveLength(0);
  });
});

describe('computeChallengeMarkers', () => {
  it('places a dotted marker per challenge with a resolved type', () => {
    const events = [
      { type: 'challenge', data: { challengeId: 'a', type: 'cycle', start: 1_060_000, result: 'success' } },
      { type: 'challenge', data: { challengeId: 'b', zoneId: 'warm', start: 1_120_000, result: 'fail', zoneLabel: 'Warm' } }
    ];
    const markers = computeChallengeMarkers(events, MARKER_OPTS);
    expect(markers).toHaveLength(2);
    expect(markers[0].type).toBe('cycle');
    expect(markers[1].type).toBe('zone');
    expect(markers[1].label).toBe('Warm');
    expect(markers[0].x).toBeGreaterThan(0);
  });

  it('returns [] when there are no challenge events', () => {
    expect(computeChallengeMarkers([{ type: 'media', data: {} }], MARKER_OPTS)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/timelineOverlay.test.js`
Expected: FAIL — `computeVideoMarkers`/`computeChallengeMarkers` are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `timelineOverlay.js` (it already has `msToTickX` and a `clampX` local):

```javascript
import { mediaDisplayUrl } from './sessionDetailUtils.js';
import { resolveChallengeMarkerType } from '@/modules/Fitness/lib/activities/challengeTypeRegistry.js';

const isVideoMedia = (evt) => {
  const d = evt?.data || {};
  return evt?.type === 'media' && d.contentType !== 'track' && !d.artist;
};

/**
 * Video-change markers. The first video (the opening slot — warm-up OR hero)
 * gets no flag; videos 2..N are marked at their start. Event `start` is absolute
 * epoch ms, rebased onto the tick axis via opts.sessionStartMs.
 */
export function computeVideoMarkers(events, opts) {
  if (!Array.isArray(events) || !Number.isFinite(opts?.sessionStartMs)) return [];
  const videos = events
    .filter(isVideoMedia)
    .filter((e) => Number.isFinite(e.data?.start))
    .sort((a, b) => a.data.start - b.data.start);
  return videos.slice(1).map((e) => {
    const offsetMs = e.data.start - opts.sessionStartMs;
    return {
      x: clampX(msToTickX(offsetMs, opts), opts),
      episodeName: e.data.title || null,
      posterUrl: mediaDisplayUrl(e.data.grandparentId),
      thumbUrl: mediaDisplayUrl(e.data.contentId)
    };
  });
}

/** Challenge markers (dotted). Type resolved via the registry classifier. */
export function computeChallengeMarkers(events, opts) {
  if (!Array.isArray(events) || !Number.isFinite(opts?.sessionStartMs)) return [];
  return events
    .filter((e) => e?.type === 'challenge' && Number.isFinite(e.data?.start))
    .map((e) => ({
      x: clampX(msToTickX(e.data.start - opts.sessionStartMs, opts), opts),
      type: resolveChallengeMarkerType(e),
      result: e.data.result || null,
      label: e.data.zoneLabel || e.data.title || null,
      requiredCount: Number.isFinite(e.data.requiredCount) ? e.data.requiredCount : null
    }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/timelineOverlay.test.js`
Expected: PASS — the existing 9 tests plus the 5 new ones pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/timelineOverlay.js \
        frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/timelineOverlay.test.js
git commit -m "feat(fitness): timeline video-change + challenge marker geometry helpers"
```

---

## Task 5: Render markers in the timeline

Wire the new markers into `FitnessTimeline`'s overlay memo and render the dashed/dotted lines (SVG) plus the video card (HTML overlay layer).

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.jsx:247` (overlay memo), render body
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.scss`

- [ ] **Step 1: Add the marker computation to the overlay memo**

In `FitnessTimeline.jsx`, update the imports (`:5`, `:6`):

```javascript
import { computeRaceBands, computeSeamLines, computeVideoMarkers, computeChallengeMarkers } from './timelineOverlay.js';
import { resolveSessionStartMs } from './sessionDetailUtils.js';
import { getChallengeTypeDisplay } from '@/modules/Fitness/lib/activities/challengeTypeRegistry.js';
```

Replace the `overlay` memo (`:247-254`) so it threads `sessionStartMs` and computes markers:

```javascript
  const overlay = useMemo(() => {
    const sessionStartMs = resolveSessionStartMs(sessionData);
    const opts = { intervalMs, effectiveTicks, plotWidth, marginLeft: CHART_MARGIN.left, sessionStartMs };
    const events = sessionData?.timeline?.events;
    return {
      bands: computeRaceBands(sessionData?.activities, opts),
      seams: computeSeamLines(sessionData?.seams, opts),
      videoMarkers: computeVideoMarkers(events, opts),
      challengeMarkers: computeChallengeMarkers(events, opts),
      accent: getActivityDisplay(primaryActivity(sessionData?.activities)?.type)?.accent || '#3ba776',
    };
  }, [sessionData, intervalMs, effectiveTicks, plotWidth]);
```

- [ ] **Step 2: Render the marker lines inside the SVG**

In `FitnessTimeline.jsx`, after the existing seams group (`:357`, just before `</svg>`), add the challenge dotted lines and video dashed lines:

```javascript
        {/* challenge markers (dotted) */}
        {overlay.challengeMarkers.map((m, i) => {
          const d = getChallengeTypeDisplay(m.type);
          return (
            <g key={`chal-${i}`} className="timeline-challenge-marker">
              <line x1={m.x} y1={0} x2={m.x} y2={plotHeight} stroke={d.color} strokeWidth={1.5} strokeDasharray="1 4" opacity={0.85} />
            </g>
          );
        })}
        {/* video-change markers (dashed) */}
        {overlay.videoMarkers.map((m, i) => (
          <g key={`vid-${i}`} className="timeline-video-marker">
            <line x1={m.x} y1={0} x2={m.x} y2={plotHeight} stroke="rgba(255,255,255,0.8)" strokeWidth={1.5} strokeDasharray="6 4" />
          </g>
        ))}
```

- [ ] **Step 3: Render the HTML overlay layer for cards + challenge flags**

In `FitnessTimeline.jsx`, the outer container is the `<div ref={containerRef} className="fitness-timeline">` wrapping the `<svg>` (`:288-359`). Add an HTML overlay layer as a sibling AFTER the `</svg>` but inside that div:

```javascript
      </svg>
      <div className="fitness-timeline__markers" aria-hidden="true">
        {overlay.challengeMarkers.map((m, i) => {
          const d = getChallengeTypeDisplay(m.type);
          return (
            <div key={`chal-flag-${i}`} className="timeline-challenge-flag" style={{ left: `${m.x}px`, borderColor: d.color }}>
              <span className="icon">{d.icon}</span>
              {m.requiredCount != null && <span className="count">{m.requiredCount}</span>}
            </div>
          );
        })}
        {overlay.videoMarkers.map((m, i) => (
          <div key={`vid-card-${i}`} className="timeline-video-card" style={{ left: `${m.x}px` }}>
            <div className="imgs">
              {m.posterUrl && <img className="poster" src={m.posterUrl} alt="" />}
              {m.thumbUrl && <img className="thumb" src={m.thumbUrl} alt="" />}
            </div>
            {m.episodeName && <div className="caption">{m.episodeName}</div>}
          </div>
        ))}
      </div>
    </div>
```

(Adjust the closing tags so the new `<div className="fitness-timeline__markers">` and the existing `<svg>` are both children of the `fitness-timeline` div.)

- [ ] **Step 4: Add the marker styles**

Append to `FitnessTimeline.scss`:

```scss
.fitness-timeline {
  position: relative; // anchor the absolutely-positioned marker overlay

  &__markers {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
}

.timeline-video-card {
  position: absolute;
  top: 2px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;

  .imgs {
    display: flex;
    align-items: stretch;
    height: 44px;
    border-radius: 3px;
    overflow: hidden;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);

    .poster { height: 44px; width: auto; object-fit: cover; }   // portrait
    .thumb  { height: 44px; width: auto; object-fit: cover; }   // landscape, matched height
  }

  .caption {
    margin-top: 2px;
    max-width: 140px;
    font-size: 10px;
    line-height: 1.1;
    text-align: center;
    color: rgba(255, 255, 255, 0.9);
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.timeline-challenge-flag {
  position: absolute;
  top: 2px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 1px 4px;
  border-radius: 3px;
  border: 1.5px solid;
  background: rgba(0, 0, 0, 0.55);
  font-size: 11px;

  .count { color: #fff; font-weight: 600; }
}
```

- [ ] **Step 5: Build sanity check**

Run a build to confirm the JSX/SCSS compile:
`npm run build 2>&1 | tail -8` (or `cd frontend && npx vite build`).
Expected: build completes; no errors referencing `FitnessTimeline.jsx` or `FitnessTimeline.scss`.

- [ ] **Step 6: Manual verification**

On a running dev server, open a session-detail page for a session that played **multiple videos** and ran **challenges** (e.g. the June 8 group session `20260608191948`). Confirm:
- No video flag at the opening slot; a dashed line + poster/thumbnail card for each later video, captioned with the episode name.
- A dotted line + type flag (🚴 for cycle, 🎯 + count for zone) at each challenge, colored per the registry.

Capture a screenshot as evidence.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.jsx \
        frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.scss
git commit -m "feat(fitness): render video-change + challenge markers on the session timeline"
```

---

## Final Verification

- [ ] Run every new/changed unit suite:

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/sessionDetailUtils.test.js \
  frontend/src/modules/Fitness/lib/activities/challengeTypeRegistry.test.js \
  frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/timelineOverlay.test.js \
  frontend/src/modules/Fitness/player/buildChallengeEventPayload.test.js
```
Expected: all pass, 0 failed.

- [ ] Deploy and confirm on a real multi-video, multi-challenge session that both marker layers render correctly and the first video has no flag.
