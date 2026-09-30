import { useState } from 'react';
import { Button, Menu } from '@mantine/core';
import { useDayDropTarget, useMealDragActive } from './mealDrag.jsx';
import { dayLabel, recentDays } from './moveDays.js';

/** The day choices as menu items, plus a date picker for anything older. */
export function MoveDayItems({ date, today, onPick }) {
  return <>
    {recentDays(today, date).map(iso => <Menu.Item key={iso} onClick={() => onPick(iso)}>{dayLabel(iso, today)}</Menu.Item>)}
    <Menu.Divider />
    <Menu.Label>Another day</Menu.Label>
    <div style={{ padding: '0 0.75rem 0.5rem' }}>
      <input type="date" aria-label="Move to another day" max={today} defaultValue=""
        onClick={event => event.stopPropagation()}
        onChange={event => { const value = event.target.value; if (value && value <= today && value !== date) onPick(value); }} />
    </div>
  </>;
}

/**
 * Selection mode: once foods are ticked, this moves them all to another day in
 * one step. Shown beside the meal's own selection controls.
 */
export function MoveDayControl({ date, today, count, onMove }) {
  const [busy, setBusy] = useState(false);
  const pick = async iso => { setBusy(true); try { await onMove(iso); } finally { setBusy(false); } };
  return <Menu position="bottom-start" disabled={busy}>
    <Menu.Target>
      <Button size="compact-xs" variant="light" loading={busy} aria-label={`Move ${count} selected to another day`}>
        Move {count} to another day…
      </Button>
    </Menu.Target>
    <Menu.Dropdown><MoveDayItems date={date} today={today} onPick={pick} /></Menu.Dropdown>
  </Menu>;
}

function DayChip({ iso, today }) {
  const drop = useDayDropTarget(iso);
  return <div ref={drop.ref} data-no-drag className={['health-day-dock__chip', drop.over && 'health-day-dock__chip--over'].filter(Boolean).join(' ')}>
    {dayLabel(iso, today)}
  </div>;
}

/**
 * While a food or a meal is being dragged, the recent days dock at the right
 * edge; dropping on one moves it there. Fixed-position, so it never shifts the
 * page, and it only exists during a drag.
 */
export function DayDropDock({ date, today }) {
  const dragging = useMealDragActive();
  if (!dragging) return null;
  return <aside className="health-day-dock" aria-label="Drop on a day to move it">
    <span className="health-day-dock__title">Move to day</span>
    {recentDays(today, date).map(iso => <DayChip key={iso} iso={iso} today={today} />)}
  </aside>;
}
