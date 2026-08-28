// useVolumeStore.js — the volume-store accessor for VolumeProvider.jsx, split
// out so Fast Refresh can hot-reload files that only export components.
import { useContext } from 'react';
import { VolumeContext } from './VolumeProvider.jsx';

export const useVolumeStore = () => {
  const ctx = useContext(VolumeContext);
  if (!ctx) {
    throw new Error('useVolumeStore must be used within VolumeProvider');
  }
  return ctx;
};
