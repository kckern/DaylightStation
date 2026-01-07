/**
 * VibrationCard - Realtime card for vibration-based equipment
 * 
 * Shows: equipment icon, name, intensity level
 * Used for: Punching bag, Step platform, Pull-up bar
 */

import React from 'react';
import { BaseRealtimeCard, StatsRow } from './BaseRealtimeCard.jsx';
import { DaylightMediaPath } from '../../../../lib/api.mjs';

// Equipment type to icon mapping
const EQUIPMENT_ICONS = {
  punching_bag: '🥊',
  step_platform: '🪜',
  pull_up_bar: '💪',
  default: '📳'
};

/**
 * Get intensity label based on thresholds
 */
function getIntensityLabel(intensity, thresholds = {}) {
  const { low = 5, medium = 15, high = 30 } = thresholds;
  if (intensity >= high) return 'High';
  if (intensity >= medium) return 'Med';
  if (intensity >= low) return 'Low';
  return 'Idle';
}

export function VibrationCard({
  device,
  deviceName,
  equipmentId,
  equipmentType,
  layoutMode = 'horizontal',
  zoneClass = '',
  isInactive = false,
  isCountdownActive = false,
  countdownWidth = 0,
}) {
  // Get intensity and thresholds
  const intensity = device.intensity ?? 0;
  const thresholds = device.thresholds || {};
  const isActive = device.vibration === true;
  
  // Format display value
  const intensityLabel = isActive ? getIntensityLabel(intensity, thresholds) : 'Idle';
  const displayValue = isActive ? `${intensityLabel}` : '--';
  
  // Get icon for equipment type
  const icon = EQUIPMENT_ICONS[equipmentType] || EQUIPMENT_ICONS.default;

  return (
    <BaseRealtimeCard
      device={device}
      deviceName={deviceName}
      className={`vibration ${equipmentType || ''}`}
      layoutMode={layoutMode}
      zoneClass={zoneClass}
      isInactive={isInactive || !isActive}
      isCountdownActive={isCountdownActive}
      countdownWidth={countdownWidth}
      imageSrc={DaylightMediaPath(`/media/img/equipment/${equipmentId}`)}
      imageAlt={`${deviceName} equipment`}
      imageFallback={DaylightMediaPath('/media/img/equipment/equipment')}
      isClickable={false}
    >
      <StatsRow
        icon={icon}
        value={displayValue}
        unit={isActive ? 'active' : ''}
      />
    </BaseRealtimeCard>
  );
}

export default VibrationCard;
