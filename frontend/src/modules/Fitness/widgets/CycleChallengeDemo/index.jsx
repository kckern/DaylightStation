import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import getLogger from '@/lib/logging/Logger.js';

/**
 * CycleChallengeDemoLauncher — module entry exposed via the fitness module
 * registry under id `cycle_challenge_demo`. Selecting it from the app menu
 * picks a random episode from cycling show 674139, then navigates straight
 * to /fitness/play/{id}?cycle-demo=1&nogovern. The CycleChallengeDemo
 * overlay panel mounts on the player automatically when ?cycle-demo=1
 * is present.
 *
 * Implements the discovery inline (rather than redirecting through a
 * /fitness/cycle-demo URL) because the FitnessApp URL-init effect only
 * runs once per mount; an intermediate URL hop wouldn't re-trigger
 * discovery on the launcher's behalf.
 */
export default function CycleChallengeDemoLauncher() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('Discovering cycling episode…');

  useEffect(() => {
    const logger = getLogger().child({ component: 'cycle-challenge-demo-launcher' });
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch('/api/v1/fitness/show/674139/playable')
          .then((r) => r.json())
          .catch(() => null);
        if (cancelled) return;
        const episodes = (resp?.items || resp?.episodes || []).filter((e) => e?.id || e?.key);
        if (episodes.length === 0) {
          setStatus('No cycling episodes available.');
          logger.warn('no_episodes', { showId: 674139 });
          return;
        }
        const pick = episodes[Math.floor(Math.random() * episodes.length)];
        const episodeId = String(pick.id || pick.key).replace(/^[a-z]+:/i, '');
        logger.info('redirect', { episodeId, title: pick.title, choices: episodes.length });
        if (cancelled) return;
        navigate(`/fitness/play/${episodeId}?cycle-demo=1&nogovern`, { replace: true });
      } catch (err) {
        if (cancelled) return;
        setStatus(`Discovery failed: ${err?.message || err}`);
        logger.error('discover_failed', { error: err?.message });
      }
    })();
    return () => { cancelled = true; };
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
      {status}
    </div>
  );
}

export const manifest = {
  id: 'cycle_challenge_demo',
  name: 'Cycle Challenge Demo',
  icon: '🚴',
  description: 'Plays a random cycling video and exposes a debug overlay for the cycle challenge state machine — trigger, swap rider, drive RPM, inspect telemetry.'
};
