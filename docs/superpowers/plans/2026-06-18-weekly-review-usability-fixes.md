# WeeklyReview Usability Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the usability defects found in the 2026-06-18 WeeklyReview audit — the "can't exit" trap, blank empty-days, accidental exits, dead touch buttons, missing control hints, and accessibility gaps.

**Architecture:** WeeklyReview is a remote/keypad-driven kiosk widget. Input flows through a pure resolver (`state/keymap.js`) into two reducers (`viewReducer`, `modalReducer`); React components are presentational. We keep that separation: logic fixes land in `keymap.js`/reducers (unit-tested), presentational fixes land in components, and shared day-data rendering is extracted into a reusable component for DRY.

**Tech Stack:** React (JSX), SCSS, Vitest + @testing-library/react. Backend unchanged. Test runner: `npx vitest run <file>`.

---

## Source of truth

Audit: `docs/_wip/audits/2026-06-18-weekly-review-usability-audit.md`

Verified invariants (do not re-discover):
- Bootstrap always returns an 8-day window (`WeeklyReviewService.mjs:37,431`), so `data.days.length` is ≤ 8 and the grid renders every day. The current `slice(-8)`/`offset` math is a no-op today but lets grid focus leave the rendered set if the window ever grows — Task 5 removes it.
- `DaylightAPI(path, data, method)` (`frontend/src/lib/api.mjs:11`) issues a bare `fetch` with **no abort/timeout**. Network calls must be bounded by the caller — Task 2 adds `withTimeout`.
- WeeklyReview tests are **Vitest** (`import { describe, it, expect } from 'vitest'`). Run a single file with `npx vitest run <path>`.

---

## File Structure

**Create:**
- `frontend/src/modules/WeeklyReview/hooks/withTimeout.js` — bound a promise so finalize can't hang.
- `frontend/src/modules/WeeklyReview/hooks/withTimeout.test.js`
- `frontend/src/modules/WeeklyReview/components/dayData.js` — shared weather/timeline helpers (moved from `DayContextPanel`).
- `frontend/src/modules/WeeklyReview/components/DayDataPoints.jsx` — presentational weather/timeline/people/summary block, with a quiet-day fallback. Used by both the day context panel and the empty reel.
- `frontend/src/modules/WeeklyReview/components/DayDataPoints.test.jsx`
- `frontend/src/modules/WeeklyReview/components/ConfirmOverlay.jsx` — modal shell that moves focus to the dialog on open (a11y).
- `frontend/src/modules/WeeklyReview/components/ControlLegend.jsx` — persistent, context-sensitive control hints.
- `frontend/src/modules/WeeklyReview/components/ControlLegend.test.jsx`
- `frontend/src/modules/WeeklyReview/components/DayColumn.test.jsx`

**Modify:**
- `state/keymap.js` — exit-gate Back exits; remove accidental Up-exit. (`keymap.test.js` updated)
- `components/DayContextPanel.jsx` — delegate to `DayDataPoints`.
- `components/DayReel.jsx` — empty state renders `DayDataPoints`; accept `day`. (`DayReel.test.jsx` updated)
- `components/DayColumn.jsx` — count calendar as content; full aria-label; import shared helpers.
- `components/RecordingBar.jsx` — visible silence-warning message.
- `WeeklyReview.jsx` — bound finalize with `withTimeout`; pop-guard exits on second Back; render all days; pass `day` to reel; wire modal buttons for touch; add `ControlLegend`; use `ConfirmOverlay`.
- `WeeklyReview.scss` — empty-state contrast; styles for `DayDataPoints` in reel, `ControlLegend`.

---

## Task 1: Exit-gate Back exits (fix the "can't exit" trap)

**Why:** Today, Back/Escape on the exit gate only CLOSES it (`keymap.js:30`), so mashing Back — the universal "get me out" gesture — toggles the gate forever and never exits.

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/state/keymap.js:29-36`
- Test: `frontend/src/modules/WeeklyReview/state/keymap.test.js:141-157`

- [ ] **Step 1: Update the failing test for the exit gate**

In `state/keymap.test.js`, find the `describe('keymap — exit gate modal', ...)` block. Replace the existing `it('Enter on "Keep going" ...')` test (around lines 147-156) with:

```javascript
  it('Enter on "Keep going" closes; on "Save & end" closes + saveAndExit', () => {
    const keep = resolveKey(gate(0, 'Enter'));
    expect(keep.modal).toEqual([{ type: 'CLOSE' }]);
    expect(keep.intents).toEqual([]);
    const save = resolveKey(gate(1, 'Enter'));
    expect(save.modal).toEqual([{ type: 'CLOSE' }]);
    expect(save.intents).toEqual(['saveAndExit']);
  });

  it('Back on the gate confirms exit (mash-Back must escape)', () => {
    const back = resolveKey(gate(0, 'Escape'));
    expect(back.modal).toEqual([{ type: 'CLOSE' }]);
    expect(back.intents).toEqual(['saveAndExit']);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/modules/WeeklyReview/state/keymap.test.js`
Expected: FAIL — "Back on the gate confirms exit" expects `['saveAndExit']` but gets `[]`.

- [ ] **Step 3: Make Back on the exit gate exit**

In `state/keymap.js`, replace the `exitGate` block (currently lines 29-36):

```javascript
    if (modalType === 'exitGate') {
      // Second Back confirms exit — "mash Back to get out" must always work.
      // saveAndExit stops the recorder, flushes, finalizes, and always exits.
      if (isBack) { out.modal.push({ type: 'CLOSE' }); out.intents.push('saveAndExit'); return out; }
      if (isEnter) {
        out.modal.push({ type: 'CLOSE' });
        if (modalFocus === 1) out.intents.push('saveAndExit');
        return out;
      }
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run frontend/src/modules/WeeklyReview/state/keymap.test.js`
Expected: PASS (all tests green).

- [ ] **Step 5: Pop-guard exits on the second Back too**

The remote Back button can also arrive via `MenuNavigationContext.pop()` (not the keydown path). In `WeeklyReview.jsx`, just after `onSaveAndExit` is defined (after line 148), add a ref so the pop-guard can call the latest version:

```javascript
  // Ref so the pop-guard (registered once) always calls the current onSaveAndExit.
  const onSaveAndExitRef = useRef(onSaveAndExit);
  onSaveAndExitRef.current = onSaveAndExit;
```

Then in the pop-guard effect (around line 444), change the `exitGate` branch from closing to exiting:

```javascript
    menuNav.setPopGuard(() => {
      logger.info('nav.pop-guard', { isRecording: isRecordingRef.current, viewLevel: viewLevelRef.current, modalType: modalTypeRef.current });
      if (modalTypeRef.current === 'exitGate') { onSaveAndExitRef.current(); return false; }
      if (viewLevelRef.current === 'reel') { dispatchView({ type: 'CLIMB' }); return false; }
      dispatchModal({ type: 'OPEN', modal: 'exitGate' });
      return false;
    });
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/WeeklyReview/state/keymap.js frontend/src/modules/WeeklyReview/state/keymap.test.js frontend/src/modules/WeeklyReview/WeeklyReview.jsx
git commit -m "fix(weekly-review): Back on exit gate confirms exit so mash-Back always escapes"
```

---

## Task 2: Bound the finalize call so "Saving…" can't hang forever

**Why:** `onSaveAndExit` and the disconnect handler `await DaylightAPI('.../finalize')` behind the key-swallowing `disconnect` modal. With no timeout, a hung request pins the user on "Saving your recording…". The recording is durable (IndexedDB + server chunks), so a timed-out finalize is safe to skip — and the leftover draft is picked up by mount-time recovery.

**Files:**
- Create: `frontend/src/modules/WeeklyReview/hooks/withTimeout.js`
- Create: `frontend/src/modules/WeeklyReview/hooks/withTimeout.test.js`
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.jsx` (imports + `onSaveAndExit` + disconnect handler)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/WeeklyReview/hooks/withTimeout.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { withTimeout, TIMEOUT } from './withTimeout.js';

describe('withTimeout', () => {
  it('resolves with the promise value when it settles in time', async () => {
    const r = await withTimeout(Promise.resolve('ok'), 50);
    expect(r).toBe('ok');
  });

  it('resolves to TIMEOUT when the promise is too slow', async () => {
    const slow = new Promise((res) => setTimeout(() => res('late'), 100));
    const r = await withTimeout(slow, 10);
    expect(r).toBe(TIMEOUT);
  });

  it('propagates rejection from the underlying promise', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 50)).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/modules/WeeklyReview/hooks/withTimeout.test.js`
Expected: FAIL — cannot resolve `./withTimeout.js`.

- [ ] **Step 3: Implement `withTimeout`**

Create `frontend/src/modules/WeeklyReview/hooks/withTimeout.js`:

```javascript
// Race a promise against a timeout so a wedged network call can never hang the
// UI. On timeout the result is the TIMEOUT sentinel (NOT a rejection) so callers
// can decide to proceed — used to bound recording-finalize, which is safe to skip
// because the audio is durable in IndexedDB + server chunks and draft recovery
// will finalize it on the next mount.
export const TIMEOUT = Symbol('weekly-review-timeout');

export function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run frontend/src/modules/WeeklyReview/hooks/withTimeout.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Use it in `onSaveAndExit`**

In `WeeklyReview.jsx`, add the import near the other hook imports (after line 12):

```javascript
import { withTimeout, TIMEOUT } from './hooks/withTimeout.js';
```

In `onSaveAndExit` (lines 134-141), replace the `try` body's finalize block:

```javascript
    try {
      uploaderFlushNow();
      if (sessionIdRef.current && data?.week) {
        const res = await withTimeout(DaylightAPI('/api/v1/weekly-review/recording/finalize', {
          sessionId: sessionIdRef.current, week: data.week, duration: recordingDuration,
        }, 'POST'), 8000);
        // Only drop the local draft if the server actually confirmed. On timeout
        // keep it so mount-time recovery can finalize later.
        if (res !== TIMEOUT) await deleteLocalSession(sessionIdRef.current).catch(() => {});
        else logger.warn('save-and-exit.finalize-timeout');
      }
    } catch (err) {
      logger.error('save-and-exit.finalize-failed', { error: err.message });
    } finally {
      dispatchModal({ type: 'CLOSE' });
      onExitWidget();
    }
```

- [ ] **Step 6: Use it in the disconnect handler**

In the disconnect effect (lines 262-274), replace the inner `try` so a timeout exits cleanly instead of trapping or falsely erroring:

```javascript
      try {
        uploaderFlushNow();
        const res = await withTimeout(DaylightAPI('/api/v1/weekly-review/recording/finalize', {
          sessionId: sessionIdRef.current, week: data?.week, duration: recordingDuration,
        }, 'POST'), 8000);
        if (res !== TIMEOUT) await deleteLocalSession(sessionIdRef.current).catch(() => {});
        else logger.warn('disconnect.finalize-timeout');
        dispatchModal({ type: 'CLOSE' });
        onExitWidget();
      } catch (err) {
        logger.error('disconnect.finalize-failed', { error: err.message });
        dispatchModal({ type: 'CLOSE' });
        dispatchModal({ type: 'OPEN', modal: 'finalizeError', payload: err.message });
      }
```

- [ ] **Step 7: Run the module's tests to confirm nothing regressed**

Run: `npx vitest run frontend/src/modules/WeeklyReview`
Expected: PASS (all WeeklyReview test files).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/WeeklyReview/hooks/withTimeout.js frontend/src/modules/WeeklyReview/hooks/withTimeout.test.js frontend/src/modules/WeeklyReview/WeeklyReview.jsx
git commit -m "fix(weekly-review): bound recording-finalize with an 8s timeout so save-and-exit can't hang"
```

---

## Task 3: Empty days surface weather/calendar/fitness (no more blank reel)

**Why:** Entering a media-less day shows only "No photos or videos this day" (`DayReel.jsx:48`); the day's weather/events/workouts exist but are hidden in the context panel until the user presses Down. We extract the data rendering into `DayDataPoints` (DRY) and render it inline in the empty reel.

**Files:**
- Create: `frontend/src/modules/WeeklyReview/components/dayData.js`
- Create: `frontend/src/modules/WeeklyReview/components/DayDataPoints.jsx`
- Create: `frontend/src/modules/WeeklyReview/components/DayDataPoints.test.jsx`
- Modify: `frontend/src/modules/WeeklyReview/components/DayContextPanel.jsx`
- Modify: `frontend/src/modules/WeeklyReview/components/DayReel.jsx`
- Modify: `frontend/src/modules/WeeklyReview/components/DayReel.test.jsx`
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.jsx:498-508` (pass `day` to `DayReel`)
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.scss` (reel data-points styles)

- [ ] **Step 1: Create the shared helpers module**

Create `frontend/src/modules/WeeklyReview/components/dayData.js` (moved verbatim from `DayContextPanel.jsx`, now exported):

```javascript
// Shared weather + timeline helpers for the WeeklyReview day surfaces.
export const WMO_ICONS = {
  0: '☀️', 1: '🌤', 2: '⛅', 3: '☁️', 45: '🌫', 48: '🌫',
  51: '🌦', 53: '🌦', 55: '🌧', 61: '🌧', 63: '🌧', 65: '🌧',
  71: '🌨', 73: '🌨', 75: '❄️', 77: '❄️', 80: '🌦', 81: '🌧', 82: '🌧',
  85: '🌨', 86: '❄️', 95: '⛈', 96: '⛈', 99: '⛈',
};
export const WMO_DESC = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Foggy', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
  85: 'Light snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Hail storm', 99: 'Heavy hail',
};
export function cToF(c) { return Math.round(c * 9 / 5 + 32); }
export function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

export function buildTimeline(day) {
  const items = [];
  function to24h(timeStr) {
    if (!timeStr || timeStr === 'All day') return '00:00';
    const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) return '99:99';
    let h = parseInt(match[1], 10);
    const m = match[2];
    const ampm = match[3].toUpperCase();
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m}`;
  }
  for (const event of (day.calendar || [])) {
    items.push({ type: 'calendar', time: event.allDay ? 'All day' : event.time, endTime: event.endTime, label: event.summary, sortKey: to24h(event.time) || (event.allDay ? '00:00' : '99:99') });
  }
  for (const session of (day.fitness || [])) {
    let timeStr = ''; let sortKey = '99:99';
    if (session.sessionId && session.sessionId.length >= 12) {
      const hh = parseInt(session.sessionId.slice(8, 10), 10);
      const mm = session.sessionId.slice(10, 12);
      const ampm = hh >= 12 ? 'PM' : 'AM';
      const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
      timeStr = `${h12}:${mm} ${ampm}`; sortKey = `${String(hh).padStart(2, '0')}:${mm}`;
    }
    const durationMin = session.durationMs ? Math.round(session.durationMs / 60000) : null;
    const title = session.media?.primary?.showTitle || session.media?.primary?.title || 'Workout';
    items.push({ type: 'fitness', time: timeStr, label: `${title}${durationMin ? ` (${durationMin} min)` : ''}`, sortKey, participants: session.participants });
  }
  for (const session of (day.sessions || [])) {
    items.push({ type: 'photo', time: session.timeRange || '', label: plural(session.count, 'photo'), sortKey: to24h(session.timeRange?.split(' – ')[0]) || '99:99' });
  }
  items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return items;
}
```

- [ ] **Step 2: Write the failing test for `DayDataPoints`**

Create `frontend/src/modules/WeeklyReview/components/DayDataPoints.test.jsx`:

```javascript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import DayDataPoints from './DayDataPoints.jsx';

describe('DayDataPoints', () => {
  it('renders weather, timeline events and a summary for a day with data', () => {
    const day = {
      date: '2026-04-21',
      weather: { code: 0, high: 22, low: 12, precip: 0 },
      calendar: [{ time: '8:30 AM', summary: 'Standup' }],
      fitness: [{ sessionId: '20260421073000', durationMs: 1800000, media: { primary: { title: 'Peloton' } }, participants: {} }],
      photos: [], photoCount: 0,
    };
    render(<DayDataPoints day={day} />);
    expect(screen.getByText('Standup')).toBeInTheDocument();
    expect(screen.getByText(/Peloton/)).toBeInTheDocument();
    expect(screen.getByText(/72°/)).toBeInTheDocument(); // 22C -> 72F
  });

  it('shows a quiet-day fallback when the day has no data at all', () => {
    const day = { date: '2026-04-22', weather: null, calendar: [], fitness: [], photos: [], photoCount: 0 };
    render(<DayDataPoints day={day} />);
    expect(screen.getByText(/Quiet day/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run frontend/src/modules/WeeklyReview/components/DayDataPoints.test.jsx`
Expected: FAIL — cannot resolve `./DayDataPoints.jsx`.

- [ ] **Step 4: Implement `DayDataPoints`**

Create `frontend/src/modules/WeeklyReview/components/DayDataPoints.jsx`. It returns a fragment of `.context-section` blocks so it slots into the existing `.context-panel-inner` flex layout unchanged:

```jsx
import React, { useMemo } from 'react';
import { WMO_ICONS, WMO_DESC, cToF, plural, buildTimeline } from './dayData.js';

export default function DayDataPoints({ day }) {
  const timeline = useMemo(() => (day ? buildTimeline(day) : []), [day]);
  const allPeople = useMemo(() => {
    const set = new Set();
    for (const photo of (day?.photos || [])) for (const p of (photo.people || [])) set.add(p);
    return [...set];
  }, [day]);

  if (!day) return null;

  const weather = day.weather;
  const videoCount = day.photos?.filter(p => p.type === 'video').length || 0;
  const imageCount = (day.photoCount || 0) - videoCount;
  const hasAny = !!weather || timeline.length > 0 || allPeople.length > 0 || (day.photoCount || 0) > 0;

  if (!hasAny) {
    return <div className="context-section day-data-quiet">Quiet day — nothing recorded.</div>;
  }

  return (
    <>
      {weather && (
        <div className="context-section">
          <h3 className="context-section-title">Weather</h3>
          <div className="context-weather">
            <span className="weather-icon-lg">{WMO_ICONS[weather.code] || '🌡'}</span>
            <span className="weather-temps">{cToF(weather.high)}° / {cToF(weather.low)}°</span>
            <span className="weather-desc">{WMO_DESC[weather.code] || ''}</span>
            {weather.precip > 0 && <span className="weather-detail">Precip: {weather.precip.toFixed(1)}mm</span>}
          </div>
        </div>
      )}
      {timeline.length > 0 && (
        <div className="context-section">
          <h3 className="context-section-title">Timeline</h3>
          <div className="context-timeline">
            {timeline.map((item, i) => (
              <div key={i} className={`timeline-item timeline-item--${item.type}`}>
                <span className="timeline-time">{item.time}{item.endTime ? ` – ${item.endTime}` : ''}</span>
                <span className="timeline-label">{item.label}</span>
                {item.participants && Object.keys(item.participants).length > 0 && (
                  <span className="timeline-people">{Object.values(item.participants).map(p => p.displayName).join(', ')}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {allPeople.length > 0 && (
        <div className="context-section">
          <h3 className="context-section-title">People</h3>
          <div className="context-people">{allPeople.map(p => <span key={p} className="person-tag">{p}</span>)}</div>
        </div>
      )}
      <div className="context-section">
        <h3 className="context-section-title">Summary</h3>
        <div className="context-stats">
          {imageCount > 0 && <span className="stat">{plural(imageCount, 'photo')}</span>}
          {videoCount > 0 && <span className="stat">{plural(videoCount, 'video')}</span>}
          {(day.calendar?.length || 0) > 0 && <span className="stat">{plural(day.calendar.length, 'event')}</span>}
          {(day.fitness?.length || 0) > 0 && <span className="stat">{plural(day.fitness.length, 'workout')}</span>}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run frontend/src/modules/WeeklyReview/components/DayDataPoints.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Refactor `DayContextPanel` to delegate (keeps existing test green)**

Replace the entire body of `frontend/src/modules/WeeklyReview/components/DayContextPanel.jsx` with:

```jsx
// frontend/src/modules/WeeklyReview/components/DayContextPanel.jsx
import React from 'react';
import DayDataPoints from './DayDataPoints.jsx';

export default function DayContextPanel({ day, open }) {
  if (!open || !day) return null;
  return (
    <div className="weekly-review-context-panel" role="dialog" aria-modal="true" aria-label="Day details">
      <div className="context-panel-inner">
        <DayDataPoints day={day} />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Verify the existing context-panel test still passes**

Run: `npx vitest run frontend/src/modules/WeeklyReview/components/DayContextPanel.test.jsx`
Expected: PASS — same rendered text, now sourced from `DayDataPoints`.

- [ ] **Step 8: Update `DayReel` empty state to show the data**

In `frontend/src/modules/WeeklyReview/components/DayReel.jsx`, add the import after the `FullscreenImage` import (line 3):

```jsx
import DayDataPoints from './DayDataPoints.jsx';
```

Change the component signature (line 47) to accept `day`:

```jsx
export default function DayReel({ item, day, index, total, dayLabel, playing, muted, paused, onEnded }) {
```

Replace the empty-state block (lines 48-55):

```jsx
  if (!item) {
    return (
      <div className="weekly-review-reel weekly-review-reel--empty">
        <div className="reel-day-label">{dayLabel}</div>
        <div className="reel-empty-data">
          <DayDataPoints day={day} />
        </div>
      </div>
    );
  }
```

- [ ] **Step 9: Update the `DayReel` empty-state test**

In `frontend/src/modules/WeeklyReview/components/DayReel.test.jsx`, replace the last test (`it('renders an empty state when there is no item', ...)`) with:

```javascript
  it('surfaces the day data points when there is no media', () => {
    const day = { date: '2026-04-21', weather: { code: 0, high: 22, low: 12, precip: 0 }, calendar: [{ time: '8:30 AM', summary: 'Standup' }], fitness: [], photos: [], photoCount: 0 };
    render(<DayReel item={null} day={day} index={0} total={0} dayLabel={dayLabel} playing={false} muted paused={false} />);
    expect(screen.getByText('Standup')).toBeInTheDocument();
    expect(screen.getByText(/72°/)).toBeInTheDocument();
    expect(screen.getByText(dayLabel)).toBeInTheDocument();
  });

  it('shows a quiet-day fallback for a day with no data', () => {
    const day = { date: '2026-04-22', weather: null, calendar: [], fitness: [], photos: [], photoCount: 0 };
    render(<DayReel item={null} day={day} index={0} total={0} dayLabel={dayLabel} playing={false} muted paused={false} />);
    expect(screen.getByText(/Quiet day/i)).toBeInTheDocument();
  });
```

- [ ] **Step 10: Pass `day` to `DayReel` from `WeeklyReview`**

In `WeeklyReview.jsx`, in the reel render branch (around line 498), add the `day` prop to `<DayReel>`:

```jsx
            <DayReel
              item={items[safeIdx] || null}
              day={day}
              index={safeIdx}
              total={items.length}
              dayLabel={dayLabel}
              playing={view.playing}
              muted={view.muted}
              paused={view.contextOpen}
              onEnded={() => dispatchView({ type: 'STOP_VIDEO' })}
            />
```

- [ ] **Step 11: Add reel empty-data styling**

In `WeeklyReview.scss`, find `.weekly-review-reel { ... &--empty { ... } }` (around line 1189) and replace the `&--empty` rule with:

```scss
  &--empty {
    flex-direction: column;
    gap: 1rem;
    color: #ddd;
    justify-content: center;
    align-items: center;
    padding: 2rem;

    .reel-empty-data {
      display: flex;
      flex-wrap: wrap;
      gap: 2rem;
      justify-content: center;
      max-width: 80%;
    }
    .day-data-quiet { opacity: 0.7; font-size: 1.2rem; }
  }
```

- [ ] **Step 12: Run all WeeklyReview tests**

Run: `npx vitest run frontend/src/modules/WeeklyReview`
Expected: PASS (all files).

- [ ] **Step 13: Commit**

```bash
git add frontend/src/modules/WeeklyReview/components/dayData.js frontend/src/modules/WeeklyReview/components/DayDataPoints.jsx frontend/src/modules/WeeklyReview/components/DayDataPoints.test.jsx frontend/src/modules/WeeklyReview/components/DayContextPanel.jsx frontend/src/modules/WeeklyReview/components/DayReel.jsx frontend/src/modules/WeeklyReview/components/DayReel.test.jsx frontend/src/modules/WeeklyReview/WeeklyReview.jsx frontend/src/modules/WeeklyReview/WeeklyReview.scss
git commit -m "feat(weekly-review): empty days surface weather/calendar/fitness instead of a blank reel"
```

---

## Task 4: Count calendar as content + full aria-label + contrast

**Why:** `hasContent` excludes calendar (`DayColumn.jsx:25`), so calendar-only days get the `--empty` dim. The `aria-label` reports only photo count. Empty-state opacity (0.3/0.5) is below WCAG contrast.

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/components/DayColumn.jsx`
- Create: `frontend/src/modules/WeeklyReview/components/DayColumn.test.jsx`
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.scss` (empty-state contrast)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/WeeklyReview/components/DayColumn.test.jsx`:

```javascript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import DayColumn from './DayColumn.jsx';

const baseDay = {
  date: '2026-04-21', label: 'Tue', photoCount: 0, photos: [],
  calendar: [{ time: '8:30 AM', summary: 'Standup' }], fitness: [], weather: null, columnWeight: 1,
};

describe('DayColumn', () => {
  it('treats a calendar-only day as content (not dimmed --empty)', () => {
    const { container } = render(<DayColumn day={baseDay} isFocused={false} onClick={() => {}} />);
    expect(container.querySelector('.day-column--empty')).toBeNull();
  });

  it('includes events in the aria-label', () => {
    render(<DayColumn day={baseDay} isFocused={false} onClick={() => {}} />);
    const el = screen.getByRole('button');
    expect(el.getAttribute('aria-label')).toMatch(/1 event/);
  });

  it('marks a truly empty day as --empty', () => {
    const empty = { ...baseDay, calendar: [] };
    const { container } = render(<DayColumn day={empty} isFocused={false} onClick={() => {}} />);
    expect(container.querySelector('.day-column--empty')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/modules/WeeklyReview/components/DayColumn.test.jsx`
Expected: FAIL — calendar-only day is currently `--empty`, and aria-label lacks "event".

- [ ] **Step 3: Update `DayColumn`**

In `frontend/src/modules/WeeklyReview/components/DayColumn.jsx`:

Replace the local helper constants at the top (lines 4-16: `WMO_ICONS` and `cToF`) with a shared import (delete the local `const WMO_ICONS = {...}` and `function cToF`), and add after the `import PhotoWall` line:

```jsx
import { WMO_ICONS, cToF } from './dayData.js';
```

Replace the `hasContent` line (line 25):

```jsx
  const hasContent = day.photoCount > 0 || day.fitness?.length > 0 || day.calendar?.length > 0;
```

Replace the `aria-label` attribute (line 40) with a content-aware label:

```jsx
      aria-label={[
        `${day.label} ${dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`,
        day.photoCount > 0 ? `${day.photoCount} photos` : null,
        day.calendar?.length ? `${day.calendar.length} event${day.calendar.length === 1 ? '' : 's'}` : null,
        day.fitness?.length ? `${day.fitness.length} workout${day.fitness.length === 1 ? '' : 's'}` : null,
        weather ? `${cToF(weather.high)} degrees` : null,
      ].filter(Boolean).join(', ')}
```

Note: `weather` is referenced in the label but is declared lower (line 32). Move the `const weather = day.weather;` declaration up to just below the `columnClass` block (before the `return`), so it is in scope for the label. The existing later `const weather = day.weather;` line must be removed to avoid a duplicate declaration.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run frontend/src/modules/WeeklyReview/components/DayColumn.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Raise empty-state contrast**

In `WeeklyReview.scss`:

Change `.day-column &--empty` (line 183-185) opacity:

```scss
  &--empty {
    opacity: 0.7;
  }
```

Change `.day-empty-content` (line 318) and its children:

```scss
.day-empty-content {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  opacity: 0.6;

  .day-empty-name {
    font-size: 1.4rem;
    font-weight: 300;
    color: #bbb;
    letter-spacing: 0.05em;
  }
```

- [ ] **Step 6: Run the WeeklyReview suite**

Run: `npx vitest run frontend/src/modules/WeeklyReview`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/WeeklyReview/components/DayColumn.jsx frontend/src/modules/WeeklyReview/components/DayColumn.test.jsx frontend/src/modules/WeeklyReview/WeeklyReview.scss
git commit -m "fix(weekly-review): count calendar as content, full aria-label, readable empty-state contrast"
```

---

## Task 5: Remove the accidental Up-from-top-row exit; render every day

**Why:** Up on the grid's top row silently opens the exit gate (`keymap.js:61`) — easy to trigger while navigating. And the grid renders `slice(-8)` while navigation uses the full length, so focus could leave the rendered set if the window ever exceeds 8. Render every day (always ≤ 8) and make Up a normal clamped move.

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/state/keymap.js:58-68`
- Modify: `frontend/src/modules/WeeklyReview/state/keymap.test.js:20-23`
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.jsx:512-528` (render all days)

- [ ] **Step 1: Update the test for Up-from-top-row**

In `state/keymap.test.js`, replace the test at lines 20-23 (`it('Up from the top row raises the exit gate', ...)`):

```javascript
  it('Up from the top row is a clamped no-op move (no accidental exit)', () => {
    const res = r({ ...onGrid({ view: { level: 'grid', dayIndex: 1, itemIndex: 0, playing: false, muted: true, contextOpen: false } }), key: 'ArrowUp' });
    expect(res.view).toEqual([{ type: 'GRID_MOVE', dir: 'up', cols: 4, total: 8 }]);
    expect(res.modal).toEqual([]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/modules/WeeklyReview/state/keymap.test.js`
Expected: FAIL — current code returns `{ modal: [{ OPEN exitGate }] }`, not a GRID_MOVE.

- [ ] **Step 3: Remove the Up-exit special case**

In `state/keymap.js`, replace the grid block (lines 58-68):

```javascript
  // ---- Main hierarchy ----
  if (view.level === 'grid') {
    if (dir) {
      // Up on the top row is a clamped no-op in the reducer — no accidental exit.
      out.view.push(gridMove(dir, cols, totalDays));
      return out;
    }
    if (isEnter) { out.view.push({ type: 'OPEN_DAY' }); return out; }
    if (isBack)  { out.modal.push({ type: 'OPEN', modal: 'exitGate' }); return out; }
    return out;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run frontend/src/modules/WeeklyReview/state/keymap.test.js`
Expected: PASS.

- [ ] **Step 5: Render every day in the grid (drop slice/offset)**

In `WeeklyReview.jsx`, replace the grid map (lines 512-528):

```jsx
        <div className="weekly-review-grid">
          {data.days.map((day, realIndex) => (
            <DayColumn
              key={day.date}
              day={day}
              isFocused={realIndex === view.dayIndex}
              onClick={() => {
                dispatchView({ type: 'SELECT_DAY', dayIndex: realIndex });
                dispatchView({ type: 'OPEN_DAY' });
              }}
            />
          ))}
        </div>
```

- [ ] **Step 6: Run the WeeklyReview suite**

Run: `npx vitest run frontend/src/modules/WeeklyReview`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/WeeklyReview/state/keymap.js frontend/src/modules/WeeklyReview/state/keymap.test.js frontend/src/modules/WeeklyReview/WeeklyReview.jsx
git commit -m "fix(weekly-review): remove accidental Up-exit; render every day so grid focus can't leave view"
```

---

## Task 6: Wire modal buttons for touch + a "Not now" on resume

**Why:** `exitGate`, `finalizeError`, and `resumeDraft` buttons are visual-only on some modals — tapping them does nothing on touch surfaces. Wire `onClick` to the same actions the keymap dispatches, and give `resumeDraft` a visible defer option.

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.jsx` (resumeDraft, finalizeError, exitGate modal blocks)

- [ ] **Step 1: Wire the resume-draft modal**

In `WeeklyReview.jsx`, replace the `confirm-actions` block inside the `resumeDraft` modal (lines 482-485):

```jsx
            <div className="confirm-actions">
              <button className="confirm-btn confirm-btn--save focused" onClick={finalizePriorDraft}>Finalize Previous</button>
              <button className="confirm-btn confirm-btn--continue" onClick={() => dispatchModal({ type: 'CLOSE' })}>Not now</button>
            </div>
```

- [ ] **Step 2: Wire the finalize-error modal**

Replace the `confirm-actions` block inside the `finalizeError` modal (lines 539-543):

```jsx
            <div className="confirm-actions">
              <button className={`confirm-btn confirm-btn--save${modal.focusIndex === 0 ? ' focused' : ''}`} onClick={() => dispatchModal({ type: 'CLOSE' })}>Dismiss</button>
              <button className={`confirm-btn confirm-btn--continue${modal.focusIndex === 1 ? ' focused' : ''}`} onClick={onExitWidget}>Exit (save later)</button>
            </div>
```

- [ ] **Step 3: Wire the exit-gate modal**

Replace the `confirm-actions` block inside the `exitGate` modal (lines 553-557):

```jsx
            <div className="confirm-actions">
              <button className={`confirm-btn confirm-btn--continue${modal.focusIndex === 0 ? ' focused' : ''}`} onClick={() => dispatchModal({ type: 'CLOSE' })}>Keep going</button>
              <button className={`confirm-btn confirm-btn--save${modal.focusIndex === 1 ? ' focused' : ''}`} onClick={onSaveAndExit}>Save &amp; end</button>
            </div>
```

- [ ] **Step 4: Sanity-check the build compiles (lint the file by running the suite)**

Run: `npx vitest run frontend/src/modules/WeeklyReview`
Expected: PASS (no syntax errors; behavior unit tests unaffected).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/WeeklyReview/WeeklyReview.jsx
git commit -m "fix(weekly-review): wire modal buttons for touch and add a Not-now option on resume"
```

---

## Task 7: Persistent, context-sensitive control legend

**Why:** The only on-screen control hint in the whole module is "Enter to play" on video posters. A 10-foot remote UI needs a persistent footer telling users how to navigate and — crucially — how to exit.

**Files:**
- Create: `frontend/src/modules/WeeklyReview/components/ControlLegend.jsx`
- Create: `frontend/src/modules/WeeklyReview/components/ControlLegend.test.jsx`
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.jsx` (render the legend)
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.scss` (legend styles)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/WeeklyReview/components/ControlLegend.test.jsx`:

```javascript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import ControlLegend from './ControlLegend.jsx';

describe('ControlLegend', () => {
  it('on the grid, shows open + exit hints', () => {
    render(<ControlLegend level="grid" contextOpen={false} mediaType="none" playing={false} modalType={null} />);
    expect(screen.getByText(/Open/)).toBeInTheDocument();
    expect(screen.getByText(/Exit/)).toBeInTheDocument();
  });

  it('on a photo reel, shows browse + details hints', () => {
    render(<ControlLegend level="reel" contextOpen={false} mediaType="photo" playing={false} modalType={null} />);
    expect(screen.getByText(/Browse/)).toBeInTheDocument();
    expect(screen.getByText(/Details/)).toBeInTheDocument();
  });

  it('renders nothing while a modal is open (the modal owns the hints)', () => {
    const { container } = render(<ControlLegend level="grid" contextOpen={false} mediaType="none" playing={false} modalType="exitGate" />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/modules/WeeklyReview/components/ControlLegend.test.jsx`
Expected: FAIL — cannot resolve `./ControlLegend.jsx`.

- [ ] **Step 3: Implement `ControlLegend`**

Create `frontend/src/modules/WeeklyReview/components/ControlLegend.jsx`:

```jsx
import React from 'react';

// Context-sensitive hint bar for the remote/keypad UI. Hidden while a modal is
// open — the modal carries its own choices.
function hintsFor({ level, contextOpen, mediaType, playing }) {
  if (level === 'grid') {
    return [['OK', 'Open day'], ['↑ ↓ ← →', 'Navigate'], ['Back', 'Exit']];
  }
  if (contextOpen) {
    return [['↓ / Back', 'Close details']];
  }
  if (playing) {
    return [['OK', 'Mute / Unmute'], ['Back', 'Stop']];
  }
  if (mediaType === 'video') {
    return [['OK', 'Play'], ['← →', 'Browse'], ['↓', 'Details'], ['Back', 'Back to week']];
  }
  // photo or empty day
  return [['← →', 'Browse'], ['↓', 'Details'], ['Back', 'Back to week']];
}

export default function ControlLegend({ level, contextOpen, mediaType, playing, modalType }) {
  if (modalType) return null;
  const hints = hintsFor({ level, contextOpen, mediaType, playing });
  return (
    <div className="weekly-review-legend" role="note" aria-label="Controls">
      {hints.map(([key, label], i) => (
        <span className="legend-hint" key={i}>
          <span className="legend-key">{key}</span>
          <span className="legend-label">{label}</span>
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run frontend/src/modules/WeeklyReview/components/ControlLegend.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Render the legend in `WeeklyReview`**

In `WeeklyReview.jsx`, add the import after the `RecordingBar` import (line 9):

```jsx
import ControlLegend from './components/ControlLegend.jsx';
```

Then, immediately before the `<RecordingBar ... />` element (line 581), add:

```jsx
      <ControlLegend
        level={view.level}
        contextOpen={view.contextOpen}
        mediaType={mediaCtx.currentType}
        playing={view.playing}
        modalType={modal.type}
      />
```

- [ ] **Step 6: Style the legend**

Append to `WeeklyReview.scss`:

```scss
.weekly-review-legend {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 2.6rem; // sits just above the recording bar
  display: flex;
  justify-content: center;
  gap: 1.5rem;
  padding: 0.4rem 1rem;
  pointer-events: none;
  font-size: 0.8rem;
  color: #cfcfcf;
  background: linear-gradient(to top, rgba(0,0,0,0.55), transparent);

  .legend-hint { display: inline-flex; align-items: center; gap: 0.4em; }
  .legend-key {
    background: rgba(255,255,255,0.15);
    border-radius: 0.3em;
    padding: 0.1em 0.5em;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .legend-label { opacity: 0.85; }
}
```

- [ ] **Step 7: Run the WeeklyReview suite**

Run: `npx vitest run frontend/src/modules/WeeklyReview`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/WeeklyReview/components/ControlLegend.jsx frontend/src/modules/WeeklyReview/components/ControlLegend.test.jsx frontend/src/modules/WeeklyReview/WeeklyReview.jsx frontend/src/modules/WeeklyReview/WeeklyReview.scss
git commit -m "feat(weekly-review): persistent context-sensitive control legend (incl. how to exit)"
```

---

## Task 8: Visible silence-warning message

**Why:** When the mic hears nothing, `silenceWarning` only pulses a CSS class (`RecordingBar.jsx:52`) — no text. The user doesn't know why.

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/components/RecordingBar.jsx`
- Create: `frontend/src/modules/WeeklyReview/components/RecordingBar.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/WeeklyReview/components/RecordingBar.test.jsx`:

```javascript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React, { createRef } from 'react';
import RecordingBar from './RecordingBar.jsx';

const baseProps = {
  weekLabel: 'Week of Apr 1 – Apr 8', isRecording: true, duration: 5,
  micLevelRef: createRef(), silenceWarning: false, uploading: false,
  existingRecording: null, error: null, syncStatus: null, pendingCount: 0,
  lastAckedAt: null, micConnected: true,
};

describe('RecordingBar', () => {
  it('shows a spoken-aloud prompt when silence is detected', () => {
    render(<RecordingBar {...baseProps} silenceWarning={true} />);
    expect(screen.getByText(/can't hear you/i)).toBeInTheDocument();
  });

  it('does not show the silence prompt when audio is fine', () => {
    render(<RecordingBar {...baseProps} silenceWarning={false} />);
    expect(screen.queryByText(/can't hear you/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/modules/WeeklyReview/components/RecordingBar.test.jsx`
Expected: FAIL — no "can't hear you" text rendered.

- [ ] **Step 3: Add the message**

In `frontend/src/modules/WeeklyReview/components/RecordingBar.jsx`, inside `recording-bar-right`, add a silence message right after the recording timer/VU block. Replace the closing of the `isRecording` fragment (lines 67-75) with:

```jsx
        {isRecording && (
          <>
            <span className="recording-dot">●</span>
            <span className="recording-timer">{formatTime(duration)}</span>
            <div className="vu-meter" ref={vuMeterRef} aria-label="Microphone level">
              {Array.from({ length: 20 }, (_, i) => <div key={i} className="vu-bar" />)}
            </div>
            {silenceWarning && (
              <span className="silence-message" role="status">🔈 We can't hear you — speak up or check the mic.</span>
            )}
          </>
        )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run frontend/src/modules/WeeklyReview/components/RecordingBar.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Add minimal styling**

Append to `WeeklyReview.scss`:

```scss
.recording-bar .silence-message {
  color: #ffd27a;
  font-size: 0.85rem;
  font-weight: 600;
  margin-left: 0.6rem;
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/WeeklyReview/components/RecordingBar.jsx frontend/src/modules/WeeklyReview/components/RecordingBar.test.jsx frontend/src/modules/WeeklyReview/WeeklyReview.scss
git commit -m "fix(weekly-review): show a visible prompt when the mic detects silence"
```

---

## Task 9: Move focus to dialogs on open (a11y)

**Why:** Modals set `aria-modal` but never move focus, so screen readers don't announce them and there's no focus anchor. Extract a `ConfirmOverlay` shell that focuses the dialog on mount (safe: the global keydown handler only bails on INPUT/TEXTAREA/SELECT, so a focused `tabIndex={-1}` div doesn't disturb key routing). This also DRYs four near-identical modal shells.

**Files:**
- Create: `frontend/src/modules/WeeklyReview/components/ConfirmOverlay.jsx`
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.jsx` (resumeDraft, finalizeError, exitGate, disconnect modals)

- [ ] **Step 1: Create the overlay shell**

Create `frontend/src/modules/WeeklyReview/components/ConfirmOverlay.jsx`:

```jsx
import React, { useEffect, useRef } from 'react';

// Shared modal shell. Moves keyboard/AT focus to the dialog on open so screen
// readers announce it. Key handling stays on the document-level listener in
// WeeklyReview (a focused tabIndex=-1 div does not intercept arrow/Enter/Escape).
export default function ConfirmOverlay({ labelId, ariaLive, children }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="weekly-review-confirm-overlay">
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        aria-live={ariaLive}
        tabIndex={-1}
        ref={ref}
      >
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Use it for the four modals**

In `WeeklyReview.jsx`, add the import after the `ControlLegend` import:

```jsx
import ConfirmOverlay from './components/ConfirmOverlay.jsx';
```

Replace the **resumeDraft** modal block (lines 475-487) with:

```jsx
      {modal.type === 'resumeDraft' && !isRecording && (
        <ConfirmOverlay labelId="wr-resume-label">
          <div className="confirm-message" id="wr-resume-label">
            A previous recording was not finalized.<br/>
            <small>{modal.payload?.source === 'server' ? `Server draft · ${Math.round((modal.payload?.totalBytes || 0) / 1024)} KB` : `Local-only draft · ${modal.payload?.chunkCount || 0} chunks`}</small>
          </div>
          <div className="confirm-actions">
            <button className="confirm-btn confirm-btn--save focused" onClick={finalizePriorDraft}>Finalize Previous</button>
            <button className="confirm-btn confirm-btn--continue" onClick={() => dispatchModal({ type: 'CLOSE' })}>Not now</button>
          </div>
        </ConfirmOverlay>
      )}
```

Replace the **finalizeError** modal block (lines 532-546) with:

```jsx
      {modal.type === 'finalizeError' && !isRecording && (
        <ConfirmOverlay labelId="wr-error-label">
          <div className="confirm-message" id="wr-error-label">
            Save failed: {modal.payload}<br/>
            <small>Your recording is safe — stored locally and on the server.</small>
          </div>
          <div className="confirm-actions">
            <button className={`confirm-btn confirm-btn--save${modal.focusIndex === 0 ? ' focused' : ''}`} onClick={() => dispatchModal({ type: 'CLOSE' })}>Dismiss</button>
            <button className={`confirm-btn confirm-btn--continue${modal.focusIndex === 1 ? ' focused' : ''}`} onClick={onExitWidget}>Exit (save later)</button>
          </div>
        </ConfirmOverlay>
      )}
```

Replace the **exitGate** modal block (lines 549-560) with:

```jsx
      {modal.type === 'exitGate' && (
        <ConfirmOverlay labelId="wr-exit-label">
          <div className="confirm-message" id="wr-exit-label">End weekly review recording?</div>
          <div className="confirm-actions">
            <button className={`confirm-btn confirm-btn--continue${modal.focusIndex === 0 ? ' focused' : ''}`} onClick={() => dispatchModal({ type: 'CLOSE' })}>Keep going</button>
            <button className={`confirm-btn confirm-btn--save${modal.focusIndex === 1 ? ' focused' : ''}`} onClick={onSaveAndExit}>Save &amp; end</button>
          </div>
        </ConfirmOverlay>
      )}
```

Replace the **disconnect** modal block (lines 563-572) with:

```jsx
      {modal.type === 'disconnect' && (
        <ConfirmOverlay labelId="wr-disc-label" ariaLive="polite">
          <div className="confirm-message" id="wr-disc-label">
            {modal.payload?.phase === 'reconnecting' && (<>Microphone dropped — reconnecting…<br/><small>Please hold tight.</small></>)}
            {modal.payload?.phase === 'finalizing' && (<>Microphone disconnected.<br/><small>Saving your recording…</small></>)}
          </div>
        </ConfirmOverlay>
      )}
```

- [ ] **Step 3: Verify the suite still passes (markup parity)**

Run: `npx vitest run frontend/src/modules/WeeklyReview`
Expected: PASS — same class names/text, just wrapped in the shared shell.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/WeeklyReview/components/ConfirmOverlay.jsx frontend/src/modules/WeeklyReview/WeeklyReview.jsx
git commit -m "fix(weekly-review): move focus to dialogs on open and DRY the modal shell (a11y)"
```

---

## Task 10: Full verification + update audit status

**Files:**
- Modify: `docs/_wip/audits/2026-06-18-weekly-review-usability-audit.md` (mark resolved)

- [ ] **Step 1: Run the entire WeeklyReview test suite**

Run: `npx vitest run frontend/src/modules/WeeklyReview`
Expected: PASS — every file (keymap, viewReducer, modalReducer, withTimeout, DayReel, DayContextPanel, DayDataPoints, DayColumn, ControlLegend, RecordingBar).

- [ ] **Step 2: Run the production frontend build to catch any compile errors**

Run: `npx vite build`
Expected: Build completes with no errors referencing `frontend/src/modules/WeeklyReview/*`.

- [ ] **Step 3: Append a resolution note to the audit**

At the bottom of `docs/_wip/audits/2026-06-18-weekly-review-usability-audit.md`, add:

```markdown

---

## Resolution (2026-06-18)

Implemented via `docs/superpowers/plans/2026-06-18-weekly-review-usability-fixes.md`:
- P0 exit trap → exit-gate Back now confirms exit; finalize bounded by an 8s timeout.
- P0 blank empty-days → `DayDataPoints` surfaces weather/calendar/fitness in the empty reel; calendar counts as content.
- P1 → removed accidental Up-exit; grid renders every day; modal buttons wired for touch.
- P2 → persistent `ControlLegend`; visible silence message; dialog focus + contrast a11y.
```

- [ ] **Step 4: Commit**

```bash
git add docs/_wip/audits/2026-06-18-weekly-review-usability-audit.md
git commit -m "docs(weekly-review): mark usability audit findings resolved"
```

---

## Task 11: Deploy to prod (kckern-server)

Per `CLAUDE.local.md`, deploying on this host after committed work is allowed.

- [ ] **Step 1: Confirm the working tree is clean and committed**

Run: `git status --short`
Expected: empty output (all work from Tasks 1-10 committed).

- [ ] **Step 2: Build the image**

Run:

```bash
sudo docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  .
```

Expected: image builds, including the `vite build` step, with no errors.

- [ ] **Step 3: Replace the running container**

Run:

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

Expected: new container starts.

- [ ] **Step 4: Verify the deployed build**

Run: `curl -s http://localhost:3111/api/v1/weekly-review/bootstrap | head -c 300`
Expected: JSON with a `week` and `days` array (confirms backend up; frontend served from the same image).

- [ ] **Step 5: Reload whichever kiosk shows Weekly Review**

Weekly Review runs as a widget/app inside a kiosk browser. After deploy, hard-reload that screen so it picks up the new bundle. If it is the office screen, reload Brave over CDP (see `CLAUDE.local.md` → Office Screen). If it is the living-room Shield (FKB), clear cache + `loadStartURL`. If unsure which surface is in use, ask the user which screen they review on rather than guessing.

---

## Self-Review (completed)

**Spec coverage** — every audit finding maps to a task:
- P0 can't-exit → Task 1 (+ pop-guard) and Task 2 (finalize hang).
- P0 blank empty-days → Task 3 (reel) + Task 4 (grid `hasContent`).
- P1 grid focus leaves viewport / accidental Up-exit → Task 5.
- P1 touch buttons dead → Task 6.
- P2-A control legend → Task 7. P2-B silence text → Task 8. P2-C resume "Not now" → Task 6.
- P2 a11y aria-label/contrast → Task 4; focus-to-dialog → Task 9.

**Placeholder scan** — no TBD/"handle edge cases"/"similar to" placeholders; every code step shows full code.

**Type/name consistency** — `withTimeout`/`TIMEOUT` defined in Task 2 and used with the same names in Tasks 2; `DayDataPoints` defined in Task 3 and consumed by `DayContextPanel`/`DayReel` in the same task; `dayData.js` exports (`WMO_ICONS`, `cToF`, `buildTimeline`, `plural`, `WMO_DESC`) match imports in `DayDataPoints` (Task 3) and `DayColumn` (Task 4); `ControlLegend` prop names (`level`, `contextOpen`, `mediaType`, `playing`, `modalType`) match the render site in Task 7; `ConfirmOverlay` props (`labelId`, `ariaLive`) match all four usages in Task 9.

**Known intentional behavior changes** (call out at review): the only exit from the gate now always finalizes/saves (there is no "discard"); the audit's optional "Discard & exit" affordance is deliberately deferred to keep the recording safe-by-default.
