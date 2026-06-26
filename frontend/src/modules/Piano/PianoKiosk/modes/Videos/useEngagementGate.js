import { useState, useEffect, useRef, useCallback } from 'react';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import getLogger from '../../../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-engagement-gate' });
  return _logger;
}

/**
 * Anti-AFK inactivity gate for sequential piano lectures. When no MIDI key is
 * pressed for `timeoutSeconds` while a sequential lecture plays, pauses the video
 * and opens the gate. The parent shows a play-along prompt and calls dismissGate()
 * on success to resume. No-op when isSequential is false.
 */
export function useEngagementGate({ mediaEl, isSequential, timeoutSeconds = 90, onEngagementConfirmed }) {
  const [gateOpen, setGateOpen] = useState(false);
  const { activeNotes } = usePianoMidi();
  const lastActivityRef = useRef(Date.now());
  const gateOpenRef = useRef(false);

  // Any MIDI note resets the idle timer.
  useEffect(() => {
    if (!isSequential) return;
    if (activeNotes && activeNotes.size > 0) {
      lastActivityRef.current = Date.now();
    }
  }, [activeNotes, isSequential]);

  // Poll once a second; open the gate when idle too long and the video is playing.
  useEffect(() => {
    if (!isSequential || !mediaEl) return undefined;
    const id = setInterval(() => {
      if (gateOpenRef.current || mediaEl.paused) return;
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= timeoutSeconds * 1000) {
        gateOpenRef.current = true;
        setGateOpen(true);
        try { mediaEl.pause(); } catch { /* element may be detached */ }
        logger().info('piano.engagement-gate.open', { idleMs });
      }
    }, 1000);
    return () => clearInterval(id);
  }, [isSequential, mediaEl, timeoutSeconds]);

  const dismissGate = useCallback(() => {
    gateOpenRef.current = false;
    setGateOpen(false);
    lastActivityRef.current = Date.now();
    if (mediaEl && mediaEl.paused) {
      try { mediaEl.play(); } catch { /* autoplay policy */ }
    }
    logger().info('piano.engagement-gate.dismissed');
    onEngagementConfirmed?.();
  }, [mediaEl, onEngagementConfirmed]);

  return { gateOpen, dismissGate };
}

export default useEngagementGate;
