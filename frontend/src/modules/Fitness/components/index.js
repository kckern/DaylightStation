/**
 * @deprecated This folder is deprecated. Import from Fitness/shared instead.
 * 
 * Migration guide:
 * 
 * OLD: import CircularUserAvatar from '../components/CircularUserAvatar';
 * NEW: import { UserAvatar } from '../shared';
 * 
 * OLD: import RpmDeviceAvatar from '../components/RpmDeviceAvatar';
 * NEW: import { DeviceAvatar } from '../shared';
 * 
 * OLD: import { webcamFilters } from '../components/webcamFilters';
 * NEW: import { webcamFilters } from '../shared/utils/webcamFilters';
 * 
 * OLD: import FitnessWebcam from '../components/FitnessWebcam';
 * NEW: import { WebcamView } from '../shared';
 * 
 * These re-exports are provided for backward compatibility.
 * Please update your imports to use the new paths.
 */

// Re-export legacy components for backward compatibility
export { default as CircularUserAvatar } from './CircularUserAvatar';
export { default as RpmDeviceAvatar } from './RpmDeviceAvatar';
export { default as FitnessWebcam } from './FitnessWebcam';
export { default as FitnessWebcamProvider } from './FitnessWebcamProvider';

// Re-export hooks
export { default as useMediaAmplifier } from './useMediaAmplifier';
export { default as useMediaDevices } from './useMediaDevices';
export { default as useWebcamSnapshots } from './useWebcamSnapshots';
export { default as useWebcamStream } from './useWebcamStream';

// Re-export utilities
export * from './webcamFilters';
