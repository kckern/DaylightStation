// shell/handleStop.js
// Stop on the bottom bar clears the item from the UI (owner ruling
// 2026-11-27): the bar goes at once, with no "Paused / Resume" left over.
//
//  - This device: the spot is saved first (pause flushes it), then the
//    session ENDS (lifecycle.reset), so neither the bar nor a reload brings it
//    back. Undo for 5 s in the outcome toast restores it paused, because the
//    captured snapshot is cheap to adopt.
//  - A screen (the handle): stop is sent and the handle hides at once; it
//    stays hidden while the screen still reports the stopped item (its fleet
//    state lags, and a stopped screen keeps a ready queue). A failed or
//    refused stop brings the bar back as "Couldn't stop on <screen>" with
//    Retry. No Undo: a screen's session is not cheap to restore.
import { useSyncExternalStore } from 'react';
import mediaLog from '../logging/mediaLog.js';

export const STOP_UNDO_MS = 5000;

/** Stop on this device's bar. */
export function stopLocalSession(controller, { outcomes = null, opts = { keepMusic: false }, now = Date.now } = {}) {
  if (!controller) return;
  const before = controller.getSnapshot?.() ?? null;
  const captured = controller.portability?.capture?.()?.snapshot ?? null;
  const item = before?.currentItem ?? before?.queue?.items?.[0] ?? null;
  const title = item?.title ?? 'it';
  controller.transport?.pause?.();
  controller.transport?.stop?.(opts);
  controller.lifecycle?.reset?.({ keep: {} });
  mediaLog.miniPlayerStopped({ target: 'local', contentId: item?.contentId ?? null });
  const canUndo = !!captured?.currentItem && typeof controller.portability?.adopt === 'function';
  outcomes?.recordLocal?.({
    kind: 'stop',
    phase: 'confirmed',
    item: { title },
    command: { copy: { primary: `Stopped ${title}`, secondary: null } },
    ...(canUndo ? {
      undo: {
        operationId: `stop-${now()}`,
        expiresAt: now() + STOP_UNDO_MS,
        run: () => controller.portability.adopt(captured, { autoplay: false }),
      },
    } : {}),
  });
}

/** Does a stop on this screen still hide its handle, given what it reports now? */
export function handleSuppressed(entry, snapshot) {
  if (!entry) return false;
  if (entry.status === 'failed') return false;
  const current = snapshot?.currentItem?.contentId ?? null;
  // Something else plays there now: the stop is history.
  if (current && entry.contentId && current !== entry.contentId) return false;
  return true;
}

/** The screens stopped from the handle, as a small external store. */
export function createHandleStops() {
  const entries = new Map();
  const listeners = new Set();
  let version = 0;
  const emit = () => { version += 1; listeners.forEach((listener) => listener()); };
  const set = (deviceId, value) => {
    if (value) entries.set(deviceId, value); else entries.delete(deviceId);
    emit();
  };
  const run = async (deviceId) => {
    const entry = entries.get(deviceId);
    if (!entry) return;
    set(deviceId, { ...entry, status: 'stopping', message: null });
    let result;
    try { result = await entry.run(); } catch (error) { result = { ok: false, reason: error?.message ?? String(error) }; }
    const latest = entries.get(deviceId);
    if (!latest) return;
    if (result?.ok === false) {
      mediaLog.miniPlayerStopFailed({ target: deviceId, reason: result.reason ?? result.code ?? null });
      set(deviceId, { ...latest, status: 'failed', message: `Couldn't stop on ${latest.name ?? 'the screen'}` });
      return;
    }
    set(deviceId, { ...latest, status: 'stopped', message: null });
  };
  return {
    stop(deviceId, { contentId = null, name = null, run: runStop }) {
      mediaLog.miniPlayerStopped({ target: deviceId, contentId });
      set(deviceId, { contentId, name, run: runStop, status: 'stopping', message: null });
      return run(deviceId);
    },
    retry: (deviceId) => run(deviceId),
    dismiss: (deviceId) => set(deviceId, null),
    get: (deviceId) => entries.get(deviceId) ?? null,
    /** The first screen whose stop failed: its bar comes back with Retry. */
    firstFailed() {
      for (const [deviceId, entry] of entries) if (entry.status === 'failed') return { deviceId, ...entry };
      return null;
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    version: () => version,
  };
}

const shared = createHandleStops();
export const handleStops = shared;

/** Re-render on any handle stop change; returns the store. */
export function useHandleStops(store = shared) {
  useSyncExternalStore(store.subscribe, store.version, store.version);
  return store;
}
