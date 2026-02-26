import './SideScrollerOverlay.scss';

export function SideScrollerOverlay({ phase, countdown, score, level, levelName }) {
  if (phase === 'STARTING' && countdown != null) {
    return (
      <div className="scroller-overlay">
        <div className="scroller-overlay__countdown">
          {countdown === 0 ? 'GO!' : countdown}
        </div>
      </div>
    );
  }

  if (phase === 'LEVEL_UP') {
    return (
      <div className="scroller-overlay">
        <div className="scroller-overlay__level-up">
          <h2 className="scroller-overlay__title">LEVEL UP!</h2>
          <p className="scroller-overlay__level-name">{levelName}</p>
        </div>
      </div>
    );
  }

  if (phase === 'GAME_OVER') {
    return (
      <div className="scroller-overlay">
        <div className="scroller-overlay__gameover">
          <h2 className="scroller-overlay__title">GAME OVER</h2>
          <div className="scroller-overlay__stats">
            <div className="scroller-overlay__stat">
              <span className="scroller-overlay__stat-value">{score}</span>
              <span className="scroller-overlay__stat-label">Score</span>
            </div>
            <div className="scroller-overlay__stat">
              <span className="scroller-overlay__stat-value">{level}</span>
              <span className="scroller-overlay__stat-label">Level</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
