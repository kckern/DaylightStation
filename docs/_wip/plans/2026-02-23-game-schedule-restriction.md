# Game Schedule Restriction — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add time-of-day restrictions to RetroArch game launches, with an admin UI to configure the schedule and a Sonic "no no no" gif shown when games are blocked.

**Architecture:** Schedule config lives in `retroarch.yml` as per-day time windows. `LaunchService` checks the schedule before launching retroarch content. A generic `GET /api/v1/content/schedule/:contentId` endpoint exposes availability. The admin UI adds a visual weekly time grid to GamesIndex. LaunchCard shows a blocked state with Sonic gif when the schedule rejects a launch.

**Tech Stack:** Express (backend), React + Mantine (admin UI), SCSS (LaunchCard styling)

---

### Task 1: Pass error code through launch router

The launch router currently drops `ValidationError.code`. We need it to pass `OUTSIDE_SCHEDULE` to the frontend.

**Files:**
- Modify: `backend/src/4_api/v1/routers/launch.mjs:42-48`

**Step 1: Update error response to include code**

In the catch block, include `error.code` in the JSON response:

```javascript
    } catch (error) {
      const status = error.name === 'ValidationError' ? 400
        : error.name === 'EntityNotFoundError' ? 404
        : 500;
      logger.error?.('launch.api.error', { contentId, targetDeviceId, error: error.message });
      res.status(status).json({
        error: error.message,
        ...(error.code && { code: error.code }),
        ...(error.details && { details: error.details })
      });
    }
```

**Step 2: Verify no regressions**

Run: existing launch error paths still produce `{ error: "..." }` — the new fields are only added when present.

**Step 3: Commit**

```bash
git add backend/src/4_api/v1/routers/launch.mjs
git commit -m "feat: pass error code and details through launch API responses"
```

---

### Task 2: Add schedule checking to LaunchService

**Files:**
- Modify: `backend/src/3_applications/content/services/LaunchService.mjs:34-56`

**Step 1: Add schedule check method**

Add a private method `#checkContentSchedule(contentId)` to `LaunchService` that:
1. Parses the source prefix from `contentId` (e.g. `retroarch` from `retroarch:snes/mario`)
2. If source is `retroarch`, loads the retroarch config via `this.#configService.getHouseholdAppConfig(null, 'retroarch')`
3. Reads the `schedule` key from config
4. If no schedule exists, returns (allowed by default)
5. Gets current day name (lowercase) and current time (HH:MM)
6. Checks if now falls within any window for today
7. If blocked, throws `ValidationError` with `code: 'OUTSIDE_SCHEDULE'` and `details: { nextWindow }` containing the next available start time

```javascript
  #checkContentSchedule(contentId) {
    const source = contentId.split(':')[0];
    if (source !== 'retroarch' || !this.#configService) return;

    const config = this.#configService.getHouseholdAppConfig(null, 'retroarch');
    const schedule = config?.schedule;
    if (!schedule) return;

    const now = new Date();
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const today = days[now.getDay()];
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const windows = schedule[today];
    if (!windows || windows.length === 0) {
      const nextWindow = this.#findNextWindow(schedule, now);
      throw new ValidationError('Games are not available right now', {
        code: 'OUTSIDE_SCHEDULE',
        details: { nextWindow }
      });
    }

    const inWindow = windows.some(w => {
      const [sh, sm] = w.start.split(':').map(Number);
      const [eh, em] = w.end.split(':').map(Number);
      return currentMinutes >= sh * 60 + sm && currentMinutes < eh * 60 + em;
    });

    if (!inWindow) {
      const nextWindow = this.#findNextWindowFromToday(schedule, now, windows);
      throw new ValidationError('Games are not available right now', {
        code: 'OUTSIDE_SCHEDULE',
        details: { nextWindow }
      });
    }
  }

  #findNextWindow(schedule, now) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const currentDay = now.getDay();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // Check remaining windows today
    const todayWindows = schedule[days[currentDay]] || [];
    for (const w of todayWindows) {
      const [sh, sm] = w.start.split(':').map(Number);
      if (sh * 60 + sm > currentMinutes) return { day: days[currentDay], start: w.start };
    }

    // Check next 7 days
    for (let i = 1; i <= 7; i++) {
      const dayIdx = (currentDay + i) % 7;
      const dayName = days[dayIdx];
      const dayWindows = schedule[dayName];
      if (dayWindows?.length > 0) {
        return { day: dayName, start: dayWindows[0].start };
      }
    }
    return null;
  }

  #findNextWindowFromToday(schedule, now, todayWindows) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // Check later windows today
    for (const w of todayWindows) {
      const [sh, sm] = w.start.split(':').map(Number);
      if (sh * 60 + sm > currentMinutes) return { day: days[now.getDay()], start: w.start };
    }

    // Fall through to next days
    return this.#findNextWindow(schedule, now);
  }
```

**Step 2: Call schedule check in launch()**

Insert after content resolution (after line 56 in current file), before device resolution:

```javascript
    // 1.5. Check content schedule
    this.#checkContentSchedule(contentId);
```

**Step 3: Commit**

```bash
git add backend/src/3_applications/content/services/LaunchService.mjs
git commit -m "feat: enforce game schedule in LaunchService"
```

---

### Task 3: Add content schedule API endpoint

A source-agnostic endpoint that checks schedule availability for any content ID.

**Files:**
- Modify: `backend/src/4_api/v1/routers/content.mjs` — add new route
- Modify: `backend/src/app.mjs` — pass configService to content router if not already available

**Step 1: Add schedule checking utility**

Create a small helper that can be shared between LaunchService and the content router. Rather than duplicating logic, extract the schedule check into a pure function in a new file:

**Create:** `backend/src/3_applications/content/services/scheduleCheck.mjs`

```javascript
/**
 * Check if content is currently within its allowed schedule.
 * @param {string} source - Content source (e.g. 'retroarch')
 * @param {Object} schedule - The schedule config object (per-day windows)
 * @returns {{ available: boolean, nextWindow: { day: string, start: string } | null }}
 */
export function checkSchedule(source, schedule) {
  if (source !== 'retroarch' || !schedule) {
    return { available: true, nextWindow: null };
  }

  const now = new Date();
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const today = days[now.getDay()];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const windows = schedule[today];
  if (!windows || windows.length === 0) {
    return { available: false, nextWindow: findNextWindow(schedule, now) };
  }

  const inWindow = windows.some(w => {
    const [sh, sm] = w.start.split(':').map(Number);
    const [eh, em] = w.end.split(':').map(Number);
    return currentMinutes >= sh * 60 + sm && currentMinutes < eh * 60 + em;
  });

  if (!inWindow) {
    return { available: false, nextWindow: findNextWindowFromToday(schedule, now, windows) };
  }

  return { available: true, nextWindow: null };
}

function findNextWindow(schedule, now) {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const currentDay = now.getDay();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const todayWindows = schedule[days[currentDay]] || [];
  for (const w of todayWindows) {
    const [sh, sm] = w.start.split(':').map(Number);
    if (sh * 60 + sm > currentMinutes) return { day: days[currentDay], start: w.start };
  }

  for (let i = 1; i <= 7; i++) {
    const dayIdx = (currentDay + i) % 7;
    const dayName = days[dayIdx];
    const dayWindows = schedule[dayName];
    if (dayWindows?.length > 0) {
      return { day: dayName, start: dayWindows[0].start };
    }
  }
  return null;
}

function findNextWindowFromToday(schedule, now, todayWindows) {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  for (const w of todayWindows) {
    const [sh, sm] = w.start.split(':').map(Number);
    if (sh * 60 + sm > currentMinutes) return { day: days[now.getDay()], start: w.start };
  }

  return findNextWindow(schedule, now);
}
```

**Step 2: Refactor LaunchService to use shared utility**

Replace the inline schedule logic in LaunchService with a call to `checkSchedule()`:

```javascript
import { checkSchedule } from './scheduleCheck.mjs';

// In #checkContentSchedule:
#checkContentSchedule(contentId) {
  const source = contentId.split(':')[0];
  if (!this.#configService) return;

  const config = this.#configService.getHouseholdAppConfig(null, source);
  const { available, nextWindow } = checkSchedule(source, config?.schedule);

  if (!available) {
    throw new ValidationError('Games are not available right now', {
      code: 'OUTSIDE_SCHEDULE',
      details: { nextWindow }
    });
  }
}
```

**Step 3: Add route to content router**

Add to `content.mjs`:

```javascript
  router.get('/schedule/:source/*', (req, res) => {
    const source = req.params.source;
    const config = configService?.getHouseholdAppConfig(null, source);
    const { available, nextWindow } = checkSchedule(source, config?.schedule);
    res.json({ available, nextWindow, schedule: config?.schedule || null });
  });
```

**Step 4: Wire configService into content router**

In `app.mjs`, ensure `configService` is passed to `createContentRouter`. Check current params and add if missing.

**Step 5: Commit**

```bash
git add backend/src/3_applications/content/services/scheduleCheck.mjs \
      backend/src/3_applications/content/services/LaunchService.mjs \
      backend/src/4_api/v1/routers/content.mjs \
      backend/src/app.mjs
git commit -m "feat: add content schedule API and shared schedule check utility"
```

---

### Task 4: LaunchCard blocked state with Sonic gif

When the launch API returns `code: 'OUTSIDE_SCHEDULE'`, show a blocked state instead of the generic error.

**Files:**
- Modify: `frontend/src/modules/Menu/LaunchCard.jsx`
- Modify: `frontend/src/modules/Menu/LaunchCard.scss`

**Step 1: Update LaunchCard to detect schedule block**

Add a `blocked` state and `nextWindow` state. Parse the error response JSON to check for `code: 'OUTSIDE_SCHEDULE'`:

```jsx
import { DaylightMediaPath } from '../../lib/api.mjs';

const LaunchCard = ({ launch, title, thumbnail, metadata, onClose }) => {
  const logger = useMemo(() => getLogger().child({ component: 'LaunchCard' }), []);
  const [status, setStatus] = useState('launching');
  const [errorMsg, setErrorMsg] = useState(null);
  const [nextWindow, setNextWindow] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!launch?.contentId) return;

    logger.info('launch.initiated', { contentId: launch.contentId });

    const deviceId = launch.targetDeviceId || window.__DAYLIGHT_DEVICE_ID || undefined;

    fetch('/api/v1/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentId: launch.contentId,
        ...(deviceId && { targetDeviceId: deviceId })
      })
    })
      .then(res => {
        if (!res.ok) return res.json().then(d => Promise.reject(d));
        return res.json();
      })
      .then(data => {
        logger.info('launch.success', { contentId: launch.contentId, title: data.title });
        setStatus('success');
        setTimeout(() => onClose?.(), 1500);
      })
      .catch(errData => {
        const message = errData?.error || errData?.message || 'Launch failed';
        if (errData?.code === 'OUTSIDE_SCHEDULE') {
          logger.info('launch.blocked.schedule', { contentId: launch.contentId, nextWindow: errData.details?.nextWindow });
          setStatus('blocked');
          setNextWindow(errData.details?.nextWindow || null);
        } else {
          logger.error('launch.failed', { contentId: launch.contentId, error: message });
          setStatus('error');
          setErrorMsg(message);
        }
      });
  }, [launch?.contentId, retryCount]);
```

**Step 2: Add blocked state rendering**

Add the blocked state JSX. Use `DaylightMediaPath` for the Sonic gif:

```jsx
  const sonicGif = DaylightMediaPath('media/img/ui/sonic-nonono.gif');

  // Format next window for display
  const formatNextWindow = (nw) => {
    if (!nw) return '';
    const [h, m] = nw.start.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    const timeStr = m > 0 ? `${h12}:${String(m).padStart(2, '0')} ${ampm}` : `${h12} ${ampm}`;
    const dayStr = nw.day.charAt(0).toUpperCase() + nw.day.slice(1);
    // If it's today, just show time
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const today = days[new Date().getDay()];
    if (nw.day === today) return timeStr;
    return `${dayStr} at ${timeStr}`;
  };

  return (
    <div className={`launch-card${status === 'blocked' ? ' launch-card--blocked' : ''}`}>
      {status === 'blocked' ? (
        <>
          <img className="launch-card__art" src={sonicGif} alt="Not right now!" />
          <div className="launch-card__info">
            <h2 className="launch-card__title">Not right now!</h2>
            {nextWindow && (
              <p className="launch-card__console">Games open at {formatNextWindow(nextWindow)}</p>
            )}
          </div>
          <div className="launch-card__status">
            <button className="launch-card__ok-btn" onClick={() => onClose?.()}>OK</button>
          </div>
        </>
      ) : (
        <>
          {thumbnail && <img className="launch-card__art" src={thumbnail} alt={title} />}
          <div className="launch-card__info">
            <h2 className="launch-card__title">{title}</h2>
            {metadata?.parentTitle && <p className="launch-card__console">{metadata.parentTitle}</p>}
          </div>
          <div className="launch-card__status">
            {status === 'launching' && <span className="launch-card__spinner">Launching...</span>}
            {status === 'success' && <span className="launch-card__success">Launched</span>}
            {status === 'error' && (
              <div className="launch-card__error">
                <span>{errorMsg}</span>
                <button onClick={() => { setStatus('launching'); setErrorMsg(null); setRetryCount(c => c + 1); }}>Retry</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
```

**Step 3: Add blocked state styles**

Add to `LaunchCard.scss`:

```scss
  &--blocked {
    background: rgba(0, 0, 0, 0.95);
  }

  &__ok-btn {
    padding: 0.5rem 2rem;
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 8px;
    background: transparent;
    color: #f8fafc;
    cursor: pointer;
    font-size: 1rem;
    margin-top: 0.5rem;

    &:hover {
      background: rgba(255, 255, 255, 0.1);
    }
  }
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Menu/LaunchCard.jsx \
      frontend/src/modules/Menu/LaunchCard.scss
git commit -m "feat: show Sonic gif when game launch is blocked by schedule"
```

---

### Task 5: Admin UI — Game Schedule Editor

A visual weekly time grid at the top of GamesIndex for editing the retroarch schedule.

**Files:**
- Create: `frontend/src/modules/Admin/Games/GameScheduleEditor.jsx`
- Create: `frontend/src/modules/Admin/Games/GameScheduleEditor.scss`
- Modify: `frontend/src/modules/Admin/Games/GamesIndex.jsx`

**Step 1: Create GameScheduleEditor component**

The grid is a 7-row (days) × 48-column (half-hour blocks, 6am–midnight = 36 cols) table. Each cell is a toggle. Click+drag paints or erases.

```jsx
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Paper, Text, Group, Button, Collapse, ActionIcon } from '@mantine/core';
import getLogger from '../../../lib/logging/Logger.js';
import './GameScheduleEditor.scss';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const START_HOUR = 6;
const END_HOUR = 24; // midnight
const SLOTS_PER_HOUR = 2; // 30-min blocks
const TOTAL_SLOTS = (END_HOUR - START_HOUR) * SLOTS_PER_HOUR;

/** Convert schedule config ({ monday: [{ start, end }] }) to a 7×TOTAL_SLOTS boolean grid */
function scheduleToGrid(schedule) {
  const grid = DAYS.map(() => new Array(TOTAL_SLOTS).fill(false));
  if (!schedule) return grid;

  DAYS.forEach((day, dayIdx) => {
    const windows = schedule[day] || [];
    for (const w of windows) {
      const [sh, sm] = w.start.split(':').map(Number);
      const [eh, em] = w.end.split(':').map(Number);
      const startSlot = Math.max(0, (sh - START_HOUR) * SLOTS_PER_HOUR + Math.floor(sm / 30));
      const endSlot = Math.min(TOTAL_SLOTS, (eh - START_HOUR) * SLOTS_PER_HOUR + Math.floor(em / 30));
      for (let s = startSlot; s < endSlot; s++) {
        if (s >= 0 && s < TOTAL_SLOTS) grid[dayIdx][s] = true;
      }
    }
  });
  return grid;
}

/** Convert boolean grid back to schedule config */
function gridToSchedule(grid) {
  const schedule = {};
  DAYS.forEach((day, dayIdx) => {
    const windows = [];
    let inWindow = false;
    let windowStart = 0;

    for (let s = 0; s <= TOTAL_SLOTS; s++) {
      const active = s < TOTAL_SLOTS && grid[dayIdx][s];
      if (active && !inWindow) {
        inWindow = true;
        windowStart = s;
      } else if (!active && inWindow) {
        inWindow = false;
        const sh = START_HOUR + Math.floor(windowStart / SLOTS_PER_HOUR);
        const sm = (windowStart % SLOTS_PER_HOUR) * 30;
        const eh = START_HOUR + Math.floor(s / SLOTS_PER_HOUR);
        const em = (s % SLOTS_PER_HOUR) * 30;
        windows.push({
          start: `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`,
          end: `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`
        });
      }
    }
    if (windows.length > 0) schedule[day] = windows;
  });
  return schedule;
}

const GameScheduleEditor = ({ schedule, onSave }) => {
  const logger = useMemo(() => getLogger().child({ component: 'GameScheduleEditor' }), []);
  const [grid, setGrid] = useState(() => scheduleToGrid(schedule));
  const [painting, setPainting] = useState(null); // null | true (painting on) | false (erasing)
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const gridRef = useRef(null);

  useEffect(() => {
    setGrid(scheduleToGrid(schedule));
    setDirty(false);
  }, [schedule]);

  const toggleSlot = useCallback((dayIdx, slotIdx, value) => {
    setGrid(prev => {
      const next = prev.map(row => [...row]);
      next[dayIdx][slotIdx] = value;
      return next;
    });
    setDirty(true);
  }, []);

  const handleMouseDown = (dayIdx, slotIdx) => {
    const newValue = !grid[dayIdx][slotIdx];
    setPainting(newValue);
    toggleSlot(dayIdx, slotIdx, newValue);
  };

  const handleMouseEnter = (dayIdx, slotIdx) => {
    if (painting !== null) {
      toggleSlot(dayIdx, slotIdx, painting);
    }
  };

  const handleMouseUp = () => setPainting(null);

  const handleSave = async () => {
    setSaving(true);
    const newSchedule = gridToSchedule(grid);
    logger.info('schedule.save', { schedule: newSchedule });
    await onSave(newSchedule);
    setDirty(false);
    setSaving(false);
  };

  // Hour labels (only show every 2 hours to avoid crowding)
  const hourLabels = [];
  for (let h = START_HOUR; h < END_HOUR; h += 2) {
    const label = h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;
    hourLabels.push({ hour: h, label, slotIdx: (h - START_HOUR) * SLOTS_PER_HOUR });
  }

  return (
    <Paper p="sm" withBorder>
      <Group justify="space-between" mb={expanded ? 'sm' : 0}>
        <Text fw={600} size="sm" style={{ cursor: 'pointer' }} onClick={() => setExpanded(e => !e)}>
          Game Schedule {expanded ? '▾' : '▸'}
        </Text>
        {expanded && dirty && (
          <Button size="xs" onClick={handleSave} loading={saving}>Save Schedule</Button>
        )}
      </Group>
      <Collapse in={expanded}>
        <div
          className="schedule-grid"
          ref={gridRef}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {/* Hour labels row */}
          <div className="schedule-grid__header">
            <div className="schedule-grid__day-label" />
            {hourLabels.map(({ hour, label, slotIdx }) => (
              <div
                key={hour}
                className="schedule-grid__hour-label"
                style={{ gridColumn: slotIdx + 2, gridColumnEnd: `span ${SLOTS_PER_HOUR * 2}` }}
              >
                {label}
              </div>
            ))}
          </div>
          {/* Day rows */}
          {DAYS.map((day, dayIdx) => (
            <div key={day} className="schedule-grid__row">
              <div className="schedule-grid__day-label">{DAY_LABELS[dayIdx]}</div>
              {Array.from({ length: TOTAL_SLOTS }, (_, slotIdx) => (
                <div
                  key={slotIdx}
                  className={`schedule-grid__cell${grid[dayIdx][slotIdx] ? ' schedule-grid__cell--active' : ''}${slotIdx % SLOTS_PER_HOUR === 0 ? ' schedule-grid__cell--hour-start' : ''}`}
                  onMouseDown={() => handleMouseDown(dayIdx, slotIdx)}
                  onMouseEnter={() => handleMouseEnter(dayIdx, slotIdx)}
                />
              ))}
            </div>
          ))}
        </div>
      </Collapse>
    </Paper>
  );
};

export default GameScheduleEditor;
```

**Step 2: Create SCSS for the grid**

```scss
.schedule-grid {
  user-select: none;

  &__header {
    display: flex;
    align-items: flex-end;
    padding-bottom: 2px;
  }

  &__hour-label {
    font-size: 10px;
    color: var(--ds-text-secondary, #999);
    font-family: 'JetBrains Mono', monospace;
    text-align: left;
    width: calc((100% - 36px) / 36 * 4); // 4 slots per 2-hour label
    flex-shrink: 0;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: 0;
  }

  &__day-label {
    width: 36px;
    flex-shrink: 0;
    font-size: 11px;
    font-family: 'JetBrains Mono', monospace;
    color: var(--ds-text-secondary, #999);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  &__cell {
    flex: 1;
    height: 24px;
    border: 1px solid var(--ds-border, rgba(255, 255, 255, 0.08));
    border-right: none;
    cursor: pointer;
    background: var(--ds-bg-base, rgba(255, 255, 255, 0.03));
    transition: background 0.05s;

    &:last-child {
      border-right: 1px solid var(--ds-border, rgba(255, 255, 255, 0.08));
    }

    &--hour-start {
      border-left-color: rgba(255, 255, 255, 0.15);
    }

    &--active {
      background: rgba(74, 123, 247, 0.5);
    }

    &:hover {
      background: rgba(74, 123, 247, 0.3);
    }

    &--active:hover {
      background: rgba(74, 123, 247, 0.7);
    }
  }
}
```

**Step 3: Integrate into GamesIndex**

Add schedule fetching and the editor above the console list:

```jsx
import GameScheduleEditor from './GameScheduleEditor.jsx';

// In component, add state:
const [schedule, setSchedule] = useState(null);

// In useEffect, also fetch schedule:
fetch('/api/v1/content/schedule/retroarch').then(r => r.json()).then(data => {
  setSchedule(data.schedule);
}).catch(() => {});

// Add save handler:
const handleScheduleSave = async (newSchedule) => {
  // Read current config, update schedule key, write back
  const configRes = await fetch('/api/v1/admin/config/files/household/config/retroarch.yml');
  const configData = await configRes.json();
  const parsed = configData.parsed || {};
  parsed.schedule = newSchedule;
  await fetch('/api/v1/admin/config/files/household/config/retroarch.yml', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parsed })
  });
  setSchedule(newSchedule);
  logger.info('schedule.saved', { schedule: newSchedule });
};

// In JSX, add above consoles.map:
<GameScheduleEditor schedule={schedule} onSave={handleScheduleSave} />
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Admin/Games/GameScheduleEditor.jsx \
      frontend/src/modules/Admin/Games/GameScheduleEditor.scss \
      frontend/src/modules/Admin/Games/GamesIndex.jsx
git commit -m "feat: add visual game schedule editor to admin UI"
```

---

### Task 6: Integration test — manual verification

**Steps:**
1. Add a `schedule` key to local `retroarch.yml` with a window that excludes the current time
2. Start dev server
3. Attempt to launch a RetroArch game → verify Sonic gif appears with next window time
4. Update schedule to include current time → verify launch succeeds
5. Open admin at `/admin/content/games` → verify schedule grid renders and is editable
6. Paint/erase time blocks, save → verify config file updated
7. Remove schedule key entirely → verify games launch without restriction (no schedule = unrestricted)

**Commit:**
```bash
git add -A
git commit -m "feat: game schedule restriction with admin UI and Sonic blocked screen"
```
