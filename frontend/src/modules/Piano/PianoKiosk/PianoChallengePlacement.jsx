import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import getLogger from '../../../lib/logging/Logger.js';
import AskSession from '../ask/AskSession.jsx';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { usePianoUser } from './PianoUserContext.jsx';
import { savePianoChallengeStartLevel } from '../ask/pianoChallengeProfile.js';
import { resolveRepertoire } from './modes/Games/gateRepertoire.js';

/**
 * An on-demand, descending placement probe. It deliberately chooses only a
 * level and its authored material; AskSession remains the sole resolver,
 * grader, and presenter. A first pass stores that rung as the learner's entry
 * point. A miss simply tries the next easier rung, never changes the ladder.
 */
export default function PianoChallengePlacement() {
  const navigate = useNavigate();
  const { basePath, config } = usePianoKioskConfig();
  const { currentUser } = usePianoUser();
  const levels = useMemo(() => resolveRepertoire(config?.gameGate?.repertoire), [config?.gameGate?.repertoire]);
  const [index, setIndex] = useState(() => Math.max(0, levels.length - 1));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);
  const logger = useMemo(() => getLogger().child({ component: 'piano-challenge-placement' }), []);
  const level = levels[Math.min(index, levels.length - 1)];
  const materialSpec = level?.material?.[0] ?? null;

  const leave = useCallback(() => navigate(basePath), [basePath, navigate]);
  const remember = useCallback(async (passedLevel) => {
    if (!currentUser || currentUser === 'guest') return;
    setSaving(true);
    setError(null);
    try {
      await savePianoChallengeStartLevel(currentUser, passedLevel.id);
      logger.info('piano.challenge-placement.saved', { learnerId: currentUser, startLevel: passedLevel.id });
      setSaved(passedLevel.id);
    } catch (cause) {
      logger.warn('piano.challenge-placement.save-failed', { learnerId: currentUser, error: cause?.message ?? String(cause) });
      setError('That result could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [currentUser, logger]);

  if (!currentUser || currentUser === 'guest') {
    return <section className="piano-mode__placeholder" role="status"><h2>Choose your profile first</h2><button type="button" onClick={leave}>Back</button></section>;
  }
  if (saved) {
    return <section className="piano-mode__placeholder" role="status"><h2>You’re ready to begin</h2><p>Your PianoChallenge starts at {saved}.</p><button type="button" onClick={leave}>Back to Piano</button></section>;
  }
  if (!level || !materialSpec) {
    return <section className="piano-mode__placeholder" role="status"><h2>Placement is unavailable</h2><button type="button" onClick={leave}>Back</button></section>;
  }

  return (
    <>
      {error && <p role="status">{error}</p>}
      <AskSession
        ask={level}
        materialSpec={materialSpec}
        intent="challenge"
        framing="Find your PianoChallenge starting point."
        onPassed={() => { if (!saving) remember(level); }}
        onFailed={() => setIndex((current) => Math.max(0, current - 1))}
        onUnavailable={() => setError('This challenge is not available right now. Try again later.')}
        onExit={leave}
      />
    </>
  );
}
