import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * useStatusOverlay — wrap live hub status with optimistic predictions.
 *
 * The broadcaster ticks every 3s, but a transport command (pause, volume, etc.)
 * returns via HTTP in ~200ms. Between those two moments the UI looks frozen.
 * This hook lets a click predict the expected new state, so the UI flips
 * immediately while the affected control greys out and locks until the WS
 * snapshot catches up (or a timeout lifts the prediction).
 *
 * Two prediction modes:
 *
 *   predict(color, patch)
 *     For predictable changes (paused, volume): overlay the predicted value
 *     and clear it when the real WS snapshot reports a matching value.
 *
 *   pending(color, fields[])
 *     For unpredictable changes (next track, Play Now): don't change the
 *     visible value, but mark the fields as in-flight. The lock clears when
 *     the real WS snapshot reports a different value for ANY locked field.
 *
 * Both modes timeout after `timeoutMs` (default 5s — two missed broadcaster
 * ticks). On timeout the prediction/lock lifts silently; reality shows
 * through. The failure-toast path in `runWithFeedback` is the operator's
 * signal that something actually broke.
 *
 * @param {Map<string, object>} realStatus - from useHubStatus().devices
 * @returns {{
 *   statusView: Map<string, object & { _pending: Set<string> }>,
 *   predict: (color: string, patch: object, opts?: { timeoutMs?: number }) => void,
 *   pending: (color: string, fields: string[], opts?: { timeoutMs?: number }) => void,
 * }}
 */
export function useStatusOverlay(realStatus) {
  // Map<color, {
  //   predictions: { field: { value, mode: 'match' } },
  //   locks:       { field: { baseline, mode: 'change' } },
  //   timers:      Map<field, timeoutId>,
  // }>
  const [overlay, setOverlay] = useState(() => new Map());
  const timersRef = useRef(new Map()); // color -> Map<field, timeoutId>

  // Clear a single field's prediction/lock + its timer.
  const clearField = useCallback((color, field) => {
    setOverlay((prev) => {
      const entry = prev.get(color);
      if (!entry) return prev;
      const predictions = { ...entry.predictions };
      const locks = { ...entry.locks };
      delete predictions[field];
      delete locks[field];
      const next = new Map(prev);
      if (Object.keys(predictions).length === 0 && Object.keys(locks).length === 0) {
        next.delete(color);
      } else {
        next.set(color, { predictions, locks });
      }
      return next;
    });
    const colorTimers = timersRef.current.get(color);
    if (colorTimers) {
      const tid = colorTimers.get(field);
      if (tid) {
        clearTimeout(tid);
        colorTimers.delete(field);
      }
      if (colorTimers.size === 0) timersRef.current.delete(color);
    }
  }, []);

  const armTimer = useCallback((color, field, timeoutMs) => {
    let colorTimers = timersRef.current.get(color);
    if (!colorTimers) {
      colorTimers = new Map();
      timersRef.current.set(color, colorTimers);
    }
    const prev = colorTimers.get(field);
    if (prev) clearTimeout(prev);
    const tid = setTimeout(() => clearField(color, field), timeoutMs);
    colorTimers.set(field, tid);
  }, [clearField]);

  const predict = useCallback((color, patch, opts = {}) => {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    setOverlay((prev) => {
      const entry = prev.get(color) ?? { predictions: {}, locks: {} };
      const predictions = { ...entry.predictions };
      for (const [field, value] of Object.entries(patch)) {
        predictions[field] = { value };
      }
      const next = new Map(prev);
      next.set(color, { predictions, locks: entry.locks ?? {} });
      return next;
    });
    for (const field of Object.keys(patch)) {
      armTimer(color, field, timeoutMs);
    }
  }, [armTimer]);

  const pending = useCallback((color, fields, opts = {}) => {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const baselineEntry = realStatus.get(color) ?? {};
    setOverlay((prev) => {
      const entry = prev.get(color) ?? { predictions: {}, locks: {} };
      const locks = { ...entry.locks };
      for (const field of fields) {
        locks[field] = { baseline: baselineEntry[field] };
      }
      const next = new Map(prev);
      next.set(color, { predictions: entry.predictions ?? {}, locks });
      return next;
    });
    for (const field of fields) {
      armTimer(color, field, timeoutMs);
    }
  }, [realStatus, armTimer]);

  // When real status updates, resolve any predictions that match, and any
  // locks whose baseline value has changed.
  useEffect(() => {
    if (overlay.size === 0) return;
    const toClear = [];
    overlay.forEach(({ predictions, locks }, color) => {
      const real = realStatus.get(color);
      if (!real) return;
      for (const [field, { value }] of Object.entries(predictions)) {
        if (deepEqual(real[field], value)) {
          toClear.push([color, field]);
        }
      }
      for (const [field, { baseline }] of Object.entries(locks)) {
        if (!deepEqual(real[field], baseline)) {
          toClear.push([color, field]);
        }
      }
    });
    if (toClear.length > 0) {
      toClear.forEach(([color, field]) => clearField(color, field));
    }
  }, [realStatus, overlay, clearField]);

  // Clean up all timers on unmount.
  useEffect(() => () => {
    timersRef.current.forEach((colorTimers) => {
      colorTimers.forEach((tid) => clearTimeout(tid));
    });
    timersRef.current.clear();
  }, []);

  const statusView = useMemo(() => {
    const merged = new Map();
    realStatus.forEach((status, color) => {
      const entry = overlay.get(color);
      if (!entry) {
        merged.set(color, { ...status, _pending: EMPTY_SET });
        return;
      }
      const predicted = {};
      const pendingFields = new Set();
      for (const [field, { value }] of Object.entries(entry.predictions)) {
        predicted[field] = value;
        pendingFields.add(field);
      }
      for (const field of Object.keys(entry.locks)) {
        pendingFields.add(field);
      }
      merged.set(color, { ...status, ...predicted, _pending: pendingFields });
    });
    // Also include any overlay-only colors (predictions for a device not yet
    // in real status — edge case, but be defensive).
    overlay.forEach((entry, color) => {
      if (merged.has(color)) return;
      const predicted = {};
      const pendingFields = new Set();
      for (const [field, { value }] of Object.entries(entry.predictions)) {
        predicted[field] = value;
        pendingFields.add(field);
      }
      for (const field of Object.keys(entry.locks)) {
        pendingFields.add(field);
      }
      merged.set(color, { ...predicted, _pending: pendingFields });
    });
    return merged;
  }, [realStatus, overlay]);

  return { statusView, predict, pending };
}

const EMPTY_SET = new Set();

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

export default useStatusOverlay;
