import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import { buildTicks, buildBandArcs, needleAngleDeg, tickStepsFor, scaleBands } from '@/modules/Fitness/lib/cycleGame/speedometerGeometry.js';
import './CycleSpeedometer.scss';

const VIEWBOX = 200;
const CENTER = 100;
const GAUGE_RADIUS = 80;

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 4 → "4th", … */
function ordinal(n) {
  if (!Number.isFinite(n)) return '';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export default function CycleSpeedometer({
  rpm = 0, maxRpm = 120, cadenceBands = [], tickStep, labelStep,
  avatar = {}, distanceMeters = 0, multiplier = 1, multiplierColor, size = 220, className = '',
  isGhost = false, finished = false, placement = null, penalized = false,
  penaltyRemainingS = null, penaltyTotalS = null, penaltyAwaitingStop = false
}) {
  // Tick spacing scales with the gauge max (a fixed 10/30 crowds a 250 dial);
  // explicit tickStep/labelStep props still override when provided.
  const steps = useMemo(() => tickStepsFor(maxRpm), [maxRpm]);
  const effTickStep = Number.isFinite(tickStep) ? tickStep : steps.tickStep;
  const effLabelStep = Number.isFinite(labelStep) ? labelStep : steps.labelStep;
  const ticks = useMemo(
    () => buildTicks({ maxRpm, tickStep: effTickStep, labelStep: effLabelStep, center: CENTER, gaugeRadius: GAUGE_RADIUS }),
    [maxRpm, effTickStep, effLabelStep]
  );
  // Bands scale proportionally to the gauge so the colour zones keep their intent
  // (a real sprint is the top tier, not a giant red wedge on a 250 dial).
  const bands = useMemo(
    () => buildBandArcs({ bands: scaleBands(cadenceBands, maxRpm), maxRpm, center: CENTER, gaugeRadius: GAUGE_RADIUS }),
    [cadenceBands, maxRpm]
  );
  const needleDeg = needleAngleDeg(rpm, maxRpm);
  const showBadge = Number.isFinite(multiplier) && multiplier > 1;
  const badgeColor = multiplierColor || avatar.zoneColor || '#e67e22';

  const px = typeof size === 'number' ? size : 220;

  return (
    <div className={`cycle-speedometer${finished ? ' cycle-speedometer--finished' : ''}${penalized ? ' cycle-speedometer--penalized' : ''} ${className}`.trim()} style={{ width: px }}>
      <div className="cycle-speedometer__gauge" style={{ width: px, height: px }}>
        {penalized && !finished && (
          <div className="cycle-speedometer__penalty" data-testid="cycle-speedometer-penalty">
            <span className="cycle-speedometer__penalty-icon" aria-hidden="true">⛔</span>
            <span className="cycle-speedometer__penalty-title">False start</span>
            {penaltyAwaitingStop ? (
              // Timer served — they just need to stop pedalling to clear the box.
              <span className="cycle-speedometer__penalty-stop">Stop pedaling to clear</span>
            ) : (
              <>
                <span className="cycle-speedometer__penalty-sub">
                  Penalty box · {Math.ceil(Number.isFinite(penaltyRemainingS) ? penaltyRemainingS : 0)}s
                </span>
                {Number.isFinite(penaltyTotalS) && penaltyTotalS > 0 && (
                  <span className="cycle-speedometer__penalty-bar" data-testid="cycle-speedometer-penalty-bar">
                    <span
                      className="cycle-speedometer__penalty-fill"
                      style={{ width: `${Math.max(0, Math.min(100, (penaltyRemainingS / penaltyTotalS) * 100))}%` }}
                    />
                  </span>
                )}
              </>
            )}
          </div>
        )}
        {finished && (
          <div className="cycle-speedometer__finished" data-testid="cycle-speedometer-finished">
            <span className="cycle-speedometer__finished-flag" aria-hidden="true">🏁</span>
            <span className="cycle-speedometer__finished-place">
              {Number.isFinite(placement) ? ordinal(placement) : 'Finished'}
            </span>
            <span className="cycle-speedometer__finished-label">Finished</span>
          </div>
        )}
        <svg className="cycle-speedometer__svg" viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`} aria-hidden="true">
          <circle className="cycle-speedometer__ring" cx={CENTER} cy={CENTER} r={GAUGE_RADIUS + 8} fill="none" />
          {bands.map((b) => (
            <path key={b.id} className="cycle-speedometer__band" d={b.d} stroke={b.color} fill="none" strokeWidth="6" />
          ))}
          {ticks.map((t) => (
            <line
              key={`t-${t.rpm}`}
              className={`cycle-speedometer__tick${t.major ? ' cycle-speedometer__tick--major' : ''}`}
              x1={t.inner.x} y1={t.inner.y} x2={t.outer.x} y2={t.outer.y}
            />
          ))}
          {ticks.filter((t) => t.major).map((t) => (
            <text
              key={`l-${t.rpm}`}
              className="cycle-speedometer__tick-label"
              x={t.outer.x} y={t.outer.y - 4}
              textAnchor="middle"
            >{t.label}</text>
          ))}
          <g
            className="cycle-speedometer__needle-group"
            style={{ transform: `rotate(${needleDeg}deg)`, transformOrigin: `${CENTER}px ${CENTER}px`, transformBox: 'view-box' }}
          >
            <line className="cycle-speedometer__needle" x1={CENTER} y1={CENTER} x2={CENTER} y2={CENTER - GAUGE_RADIUS} />
          </g>
          <circle className="cycle-speedometer__hub" cx={CENTER} cy={CENTER} r="3" />
        </svg>

        <div className={`cycle-speedometer__avatar${isGhost ? ' cg-ghost' : ''}`}>
          <CircularUserAvatar
            name={avatar.name}
            avatarSrc={avatar.src}
            fallbackSrc={avatar.fallbackSrc}
            heartRate={avatar.heartRate}
            zoneId={avatar.zoneId}
            zoneColor={avatar.zoneColor}
            progress={avatar.progress}
            size={Math.round(px * 0.4)}
          />
          {showBadge && (
            <div className="cycle-speedometer__multiplier" data-testid="cycle-speedometer-multiplier" style={{ background: badgeColor }}>
              ×{Number(multiplier).toFixed(multiplier % 1 === 0 ? 0 : 1)}
            </div>
          )}
        </div>

        <div className="cycle-speedometer__rpm" data-testid="cycle-speedometer-rpm">
          {Math.round(Number.isFinite(rpm) ? rpm : 0)}<span className="cycle-speedometer__rpm-unit"> rpm</span>
        </div>
      </div>

      <div className="cycle-speedometer__odometer" data-testid="cycle-speedometer-odometer">
        {formatDistance(distanceMeters)}
      </div>
    </div>
  );
}

CycleSpeedometer.propTypes = {
  rpm: PropTypes.number,
  maxRpm: PropTypes.number,
  cadenceBands: PropTypes.arrayOf(PropTypes.shape({ id: PropTypes.string, min: PropTypes.number, color: PropTypes.string })),
  tickStep: PropTypes.number,
  labelStep: PropTypes.number,
  avatar: PropTypes.shape({
    name: PropTypes.string, src: PropTypes.string, fallbackSrc: PropTypes.string,
    heartRate: PropTypes.number, zoneId: PropTypes.string, zoneColor: PropTypes.string, progress: PropTypes.number
  }),
  distanceMeters: PropTypes.number,
  multiplier: PropTypes.number,
  multiplierColor: PropTypes.string,
  size: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  className: PropTypes.string,
  isGhost: PropTypes.bool,
  finished: PropTypes.bool,
  placement: PropTypes.number,
  penalized: PropTypes.bool,
  penaltyRemainingS: PropTypes.number,
  penaltyTotalS: PropTypes.number,
  penaltyAwaitingStop: PropTypes.bool
};
