/**
 * CadenceCard - Realtime card for RPM devices (bikes, ab roller, etc.)
 * 
 * Shows: equipment icon, name, RPM
 */

import React from 'react';
import { BaseRealtimeCard, StatsRow } from './BaseRealtimeCard.jsx';
import { DaylightMediaPath } from '../../../../lib/api.mjs';

export function CadenceCard({
  device,
  deviceName,
  equipmentId,
  layoutMode = 'horizontal',
  zoneClass = '',
  isInactive = false,
  isCountdownActive = false,
  countdownWidth = 0,
}) {
  // Format cadence value
  const cadence = device.cadence;
  const cadenceValue = Number.isFinite(cadence) && cadence > 0
    ? `${Math.round(cadence)}`
    : '--';

  return (
    <BaseRealtimeCard
      device={device}
      deviceName={deviceName}
      className="cadence"
      layoutMode={layoutMode}
      zoneClass={zoneClass}
      isInactive={isInactive}
      isCountdownActive={isCountdownActive}
      countdownWidth={countdownWidth}
      imageSrc={DaylightMediaPath(`/media/img/equipment/${equipmentId}`)}
      imageAlt={`${deviceName} equipment`}
      imageFallback={DaylightMediaPath('/media/img/equipment/equipment')}
      isClickable={false}
    >
      <StatsRow
        icon="⚙️"
        value={cadenceValue}
        unit="RPM"
      />
    </BaseRealtimeCard>
  );
}

export default CadenceCard;
