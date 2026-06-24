import { useMemo } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { circlePositions, activeSlots, keyArc } from '../theory/circleOfFifths.js';
import './CircleOfFifths.scss';

/**
 * Circle-of-fifths wheel. Highlights the slots for the pitch classes currently
 * sounding; softly rings the detected key's I/IV/V neighbourhood. Purely
 * presentational — the geometry/highlight logic is the unit-tested
 * theory/circleOfFifths.js model.
 *
 * @param {number[]} pitchClasses - active pitch classes (0-11)
 * @param {string} [detectedKey] - major key name for the soft key-region ring
 * @param {number} [size] - px square viewport (default 220)
 */
export function CircleOfFifths({ pitchClasses = [], detectedKey, size = 220 }) {
  const logger = useMemo(() => getLogger().child({ component: 'circle-of-fifths' }), []);
  const positions = useMemo(() => circlePositions(), []);
  const active = useMemo(() => activeSlots(pitchClasses), [pitchClasses]);
  const region = useMemo(() => keyArc(detectedKey), [detectedKey]);

  // Debug-level: high frequency (every chord change). Sampled to bound volume.
  logger.sampled('circle.render', { active: active.size, key: detectedKey },
    { maxPerMinute: 30, aggregate: true });

  const cx = size / 2;
  const cy = size / 2;
  const ringR = size * 0.42;   // where slot bubbles sit
  const bubbleR = size * 0.07; // slot bubble radius

  return (
    <svg
      className="piano-circle-of-fifths"
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label="Circle of fifths"
    >
      <circle className="cof-ring" cx={cx} cy={cy} r={ringR} />
      {positions.map((p, i) => {
        const x = cx + p.x * ringR;
        const y = cy + p.y * ringR;
        const isActive = active.has(i);
        const inKey = region.has(i);
        const cls = `cof-slot${isActive ? ' is-active' : ''}${inKey ? ' in-key' : ''}`;
        return (
          <g key={p.label} className={cls}>
            <circle className="cof-bubble" cx={x} cy={y} r={bubbleR} />
            <text className="cof-label" x={x} y={y} dominantBaseline="central" textAnchor="middle">
              {p.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default CircleOfFifths;
