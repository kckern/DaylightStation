import React from 'react';
import PropTypes from 'prop-types';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import { formatClock } from '@/modules/Fitness/lib/cycleGame/cycleGameLobby.js';
import './OvalTrack.scss';

// Oval geometry radii (SVG user units) — the track ellipse the markers ride on.
const RX = 100;
const RY = 50;

/**
 * Pure geometry helper: map a normalized lap progress (0..1 into the current lap)
 * to a point on an ellipse of radii (rx, ry). θ starts at the top (−π/2) and
 * advances clockwise as progress goes 0→1, so a quarter lap lands on the right
 * side and a half lap at the bottom. y is SVG-style (down is positive).
 */
export function ovalPoint(progress, rx, ry) {
  const theta = -Math.PI / 2 + (Number(progress) || 0) * 2 * Math.PI;
  return { x: rx * Math.cos(theta), y: ry * Math.sin(theta) };
}

/**
 * Top-down velodrome oval. Each rider's marker sits at `progress` (0→1+) around
 * the loop — the caller decides what one loop means: when laps are enabled it's a
 * LAP track (one full revolution = one lap, progress wraps 1→0 across the top tick
 * each lap, via `ovalProgressFor`); when laps are off it's a "whole-race track"
 * (one loop = the entire race, a finisher parking at the start/finish tick, a fast
 * time-racer wrapping past their circuit target). Synthwave HUD panel; lane-colored
 * markers glide via a CSS transform-property transition. Pure presentational component.
 */
export default function OvalTrack({ riderIds, riders, riderLive = {}, progress = {}, lapLabel = null, lapLengthM = 0, elapsedS = 0 }) {
  // Compact two-row lap strip under the oval (one column per rider): the previous
  // (last completed) lap as a fixed split, and the current lap counting up live.
  // Shown whenever laps are enabled — before the first crossing "Last" reads "—"
  // and "Now" counts up from the race start.
  const lapsOn = Number.isFinite(lapLengthM) && lapLengthM > 0;
  const splitsOf = (id) => riders[id]?.lapSplits || [];
  const prevLap = (id) => { const s = splitsOf(id); return s.length ? s[s.length - 1] - (s[s.length - 2] || 0) : null; };
  const curLap = (id) => { const s = splitsOf(id); return Math.max(0, elapsedS - (s[s.length - 1] || 0)); };

  return (
    <div className="cg-oval-track" data-testid="oval-track">
      <svg
        className="cg-oval-track__svg"
        viewBox="-130 -80 260 160"
        role="img"
        aria-label="Velodrome oval track"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Outer track ellipse — neon-rimmed lane the avatars ride on. */}
        <ellipse className="cg-oval-track__lane" cx="0" cy="0" rx={RX} ry={RY} />
        {/* Faint inner ellipse for depth (the infield). */}
        <ellipse className="cg-oval-track__infield" cx="0" cy="0" rx={RX - 22} ry={RY - 14} />
        {/* Start/finish tick at the top of the oval. */}
        <line className="cg-oval-track__startline" x1="0" y1={-RY - 8} x2="0" y2={-RY + 8} />

        {/* Current lap number, centered in the infield (inside the SVG so it can't
            drift onto the track when the panel resizes around the strip below). */}
        {lapLabel ? (
          <text className="cg-oval-track__lap-label" data-testid="oval-lap-label"
            x="0" y="0" textAnchor="middle" dominantBaseline="central">{lapLabel}</text>
        ) : null}

        {riderIds.map((id, idx) => {
          const color = LINE_COLORS[idx % LINE_COLORS.length];
          const p = ovalPoint(progress[id] || 0, RX, RY);
          const isGhost = !!riders[id]?.isGhost;
          const initial = (riders[id]?.displayName || id || '?').trim().charAt(0).toUpperCase() || '?';
          return (
            <g
              key={`oval-marker-${id}`}
              className={`cg-oval-track__marker${isGhost ? ' cg-oval-track__marker--ghost' : ''}`}
              data-testid="oval-marker"
              // CSS transform PROPERTY (not the SVG attribute) so the glide transition
              // in OvalTrack.scss actually animates on the Firefox kiosk. px == user units
              // for a translate, so the ellipse coordinates carry over unchanged.
              style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
            >
              <circle
                className="cg-oval-track__dot"
                r="9"
                fill={color}
                stroke={color}
                strokeDasharray={isGhost ? '3 3' : undefined}
              />
              <text className="cg-oval-track__initial" x="0" y="0" textAnchor="middle" dominantBaseline="central">
                {initial}
              </text>
            </g>
          );
        })}
      </svg>
      {lapsOn ? (
        <table className="cg-oval-track__laps" data-testid="oval-lap-strip">
          <thead>
            <tr>
              <th className="cg-oval-track__laps-corner" aria-hidden="true" />
              {riderIds.map((id, idx) => (
                <th key={id} className="cg-oval-track__laps-rider" data-testid="oval-lap-rider">
                  <span className="cg-oval-track__laps-dot" style={{ background: LINE_COLORS[idx % LINE_COLORS.length] }} />
                  <span className="cg-oval-track__laps-name">{riders[id]?.displayName || id}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="cg-oval-track__laps-row" data-testid="oval-lap-prev">
              <th scope="row" className="cg-oval-track__laps-label">Last</th>
              {riderIds.map((id) => {
                const d = prevLap(id);
                return <td key={id} className="cg-oval-track__laps-cell">{d == null ? '—' : formatClock(d)}</td>;
              })}
            </tr>
            <tr className="cg-oval-track__laps-row cg-oval-track__laps-row--current" data-testid="oval-lap-cur">
              <th scope="row" className="cg-oval-track__laps-label">Now</th>
              {riderIds.map((id) => (
                <td key={id} className="cg-oval-track__laps-cell cg-oval-track__laps-cell--current">
                  {formatClock(curLap(id))}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

OvalTrack.propTypes = {
  riderIds: PropTypes.array.isRequired,
  riders: PropTypes.object.isRequired,
  riderLive: PropTypes.object,
  progress: PropTypes.object,
  lapLabel: PropTypes.string,
  lapLengthM: PropTypes.number,
  elapsedS: PropTypes.number
};
