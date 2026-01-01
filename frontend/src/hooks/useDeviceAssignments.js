import React from 'react';
import { useFitnessContext } from '../context/FitnessContext.jsx';

const cloneMetadata = (metadata) => {
  if (metadata && typeof metadata === 'object') {
    return { ...metadata };
  }
  return {};
};

export const useDeviceAssignments = () => {
  const {
    deviceAssignments = [],
    getDisplayLabel,
    participantsByDevice
  } = useFitnessContext();

  return React.useMemo(() => {
    return deviceAssignments.map((entry) => {
      const metadata = cloneMetadata(entry.metadata);
      const occupantName = entry.occupantName || metadata.name || 'Guest';
      const participant = participantsByDevice instanceof Map
        ? participantsByDevice.get(String(entry.deviceId))
        : null;
      const displayLabel = typeof getDisplayLabel === 'function'
        ? getDisplayLabel(occupantName, { preferGroupLabel: false })
        : occupantName;
      // Use explicit ID from entry or metadata
      const occupantId = entry.occupantId || metadata.profileId || entry.occupantSlug;
      return {
        deviceId: entry.deviceId,
        occupantId,
        occupantName,
        occupantLabel: displayLabel,
        occupantType: entry.occupantType || 'guest',
        displacedUserId: entry.displacedUserId || entry.displacedSlug || null,
        updatedAt: entry.updatedAt || metadata.updatedAt || null,
        metadata,
        participantSnapshot: participant ? { ...participant } : null
      };
    });
  }, [deviceAssignments, getDisplayLabel, participantsByDevice]);
};
