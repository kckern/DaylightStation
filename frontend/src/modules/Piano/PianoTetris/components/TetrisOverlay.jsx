import './TetrisOverlay.scss';

/**
 * Overlay for countdown, game over display.
 */
export function TetrisOverlay({ phase, countdown, score, linesCleared, level }) {
  if (phase === 'STARTING' && countdown != null) {
    return (
      <div className="tetris-overlay">
        <div className="tetris-overlay__countdown">
          {countdown === 0 ? 'GO!' : countdown}
        </div>
      </div>
    );
  }

  if (phase === 'GAME_OVER') {
    return (
      <div className="tetris-overlay">
        <div className="tetris-overlay__gameover">
          <h2 className="tetris-overlay__title">GAME OVER</h2>
          <div className="tetris-overlay__stats">
            <div className="tetris-overlay__stat">
              <span className="tetris-overlay__stat-value">{score.toLocaleString()}</span>
              <span className="tetris-overlay__stat-label">Score</span>
            </div>
            <div className="tetris-overlay__stat">
              <span className="tetris-overlay__stat-value">{linesCleared}</span>
              <span className="tetris-overlay__stat-label">Lines</span>
            </div>
            <div className="tetris-overlay__stat">
              <span className="tetris-overlay__stat-value">{level}</span>
              <span className="tetris-overlay__stat-label">Level</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
