// Shell root. Minimal skeleton for now — phases render placeholder text.
// Task 17 assembles the real per-phase screens.
import React, { useReducer, useEffect } from 'react';
import { flowReducer, initialFlowState } from './shell/flow/flowReducer.js';
import { fetchBoot } from './shell/session/sessionClient.js';
import './GameShow.scss';

export default function GameShow() {
  const [flow, dispatchFlow] = useReducer(flowReducer, initialFlowState);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { config, sets, activeSession } = await fetchBoot();
        if (cancelled) return;
        dispatchFlow({ type: 'BOOT_LOADED', config, sets, activeSession });
      } catch (err) {
        if (!cancelled) dispatchFlow({ type: 'BOOT_FAILED', error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="gameshow" data-phase={flow.phase}>
      {flow.error ? <div className="gameshow__error">{flow.error}</div> : <div className="gameshow__phase">{flow.phase}</div>}
    </div>
  );
}
