/**
 * PersonCard - Realtime card for heart rate monitors (people)
 * 
 * Shows: avatar, name, heart rate, zone badge, zone progress bar
 */

import React from 'react';
import { Badge } from '@mantine/core';
import { BaseRealtimeCard, StatsRow } from './BaseRealtimeCard.jsx';
import { DaylightMediaPath } from '../../../../lib/api.mjs';

// Heart icons by color
const HEART_ICONS = {
  red: '❤️',
  yellow: '💛',
  green: '💚',
  blue: '💙',
  watch: '⌚',
  default: '🤍'
};

/**
 * Pick contrasting text color for zone badge
 */
function pickTextColor(bgHex) {
  if (!bgHex || typeof bgHex !== 'string') return '#fff';
  const hex = bgHex.replace('#', '');
  if (hex.length !== 6) return '#fff';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#1a1a1a' : '#fff';
}

export function PersonCard({
  device,
  deviceName,
  profileId,
  heartRate,
  heartIcon,
  layoutMode = 'horizontal',
  zoneClass = '',
  isInactive = false,
  isCountdownActive = false,
  countdownWidth = 0,
  
  // Zone badge props
  showZoneBadge = false,
  zoneBadgeColor,
  zoneName,
  
  // Progress bar props
  showProgressBar = false,
  progressValue = 0,
  
  // Interaction
  onClick,
}) {
  // Format heart rate value - show blank for invalid/zero values
  const hrValue = Number.isFinite(heartRate) && heartRate > 0
    ? `${Math.round(heartRate)}`
    : '';

  // Build zone badge if needed
  const zoneBadge = showZoneBadge ? (() => {
    const bg = zoneBadgeColor || '#444';
    const text = pickTextColor(bg);
    return (
      <Badge
        variant="filled"
        size="xs"
        style={{
          backgroundColor: bg,
          color: text,
          border: `1px solid ${bg}`,
          textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}
        title={zoneName ? `Zone group: ${zoneName}` : 'No Zone'}
      >
        {zoneName || 'No Zone'}
      </Badge>
    );
  })() : null;

  // Build progress bar if needed
  const progressBar = showProgressBar ? (
    <div className="zone-progress-bar" aria-label="Zone progress" role="presentation">
      <div
        className="zone-progress-fill"
        style={{ width: `${Math.max(0, Math.min(100, Math.round(progressValue * 100)))}%` }}
      />
    </div>
  ) : null;

  return (
    <BaseRealtimeCard
      device={device}
      deviceName={deviceName}
      className="heart-rate"
      layoutMode={layoutMode}
      zoneClass={zoneClass}
      isInactive={isInactive}
      isCountdownActive={isCountdownActive}
      countdownWidth={countdownWidth}
      imageSrc={DaylightMediaPath(`/static/img/users/${profileId}`)}
      imageAlt={`${deviceName} profile`}
      imageFallback={DaylightMediaPath('/static/img/users/user')}
      onClick={onClick}
      isClickable={true}
      ariaLabel={`Reassign ${deviceName}`}
      zoneBadge={zoneBadge}
      progressBar={progressBar}
    >
      <StatsRow
        icon={heartIcon || HEART_ICONS.default}
        value={hrValue}
        unit="BPM"
      />
    </BaseRealtimeCard>
  );
}

export default PersonCard;
