import { useEffect, useState } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { readPianoChallengeProfile } from './pianoChallengeProfile.js';

/**
 * Read placement once per selected learner. A read failure deliberately falls
 * back to the household start level: placement must never block a game gate.
 */
export default function usePianoChallengeProfile(learnerId) {
  const [state, setState] = useState({ learnerId, loading: !!learnerId && learnerId !== 'guest', startLevel: null });

  useEffect(() => {
    let alive = true;
    if (!learnerId || learnerId === 'guest') {
      setState({ learnerId, loading: false, startLevel: null });
      return () => { alive = false; };
    }
    setState({ learnerId, loading: true, startLevel: null });
    readPianoChallengeProfile(learnerId)
      .then((profile) => { if (alive) setState({ learnerId, loading: false, startLevel: profile.startLevel }); })
      .catch((error) => {
        getLogger().child({ component: 'piano-challenge-profile' }).warn(
          'piano.challenge-profile.read-failed', { learnerId, error: error?.message ?? String(error) },
        );
        if (alive) setState({ learnerId, loading: false, startLevel: null });
      });
    return () => { alive = false; };
  }, [learnerId]);

  return state.learnerId === learnerId
    ? state
    : { learnerId, loading: !!learnerId && learnerId !== 'guest', startLevel: null };
}
