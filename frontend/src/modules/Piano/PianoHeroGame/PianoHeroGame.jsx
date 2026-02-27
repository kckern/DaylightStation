import { useState, useEffect, useMemo, useCallback } from 'react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { useAutoGameLifecycle } from '../useAutoGameLifecycle.js';
import './PianoHeroGame.scss';

const DISPLAY_MS = 4000;

/**
 * Piano Hero — placeholder game. Shows "Coming Soon" then auto-exits.
 */
export function PianoHeroGame({ activeNotes, gameConfig, onDeactivate }) {
  const logger = useMemo(() => getChildLogger({ component: 'piano-hero-game' }), []);
  const [phase, setPhase] = useState('IDLE');

  const startGame = useCallback(() => {
    logger.info('hero.started', {});
    setPhase('PLAYING');
    setTimeout(() => setPhase('IDLE'), DISPLAY_MS);
  }, [logger]);

  useAutoGameLifecycle(phase, startGame, onDeactivate, logger, 'hero');

  return (
    <div className="piano-hero-placeholder">
      <div className="piano-hero-placeholder__content">
        <h1 className="piano-hero-placeholder__title">Piano Hero</h1>
        <p className="piano-hero-placeholder__subtitle">Coming Soon</p>
      </div>
    </div>
  );
}

export default PianoHeroGame;
