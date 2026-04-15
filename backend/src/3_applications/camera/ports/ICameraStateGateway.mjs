/**
 * ICameraStateGateway Port — real-time detection and motion state
 * @module applications/camera/ports
 */

export function isCameraStateGateway(obj) {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.getDetectionState === 'function'
  );
}

export function assertCameraStateGateway(obj, context = 'CameraStateGateway') {
  if (!isCameraStateGateway(obj)) {
    throw new Error(`${context} must implement ICameraStateGateway (getDetectionState)`);
  }
}

export function createNoOpCameraStateGateway() {
  return {
    getDetectionState: async () => ({ detections: [], motion: false }),
  };
}
