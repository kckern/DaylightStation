// frontend/src/modules/Media/shell/LocalPlaybackOutcomes.jsx
// RELY.5a — a local playback failure or skip (PlayerBridge stall/terminal
// error auto-advance) becomes an outcome record in the one tray, wherever
// the person is in the app: it names the item, this device and what plays
// instead, with its own Retry. The handle's problem sign is MiniPlayer's.
import { useContext, useEffect, useRef } from 'react';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { DispatchContext } from '../cast/DispatchProvider.jsx';

export function LocalPlaybackOutcomes() {
  const controller = useContext(LocalSessionContext)?.controller ?? null;
  const outcomes = useContext(DispatchContext);
  const seenRef = useRef(null);
  const recordLocal = outcomes?.recordLocal;
  const removeDispatch = outcomes?.removeDispatch;
  // A waiting/held notice is withdrawn when the file comes back or when a
  // skip notice replaces it; skip and failure notices stay until dismissed.
  const heldRowRef = useRef(null);
  useEffect(() => {
    if (!controller?.problems?.subscribe || !recordLocal) return undefined;
    const withdrawHeld = () => {
      if (heldRowRef.current) removeDispatch?.(heldRowRef.current);
      heldRowRef.current = null;
    };
    const report = (problem) => {
      if (!problem) { withdrawHeld(); seenRef.current = null; return; }
      if (seenRef.current === problem) return;
      seenRef.current = problem;
      withdrawHeld();
      const attemptId = recordLocal({
        kind: 'playback',
        phase: problem.kind,
        reason: problem.reason,
        item: problem.item,
        replacement: problem.replacement,
        command: { kind: 'playNow', item: { contentId: problem.item?.contentId, title: problem.item?.title ?? null } },
      });
      if (problem.kind === 'waiting' || problem.kind === 'library-unavailable') heldRowRef.current = attemptId ?? null;
    };
    report(controller.problems.get());
    return controller.problems.subscribe(report);
  }, [controller, recordLocal, removeDispatch]);
  return null;
}

export default LocalPlaybackOutcomes;
