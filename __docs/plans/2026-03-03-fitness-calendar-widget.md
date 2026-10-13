# Fitness Activity Calendar Widget Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a GitHub-style activity calendar to the fitness home screen that shows workout history by day (suffer score intensity) and allows clicking a day to scroll the sessions list and load that day's first session detail.

**Architecture:** New `FitnessCalendarWidget` registered as `fitness:calendar` in the left-area below the sessions list (80/20 split). Cross-widget communication via `scrollToDate` state added to `FitnessScreenProvider`. No backend changes — both widgets share the existing sessions data source (widened to 75 days).

**Tech Stack:** React, SCSS, existing screen-framework data hooks (`useScreenData`), `useFitnessScreen()` context

---

### Task 1: Widen Sessions Data Source

**Files:**
- Modify: `data/household/config/fitness.yml` (Dropbox mount at `~/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/config/fitness.yml`)

**Step 1: Update the sessions data source**

Change the `sessions` source from `since=30d&limit=20` to `since=75d` (covers 10+ full weeks for the 7×10 calendar grid). Remove the limit so all sessions in the window are returned.

```yaml
# BEFORE (line 30):
        source: /api/v1/fitness/sessions?since=30d&limit=20

# AFTER:
        source: /api/v1/fitness/sessions?since=75d
```

**Step 2: Split left-area layout into column with two children**

The left area currently has a single widget. Split it into a column with sessions at 80% and calendar at 20%.

```yaml
# BEFORE (lines 37-40):
        - id: left-area
          basis: "33%"
          children:
            - widget: "fitness:sessions"

# AFTER:
        - id: left-area
          basis: "33%"
          direction: column
          children:
            - widget: "fitness:sessions"
              basis: "80%"
            - widget: "fitness:calendar"
              basis: "20%"
```

**Step 3: Commit**

```bash
git add data/household/config/fitness.yml
git commit -m "feat(fitness): widen sessions to 75d and add calendar slot to layout"
```

---

### Task 2: Add `scrollToDate` to FitnessScreenProvider

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessScreenProvider.jsx`

**Step 1: Add scrollToDate state and expose via context**

```jsx
// FULL FILE REPLACEMENT:
import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';

const FitnessScreenContext = createContext(null);

/**
 * FitnessScreenProvider - Bridges screen-framework widgets to FitnessApp actions.
 *
 * @param {Function} props.onPlay - Add item to fitness play queue
 * @param {Function} props.onNavigate - Navigate to show/module/menu
 * @param {Function} props.onCtaAction - Handle coach CTA actions
 */
export function FitnessScreenProvider({ onPlay, onNavigate, onCtaAction, children }) {
  const [scrollToDate, setScrollToDate] = useState(null);

  const value = useMemo(() => ({
    onPlay,
    onNavigate,
    onCtaAction,
    scrollToDate,
    setScrollToDate,
  }), [onPlay, onNavigate, onCtaAction, scrollToDate]);

  return (
    <FitnessScreenContext.Provider value={value}>
      {children}
    </FitnessScreenContext.Provider>
  );
}

/**
 * useFitnessScreen - Access FitnessApp action callbacks from within a screen-framework widget.
 */
export function useFitnessScreen() {
  const ctx = useContext(FitnessScreenContext);
  if (!ctx) {
    return { onPlay: null, onNavigate: null, onCtaAction: null, scrollToDate: null, setScrollToDate: () => {} };
  }
  return ctx;
}
```

Key changes:
- Import `useState` and add `scrollToDate` / `setScrollToDate` state
- Add both to the context value
- Default `setScrollToDate` to no-op in the fallback

**Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessScreenProvider.jsx
git commit -m "feat(fitness): add scrollToDate cross-widget state to FitnessScreenProvider"
```

---

### Task 3: Update FitnessSessionsWidget to Consume `scrollToDate`

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx`

**Step 1: Add `data-date` attributes and consume scrollToDate**

In the `FitnessSessionsWidget` component (line 212), add:
- Import `useFitnessScreen`
- Import `useEffect`
- Read `scrollToDate` and `setScrollToDate` from the context
- Add a `useEffect` that watches `scrollToDate`: finds the date header, scrolls to it, and auto-clicks the first session under that date
- Add `data-date` attribute on each date group's container div

Changes to `SessionsCard` (line 49):
- Add `data-date={group.date}` to each date group `<div>` (line 73)

Changes to `FitnessSessionsWidget` (line 212):

```jsx
import React, { useState, useRef, useEffect } from 'react';
// ... existing imports ...
import { useFitnessScreen } from '@/modules/Fitness/FitnessScreenProvider.jsx';

// In SessionsCard, line 73 change:
// BEFORE:
//   <div key={group.date}>
// AFTER:
//   <div key={group.date} data-date={group.date}>

// In FitnessSessionsWidget, after existing state declarations:
export default function FitnessSessionsWidget() {
  const rawSessions = useScreenData('sessions');
  const { replace } = useScreen();
  const { scrollToDate, setScrollToDate } = useFitnessScreen();
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const revertRef = useRef(null);
  const containerRef = useRef(null);

  const sessions = rawSessions?.sessions || [];

  const handleSessionClick = (sessionId) => {
    if (selectedSessionId === sessionId) {
      revertRef.current?.revert();
      revertRef.current = null;
      setSelectedSessionId(null);
      return;
    }
    revertRef.current?.revert();
    setSelectedSessionId(sessionId);
    revertRef.current = replace('right-area', {
      children: [{ widget: 'fitness:session-detail', props: { sessionId } }]
    });
  };

  // Respond to calendar date selection
  useEffect(() => {
    if (!scrollToDate || !containerRef.current) return;

    const dateDiv = containerRef.current.querySelector(`[data-date="${scrollToDate}"]`);
    if (dateDiv) {
      dateDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Find first session in that date group and auto-select it
      const firstRow = dateDiv.querySelector('.session-row');
      if (firstRow) {
        // Extract sessionId from the first session in that group
        const dateGroup = sessions.filter(s => s.date === scrollToDate);
        // Sessions are reversed within groups in SessionsCard, so the first displayed is last chronologically
        const reversed = [...dateGroup].reverse();
        if (reversed.length > 0) {
          handleSessionClick(reversed[0].sessionId);
        }
      }
    }
    setScrollToDate(null);
  }, [scrollToDate]);

  return (
    <div ref={containerRef}>
      <SessionsCard
        sessions={sessions}
        onSessionClick={handleSessionClick}
        selectedSessionId={selectedSessionId}
      />
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx
git commit -m "feat(fitness): sessions widget responds to scrollToDate from calendar"
```

---

### Task 4: Create FitnessCalendarWidget Component

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/FitnessCalendarWidget/FitnessCalendarWidget.jsx`
- Create: `frontend/src/modules/Fitness/widgets/FitnessCalendarWidget/FitnessCalendarWidget.scss`
- Create: `frontend/src/modules/Fitness/widgets/FitnessCalendarWidget/index.jsx`

**Step 1: Create index.jsx**

```jsx
export { default } from './FitnessCalendarWidget.jsx';
```

**Step 2: Create FitnessCalendarWidget.jsx**

```jsx
import React, { useMemo } from 'react';
import { useScreenData } from '@/screen-framework/data/ScreenDataProvider.jsx';
import { useFitnessScreen } from '@/modules/Fitness/FitnessScreenProvider.jsx';
import './FitnessCalendarWidget.scss';

const COLS = 10; // weeks
const ROWS = 7;  // days (Mon=0 ... Sun=6)
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// Suffer score color: maps 0–200+ to light peach → full Strava orange
function sufferColor(score) {
  if (score == null) return null;
  // Clamp to 0–200 range for interpolation
  const t = Math.min(score / 200, 1);
  // Light peach (#fdd) → Strava orange (#fc4c02)
  const r = Math.round(253 - t * (253 - 252));
  const g = Math.round(221 - t * (221 - 76));
  const b = Math.round(221 - t * (221 - 2));
  return `rgb(${r}, ${g}, ${b})`;
}

function buildCalendarData(sessions) {
  // Build map: dateStr → { count, maxSufferScore }
  const map = new Map();
  for (const s of sessions) {
    if (!s.date) continue;
    const existing = map.get(s.date);
    if (!existing) {
      map.set(s.date, { count: 1, maxSufferScore: s.maxSufferScore ?? null });
    } else {
      existing.count += 1;
      const ss = s.maxSufferScore;
      if (ss != null && (existing.maxSufferScore === null || ss > existing.maxSufferScore)) {
        existing.maxSufferScore = ss;
      }
    }
  }
  return map;
}

function buildGrid() {
  // Build a 10-col × 7-row grid ending at today's week
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  // Find Monday of this week (today's week is the rightmost column)
  const dayOfWeek = today.getDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Mon=0
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - mondayOffset);

  // Start date is (COLS - 1) weeks before thisMonday
  const startMonday = new Date(thisMonday);
  startMonday.setDate(thisMonday.getDate() - (COLS - 1) * 7);

  const cells = [];
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      const d = new Date(startMonday);
      d.setDate(startMonday.getDate() + col * 7 + row);
      const dateStr = d.toISOString().slice(0, 10);
      // Don't show future dates
      const isFuture = dateStr > todayStr;
      cells.push({
        col,
        row,
        date: dateStr,
        isToday: dateStr === todayStr,
        isFuture,
      });
    }
  }
  return cells;
}

export default function FitnessCalendarWidget() {
  const rawSessions = useScreenData('sessions');
  const { setScrollToDate, scrollToDate } = useFitnessScreen();
  const sessions = rawSessions?.sessions || [];

  const dayMap = useMemo(() => buildCalendarData(sessions), [sessions]);
  const grid = useMemo(() => buildGrid(), []);

  // Derive selected date from context (could be set by calendar or by clicking a session)
  const selectedDate = scrollToDate || null;

  return (
    <div className="fitness-calendar">
      <div className="fitness-calendar__labels">
        {DAY_LABELS.map((label, i) => (
          <span key={i} className="fitness-calendar__label">{label}</span>
        ))}
      </div>
      <div className="fitness-calendar__grid">
        {grid.map((cell) => {
          const data = dayMap.get(cell.date);
          const hasSession = !!data;
          const sufferScore = data?.maxSufferScore ?? null;

          let bg;
          if (cell.isFuture) {
            bg = 'transparent';
          } else if (!hasSession) {
            bg = '#DDD';
          } else if (sufferScore != null && sufferScore > 0) {
            bg = sufferColor(sufferScore);
          } else {
            bg = '#2d6a2d'; // dim green — session without Strava
          }

          const classNames = [
            'fitness-calendar__cell',
            cell.isToday && 'fitness-calendar__cell--today',
            hasSession && 'fitness-calendar__cell--active',
            cell.date === selectedDate && 'fitness-calendar__cell--selected',
            cell.isFuture && 'fitness-calendar__cell--future',
          ].filter(Boolean).join(' ');

          return (
            <div
              key={cell.date}
              className={classNames}
              style={{
                backgroundColor: bg,
                gridColumn: cell.col + 2, // +2 because col 1 is labels
                gridRow: cell.row + 1,
              }}
              onPointerDown={hasSession ? () => setScrollToDate(cell.date) : undefined}
              title={`${cell.date}${data ? ` — ${data.count} session${data.count > 1 ? 's' : ''}${sufferScore ? `, suffer: ${sufferScore}` : ''}` : ''}`}
            />
          );
        })}
      </div>
    </div>
  );
}
```

**Step 3: Create FitnessCalendarWidget.scss**

```scss
.fitness-calendar {
  display: flex;
  height: 100%;
  width: 100%;
  padding: 8px;
  box-sizing: border-box;
  gap: 2px;
  align-items: stretch;

  &__labels {
    display: flex;
    flex-direction: column;
    justify-content: space-around;
    flex-shrink: 0;
    width: 14px;
    padding-right: 2px;
  }

  &__label {
    font-size: 0.5rem;
    color: rgba(255, 255, 255, 0.35);
    text-align: center;
    line-height: 1;
  }

  &__grid {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    grid-template-rows: repeat(7, 1fr);
    gap: 2px;
  }

  &__cell {
    border-radius: 2px;
    aspect-ratio: 1;
    // Fill available space without aspect-ratio forcing overflow
    min-width: 0;
    min-height: 0;

    &--today {
      outline: 1.5px solid rgba(255, 255, 255, 0.7);
      outline-offset: -1px;
    }

    &--active {
      cursor: pointer;

      &:hover {
        filter: brightness(1.25);
      }
    }

    &--selected {
      outline: 2px solid rgba(34, 139, 230, 0.8);
      outline-offset: -1px;
    }

    &--future {
      opacity: 0;
    }
  }
}
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessCalendarWidget/
git commit -m "feat(fitness): create FitnessCalendarWidget with suffer-score heat map"
```

---

### Task 5: Register `fitness:calendar` in Widget Registry

**Files:**
- Modify: `frontend/src/modules/Fitness/index.js`

**Step 1: Add import and registration**

After line 49 (the existing dashboard widget imports), add:

```jsx
import FitnessCalendarWidget from './widgets/FitnessCalendarWidget/index.jsx';
```

After line 56 (the existing registrations), add:

```jsx
registry.register('fitness:calendar', FitnessCalendarWidget);
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/index.js
git commit -m "feat(fitness): register fitness:calendar widget"
```

---

### Task 6: Reverse Sync — Calendar Highlights Active Session's Date

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessCalendarWidget/FitnessCalendarWidget.jsx`
- Modify: `frontend/src/modules/Fitness/FitnessScreenProvider.jsx`

The calendar should highlight the date of the currently-selected session even when the user taps a session row directly (not via calendar). Two approaches:

**Approach: Add `selectedSessionId` to FitnessScreenProvider context**

This is simpler. The sessions widget already tracks `selectedSessionId`. Lift it to the provider so the calendar can read it and derive the date.

In `FitnessScreenProvider.jsx`, add:

```jsx
const [selectedSessionId, setSelectedSessionId] = useState(null);
// Add to value: selectedSessionId, setSelectedSessionId
```

In `FitnessSessionsWidget.jsx`, replace local `selectedSessionId` state with the context version:

```jsx
const { scrollToDate, setScrollToDate, selectedSessionId, setSelectedSessionId } = useFitnessScreen();
// Remove: const [selectedSessionId, setSelectedSessionId] = useState(null);
```

In `FitnessCalendarWidget.jsx`, derive the active date:

```jsx
const { setScrollToDate, selectedSessionId } = useFitnessScreen();

// Derive selected date from selectedSessionId (format: YYYYMMDDHHmmss)
const selectedDate = useMemo(() => {
  if (!selectedSessionId || selectedSessionId.length < 8) return null;
  return `${selectedSessionId.slice(0, 4)}-${selectedSessionId.slice(4, 6)}-${selectedSessionId.slice(6, 8)}`;
}, [selectedSessionId]);
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessScreenProvider.jsx
git add frontend/src/modules/Fitness/widgets/FitnessCalendarWidget/FitnessCalendarWidget.jsx
git add frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx
git commit -m "feat(fitness): calendar highlights date of selected session (reverse sync)"
```

---

## Files Summary

| File | Action |
|------|--------|
| `data/household/config/fitness.yml` | Edit — widen data source, split left-area layout |
| `frontend/src/modules/Fitness/FitnessScreenProvider.jsx` | Edit — add `scrollToDate`, `selectedSessionId` state |
| `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx` | Edit — consume `scrollToDate`, add `data-date` attrs, lift `selectedSessionId` |
| `frontend/src/modules/Fitness/widgets/FitnessCalendarWidget/FitnessCalendarWidget.jsx` | Create — calendar grid component |
| `frontend/src/modules/Fitness/widgets/FitnessCalendarWidget/FitnessCalendarWidget.scss` | Create — grid layout, cell colors |
| `frontend/src/modules/Fitness/widgets/FitnessCalendarWidget/index.jsx` | Create — re-export |
| `frontend/src/modules/Fitness/index.js` | Edit — register `fitness:calendar` |

## Verification

1. Run dev server, open `http://localhost:3111/fitness/home`
2. Verify: left area shows sessions list (80%) with calendar (20%) below
3. Verify: calendar shows 7×10 grid with day labels, #DDD empty cells, dim green for sessions without Strava, orange gradient for suffer scores
4. Verify: today's cell has white border
5. Verify: clicking a calendar day scrolls sessions list to that date and loads first session detail
6. Verify: clicking a session row directly highlights corresponding day in calendar
7. Verify: clicking an empty (grey) cell does nothing
8. Verify: future dates are invisible
