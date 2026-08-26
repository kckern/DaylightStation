import React from 'react';
import PropTypes from 'prop-types';
import { ElapsedTimer } from '@/modules/Fitness/shared';
import { ZONE_COLORS, getRingColorRank } from '@/modules/Fitness/shared/constants/fitness';
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

  const totalRings = box.totalRings ?? 0;
  const colorRings = box.buckets || {};
  
  // Get colors with rings, sorted by zone intensity (high to low)
  const colors = Object.keys(colorRings)
    .filter(c => (colorRings[c] || 0) > 0)
    .sort((a, b) => getRingColorRank(b) - getRingColorRank(a));
  const hasRings = colors.length > 0;

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
          <span className="tb-icon" role="img" aria-label="rings">💰</span>
          {totalRings}
        </div>
        {hasRings && (
          <div className="tb-color-grid">
            {colors.map(c => {
              const hex = ZONE_COLORS[c] || c;
              return (
                <div key={c} className="tb-color-ring" title={`${c}: ${colorRings[c]} rings`}>
                  <span className="swatch" style={{ background: hex }}>
                    {colorRings[c]}
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
  /** Treasure box state with totalRings and buckets */
  box: PropTypes.shape({
    totalRings: PropTypes.number,
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
