import { useEffect, useRef } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { shouldAutoEnterStudio } from './autoStudioEntry.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-auto-studio' });
  return _logger;
}

/**
 * Arms auto-entry into Studio from the kiosk menu (spec
 * 2026-07-28-piano-auto-studio-design.md). Armed + on the menu + sustained
 * playing (shouldAutoEnterStudio) → onEnter(). A MANUAL Studio→menu exit
 * disarms; an idle-driven return (consumeIdleReturn() true) does not. Re-arms
 * after `inactivityMinutes` with no notes (wall-clock timer — quiet means no
 * new noteHistory entries).
 */
export function useAutoStudioEntry({ pathname, basePath, noteHistory, autoStudio, inactivityMinutes, consumeIdleReturn, onEnter }) {
  const armedRef = useRef(true);
  const prevPathRef = useRef(pathname);
  const rearmTimerRef = useRef(null);
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;
  const consumeRef = useRef(consumeIdleReturn);
  consumeRef.current = consumeIdleReturn;

  const menuPath = basePath;
  const studioPrefix = `${basePath}/studio`;

  const scheduleRearm = () => {
    if (rearmTimerRef.current) clearTimeout(rearmTimerRef.current);
    rearmTimerRef.current = setTimeout(() => {
      armedRef.current = true;
      logger().debug('piano.auto-studio.rearm', {});
    }, Math.max(1, inactivityMinutes || 10) * 60_000);
  };

  // Route transitions: a manual Studio→menu exit disarms until a fresh sitting.
  // An idle-driven return (consumeIdleReturn() true) re-arms instead, since
  // firing already cleared armedRef and an idle return means a fresh sitting.
  useEffect(() => {
    const prev = prevPathRef.current;
    prevPathRef.current = pathname;
    if (prev !== pathname && prev?.startsWith(studioPrefix) && pathname === menuPath) {
      if (consumeRef.current?.()) {
        armedRef.current = true; // idle return = fresh sitting
        logger().debug('piano.auto-studio.rearm', { reason: 'idle-return' });
      } else {
        armedRef.current = false;
        logger().debug('piano.auto-studio.disarm', { reason: 'manual-exit' });
        scheduleRearm();
      }
    }
  }, [pathname, menuPath, studioPrefix]); // eslint-disable-line react-hooks/exhaustive-deps

  // Note activity: while disarmed, every new note pushes the quiet-gap
  // re-arm timer out; while armed on the menu, evaluate the trigger.
  useEffect(() => {
    if (!noteHistory?.length) return;
    if (!armedRef.current) { scheduleRearm(); return; }
    if (!autoStudio?.enabled || pathname !== menuPath) return;
    if (shouldAutoEnterStudio(noteHistory, autoStudio)) {
      armedRef.current = false; // the navigation satisfies the trigger; route-exit rules take over
      logger().info('piano.auto-studio.enter', { notes: noteHistory.length });
      onEnterRef.current?.();
    }
  }, [noteHistory, autoStudio, pathname, menuPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear the re-arm timer on unmount.
  useEffect(() => () => { if (rearmTimerRef.current) clearTimeout(rearmTimerRef.current); }, []);
}

export default useAutoStudioEntry;
