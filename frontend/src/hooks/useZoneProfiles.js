import React from 'react';
import { useFitnessContext } from '../context/FitnessContext.jsx';

const cloneSequence = (sequence) => (Array.isArray(sequence)
  ? sequence.map((zone) => ({ ...zone }))
  : null);

const cloneProfile = (profile) => ({
  ...profile,
  zoneConfig: Array.isArray(profile?.zoneConfig)
    ? profile.zoneConfig.map((zone) => ({ ...zone }))
    : [],
  zoneSequence: Array.isArray(profile?.zoneSequence)
    ? profile.zoneSequence.map((zone) => ({ ...zone }))
    : [],
  zoneSnapshot: profile?.zoneSnapshot
    ? {
        ...profile.zoneSnapshot,
        zoneSequence: cloneSequence(profile.zoneSnapshot.zoneSequence)
      }
    : null
});

export const useZoneProfiles = () => {
  const { zoneProfiles = [] } = useFitnessContext();
  return React.useMemo(() => zoneProfiles.map(cloneProfile), [zoneProfiles]);
};
