import { useState, useRef, useCallback } from 'react';
import { toTakeEvent, takeDuration, closeOpenNotes } from './studioRecording.js';

/**
 * useStudioRecorder — captures the live MIDI note stream into a replayable take.
 *
 * Taps useWebMidiBLE.subscribe (not noteHistory, which trims after 8s). start()
 * begins accumulating relative-time events; stop() returns the finalized take
 * { events, durationMs } with any still-held notes closed.
 *
 * @param {(listener: Function) => Function} subscribe - from usePianoMidi()
 */
export function useStudioRecorder(subscribe) {
  const [recording, setRecording] = useState(false);
  const [lastTake, setLastTake] = useState(null); // { events, durationMs }
  const eventsRef = useRef([]);
  const t0Ref = useRef(0);
  const unsubRef = useRef(null);

  const start = useCallback(() => {
    eventsRef.current = [];
    t0Ref.current = Date.now();
    unsubRef.current = subscribe((evt) => {
      eventsRef.current.push(toTakeEvent(evt, t0Ref.current));
    });
    setRecording(true);
  }, [subscribe]);

  const stop = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
    const stopT = Date.now() - t0Ref.current;
    const events = closeOpenNotes(eventsRef.current, stopT);
    const take = { events, durationMs: takeDuration(events) };
    setLastTake(take);
    setRecording(false);
    return take;
  }, []);

  return { recording, lastTake, start, stop };
}

export default useStudioRecorder;
