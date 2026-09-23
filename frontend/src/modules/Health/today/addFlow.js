// The add row's afterlife: once an add commits, when do its rows actually show
// on the day, and which rows should the eye be drawn to?
//
// AddCombobox knows what was added (the response carries the new row ids) but
// never sees the day; useHealthDay sees the day but not what was just added.
// This module is the meeting point: the combobox registers the ids it is
// waiting for, the day reports the rows it has, and the match produces
//   - one `add.flow` info event (submit→committed, committed→visible), and
//   - a short-lived highlight on the new rows (meals sort heaviest-first, so a
//     new row can land mid-list).
import { useEffect, useRef, useState } from 'react';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('add-flow');

/** Past this, a committed add that never showed up is logged without a visible time. */
export const ADD_VISIBLE_TIMEOUT_MS = 30_000;
/** How long a new row stays highlighted once it is on screen. */
export const ADDED_HIGHLIGHT_MS = 1500;

const waiting = new Set();
let lastSeen = new Set(); // row ids in the most recent day the view reported
const listeners = new Set();
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const rowId = row => String(row?.uuid ?? row?.id ?? '');

/**
 * Row ids from an add response. Quick-add answers `{ item: { uuid } }`; a
 * sentence answers `{ entryIds, items }`; a replay may carry either.
 */
export function addedRowIds(response) {
  const ids = [];
  if (Array.isArray(response?.entryIds)) ids.push(...response.entryIds);
  if (response?.item) ids.push(response.item.uuid ?? response.item.id);
  if (Array.isArray(response?.items)) for (const item of response.items) ids.push(item?.uuid ?? item?.id);
  return [...new Set(ids.filter(id => id !== undefined && id !== null && id !== '').map(String))];
}

/**
 * Register a committed add. Resolves (never rejects) once every id is on the
 * day, or immediately when there are none, or after the timeout — so a caller
 * can hold a placeholder exactly until the real row replaces it.
 */
export function trackAddFlow({ ids = [], bucket = null, surface, kind, submitToCommittedMs, at = now() }) {
  const data = { bucket, surface, kind, submitToCommittedMs: Math.round(submitToCommittedMs), rows: ids.length };
  if (!ids.length) {
    logger.info('add.flow', { ...data, committedToVisibleMs: null });
    return Promise.resolve(false);
  }
  for (const notify of listeners) notify(ids);
  return new Promise((resolve) => {
    const pending = { ids: new Set(ids), committedAt: at, data, resolve };
    pending.timer = setTimeout(() => {
      if (!waiting.delete(pending)) return;
      logger.info('add.flow', { ...data, committedToVisibleMs: null, timedOut: true });
      resolve(false);
    }, ADD_VISIBLE_TIMEOUT_MS);
    waiting.add(pending);
    // The day may already hold the rows (a reload that beat the response).
    completeSeen(lastSeen, at);
  });
}

/** The day's current rows. Completes every registered add they now contain. */
export function noteVisibleRows(rows, at = now()) {
  if (!Array.isArray(rows)) return;
  lastSeen = new Set(rows.map(rowId));
  completeSeen(lastSeen, at);
}

function completeSeen(seen, at) {
  if (!waiting.size) return;
  for (const pending of [...waiting]) {
    if (![...pending.ids].every(id => seen.has(id))) continue;
    waiting.delete(pending);
    clearTimeout(pending.timer);
    logger.info('add.flow', { ...pending.data, committedToVisibleMs: Math.round(at - pending.committedAt) });
    pending.resolve(true);
  }
}

/** Test seam: forget every registered add. */
export function resetAddFlow() {
  for (const pending of waiting) clearTimeout(pending.timer);
  waiting.clear();
  lastSeen = new Set();
}

/**
 * The ids of rows added from an add row that have just appeared in `rows`,
 * each for ADDED_HIGHLIGHT_MS from the moment it is first on screen (not from
 * the commit, which can be seconds earlier for a parsed sentence).
 */
export function useAddedRowHighlight(rows) {
  const expected = useRef(new Map()); // id -> registered at
  const timers = useRef(new Set());
  const [tick, setTick] = useState(0);
  const [highlighted, setHighlighted] = useState(() => new Set());
  useEffect(() => {
    const notify = (ids) => { const at = Date.now(); ids.forEach(id => expected.current.set(id, at)); setTick(n => n + 1); };
    listeners.add(notify);
    const pendingTimers = timers.current;
    return () => { listeners.delete(notify); pendingTimers.forEach(clearTimeout); pendingTimers.clear(); };
  }, []);
  useEffect(() => {
    if (!expected.current.size) return;
    const cutoff = Date.now() - ADD_VISIBLE_TIMEOUT_MS;
    for (const [id, at] of expected.current) if (at < cutoff) expected.current.delete(id);
    const present = (rows || []).map(rowId).filter(id => expected.current.has(id));
    if (!present.length) return;
    present.forEach(id => expected.current.delete(id));
    setHighlighted(previous => new Set([...previous, ...present]));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setHighlighted(previous => { const next = new Set(previous); present.forEach(id => next.delete(id)); return next; });
    }, ADDED_HIGHLIGHT_MS);
    timers.current.add(timer);
  }, [rows, tick]);
  return highlighted;
}
