import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Paper, Text, Group, Button, Collapse } from '@mantine/core';
import getLogger from '../../../lib/logging/Logger.js';
import './GameScheduleEditor.scss';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const START_HOUR = 6;
const END_HOUR = 24;
const SLOTS_PER_HOUR = 2;
const TOTAL_SLOTS = (END_HOUR - START_HOUR) * SLOTS_PER_HOUR;

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
  const [painting, setPainting] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

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

  const hourLabels = [];
  for (let h = START_HOUR; h < END_HOUR; h += 2) {
    const label = h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;
    hourLabels.push({ hour: h, label });
  }

  return (
    <Paper p="sm" withBorder>
      <Group justify="space-between" mb={expanded ? 'sm' : 0}>
        <Text fw={600} size="sm" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => setExpanded(e => !e)}>
          Game Schedule {expanded ? '\u25BE' : '\u25B8'}
        </Text>
        {expanded && dirty && (
          <Button size="xs" onClick={handleSave} loading={saving}>Save Schedule</Button>
        )}
      </Group>
      <Collapse in={expanded}>
        <div
          className="schedule-grid"
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div className="schedule-grid__header">
            <div className="schedule-grid__day-label" />
            {hourLabels.map(({ hour, label }) => (
              <div key={hour} className="schedule-grid__hour-label">
                {label}
              </div>
            ))}
          </div>
          {DAYS.map((day, dayIdx) => (
            <div key={day} className="schedule-grid__row">
              <div className="schedule-grid__day-label">{DAY_LABELS[dayIdx]}</div>
              <div className="schedule-grid__cells">
                {Array.from({ length: TOTAL_SLOTS }, (_, slotIdx) => (
                  <div
                    key={slotIdx}
                    className={`schedule-grid__cell${grid[dayIdx][slotIdx] ? ' schedule-grid__cell--active' : ''}${slotIdx % SLOTS_PER_HOUR === 0 ? ' schedule-grid__cell--hour-start' : ''}`}
                    onMouseDown={() => handleMouseDown(dayIdx, slotIdx)}
                    onMouseEnter={() => handleMouseEnter(dayIdx, slotIdx)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Collapse>
    </Paper>
  );
};

export default GameScheduleEditor;
