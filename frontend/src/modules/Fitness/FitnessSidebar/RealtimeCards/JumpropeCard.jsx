/**
 * JumpropeCard - Realtime card for BLE jump rope
 * 
 * Shows: animated jumprope avatar, name, total jumps, RPM
 */

import React from 'react';
import JumpropeAvatar from './JumpropeAvatar.jsx';
import './JumpropeCard.scss';

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

  const cardClasses = [
    'jumprope-card',
    'fitness-device',
    layoutMode === 'vert' ? 'card-vertical' : 'card-horizontal',
    isInactive ? 'inactive' : 'active',
    isCountdownActive ? 'countdown-active' : '',
    zoneClass
  ].filter(Boolean).join(' ');

  return (
    <div 
      className={cardClasses}
      title={`${deviceName} - ${jumpsValue} jumps ${rpmValue} rpm`}
    >
      {/* Timeout countdown bar */}
      {isCountdownActive && (
        <div className="device-timeout-bar" aria-label="Removal countdown" role="presentation">
          <div
            className="device-timeout-fill"
            style={{ width: `${Math.max(0, Math.min(100, countdownWidth))}%` }}
          />
        </div>
      )}
      
      {/* Animated jumprope avatar */}
      <JumpropeAvatar
        equipmentId={equipmentId}
        equipmentName={deviceName}
        rpm={rpm}
        jumps={jumps}
        rpmThresholds={rpmThresholds}
        size={64}
      />
      
      {/* Info section */}
      <div className="device-info">
        <div className="device-name">{deviceName}</div>
        <div className="device-stats">
          <span className="device-value">{jumpsValue}</span>
          <span className="device-unit">jumps</span>
          <span className="device-value">{rpmValue}</span>
          <span className="device-unit">rpm</span>
        </div>
      </div>
    </div>
  );
}

export default JumpropeCard;
