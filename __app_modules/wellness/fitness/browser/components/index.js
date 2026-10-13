/**
 * @deprecated This folder is deprecated. Import from Fitness/shared instead.
 * 
 * Migration guide:
 * 
 * OLD: import CircularUserAvatar from './CircularUserAvatar';
 * NEW: import { UserAvatar } from '../shared';
 * 
 * OLD: import RpmDeviceAvatar from './RpmDeviceAvatar';
 * NEW: import { DeviceAvatar } from '../shared';
 * 
 * OLD: import { webcamFilters } from './webcamFilters';
 * NEW: import { webcamFilters } from '../shared/utils/webcamFilters';
 * 
 * OLD: import FitnessWebcam from './FitnessWebcam';
 * NEW: import { WebcamView } from '../shared';
 * 
 * These re-exports are provided for backward compatibility.
 * Please update your imports to use the new paths.
 */

// Re-export legacy components for backward compatibility
export { default as CircularUserAvatar } from "./CircularUserAvatar.jsx";
export { default as RpmDeviceAvatar } from "./RpmDeviceAvatar.jsx";
export { default as FitnessWebcam } from "./FitnessWebcam.jsx";
export { default as FitnessWebcamProvider } from "./FitnessWebcamProvider.jsx";

// Re-export hooks
export { default as useMediaAmplifier } from "./useMediaAmplifier.js";
export { default as useMediaDevices } from "./useMediaDevices.js";
export { default as useWebcamSnapshots } from "./useWebcamSnapshots.js";
export { default as useWebcamStream } from "./useWebcamStream.js";

// Re-export utilities
export * from "./webcamFilters.js";
