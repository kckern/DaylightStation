import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import CycleSpeedometer from '../CycleSpeedometer.jsx';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import getLogger from '@/lib/logging/Logger.js';

/**
 * Bottom row of CycleSpeedometers — one gauge per rider, scaled down to fit a
 * single line within the reserved bottom band (never wraps). The parent gates
 * rendering with {showSpeedos && <SpeedoRow/>}.
 */
export default function SpeedoRow({ riderIds, riders, riderLive, cadenceBands }) {
  // Keep the speedometer row to ONE line — scale the gauges to fit the width.
  const speedosRef = useRef(null);
  const [speedoSize, setSpeedoSize] = useState(240);
  const lastSizeRef = useRef(240);
  const riderCount = riderIds.length;
  const log = useMemo(() => getLogger().child({ component: 'cycle-speedo-row' }), []);

  useEffect(() => {
    const el = speedosRef.current;
    if (!el) return undefined;
    const SPEEDO_GAP = 28; // keep in sync with .cycle-race-screen__speedos gap
    const compute = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const n = Math.max(1, riderCount);
      const byWidth = (w - SPEEDO_GAP * (n - 1)) / n;
      // Size from WIDTH only. This band sits in an `auto`-height grid track, so
      // deriving the gauge size from the measured HEIGHT fed the gauges' own
      // height back into the track height — a measure→resize→measure thrash
      // (chart + RPM row stretching). Width is fixed by the full-width row, so
      // it's a stable input; the track height then follows the gauge, once.
      const size = Math.max(96, Math.min(280, Math.floor(byWidth)));
      const next = Number.isFinite(size) && size > 0 ? size : 96;
      if (next !== lastSizeRef.current) {
        lastSizeRef.current = next;
        log.debug('cycle_game.speedo_resize', { w: Math.round(w), h: Math.round(h), riders: n, size: next });
        setSpeedoSize(next);
      }
    };
    compute();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(compute);
      ro.observe(el);
    }
    return () => { if (ro) ro.disconnect(); };
  }, [riderCount, log]);

  return (
    <div className="cycle-race-screen__speedos" ref={speedosRef}>
      {riderIds.map((id, idx) => {
        const live = riderLive[id] || {};
        return (
          <CycleSpeedometer
            key={id}
            rpm={live.rpm}
            maxRpm={live.maxRpm}
            cadenceBands={cadenceBands}
            distanceMeters={riders[id].cumulativeDistanceM}
            multiplier={live.multiplier}
            avatar={{
              name: riders[id].displayName,
              src: live.avatarSrc,
              heartRate: live.heartRate,
              zoneId: live.zoneId,
              zoneColor: live.zoneColor || LINE_COLORS[idx % LINE_COLORS.length],
              progress: live.zoneProgress
            }}
            isGhost={!!riders[id].isGhost}
            finished={!!live.finished}
            placement={live.placement}
            penalized={!!live.penalized}
            penaltyRemainingS={live.penaltyRemainingS}
            penaltyTotalS={live.penaltyTotalS}
            penaltyAwaitingStop={!!live.penaltyAwaitingStop}
            size={speedoSize}
          />
        );
      })}
    </div>
  );
}

SpeedoRow.propTypes = {
  riderIds: PropTypes.array.isRequired,
  riders: PropTypes.object.isRequired,
  riderLive: PropTypes.object.isRequired,
  cadenceBands: PropTypes.array
};
