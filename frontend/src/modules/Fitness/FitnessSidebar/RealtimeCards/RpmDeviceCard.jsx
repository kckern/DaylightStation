/**
 * RpmDeviceCard - Unified realtime card for all RPM devices
 *
 * Handles both cycles (stationary_bike, ab_roller, cadence) and jumpropes
 * with configurable stats display and gauge-based avatar.
 */

import React from 'react';
import PropTypes from 'prop-types';
import RpmDeviceAvatar from './RpmDeviceAvatar.jsx';
import './RpmDeviceCard.scss';

const STALENESS_THRESHOLD_MS = 5000;

export function RpmDeviceCard({
  device,
  deviceName,
  equipmentId,
  rpmThresholds = {},
  deviceSubtype = 'cycle',
  showRevolutions = false,
  layoutMode = 'horizontal',
  zoneClass = '',
  isInactive = false,
  isCountdownActive = false,
  countdownWidth = 0,
  compactMode = false,
}) {
  const isStale = device.timestamp && (Date.now() - device.timestamp > STALENESS_THRESHOLD_MS);

  const rpm = device.cadence ?? 0;
  const revolutions = device.revolutionCount ?? null;

  const rpmValue = isStale ? '' : (Number.isFinite(rpm) && rpm > 0 ? `${Math.round(rpm)}` : '');
  const revsValue = Number.isFinite(revolutions) ? `${Math.round(revolutions)}` : '';

  const cardClasses = [
    'rpm-device-card',
    'fitness-device',
    layoutMode === 'vert' ? 'card-vertical' : 'card-horizontal',
    isInactive ? 'inactive' : 'active',
    isCountdownActive ? 'countdown-active' : '',
    isStale ? 'stale' : '',
    compactMode ? 'compact-mode' : '',
    zoneClass
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cardClasses}
      title={`${deviceName} - ${rpmValue} rpm${showRevolutions ? ` (${revsValue} total)` : ''}`}
    >
      {isCountdownActive && (
        <div className="device-timeout-bar" aria-label="Removal countdown" role="presentation">
          <div
            className="device-timeout-fill"
            style={{ width: `${Math.max(0, Math.min(100, countdownWidth))}%` }}
          />
        </div>
      )}

      <div className="rpm-avatar-wrapper">
        <RpmDeviceAvatar
          equipmentId={equipmentId}
          equipmentName={deviceName}
          rpm={rpm}
          revolutionCount={revolutions}
          rpmThresholds={rpmThresholds}
          deviceSubtype={deviceSubtype}
          size={64}
        />
        {compactMode && (
          <div className="rpm-value-overlay">
            <span className="rpm-value">{rpmValue}</span>
          </div>
        )}
      </div>

      {!compactMode && (
        <div className="device-info">
          <div className="device-name">{deviceName}</div>
          <div className="device-stats">
            <span className="device-value">{rpmValue}</span>
            <span className="device-unit">RPM</span>
            {showRevolutions && (
              <>
                <span className="device-value secondary">{revsValue}</span>
                <span className="device-unit secondary">total</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

RpmDeviceCard.propTypes = {
  device: PropTypes.object.isRequired,
  deviceName: PropTypes.string.isRequired,
  equipmentId: PropTypes.string.isRequired,
  rpmThresholds: PropTypes.shape({
    min: PropTypes.number,
    med: PropTypes.number,
    high: PropTypes.number,
    max: PropTypes.number
  }),
  deviceSubtype: PropTypes.oneOf(['cycle', 'jumprope']),
  showRevolutions: PropTypes.bool,
  layoutMode: PropTypes.oneOf(['horizontal', 'vert']),
  zoneClass: PropTypes.string,
  isInactive: PropTypes.bool,
  isCountdownActive: PropTypes.bool,
  countdownWidth: PropTypes.number,
  compactMode: PropTypes.bool
};

export default RpmDeviceCard;
