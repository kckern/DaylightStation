/**
 * VibrationCard - Realtime card for vibration-based equipment
 *
 * Shows: VibrationActivityAvatar with live timer, activity bar, and intensity ring.
 * Used for: Punching bag, Step platform, Pull-up bar
 *
 * Follows the RpmDeviceCard pattern: renders its own card structure with a
 * custom avatar component instead of delegating to BaseRealtimeCard.
 */

import React from 'react';
import PropTypes from 'prop-types';
import VibrationActivityAvatar from './VibrationActivityAvatar.jsx';
import { DaylightMediaPath } from '@/lib/api.mjs';
import './VibrationCard.scss';

// Equipment type to icon mapping
const EQUIPMENT_ICONS = {
  punching_bag: '\u{1F94A}',
  step_platform: '\u{1FA9C}',
  pull_up_bar: '\u{1F4AA}',
  default: '\u{1F4F3}'
};

// Per-equipment-type avatar feature config
const EQUIPMENT_AVATAR_CONFIG = {
  punching_bag:  { showIntensityRing: true,  showActivityBar: true,  showTimer: true },
  step_platform: { showIntensityRing: false, showActivityBar: false, showTimer: true },
  // All others default to timer-only
};

const DEFAULT_AVATAR_CONFIG = { showIntensityRing: false, showActivityBar: false, showTimer: true };

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
  trackerSnapshot = {},
  layoutMode = 'horizontal',
  zoneClass = '',
  isInactive = false,
  isCountdownActive = false,
  countdownWidth = 0,
}) {
  const intensity = device.intensity ?? 0;
  const thresholds = device.thresholds || {};
  const isActive = device.vibration === true;

  const intensityLabel = isActive ? getIntensityLabel(intensity, thresholds) : 'Idle';
  const displayValue = isActive ? `${intensityLabel}` : '--';

  const icon = EQUIPMENT_ICONS[equipmentType] || EQUIPMENT_ICONS.default;
  const avatarConfig = EQUIPMENT_AVATAR_CONFIG[equipmentType] || DEFAULT_AVATAR_CONFIG;

  const cardClasses = [
    'vibration-device-card',
    'fitness-device',
    layoutMode === 'vert' ? 'card-vertical' : 'card-horizontal',
    equipmentType || '',
    isInactive || !isActive ? 'inactive' : 'active',
    isCountdownActive ? 'countdown-active' : '',
    zoneClass
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cardClasses}
      title={`${deviceName} - ${displayValue}`}
    >
      {isCountdownActive && (
        <div className="device-timeout-bar" aria-label="Removal countdown" role="presentation">
          <div
            className="device-timeout-fill"
            style={{ width: `${Math.max(0, Math.min(100, countdownWidth))}%` }}
          />
        </div>
      )}

      <div className="vibration-avatar-wrapper">
        <VibrationActivityAvatar
          snapshot={trackerSnapshot}
          avatarSrc={DaylightMediaPath(`/static/img/equipment/${equipmentId}`)}
          avatarAlt={`${deviceName} equipment`}
          fallbackSrc={DaylightMediaPath('/static/img/equipment/equipment')}
          showIntensityRing={avatarConfig.showIntensityRing}
          showActivityBar={avatarConfig.showActivityBar}
          showTimer={avatarConfig.showTimer}
          size={64}
        />
      </div>

      <div className="device-info">
        <div className="device-name">{deviceName}</div>
        <div className="device-stats">
          <span className="device-icon">{icon}</span>
          <span className="device-value">{displayValue}</span>
          <span className="device-unit">{isActive ? 'active' : ''}</span>
        </div>
      </div>
    </div>
  );
}

VibrationCard.propTypes = {
  device: PropTypes.object.isRequired,
  deviceName: PropTypes.string.isRequired,
  equipmentId: PropTypes.string.isRequired,
  equipmentType: PropTypes.string,
  trackerSnapshot: PropTypes.object,
  layoutMode: PropTypes.oneOf(['horizontal', 'vert']),
  zoneClass: PropTypes.string,
  isInactive: PropTypes.bool,
  isCountdownActive: PropTypes.bool,
  countdownWidth: PropTypes.number,
};

export default VibrationCard;
