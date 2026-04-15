/**
 * Camera Capability Ports
 * @module applications/camera/ports
 */

export {
  isCameraGateway,
  assertCameraGateway,
  createNoOpCameraGateway
} from './ICameraGateway.mjs';

export {
  isStreamAdapter,
  assertStreamAdapter,
  createNoOpStreamAdapter
} from './IStreamAdapter.mjs';
