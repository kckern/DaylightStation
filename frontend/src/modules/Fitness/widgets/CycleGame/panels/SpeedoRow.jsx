import React from 'react';
import PropTypes from 'prop-types';
import CycleSpeedometer from '../CycleSpeedometer.jsx';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import { gaugeRowSize } from '@/modules/Fitness/lib/cycleGame/layoutSizing.js';

const SPEEDO_GAP = 28; // keep in sync with .cycle-race-screen__speedos gap

/**
 * Bottom row of CycleSpeedometers — one gauge per rider on a single line. The
 * gauge size is computed PURELY from the zone box the layout measured
 * (`zoneBox`), so there's no self-measuring ResizeObserver loop. Falls back to a
 * reasonable size before the first measurement.
 */
export default function SpeedoRow({ riderIds, riders, riderLive, cadenceBands, zoneBox, maxGauge = 280, minGauge = 96 }) {
  const speedoSize = gaugeRowSize({
    zoneW: zoneBox?.width || 0,
    zoneH: zoneBox?.height || 0,
    count: riderIds.length,
    gap: SPEEDO_GAP,
    max: maxGauge,
    min: minGauge
  });

  return (
    <div className="cycle-race-screen__speedos">
      {riderIds.map((id, idx) => {
        const live = riderLive[id] || {};
        return (
          <CycleSpeedometer
            key={id}
            rpm={live.rpm}
            maxRpm={live.maxRpm}
            speedKmh={live.speedKmh}
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
            riderColor={LINE_COLORS[idx % LINE_COLORS.length]}
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
  cadenceBands: PropTypes.array,
  zoneBox: PropTypes.shape({ width: PropTypes.number, height: PropTypes.number }),
  maxGauge: PropTypes.number,
  minGauge: PropTypes.number
};
