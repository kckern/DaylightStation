// frontend/src/modules/Media/shell/RemoteScreenProblems.jsx
// RELY.5a/AC4 — the same applies to failures on other screens I started or am
// steering. A screen that gives up on an item (and skips to the next, or just
// stops) says so in its session snapshot (`meta.problem`); when that screen is
// one this device sent to or steers (not one merely aimed at), the failure becomes an outcome record in
// the one tray — naming the item, the screen and what plays instead — with its
// own Retry, wherever the person is in the app. Renders nothing.
import { useContext, useEffect, useRef } from 'react';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { DispatchContext } from '../cast/DispatchProvider.jsx';
import { PeekContext } from '../peek/PeekContext.js';
import { deviceName } from '../fleet/deviceDisplay.js';
import mediaLog from '../logging/mediaLog.js';

// A problem older than this was not just now: it is not news for a sender.
export const REMOTE_PROBLEM_FRESH_MS = 2 * 60 * 1000;

/**
 * Which of the watched screens carry a fresh problem not yet reported.
 * Pure; `seen` is mutated (keys `${deviceId}|${at}`).
 */
export function freshRemoteProblems({ watchedIds, entryFor, seen, now = Date.now() }) {
  const found = [];
  for (const deviceId of watchedIds) {
    const problem = entryFor(deviceId)?.snapshot?.meta?.problem;
    if (!problem || !Number.isFinite(problem.at)) continue;
    const key = `${deviceId}|${problem.at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (now - problem.at > REMOTE_PROBLEM_FRESH_MS) continue;
    found.push({ deviceId, problem });
  }
  return found;
}

export function RemoteScreenProblems() {
  const fleet = useContext(FleetContext);
  const outcomes = useContext(DispatchContext);
  const peek = useContext(PeekContext);
  const seenRef = useRef(new Set());
  const store = fleet?.store ?? null;
  const recordLocal = outcomes?.recordLocal;
  const removeDispatch = outcomes?.removeDispatch;
  // deviceId -> the tray row of that screen's held (waiting) notice.
  const heldRowsRef = useRef(new Map());

  // Screens this device started (any far outcome record) or steers. Merely
  // aiming the cast target at a screen is not a relationship with it.
  const watched = new Set([peek?.lastSteeredId].filter(Boolean));
  for (const record of outcomes?.outcomes?.values?.() ?? []) {
    if (record?.targetId && record.targetId !== 'local') watched.add(record.targetId);
  }
  const watchedKey = [...watched].sort().join('|');
  const latest = useRef({});
  latest.current = { watched, devices: fleet?.devices ?? [], recordLocal, removeDispatch };

  useEffect(() => {
    if (!store?.subscribeAll) return undefined;
    const check = () => {
      const { watched: ids, devices, recordLocal: record, removeDispatch: remove } = latest.current;
      if (!record) return;
      // A held notice is withdrawn when that screen resumes (its problem is
      // gone) or reports something newer.
      for (const [deviceId, held] of [...heldRowsRef.current]) {
        const current = store.getEntry(deviceId)?.snapshot?.meta?.problem ?? null;
        if (!current || current.at !== held.at) {
          if (held.attemptId) remove?.(held.attemptId);
          heldRowsRef.current.delete(deviceId);
        }
      }
      for (const { deviceId, problem } of freshRemoteProblems({ watchedIds: ids, entryFor: (id) => store.getEntry(id), seen: seenRef.current })) {
        const targetName = deviceName(devices.find((d) => d.id === deviceId) ?? null, deviceId);
        mediaLog.remoteProblemReported({ deviceId, kind: problem.kind, contentId: problem.item?.contentId ?? null, reason: problem.reason ?? null });
        const attemptId = record({
          kind: 'playback',
          phase: ['skipped', 'waiting', 'library-unavailable'].includes(problem.kind) ? problem.kind : 'failed',
          reason: problem.reason ?? null,
          item: problem.item,
          replacement: problem.replacement ?? null,
          targetId: deviceId,
          targetName,
          command: { kind: 'playNow', item: { contentId: problem.item?.contentId ?? null, title: problem.item?.title ?? null } },
        });
        if (problem.kind === 'waiting' || problem.kind === 'library-unavailable') {
          heldRowsRef.current.set(deviceId, { attemptId: attemptId ?? null, at: problem.at });
        }
      }
    };
    check();
    return store.subscribeAll(check);
  }, [store, watchedKey]);
  return null;
}

export default RemoteScreenProblems;
