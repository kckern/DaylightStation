import { useMemo } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { circlePositions, activeSlots, diatonicSlots, slotOfPitchClass } from '../theory/circleOfFifths.js';
import './CircleOfFifths.scss';

/**
 * Circle-of-fifths wheel — a live functional-harmony readout.
 *
 * Outer bubbles are the 12 major keys; the detected key's seven diatonic slots
 * form a contiguous window, tinted by chord quality (major / minor / diminished)
 * and labelled with their scale degree on an inner ring (IV·I·V·ii·vi·iii·vii°),
 * which rotates to the detected key. A ▲ marks the tonic. Bubbles for currently
 * sounding pitch classes light up, and the played chord's root degree is
 * emphasised. Purely presentational — the geometry/degree logic is the
 * unit-tested theory/circleOfFifths.js model.
 *
 * @param {number[]} pitchClasses - active pitch classes (0-11)
 * @param {string} [detectedKey] - major key name driving the diatonic window + degree ring
 * @param {number} [rootPc] - pitch class of the currently identified chord's root (emphasised)
 * @param {number} [size] - px square viewport (default 220)
 */
export function CircleOfFifths({ pitchClasses = [], detectedKey, rootPc, size = 220 }) {
  const logger = useMemo(() => getLogger().child({ component: 'circle-of-fifths' }), []);
  const positions = useMemo(() => circlePositions(), []);
  const active = useMemo(() => activeSlots(pitchClasses), [pitchClasses]);
  const diatonic = useMemo(() => diatonicSlots(detectedKey), [detectedKey]);
  const rootSlot = useMemo(() => (rootPc == null ? -1 : slotOfPitchClass(rootPc)), [rootPc]);

  logger.sampled('circle.render', { active: active.size, key: detectedKey, root: rootPc },
    { maxPerMinute: 30, aggregate: true });

  const cx = size / 2;
  const cy = size / 2;
  const ringR = size * 0.42;    // where slot bubbles sit
  const bubbleR = size * 0.07;  // slot bubble radius
  const degreeR = size * 0.25;  // inner degree-ring radius (roman numerals)

  // Tonic slot (for the ▲ marker), by key name → its geometry angle.
  const tonicIdx = positions.findIndex((p) => p.label === detectedKey);
  const tonicAngle = tonicIdx >= 0 ? positions[tonicIdx].angle : null;
  const markerR = ringR * 0.72;

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

      {/* Inner degree ring — roman numerals at each diatonic slot's angle. */}
      {positions.map((p, i) => {
        const deg = diatonic.get(i);
        if (!deg) return null;
        const x = cx + p.x * degreeR;
        const y = cy + p.y * degreeR;
        const isActive = active.has(i);
        return (
          <text
            key={`deg-${p.label}`}
            className={`cof-degree${isActive ? ' is-active' : ''}`}
            x={x}
            y={y}
            dominantBaseline="central"
            textAnchor="middle"
          >
            {deg.roman}
          </text>
        );
      })}

      {/* ▲ Tonic marker — a triangle just inside the tonic bubble, pointing out. */}
      {tonicAngle != null && (
        <polygon
          className="cof-tonic"
          points={`${cx - 5},${cy - markerR + 7} ${cx + 5},${cy - markerR + 7} ${cx},${cy - markerR - 3}`}
          transform={`rotate(${tonicAngle} ${cx} ${cy})`}
        />
      )}

      {/* Outer key bubbles. */}
      {positions.map((p, i) => {
        const x = cx + p.x * ringR;
        const y = cy + p.y * ringR;
        const deg = diatonic.get(i);
        const isActive = active.has(i);
        const isRoot = i === rootSlot;
        const cls = [
          'cof-slot',
          deg ? `in-key q-${deg.quality}` : '',
          isActive ? 'is-active' : '',
          isRoot ? 'is-root' : '',
        ].filter(Boolean).join(' ');
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
