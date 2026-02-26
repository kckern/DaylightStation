import { useState, useMemo, useCallback } from 'react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { useAutoGameLifecycle } from '../useAutoGameLifecycle.js';
import './SideScrollerGame.scss';

const DISPLAY_MS = 4000;

/**
 * Side Scroller — placeholder game. Shows "Coming Soon" then auto-exits.
 */
export function SideScrollerGame({ activeNotes, gameConfig, onDeactivate }) {
  const logger = useMemo(() => getChildLogger({ component: 'side-scroller-game' }), []);
  const [phase, setPhase] = useState('IDLE');

  const startGame = useCallback(() => {
    logger.info('side-scroller.started', {});
    setPhase('PLAYING');
    setTimeout(() => setPhase('IDLE'), DISPLAY_MS);
  }, [logger]);

  useAutoGameLifecycle(phase, startGame, onDeactivate, logger, 'side-scroller');

  return (
    <div className="side-scroller-placeholder">
      <div className="side-scroller-placeholder__content">
        <h1 className="side-scroller-placeholder__title">Side Scroller</h1>
        <p className="side-scroller-placeholder__subtitle">Coming Soon</p>
      </div>
    </div>
  );
}

export default SideScrollerGame;
