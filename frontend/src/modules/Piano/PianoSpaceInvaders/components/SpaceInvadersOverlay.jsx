import { useMemo } from 'react';
import { getChildLogger } from '../../../../lib/logging/singleton.js';
import './SpaceInvadersOverlay.scss';

/**
 * Game mode overlay — countdown, banners, victory screen.
 * Score HUD is in the SpaceInvadersGame header, not here.
 */
export function SpaceInvadersOverlay({ gameState, countdown, score, currentLevel, levelProgress }) {
  const logger = useMemo(() => getChildLogger({ component: 'space-invaders-overlay' }), []);

  // Countdown: 3, 2, 1, GO
  if (gameState === 'STARTING') {
    const label = countdown === 0 ? 'GO!' : countdown;
    return (
      <div className="game-overlay">
        <div className="countdown">
          <span className="countdown-number" key={countdown}>{label}</span>
        </div>
      </div>
    );
  }

  // Level complete banner
  if (gameState === 'LEVEL_COMPLETE') {
    return (
      <div className="game-overlay">
        <div className="banner banner--success">
          <h2>Level Complete!</h2>
          <div className="banner-stats">
            <div className="stat">
              <span className="stat-value">{score.points}</span>
              <span className="stat-label">Score</span>
            </div>
            <div className="stat">
              <span className="stat-value">{score.maxCombo}x</span>
              <span className="stat-label">Max Combo</span>
            </div>
            <div className="stat">
              <span className="stat-value">{score.perfects}</span>
              <span className="stat-label">Perfects</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Level failed banner
  if (gameState === 'LEVEL_FAILED') {
    return (
      <div className="game-overlay">
        <div className="banner banner--fail">
          <h2>Try Again!</h2>
          <div className="banner-stats">
            <div className="stat">
              <span className="stat-value">{score.points}</span>
              <span className="stat-label">Score</span>
            </div>
            <div className="stat">
              <span className="stat-value">{score.misses}</span>
              <span className="stat-label">Misses</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Victory screen
  if (gameState === 'VICTORY') {
    const totalHits = score.perfects + score.goods;
    const totalAttempts = totalHits + score.misses;
    const accuracy = totalAttempts > 0
      ? Math.round((totalHits / totalAttempts) * 100)
      : 0;

    return (
      <div className="game-overlay">
        <div className="victory">
          <h1>Victory!</h1>
          <div className="victory-stats">
            <div className="stat stat--large">
              <span className="stat-value">{score.points}</span>
              <span className="stat-label">Final Score</span>
            </div>
            <div className="stat-row">
              <div className="stat">
                <span className="stat-value">{accuracy}%</span>
                <span className="stat-label">Accuracy</span>
              </div>
              <div className="stat">
                <span className="stat-value">{score.maxCombo}x</span>
                <span className="stat-label">Max Combo</span>
              </div>
              <div className="stat">
                <span className="stat-value">{score.perfects}</span>
                <span className="stat-label">Perfects</span>
              </div>
              <div className="stat">
                <span className="stat-value">{score.goods}</span>
                <span className="stat-label">Goods</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default SpaceInvadersOverlay;
