// Drag a food from one meal to another.
//
// The whole row is the handle, except the parts of it that already answer the
// pointer: the portion and kcal sliders (a horizontal drag there is an edit),
// the macro badges, confirm / delete, and a dish's expand triangle. A press
// that starts in one of those never becomes a move. A plain click anywhere
// else still opens the editor — a move starts only once the pointer has
// travelled (mouse/pen) or after a long press (touch), and dnd-kit swallows
// the click that ends a drag.
//
// A dish moves with its ingredients (the backend cascades mealTime to a
// group's children). An ingredient row does not drag on its own: moving one
// out would leave it parented to a dish in another meal.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, pointerWithin,
  useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { FoodIcon } from './FoodIcon.jsx';
import { entryError, entryId, entryLabel, updateEntry } from './entryCommands.js';
import { bucketLabel } from './mealBuckets.js';

const logger = createAppLogger('health').child('meal-drag');

/** Where a press must never start a move. */
export const DRAG_DEAD_ZONE = [
  '.health-row__macros', '.health-row__portion-cell', '.health-row__kcal', '.health-portion',
  '.health-row__action', '.health-row__expand', 'input', 'textarea', 'select', '[data-no-drag]',
].join(', ');

export const MOUSE_DRAG_DISTANCE_PX = 6;
export const TOUCH_HOLD_MS = 300;
export const MOVED_HIGHLIGHT_MS = 1500;

export const isDragDeadZone = target => Boolean(target?.closest?.(DRAG_DEAD_ZONE));

// Mouse and pen: primary button, outside the dead zones. Touch has its own
// sensor (long press), so a finger never starts a move by scrolling.
class RowPointerSensor extends PointerSensor {
  static activators = [{
    eventName: 'onPointerDown',
    handler: ({ nativeEvent: event }) => event.isPrimary && event.button === 0
      && event.pointerType !== 'touch' && !isDragDeadZone(event.target),
  }];
}
class RowTouchSensor extends TouchSensor {
  static activators = [{
    eventName: 'onTouchStart',
    handler: ({ nativeEvent: event }) => event.touches.length === 1 && !isDragDeadZone(event.target),
  }];
}
// No keyboard sensor on purpose: the row's name is a button that opens the
// editor, and the editor's meal picker is the keyboard route for a move.

const MealDragContext = createContext(null);

/**
 * Wraps the day's meals. `onMove(row, toBucket, fromBucket)` is called once,
 * on a drop into a different meal.
 */
export function MealDragProvider({ onMove, children }) {
  const sensors = useSensors(
    useSensor(RowPointerSensor, { activationConstraint: { distance: MOUSE_DRAG_DISTANCE_PX } }),
    useSensor(RowTouchSensor, { activationConstraint: { delay: TOUCH_HOLD_MS, tolerance: 8 } }),
  );
  const [active, setActive] = useState(null); // { row, bucket }
  const onDragStart = ({ active: item }) => {
    const { row, bucket } = item.data.current || {};
    setActive({ row, bucket });
    logger.debug('drag.start', { uuid: entryId(row), from: bucket });
  };
  const onDragEnd = ({ active: item, over }) => {
    const { row, bucket } = item.data.current || {};
    setActive(null);
    const to = over?.id ?? null;
    if (!row || !to || to === bucket) { logger.debug('drag.cancel', { uuid: entryId(row), from: bucket, over: to }); return; }
    onMove?.(row, to, bucket);
  };
  const value = useMemo(() => ({ enabled: true, activeBucket: active?.bucket ?? null }), [active?.bucket]);
  return <MealDragContext.Provider value={value}>
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart}
      onDragEnd={onDragEnd} onDragCancel={() => setActive(null)} autoScroll={{ threshold: { x: 0, y: 0.15 } }}>
      {children}
      <DragOverlay dropAnimation={null}>
        {active ? <div className="health-drag-ghost">
          <FoodIcon icon={active.row.icon} />
          <span className="health-drag-ghost__name">{entryLabel(active.row)}</span>
        </div> : null}
      </DragOverlay>
    </DndContext>
  </MealDragContext.Provider>;
}

/** Row side. Inert outside a provider, for child rows, and while `disabled`. */
export function useDraggableRow(row, bucket, { disabled = false } = {}) {
  const context = useContext(MealDragContext);
  const off = !context?.enabled || !bucket || disabled;
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: String(entryId(row)), data: { row, bucket }, disabled: off,
  });
  return { ref: setNodeRef, handlers: off ? {} : listeners, dragging: isDragging, draggable: !off };
}

/** Meal side: the section a row is dropped on. */
export function useMealDropTarget(bucket) {
  const context = useContext(MealDragContext);
  const { setNodeRef, isOver } = useDroppable({ id: bucket || '__none__', disabled: !context?.enabled || !bucket });
  const activeBucket = context?.activeBucket ?? null;
  return {
    ref: setNodeRef,
    dragging: activeBucket != null,
    over: isOver && activeBucket != null && activeBucket !== bucket,
  };
}

// A moved row (and a dish's children) wear their new meal from the drop until
// the day reloads with it, so the row never snaps back in between.
function applyMoves(items, moves) {
  if (!moves.size) return items;
  return items.map(row => {
    const id = String(entryId(row));
    const direct = moves.get(id);
    const viaParent = row.parentId != null ? moves.get(String(row.parentId)) : null;
    const move = direct || viaParent;
    return move && row.mealTime !== move.to ? { ...row, mealTime: move.to } : row;
  });
}

/**
 * Owns the move command: optimistic placement, the PUT, a brief highlight on
 * the moved row, and one Undo.
 */
export function useMealMoves(day) {
  const [moves, setMoves] = useState(() => new Map()); // id -> { to }
  const [recent, setRecent] = useState(() => new Set());
  const [undo, setUndo] = useState(null); // { row, from, to, versions }
  const [error, setError] = useState(null);
  const timers = useRef(new Set());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Retire an override once the read model carries the move.
  useEffect(() => {
    if (!moves.size) return;
    const settled = [...moves].filter(([id, move]) => day.items.some(row => String(entryId(row)) === id && row.mealTime === move.to));
    if (!settled.length) return;
    setMoves(previous => { const next = new Map(previous); settled.forEach(([id]) => next.delete(id)); return next; });
  }, [day.items, moves]);

  const items = useMemo(() => applyMoves(day.items, moves), [day.items, moves]);

  const highlight = id => {
    setRecent(previous => new Set(previous).add(id));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setRecent(previous => { const next = new Set(previous); next.delete(id); return next; });
    }, MOVED_HIGHLIGHT_MS);
    timers.current.add(timer);
  };

  const send = useCallback(async (row, to, from, { isUndo = false } = {}) => {
    const id = String(entryId(row));
    setError(null);
    setMoves(previous => new Map(previous).set(id, { to }));
    highlight(id);
    try {
      const result = await updateEntry(row, { mealTime: to }, crypto.randomUUID());
      logger.info(isUndo ? 'entry.move.undo' : 'entry.move', { uuid: id, from, to, children: row.children?.length || 0 });
      const versions = result?.versions || {};
      const moved = { ...row, mealTime: to, version: versions[id] ?? row.version,
        children: row.children?.map(child => ({ ...child, mealTime: to, version: versions[String(entryId(child))] ?? child.version })) };
      setUndo(isUndo ? null : { row: moved, from, to });
      day.reload?.();
    } catch (err) {
      setMoves(previous => { const next = new Map(previous); next.delete(id); return next; });
      setError(`Couldn't move ${entryLabel(row)}: ${entryError(err)}`);
      logger.warn('entry.move.failed', { uuid: id, from, to, error: err.message });
      day.reload?.();
    }
  }, [day]);

  return {
    items,
    recentIds: recent,
    move: (row, to, from) => send(row, to, from),
    undo: undo ? {
      label: `Moved ${entryLabel(undo.row)} to ${bucketLabel(undo.to)}`,
      run: () => send(undo.row, undo.from, undo.to, { isUndo: true }),
      dismiss: () => setUndo(null),
    } : null,
    error,
    clearError: () => setError(null),
  };
}
