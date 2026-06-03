import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import CycleSpeedometer from '../CycleSpeedometer.jsx';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';

/**
 * Bottom row of CycleSpeedometers — one gauge per rider, scaled down to fit a
 * single line within the reserved bottom band (never wraps). The parent gates
 * rendering with {showSpeedos && <SpeedoRow/>}.
 */
export default function SpeedoRow({ riderIds, riders, riderLive, cadenceBands }) {
  // Keep the speedometer row to ONE line within the reserved bottom band —
  // scale the gauges down to fit (never wrap). Measure the row and divide.
  const speedosRef = useRef(null);
  const [speedoSize, setSpeedoSize] = useState(240);
  const riderCount = riderIds.length;

  useEffect(() => {
    const el = speedosRef.current;
    if (!el) return undefined;
    const SPEEDO_GAP = 28; // keep in sync with .cycle-race-screen__speedos gap
    const compute = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const n = Math.max(1, riderCount);
      const byWidth = (w - SPEEDO_GAP * (n - 1)) / n;
      const byHeight = h - 50; // room for the odometer pill beneath the gauge
      const size = Math.max(96, Math.min(280, Math.floor(Math.min(byWidth, byHeight))));
      setSpeedoSize(Number.isFinite(size) && size > 0 ? size : 96);
    };
    compute();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(compute);
      ro.observe(el);
    }
    return () => { if (ro) ro.disconnect(); };
  }, [riderCount]);

  return (
    <div className="cycle-race-screen__speedos" ref={speedosRef}>
      {riderIds.map((id, idx) => {
        const live = riderLive[id] || {};
        return (
          <CycleSpeedometer
            key={id}
            rpm={live.rpm}
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
