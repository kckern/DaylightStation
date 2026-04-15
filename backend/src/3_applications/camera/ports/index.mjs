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

export {
  isCameraStateGateway,
  assertCameraStateGateway,
  createNoOpCameraStateGateway
} from './ICameraStateGateway.mjs';

export {
  isCameraControlGateway,
  assertCameraControlGateway,
  createNoOpCameraControlGateway
} from './ICameraControlGateway.mjs';
