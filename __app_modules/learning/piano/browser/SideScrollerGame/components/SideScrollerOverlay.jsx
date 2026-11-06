import { CountdownOverlay } from '../../../../../../__capabilities/gaming/browser/platform/ui/hud/index.js';
import './SideScrollerOverlay.scss';

export function SideScrollerOverlay({ phase, countdown, score, level }) {
  if (phase === 'STARTING' && countdown != null) {
    return (
      <div className="scroller-overlay" role="status" aria-live="polite">
        <CountdownOverlay value={countdown === 0 ? 'GO!' : countdown} className="scroller-overlay__countdown" />
      </div>
    );
  }

  if (phase === 'GAME_OVER') {
    return (
      <div className="scroller-overlay" role="status" aria-live="polite">
        <div className="scroller-overlay__gameover">
          <h2 className="scroller-overlay__title">GAME OVER</h2>
          <div className="scroller-overlay__stats">
            <div className="scroller-overlay__stat">
              <span className="scroller-overlay__stat-value">{Math.floor(score)}</span>
              <span className="scroller-overlay__stat-label">Score</span>
            </div>
            <div className="scroller-overlay__stat">
              <span className="scroller-overlay__stat-value">{level}</span>
              <span className="scroller-overlay__stat-label">Level</span>
            </div>
          </div>
          <p className="scroller-overlay__continue">Press any key to play again</p>
        </div>
      </div>
    );
  }

  return null;
}
