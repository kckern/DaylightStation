import React, { useEffect, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from "../../components/CircularUserAvatar.jsx";
import { formatDistance } from "../../lib/cycleGame/formatDistance.js";
import { buildTicks, labelFontUnits, buildBandArcs, needleAngleDeg, tickStepsFor, scaleBands, bandForRpm, DEFAULT_CADENCE_BANDS } from "../../lib/cycleGame/speedometerGeometry.js";
import { createTickLerp } from "../../../../../../__capabilities/gaming/browser/platform/realtime/index.js";
import { AVATAR_RATIO, OVERLAY_FONT_RATIO } from "../../lib/cycleGame/speedometerOverlayLayout.js";
import { formatMultiplier, boostChipLabel } from "../../lib/cycleGame/boostState.js";
import { RaceFlagIcon, MedalIcon } from "./home/icons.jsx";
import "./CycleSpeedometer.scss";

const VIEWBOX = 200;
const CENTER = 100;
const GAUGE_RADIUS = 80;
// Below this gauge width the overlay words and the boost row's next step no
// longer fit beside the dial numerals.
const COMPACT_PX = 220;

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 4 → "4th", … */
function ordinal(n) {
  if (!Number.isFinite(n)) return '';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export default function CycleSpeedometer({
  rpm = 0, maxRpm = 120, speedKmh = 0, cadenceBands = [], tickStep, labelStep,
  avatar = {}, distanceMeters = 0, riderColor = null, size = 220, className = '',
  isGhost = false, finished = false, placement = null, isLeader = false,
  sensorLost = false, parked = false, noSensor = false, riderId = null, boost = null
}) {
  // Tick spacing scales with the gauge max (a fixed 10/30 crowds a 250 dial);
  // explicit tickStep/labelStep props still override when provided.
  const steps = useMemo(() => tickStepsFor(maxRpm), [maxRpm]);
  const effTickStep = Number.isFinite(tickStep) ? tickStep : steps.tickStep;
  const effLabelStep = Number.isFinite(labelStep) ? labelStep : steps.labelStep;
  const pxForLabels = typeof size === 'number' ? size : 220;
  const labelFontSize = labelFontUnits(pxForLabels, VIEWBOX);
  const ticks = useMemo(
    () => buildTicks({ maxRpm, tickStep: effTickStep, labelStep: effLabelStep, center: CENTER, gaugeRadius: GAUGE_RADIUS, labelFontSize }),
    [maxRpm, effTickStep, effLabelStep, labelFontSize]
  );
  // Fall back to the system-default colour bands when config supplies none, so the
  // gauge always shows its green→red zones instead of a bare arc.
  const effectiveBands = Array.isArray(cadenceBands) && cadenceBands.length > 0 ? cadenceBands : DEFAULT_CADENCE_BANDS;
  // Bands scale proportionally to the gauge so the colour zones keep their intent
  // (a real sprint is the top tier, not a giant red wedge on a 250 dial). We also
  // flag the band the current RPM sits in so it can light up — the needle is thin
  // and hard to read, so the lit zone is the primary "where am I" cue.
  const { bands, activeBandId } = useMemo(() => {
    const scaled = scaleBands(effectiveBands, maxRpm);
    const arcs = buildBandArcs({ bands: scaled, maxRpm, center: CENTER, gaugeRadius: GAUGE_RADIUS });
    const active = bandForRpm(rpm, scaled);
    return { bands: arcs, activeBandId: active?.id ?? null };
  }, [effectiveBands, maxRpm, rpm]);
  const needleDeg = needleAngleDeg(rpm, maxRpm);

  const px = typeof size === 'number' ? size : 220;
  // Overlay typography scales with the gauge (audit UX §3.1-3.2): the gauge
  // wrapper's font-size is a fixed fraction of its own pixel size, so every
  // em-sized overlay child (rpm hero, speed sub-line) grows/shrinks in lockstep
  // with the dial instead of colliding at small sizes or looking lost at large
  // ones. The avatar keeps its existing ratio.
  const overlayFontPx = px * OVERLAY_FONT_RATIO;
  const avatarPx = Math.round(px * AVATAR_RATIO);
  const boostProgress = boost && boost.hasStrap && Number.isFinite(boost.progress)
    ? Math.min(1, Math.max(0, boost.progress)) : null;

  // ── Motion clock: glide the needle between 1 Hz ticks ──
  // The needle is a DATA-driven position (rpm → angle). React renders the
  // CURRENT-tick value (so a no-rAF env shows the exact datum); the shared linear
  // clock only ADJUSTS it from the previous tick toward the current one,
  // imperatively — no per-frame React render, no CSS transition.
  //
  // The odometer is a PRINTED number, so it does not glide: it prints the
  // engine's current distance through formatDistance, exactly like the chart tag,
  // chart header, standings tower and POV badge. (It used to count up from the
  // previous tick, so mid-tick it read up to one tick behind every other readout:
  // 454 m on the gauge beside 457 m everywhere else.)
  const distM = Number.isFinite(distanceMeters) ? distanceMeters : 0;
  const needleRef = useRef(null);
  const clockRef = useRef(null);
  if (!clockRef.current) clockRef.current = createTickLerp({ intervalMs: 1000 });
  const motionRef = useRef({ prevDeg: needleDeg, curDeg: needleDeg });
  const prevDegRef = useRef(needleDeg);

  useEffect(() => {
    const clock = clockRef.current;
    const unsub = clock.subscribe((f) => {
      const m = motionRef.current;
      if (needleRef.current) {
        const deg = m.prevDeg + (m.curDeg - m.prevDeg) * f;
        needleRef.current.style.transform = `rotate(${deg}deg)`;
      }
    });
    return () => { unsub(); clock.stop(); };
  }, []);

  // A new tick: snapshot prev→cur and re-arm the clock so the needle glides.
  useEffect(() => {
    motionRef.current = { prevDeg: prevDegRef.current, curDeg: needleDeg };
    prevDegRef.current = needleDeg;
    clockRef.current.onTick(null);
  }, [needleDeg]);

  // Away from the pedals (never for a finisher). The overlay sits in the
  // FINISHED overlay's slot. A rider whose sensor never reported, or whose
  // sensor has dropped, is told to check the sensor rather than to pedal: they
  // may be pedalling the whole time. Otherwise the calm PARKED card. Both clear
  // the render after the controller sees movement.
  const away = !finished && (parked || noSensor);
  const signalProblem = noSensor || sensorLost;

  return (
    <div className={`cycle-speedometer${finished ? ' cycle-speedometer--finished' : ''}${away ? ' cycle-speedometer--parked' : ''}${px < COMPACT_PX ? ' cycle-speedometer--compact' : ''}${sensorLost ? ' cycle-speedometer--sensor-lost' : ''} ${className}`.trim()} style={{ width: px, '--cg-rider-tint': riderColor || 'transparent' }}>
      <div className="cycle-speedometer__gauge" style={{ width: px, height: px, fontSize: overlayFontPx }}>
        {away && (
          <div className={`cycle-speedometer__parked${signalProblem ? ' cycle-speedometer__parked--no-signal' : ''}`}
            data-testid="cycle-speedometer-parked">
            <span className="cycle-speedometer__parked-title">{signalProblem ? 'NO SIGNAL' : 'PARKED'}</span>
            <span className="cycle-speedometer__parked-sub">{signalProblem ? 'Check the sensor' : 'Pedal to rejoin'}</span>
          </div>
        )}
        {finished && (
          <div className="cycle-speedometer__finished" data-testid="cycle-speedometer-finished">
            <span className="cycle-speedometer__finished-flag" aria-hidden="true"><RaceFlagIcon /></span>
            {Number.isFinite(placement) && (
              <span className="cycle-speedometer__finished-place">{ordinal(placement)}</span>
            )}
            <span className="cycle-speedometer__finished-label">Finished</span>
          </div>
        )}
        <svg className="cycle-speedometer__svg" viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`} aria-hidden="true">
          <circle className="cycle-speedometer__ring" cx={CENTER} cy={CENTER} r={GAUGE_RADIUS + 8} fill="none" />
          {bands.map((b) => {
            const isActive = b.id === activeBandId;
            return (
              <path
                key={b.id}
                className={`cycle-speedometer__band${isActive ? ' cycle-speedometer__band--active' : ' cycle-speedometer__band--dim'}`}
                data-testid={isActive ? 'cycle-speedometer-band-active' : undefined}
                d={b.d}
                stroke={b.color}
                fill="none"
                strokeWidth={isActive ? 9 : 6}
                // Glow tinted to the band's own colour so the lit zone reads as
                // "emitting" rather than just thicker.
                style={isActive ? { filter: `drop-shadow(0 0 4px ${b.color}) drop-shadow(0 0 8px ${b.color})` } : undefined}
              />
            );
          })}
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
              x={t.labelPos.x} y={t.labelPos.y}
              style={{ fontSize: labelFontSize }}
              textAnchor="middle"
            >{t.label}</text>
          ))}
          <g
            ref={needleRef}
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
            size={avatarPx}
          />
        </div>

        {/* Rpm + speed live TOGETHER in the free lower hemisphere (audit UX
            §3.1-3.2) — the dial's ticks/labels only ever occupy the top half
            (rpmToAngle sweeps 9 o'clock through 12 to 3 o'clock), so this block
            can never collide with a tick label. Rpm is the hero (the rider
            controls it); km/h is the sub-line beneath it. A lost sensor
            (broadcast gap past the hold+decay window — see rpmDuringGap /
            gapTicksRef) swaps the rpm digits for a "SENSOR" chip instead of a
            frozen/decayed number that would look like real telemetry. */}
        <div className="cycle-speedometer__lower-readout">
          <div className="cycle-speedometer__rpm cycle-speedometer__readout--hero" data-testid="cycle-speedometer-rpm">
            {sensorLost ? (
              <span className="cycle-speedometer__sensor-lost-chip" data-testid="cycle-speedometer-sensor-lost">SENSOR</span>
            ) : (
              <>{Math.round(Number.isFinite(rpm) ? rpm : 0)}<span className="cycle-speedometer__rpm-unit"> rpm</span></>
            )}
          </div>
          <div className="cycle-speedometer__speed cycle-speedometer__readout--sub" data-testid="cycle-speedometer-speed">
            {Math.round(Number.isFinite(speedKmh) ? speedKmh : 0)}<span className="cycle-speedometer__speed-unit"> km/h</span>
          </div>
        </div>
      </div>

      {/* Boost meter: how the heart-rate zone multiplies distance. BELOW the
          gauge, outside the dial, so it can never cover a tick label (the old
          ×1.2 badge sat on the 120). Chip in the zone colour, a thin bar to the
          next zone, the next step muted at the right. No strap: the handicap
          multiplier, no bar. */}
      {boost && (
        <div className={`cycle-speedometer__boost${boost.hasStrap ? '' : ' cycle-speedometer__boost--no-strap'}`}
          data-testid="cycle-speedometer-boost" style={{ width: px, ...(avatar.zoneColor ? { '--cg-boost-color': avatar.zoneColor } : {}) }}>
          <div className="cycle-speedometer__boost-line">
            <span className="cycle-speedometer__boost-chip" data-testid="cycle-speedometer-boost-chip">
              <span className="cycle-speedometer__boost-label">{boostChipLabel(boost, px)}</span>
              {' '}
              <span className="cycle-speedometer__boost-mult" data-testid="cycle-speedometer-boost-mult">{`×${formatMultiplier(boost.mult)}`}</span>
            </span>
            {boost.hasStrap && boost.next && (
              <span className="cycle-speedometer__boost-next" data-testid="cycle-speedometer-boost-next">
                {`${boost.next.label} ×${formatMultiplier(boost.next.mult)}`}
              </span>
            )}
          </div>
          {boostProgress != null && (
            <div className="cycle-speedometer__boost-bar" data-testid="cycle-speedometer-boost-bar">
              <span className="cycle-speedometer__boost-fill" data-testid="cycle-speedometer-boost-fill"
                style={{ width: `${Math.round(boostProgress * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      <div className="cycle-speedometer__odometer" data-testid="cycle-speedometer-odometer">
        {isLeader && !finished && (
          <span className="cycle-speedometer__leader-medal" data-testid="cycle-speedometer-leader-medal" aria-label="Current leader">
            <MedalIcon />
          </span>
        )}
        <span className="cycle-speedometer__odometer-value" data-distance-readout={riderId ?? undefined}>
          {formatDistance(distM)}
        </span>
      </div>
    </div>
  );
}

CycleSpeedometer.propTypes = {
  rpm: PropTypes.number,
  maxRpm: PropTypes.number,
  speedKmh: PropTypes.number,
  cadenceBands: PropTypes.arrayOf(PropTypes.shape({ id: PropTypes.string, min: PropTypes.number, color: PropTypes.string })),
  tickStep: PropTypes.number,
  labelStep: PropTypes.number,
  avatar: PropTypes.shape({
    name: PropTypes.string, src: PropTypes.string, fallbackSrc: PropTypes.string,
    heartRate: PropTypes.number, zoneId: PropTypes.string, zoneColor: PropTypes.string, progress: PropTypes.number
  }),
  distanceMeters: PropTypes.number,
  riderColor: PropTypes.string,
  size: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  className: PropTypes.string,
  isGhost: PropTypes.bool,
  finished: PropTypes.bool,
  placement: PropTypes.number,
  isLeader: PropTypes.bool,
  sensorLost: PropTypes.bool,
  parked: PropTypes.bool,
  noSensor: PropTypes.bool,
  riderId: PropTypes.string,
  /** boostState(): { hasStrap, label, mult, progress, next }. Absent → no boost row. */
  boost: PropTypes.shape({
    hasStrap: PropTypes.bool, label: PropTypes.string, mult: PropTypes.number,
    progress: PropTypes.number, next: PropTypes.shape({ label: PropTypes.string, mult: PropTypes.number })
  })
};
