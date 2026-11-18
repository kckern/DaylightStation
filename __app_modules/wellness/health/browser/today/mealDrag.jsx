import { useFoodMutation } from "../operations/useFoodMutation.js";
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
// A dish moves with its ingredients: the move command carries the whole dish.
// An ingredient row does not drag on its own: moving one out would leave it
// parented to a dish in another meal.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, pointerWithin,
  useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import { createAppLogger } from "../../../../../frontend/src/lib/ui/createAppLogger.js";
import { FoodIcon } from "./FoodIcon.jsx";
import { entryError, entryId, entryLabel } from "./entryCommands.js";
import { bucketLabel } from "./mealBuckets.js";
import { groupRows } from "./groupRows.js";
import { dayDropId, dayFromDropId, dayLabel } from "./moveDays.js";
import { localTodayISO } from "./mealBuckets.js";

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
 * on a drop into a different meal; `onMoveToDay(rows, isoDate, fromBucket)` on
 * a drop onto a day in the day dock (MoveDayControl.jsx).
 */
export function MealDragProvider({ onMove, onMoveMeal, onMoveToDay, children }) {
  const sensors = useSensors(
    useSensor(RowPointerSensor, { activationConstraint: { distance: MOUSE_DRAG_DISTANCE_PX } }),
    useSensor(RowTouchSensor, { activationConstraint: { delay: TOUCH_HOLD_MS, tolerance: 8 } }),
  );
  const [active, setActive] = useState(null); // { row, bucket } | { meal, rows, bucket }
  const onDragStart = ({ active: item }) => {
    const data = item.data.current || {};
    setActive(data);
    logger.debug('drag.start', data.meal ? { meal: data.bucket, count: data.rows?.length } : { uuid: entryId(data.row), from: data.bucket });
  };
  const onDragEnd = ({ active: item, over }) => {
    const { row, rows, meal, bucket } = item.data.current || {};
    setActive(null);
    const to = over?.id ?? null;
    if (!to || to === bucket || (!row && !meal)) { logger.debug('drag.cancel', { from: bucket, over: to }); return; }
    const toDay = dayFromDropId(to);
    if (toDay) { onMoveToDay?.(meal ? rows : [row], toDay, bucket); return; }
    if (meal) onMoveMeal?.(rows, to, bucket);
    else onMove?.(row, to, bucket);
  };
  const value = useMemo(() => ({ enabled: true, activeBucket: active?.bucket ?? null, dragging: active != null }), [active]);
  return <MealDragContext.Provider value={value}>
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart}
      onDragEnd={onDragEnd} onDragCancel={() => setActive(null)} autoScroll={{ threshold: { x: 0, y: 0.15 } }}>
      {children}
      <DragOverlay dropAnimation={null}>
        {active?.meal ? <div className="health-drag-ghost">
          <span className="health-drag-ghost__name">{`${bucketLabel(active.bucket)} · ${active.rows.length} ${active.rows.length === 1 ? 'food' : 'foods'}`}</span>
        </div> : active?.row ? <div className="health-drag-ghost">
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

/** A meal's flat rows as its top-level entries, each dish carrying its ingredients. */
export const mealEntries = rows => groupRows(rows || []).map(({ row, children }) => (children.length ? { ...row, children } : row));

/** A whole meal, dragged by its header onto another meal. `rows` are its top-level entries (dishes carry children). */
export function useDraggableMeal(bucket, rows) {
  const context = useContext(MealDragContext);
  const off = !context?.enabled || !bucket || !rows.length;
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: `meal:${bucket || 'none'}`, data: { meal: true, bucket, rows }, disabled: off,
  });
  return { ref: setNodeRef, handlers: off ? {} : listeners, dragging: isDragging, draggable: !off };
}

/** True from the moment a food or meal is picked up until it is dropped. */
export const useMealDragActive = () => Boolean(useContext(MealDragContext)?.dragging);

/** Day side: a day chip a food or meal is dropped on. */
export function useDayDropTarget(iso) {
  const context = useContext(MealDragContext);
  const { setNodeRef, isOver } = useDroppable({ id: dayDropId(iso), disabled: !context?.enabled });
  return { ref: setNodeRef, over: isOver };
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

/** How a move ended. Drag and the meal menu ignore it; the selection bar does not. */
export const MoveResult = Object.freeze({ MOVED: 'moved', UNCHANGED: 'unchanged', NOT_MOVED: 'not-moved' });

const MOVE_PATH = 'api/v1/health/nutrition/foods-move';
const UNDO_PATH = 'api/v1/health/nutrition/meal-undo';
const isDefiniteRefusal = err => err?.status === 400 || err?.status === 409;

// A moved row wears its new meal from the drop until the day reloads with it, so
// it never snaps back in between. `moves` names every carried row, parts included.
function applyMoves(items, moves) {
  if (!moves.size) return items;
  return items.map(row => {
    const move = moves.get(String(entryId(row)));
    return move && row.mealTime !== move.to ? { ...row, mealTime: move.to } : row;
  });
}

/**
 * Owns the move command: optimistic placement, one atomic `foods-move` per
 * gesture, a brief highlight on the moved rows, and one server Undo. Each move
 * resolves to a MoveResult: MOVED; UNCHANGED when every food was already there,
 * so nothing was sent; NOT_MOVED when it was refused or failed (`error` says why).
 */
export function useMealMoves(day) {
  const foodAPI = useFoodMutation(day.items);
  const [moves, setMoves] = useState(() => new Map()); // id -> { to }
  const [recent, setRecent] = useState(() => new Set());
  const [undo, setUndo] = useState(null); // { token, operationId, ids, rows, from, to } | { token, operationId, ids, rows, day: { from, to } }
  const [gone, setGone] = useState(() => new Set()); // ids sent to another day, hidden until the day reloads
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

  // Retire a hidden row once the read model no longer carries it.
  useEffect(() => {
    if (!gone.size) return;
    const present = new Set(day.items.map(row => String(entryId(row))));
    const settled = [...gone].filter(id => !present.has(id));
    if (!settled.length) return;
    setGone(previous => { const next = new Set(previous); settled.forEach(id => next.delete(id)); return next; });
  }, [day.items, gone]);

  const items = useMemo(() => {
    const moved = applyMoves(day.items, moves);
    return gone.size ? moved.filter(row => !gone.has(String(entryId(row)))) : moved;
  }, [day.items, moves, gone]);

  const highlight = id => {
    setRecent(previous => new Set(previous).add(id));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setRecent(previous => { const next = new Set(previous); next.delete(id); return next; });
    }, MOVED_HIGHLIGHT_MS);
    timers.current.add(timer);
  };

  // Every row a move carries: the entries, their parts, and any row of the day
  // linked to a dish. A section only knows its own meal, so a dish's `children`
  // can miss a part stranded in another one. A plain food carries only its own meal.
  const withParts = rows => {
    const dayParts = new Map(groupRows(day.items).map(({ row, children }) => [String(entryId(row)), children]));
    const all = new Map();
    for (const row of rows) {
      const linked = (dayParts.get(String(entryId(row))) || []).filter(part => row.kind === 'group' || (part.mealTime ?? null) === (row.mealTime ?? null));
      for (const item of [row, ...(row.children || []), ...linked]) all.set(String(entryId(item)), item);
    }
    return [...all.values()];
  };
  const moveBody = (rows, carried, destination) => ({
    date: rows[0].date ?? rows[0].createdAt?.slice(0, 10),
    selectedIds: rows.map(row => String(entryId(row))),
    expectedVersions: Object.fromEntries(carried.map(row => [String(entryId(row)), row.version ?? 1])),
    ...destination, operationId: crypto.randomUUID(),
  });
  const whatMoved = rows => (rows.length === 1 ? entryLabel(rows[0]) : `${rows.length} foods`);
  // The Undo's operation ID is fixed with the offer, so trying a failed Undo
  // again resumes that one operation instead of being refused as a second one.
  const offerUndo = (result, ids, rows, place) => setUndo({ token: result.undoToken, operationId: crypto.randomUUID(), ids, rows, ...place });
  // Checked before anything changes on screen: a food busy with an earlier change
  // keeps that change's placement and its Undo offer.
  const refuseMove = (rows, body) => {
    const refusal = foodAPI.refusal(MOVE_PATH, body, 'POST');
    if (!refusal) return false;
    setError(`Can't move ${whatMoved(rows)} yet. ${refusal}`);
    logger.info('entry.move.blocked', { count: rows.length, reason: refusal });
    return true;
  };
  // The server said no, so nothing happened and the foods are free. After any
  // other failure the outcome is unknown and the reservation stays for Retry.
  const releaseIfRefused = (err, operationId) => { if (isDefiniteRefusal(err)) foodAPI.release(operationId); };

  // One command per gesture: every row moves, or none do. The server refuses a
  // move that changes nothing, so rows already in that meal stay out of it.
  // Success is handled in the continuation so a Retry from the status row gets it too.
  const send = useCallback(async (requested, to, from) => {
    const rows = requested.filter(row => row.mealTime !== to);
    if (!rows.length) return MoveResult.UNCHANGED;
    const carried = withParts(rows);
    const ids = carried.map(row => String(entryId(row)));
    const body = moveBody(rows, carried, { toMeal: to });
    if (refuseMove(rows, body)) return MoveResult.NOT_MOVED;
    setError(null);
    setMoves(previous => { const next = new Map(previous); ids.forEach(id => next.set(id, { to })); return next; });
    rows.forEach(row => highlight(String(entryId(row))));
    try {
      await foodAPI.withContinuation(MOVE_PATH, body, 'POST', result => {
        logger.info(rows.length > 1 ? 'meal.move' : 'entry.move', { uuid: rows.length === 1 ? String(entryId(rows[0])) : undefined, count: rows.length, from, to });
        setError(null);
        offerUndo(result, ids, rows, { from, to });
      });
      return MoveResult.MOVED;
    } catch (err) {
      setMoves(previous => { const next = new Map(previous); ids.forEach(id => next.delete(id)); return next; });
      releaseIfRefused(err, body.operationId);
      setError(`Couldn't move ${whatMoved(rows)}: ${entryError(err)}`);
      logger.warn('entry.move.failed', { count: rows.length, from, to, status: err.status, error: err.message });
      setUndo(null);
      return MoveResult.NOT_MOVED;
    } finally { day.reload?.(); }
  }, [day]);

  // The same command with a day as the destination. The rows leave the viewed
  // day at once and come back if the command fails.
  const sendToDay = useCallback(async (requested, toDate) => {
    const rows = requested.filter(row => row.date && row.date !== toDate);
    if (!rows.length) return MoveResult.UNCHANGED;
    const fromDate = rows[0].date;
    const carried = withParts(rows);
    const ids = carried.map(row => String(entryId(row)));
    const body = moveBody(rows, carried, { toDate });
    if (refuseMove(rows, body)) return MoveResult.NOT_MOVED;
    setError(null);
    setGone(previous => new Set([...previous, ...ids]));
    try {
      await foodAPI.withContinuation(MOVE_PATH, body, 'POST', result => {
        logger.info('entry.move-day', { count: rows.length, from: fromDate, to: toDate });
        setError(null);
        offerUndo(result, ids, rows, { day: { from: fromDate, to: toDate } });
      });
      return MoveResult.MOVED;
    } catch (err) {
      setGone(previous => { const next = new Set(previous); ids.forEach(id => next.delete(id)); return next; });
      releaseIfRefused(err, body.operationId);
      setError(`Couldn't move ${whatMoved(rows)} to ${dayLabel(toDate, localTodayISO())}: ${entryError(err)}`);
      logger.warn('entry.move-day.failed', { count: rows.length, from: fromDate, to: toDate, status: err.status, error: err.message });
      setUndo(null);
      return MoveResult.NOT_MOVED;
    } finally { day.reload?.(); }
  }, [day]);

  // A failed Undo changes nothing, so the rows stay put and the offer stays open.
  const runUndo = async () => {
    const current = undo;
    if (!current) return;
    const body = { undoToken: current.token, operationId: current.operationId };
    const refusal = foodAPI.refusal(UNDO_PATH, body, 'POST');
    if (refusal) {
      setError(`Can't undo that move yet. ${refusal}`);
      logger.info('entry.move.undo-blocked', { count: current.rows.length, reason: refusal });
      return;
    }
    setError(null);
    try {
      await foodAPI.withContinuation(UNDO_PATH, body, 'POST', () => {
        setMoves(previous => { const next = new Map(previous); current.ids.forEach(id => next.delete(id)); return next; });
        setGone(previous => { const next = new Set(previous); current.ids.forEach(id => next.delete(id)); return next; });
        const event = current.day ? 'entry.move-day.undo' : current.rows.length > 1 ? 'meal.move.undo' : 'entry.move.undo';
        logger.info(event, { count: current.rows.length });
        setError(null);
        setUndo(offer => (offer?.operationId === current.operationId ? null : offer));
      });
    } catch (err) {
      releaseIfRefused(err, current.operationId);
      setError(`Couldn't undo that move: ${entryError(err)}`);
      logger.warn('entry.move.undo-failed', { count: current.rows.length, status: err.status, error: err.message });
    } finally { day.reload?.(); }
  };

  const undoLabel = () => {
    if (!undo) return null;
    if (undo.day) return `Moved ${whatMoved(undo.rows)} to ${dayLabel(undo.day.to, localTodayISO())}`;
    if (undo.rows.length === 1) return `Moved ${entryLabel(undo.rows[0])} to ${bucketLabel(undo.to)}`;
    return undo.from ? `Moved ${undo.rows.length} foods from ${bucketLabel(undo.from)} to ${bucketLabel(undo.to)}` : `Moved ${undo.rows.length} foods to ${bucketLabel(undo.to)}`;
  };

  return {
    items,
    recentIds: recent,
    moveToDay: (rows, toDate) => sendToDay(rows, toDate),
    move: (row, to, from) => send([row], to, from),
    moveMeal: (rows, to, from) => send(rows, to, from),
    undo: undo ? { label: undoLabel(), run: runUndo, dismiss: () => setUndo(null) } : null,
    error,
    clearError: () => setError(null),
  };
}
