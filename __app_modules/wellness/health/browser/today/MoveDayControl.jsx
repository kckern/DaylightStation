import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Menu } from '@mantine/core';
import { useDayDropTarget, useMealDragActive } from "./mealDrag.jsx";
import { addDaysISO, dayLabel, EARLIEST_MOVE_DAY, recentDays } from "./moveDays.js";
import { BUCKETS } from "./mealBuckets.js";

// Food menus: full-height items under a finger (health.scss).
export const MENU_CLASSES = { item: 'health-move-menu__item' };

export function useMoveInFlight(onMove) {
  const [busy, setBusy] = useState(false);
  const pick = async target => { setBusy(true); try { await onMove(target); } finally { setBusy(false); } };
  return [busy, pick];
}

/** The day choices as menu items, plus a date picker for anything older. */
export function MoveDayItems({ date, today, onPick }) {
  return <>
    {recentDays(today, date).map(iso => <Menu.Item key={iso} onClick={() => onPick(iso)}>{dayLabel(iso, today)}</Menu.Item>)}
    <Menu.Divider />
    <Menu.Label>Another day</Menu.Label>
    <div className="health-move-date" style={{ padding: '0 0.75rem 0.5rem' }}>
      <input type="date" aria-label="Move to another day" max={today} defaultValue=""
        onClick={event => event.stopPropagation()}
        onChange={event => { const value = event.target.value; if (value && value >= EARLIEST_MOVE_DAY && value <= today && value !== date) onPick(value); }} />
    </div>
  </>;
}

/**
 * Selection mode: once foods are ticked, this moves them all to another day in
 * one step. `disabled` while the bar's other move is running. Inside a modal,
 * `portalTarget` keeps the menu in the modal's tree: anywhere else, the modal
 * hides it from assistive technology. Escape closes the open menu wherever focus
 * is, and `onMenuChange` lets a modal leave that Escape to the menu.
 */
export function MoveDayControl({ date, today, count, onMove, disabled = false, portalTarget, onMenuChange }) {
  const [busy, pick] = useMoveInFlight(onMove);
  const [open, setOpen] = useState(false);
  const change = value => { setOpen(value); onMenuChange?.(value); };
  // A menu that leaves with this control must not stay "open" for its owner.
  const reportMenu = useRef(onMenuChange);
  reportMenu.current = onMenuChange;
  useEffect(() => () => reportMenu.current?.(false), []);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = event => { if (event.key === 'Escape') change(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // A menu inside the modal has to clear the modal's own layer.
  return <Menu opened={open} onChange={change} position="bottom-start" disabled={busy || disabled} classNames={MENU_CLASSES}
    zIndex={portalTarget ? 400 : undefined} portalProps={portalTarget ? { target: portalTarget } : undefined}>
    <Menu.Target>
      <Button size="compact-xs" variant="light" loading={busy} disabled={disabled && !busy} aria-label={`Move ${count} selected to another day`}>
        Move {count} to another day…
      </Button>
    </Menu.Target>
    <Menu.Dropdown><MoveDayItems date={date} today={today} onPick={pick} /></Menu.Dropdown>
  </Menu>;
}

/**
 * After a capture: one tap to the most likely other day, or pick any day. The
 * toast owns `busy`, because its Undo and Dismiss wait for the move too. `food`
 * names the buttons when another toast is offering the same ones.
 *
 * The menu closes on a pick and takes focus with it, so the day button takes over:
 * it shows the move running, and the toast passes focus on from it when the move
 * ends. A browser can drop focus from a button while it is disabled, so a move
 * that leaves the button in place gives focus back.
 */
export function CaptureDayActions({ date, today, onMove, busy = false, disabled = false, food = null }) {
  const quick = date === today ? addDaysISO(today, -1) : today;
  const quickDay = dayLabel(quick, today);
  const [menuOpen, setMenuOpen] = useState(false);
  const quickButton = useRef(null);
  const heldFocus = useRef(false);
  useLayoutEffect(() => {
    if (busy) { heldFocus.current = document.activeElement === quickButton.current; return; }
    const active = document.activeElement;
    if (heldFocus.current && (!active || active === document.body)) quickButton.current?.focus({ preventScroll: true });
    heldFocus.current = false;
  }, [busy]);
  const pickOther = iso => {
    setMenuOpen(false);
    quickButton.current?.focus({ preventScroll: true });
    onMove(iso);
  };
  return <>
    <Button ref={quickButton} size="compact-xs" variant="light" loading={busy} disabled={disabled} aria-label={food ? `Move ${food} to ${quickDay}` : undefined}
      onClick={() => onMove(quick)}>Move to {quickDay}</Button>
    {/* Above the toast layer (350), which Mantine's default of 300 sits under. */}
    <Menu opened={menuOpen} onChange={setMenuOpen} position="top-start" zIndex={400} disabled={busy || disabled} classNames={MENU_CLASSES}>
      <Menu.Target><Button size="compact-xs" variant="subtle" disabled={busy || disabled} aria-label={food ? `Move ${food} to another day` : undefined}>Other day…</Button></Menu.Target>
      <Menu.Dropdown><MoveDayItems date={date} today={today} onPick={pickOther} /></Menu.Dropdown>
    </Menu>
  </>;
}

/** Selection mode: move every ticked food into one meal. */
export function MoveMealControl({ count, onMove, disabled = false }) {
  const [busy, pick] = useMoveInFlight(onMove);
  return <Menu position="bottom-start" disabled={busy || disabled} classNames={MENU_CLASSES}>
    <Menu.Target>
      <Button size="compact-xs" variant="light" loading={busy} disabled={disabled && !busy} aria-label={`Move ${count} selected to a meal`}>
        Move {count} to a meal…
      </Button>
    </Menu.Target>
    <Menu.Dropdown>{BUCKETS.map(bucket => <Menu.Item key={bucket.id} onClick={() => pick(bucket.id)}>{bucket.label}</Menu.Item>)}</Menu.Dropdown>
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
