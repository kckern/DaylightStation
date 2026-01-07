/**
 * JumpropeCard - Realtime card for BLE jump rope
 * 
 * Shows: jumprope icon, name, total jumps @ current RPM, RPM progress bar
 */

import React from 'react';
import { BaseRealtimeCard, StatsRow } from './BaseRealtimeCard.jsx';
import { DaylightMediaPath } from '../../../../lib/api.mjs';

// RPM zone colors
const RPM_COLORS = {
  idle: '#666',      // gray - below min
  min: '#3b82f6',    // blue - min to med
  med: '#22c55e',    // green - med to high  
  high: '#f59e0b',   // orange - high to max
  max: '#ef4444'     // red - at/above max
};

/**
 * Get RPM zone color based on current RPM and thresholds
 */
function getRpmZoneColor(rpm, thresholds = {}) {
  const { min = 10, med = 50, high = 80, max = 120 } = thresholds;
  if (!Number.isFinite(rpm) || rpm < min) return RPM_COLORS.idle;
  if (rpm >= max) return RPM_COLORS.max;
  if (rpm >= high) return RPM_COLORS.high;
  if (rpm >= med) return RPM_COLORS.med;
  return RPM_COLORS.min;
}

export function JumpropeCard({
  device,
  deviceName,
  equipmentId,
  rpmThresholds = {},
  layoutMode = 'horizontal',
  zoneClass = '',
  isInactive = false,
  isCountdownActive = false,
  countdownWidth = 0,
}) {
  // Get jumps and RPM values
  const jumps = device.revolutionCount ?? null;
  const rpm = device.cadence ?? null;
  
  const jumpsValue = Number.isFinite(jumps) ? `${Math.round(jumps)}` : '--';
  const rpmValue = Number.isFinite(rpm) && rpm > 0 ? `${Math.round(rpm)}` : '--';

  // Calculate RPM progress (0-1 scale based on max threshold)
  const maxRpm = rpmThresholds.max || 120;
  const rpmProgress = Number.isFinite(rpm) && rpm > 0
    ? Math.min(1, rpm / maxRpm)
    : 0;
  
  // Get zone color for the progress bar
  const rpmColor = getRpmZoneColor(rpm, rpmThresholds);
  
  // Build progress bar
  const progressBar = (
    <div className="zone-progress-bar rpm-progress-bar" aria-label="RPM progress" role="presentation">
      <div
        className="zone-progress-fill"
        style={{ 
          width: `${Math.max(0, Math.min(100, Math.round(rpmProgress * 100)))}%`,
          backgroundColor: rpmColor
        }}
      />
    </div>
  );

  return (
    <BaseRealtimeCard
      device={device}
      deviceName={deviceName}
      className="jumprope"
      layoutMode={layoutMode}
      zoneClass={zoneClass}
      isInactive={isInactive}
      isCountdownActive={isCountdownActive}
      countdownWidth={countdownWidth}
      imageSrc={DaylightMediaPath(`/media/img/equipment/${equipmentId}`)}
      imageAlt={`${deviceName} equipment`}
      imageFallback={DaylightMediaPath('/media/img/equipment/equipment')}
      isClickable={false}
      progressBar={progressBar}
    >
      <div className="device-stats">
        <span className="device-value">{jumpsValue}</span>
        <span className="device-unit">jumps</span>
        <span className="device-value">{rpmValue}</span>
        <span className="device-unit">rpm</span>
      </div>
    </BaseRealtimeCard>
  );
}

export default JumpropeCard;
