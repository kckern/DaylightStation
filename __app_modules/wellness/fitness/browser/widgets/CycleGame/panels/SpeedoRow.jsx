import React from 'react';
import PropTypes from 'prop-types';
import CycleSpeedometer from "../CycleSpeedometer.jsx";
import { LINE_COLORS } from "../../../lib/cycleGame/lineColors.js";
import { gaugeRowSize } from "../../../lib/cycleGame/layoutSizing.js";
import { FALLBACK_AVATAR } from "../home/constants.js";

const SPEEDO_GAP = 28; // keep in sync with .cycle-race-screen__speedos gap

/**
 * Bottom row of CycleSpeedometers — one gauge per rider on a single line
 * (the solo layout passes the live rider only, `ranked={false}`). The
 * gauge size is computed PURELY from the zone box the layout measured
 * (`zoneBox`), so there's no self-measuring ResizeObserver loop. Falls back to a
 * reasonable size before the first measurement.
 */
export default function SpeedoRow({ riderIds, riders, riderLive, cadenceBands, zoneBox, maxGauge = 280, minGauge = 96, ranked = true }) {
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
            riderId={id}
            rpm={live.rpm}
            maxRpm={live.maxRpm}
            speedKmh={live.speedKmh}
            cadenceBands={cadenceBands}
            distanceMeters={riders[id].cumulativeDistanceM}
            multiplier={live.multiplier}
            avatar={{
              name: riders[id].displayName,
              src: live.avatarSrc,
              fallbackSrc: FALLBACK_AVATAR,
              heartRate: live.heartRate,
              zoneId: live.zoneId,
              zoneColor: live.zoneColor || LINE_COLORS[idx % LINE_COLORS.length],
              progress: live.zoneProgress
            }}
            riderColor={LINE_COLORS[idx % LINE_COLORS.length]}
            isGhost={!!riders[id].isGhost}
            finished={!!live.finished}
            placement={ranked ? live.placement : null}
            isLeader={ranked && !!live.isLeader}
            sensorLost={!!live.sensorLost}
            parked={!!live.parked}
            noSensor={!!live.noSensor}
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
  minGauge: PropTypes.number,
  /** false in the solo layout: no placement on the finish overlay, no leader medal. */
  ranked: PropTypes.bool
};
