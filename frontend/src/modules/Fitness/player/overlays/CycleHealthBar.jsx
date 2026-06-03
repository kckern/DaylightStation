import React, { useMemo } from 'react';
import PropTypes from 'prop-types';

const clamp01 = (v) => {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
};

/**
 * CycleHealthBar — horizontal segmented health meter (Mega-Man pip style).
 * Lit count = ceil(pct * segments); depletes right -> left. Zero lit segments
 * signals a health lock (empty bar = video paused). Pure presentational.
 */
export function CycleHealthBar({ pct, segments = 10, className = '' }) {
  const safePct = clamp01(pct);
  const lit = Math.ceil(safePct * segments);
  const cells = useMemo(
    () =>
      // index 0 is leftmost; the LEFT-most `lit` segments stay lit so the
      // RIGHT-most empty as health drains (right -> left depletion).
      Array.from({ length: segments }, (_, i) => i < lit),
    [segments, lit]
  );
  const locked = lit <= 0;
  const rootClass = [
    'cycle-health-bar',
    locked ? 'cycle-health-bar--locked' : '',
    className
  ].filter(Boolean).join(' ');

  return (
    <div
      className={rootClass}
      role="meter"
      aria-label={`Cycle health ${Math.round(safePct * 100)} percent`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(safePct * 100)}
      style={{ '--cycle-health-pct': safePct }}
    >
      {cells.map((isLit, i) => (
        <span
          key={i}
          className={`cycle-health-bar__seg${isLit ? ' cycle-health-bar__seg--lit' : ''}`}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

CycleHealthBar.propTypes = {
  pct: PropTypes.number,
  segments: PropTypes.number,
  className: PropTypes.string
};

export default CycleHealthBar;
