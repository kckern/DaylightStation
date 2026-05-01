import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import getLogger from '@/lib/logging/Logger.js';

/**
 * CycleChallengeDemoLauncher — module entry exposed via the fitness module
 * registry under id `cycle_challenge_demo`. Selecting it from the app menu
 * navigates to /fitness/cycle-demo, which auto-discovers a random cycling
 * episode and overlays the debug panel on top of FitnessPlayer.
 *
 * Renders only a brief "Starting cycle demo…" placeholder while the
 * navigation happens — the real UX lives in the player route.
 */
export default function CycleChallengeDemoLauncher() {
  const navigate = useNavigate();

  useEffect(() => {
    const logger = getLogger().child({ component: 'cycle-challenge-demo-launcher' });
    logger.info('launching');
    navigate('/fitness/cycle-demo', { replace: true });
  }, [navigate]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      color: '#cbd5e1',
      fontSize: '15px',
      letterSpacing: '0.04em'
    }}>
      Starting cycle challenge demo…
    </div>
  );
}

export const manifest = {
  id: 'cycle_challenge_demo',
  name: 'Cycle Challenge Demo',
  icon: '🚴',
  description: 'Plays a random cycling video and exposes a debug overlay for the cycle challenge state machine — trigger, swap rider, drive RPM, inspect telemetry.'
};
