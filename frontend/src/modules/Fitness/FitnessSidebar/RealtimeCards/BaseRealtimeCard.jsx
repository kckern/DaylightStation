/**
 * BaseRealtimeCard - Shared layout wrapper for all realtime fitness cards
 * 
 * Provides consistent structure for:
 * - Timeout/countdown bar
 * - Profile image container
 * - Info section (name, stats)
 * - Zone badge (optional)
 * - Progress bar (optional)
 */

import React from 'react';
import { DaylightMediaPath } from '../../../../lib/api.mjs';

/**
 * Format time ago string
 */
export const formatTimeAgo = (timestamp, labels = {}) => {
  if (!timestamp) return labels.TIME_NEVER || 'Never';
  const diffMs = Date.now() - timestamp;
  if (diffMs < 5000) return labels.TIME_JUST_NOW || 'Just now';
  if (diffMs < 60000) return `${Math.floor(diffMs / 1000)}${labels.TIME_SECONDS_SUFFIX || 's ago'}`;
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}${labels.TIME_MINUTES_SUFFIX || 'm ago'}`;
  return `${Math.floor(diffMs / 3600000)}${labels.TIME_HOURS_SUFFIX || 'h ago'}`;
};

/**
 * Base card component that wraps all realtime cards
 */
export function BaseRealtimeCard({
  // Core props
  device,
  deviceName,
  className = '',
  
  // Layout
  layoutMode = 'horizontal',
  zoneClass = '',
  isInactive = false,
  
  // Countdown
  isCountdownActive = false,
  countdownWidth = 0,
  
  // Image
  imageSrc,
  imageAlt,
  imageFallback,
  
  // Interaction
  onClick,
  isClickable = false,
  ariaLabel,
  
  // Children slots
  children, // Main content (stats)
  progressBar, // Optional progress bar
  zoneBadge, // Optional zone badge above card
}) {
  const cardClasses = [
    'fitness-device',
    isClickable ? 'clickable' : '',
    layoutMode === 'vert' ? 'card-vertical' : 'card-horizontal',
    className,
    isInactive ? 'inactive' : 'active',
    isCountdownActive ? 'countdown-active' : '',
    zoneClass
  ].filter(Boolean).join(' ');

  const handleKeyDown = isClickable ? (event) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      onClick?.();
    }
  } : undefined;

  return (
    <div className="device-wrapper">
      {/* Zone badge container */}
      {zoneBadge && (
        <div className={`device-zone-info ${zoneClass} ${layoutMode === 'vert' ? 'for-vert' : ''}`}>
          {zoneBadge}
        </div>
      )}
      
      {/* Main card */}
      <div
        className={cardClasses}
        title={`Device: ${deviceName} (${device.deviceId}) - ${formatTimeAgo(device.lastSeen)}`}
        role={isClickable ? 'button' : undefined}
        tabIndex={isClickable ? 0 : undefined}
        onClick={isClickable ? onClick : undefined}
        onKeyDown={handleKeyDown}
        aria-label={ariaLabel}
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
        
        {/* Profile image */}
        <div className={`user-profile-img-container ${zoneClass}`}>
          <img
            src={imageSrc}
            alt={imageAlt || `${deviceName} profile`}
            className={isClickable ? 'user-profile-img' : ''}
            onError={(e) => {
              if (e.currentTarget.dataset.fallback) {
                e.currentTarget.style.display = 'none';
                return;
              }
              e.currentTarget.dataset.fallback = '1';
              e.currentTarget.src = imageFallback;
            }}
          />
        </div>
        
        {/* Info section */}
        <div className="device-info">
          <div className="device-name">{deviceName}</div>
          {children}
        </div>
        
        {/* Optional progress bar */}
        {progressBar}
      </div>
    </div>
  );
}

/**
 * Stats row component for consistent stat display
 */
export function StatsRow({ icon, value, unit }) {
  return (
    <div className="device-stats">
      <span className="device-icon">{icon}</span>
      <span className="device-value">{value}</span>
      <span className="device-unit">{unit}</span>
    </div>
  );
}

export default BaseRealtimeCard;
