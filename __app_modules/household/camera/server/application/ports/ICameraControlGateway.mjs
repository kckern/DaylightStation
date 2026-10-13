/**
 * ICameraControlGateway Port — camera-associated device controls
 * @module applications/camera/ports
 */

export function isCameraControlGateway(obj) {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.listControls === 'function' &&
    typeof obj.executeControl === 'function'
  );
}

export function assertCameraControlGateway(obj, context = 'CameraControlGateway') {
  if (!isCameraControlGateway(obj)) {
    throw new Error(`${context} must implement ICameraControlGateway (listControls, executeControl)`);
  }
}

export function createNoOpCameraControlGateway() {
  return {
    listControls: async () => [],
    executeControl: async () => ({ ok: false, error: 'Controls not configured' }),
  };
}
