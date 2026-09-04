import { useEffect, useRef, useState } from 'react';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('capture-task');

/** A control owns its progress and the exact failed task, including its date. */
export function useCaptureTask() {
  const taskRef = useRef(null);
  const pendingRef = useRef(false);
  const live = useRef(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const run = async task => {
    if (pendingRef.current || !live.current) return;
    pendingRef.current = true; taskRef.current = task;
    setPending(true); setError(null);
    try {
      await task();
      taskRef.current = null;
    } catch (err) {
      logger.warn('capture.retry_available', { error: err?.message });
      if (live.current) setError(err?.message || 'Capture interrupted. Try again.');
    } finally {
      pendingRef.current = false;
      if (live.current) setPending(false);
    }
  };
  return { pending, error, run, retry: error && taskRef.current ? () => run(taskRef.current) : null };
}
