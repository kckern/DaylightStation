import React from 'react';
import PropTypes from 'prop-types';
import { ElapsedTimer } from '../shared';
import { ZONE_COLORS, getCoinColorRank } from '../shared/constants/fitness';
import '../FitnessSidebar.scss';

/**
 * FitnessTreasureBox - Gamification rewards display panel
 * 
 * Refactored to use shared primitives (Phase 3).
 */
const FitnessTreasureBox = ({ box, session }) => {
  // Determine start time from session
  const startTime = session?.startTime || session?.startedAt || null;

  if (!box) return null;

  const totalCoins = box.totalCoins ?? 0;
  const colorCoins = box.buckets || {};
  
  // Get colors with coins, sorted by zone intensity (high to low)
  const colors = Object.keys(colorCoins)
    .filter(c => (colorCoins[c] || 0) > 0)
    .sort((a, b) => getCoinColorRank(b) - getCoinColorRank(a));
  const hasCoins = colors.length > 0;

  return (
    <div className="treasure-box-panel">
      <div className="tb-row tb-row-head">
        <h3>Treasure Box</h3>
        <ElapsedTimer
          startTime={startTime}
          format="mm:ss"
          size="md"
          variant="default"
          className="tb-timer"
        />
      </div>
      <div className="tb-row tb-row-body">
        <div className="tb-total">
          <span className="tb-icon" role="img" aria-label="coins">💰</span>
          {totalCoins}
        </div>
        {hasCoins && (
          <div className="tb-color-grid">
            {colors.map(c => {
              const hex = ZONE_COLORS[c] || c;
              return (
                <div key={c} className="tb-color-coin" title={`${c}: ${colorCoins[c]} coins`}>
                  <span className="swatch" style={{ background: hex }}>
                    {colorCoins[c]}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

FitnessTreasureBox.propTypes = {
  /** Treasure box state with totalCoins and buckets */
  box: PropTypes.shape({
    totalCoins: PropTypes.number,
    buckets: PropTypes.object
  }),
  /** Session state with startTime */
  session: PropTypes.shape({
    startTime: PropTypes.number,
    startedAt: PropTypes.number,
    durationSeconds: PropTypes.number
  })
};

export default FitnessTreasureBox;
