import { assertCameraGateway } from './ports/ICameraGateway.mjs';
import { assertStreamAdapter } from './ports/IStreamAdapter.mjs';
import { assertCameraStateGateway } from './ports/ICameraStateGateway.mjs';
import { assertCameraControlGateway } from './ports/ICameraControlGateway.mjs';

export class CameraService {
  #gateway;
  #streamAdapter;
  #stateGateway;
  #controlGateway;
  #logger;

  constructor({ gateway, streamAdapter, stateGateway, controlGateway, logger = console }) {
    assertCameraGateway(gateway, 'CameraService.gateway');
    assertStreamAdapter(streamAdapter, 'CameraService.streamAdapter');
    if (stateGateway) assertCameraStateGateway(stateGateway, 'CameraService.stateGateway');
    if (controlGateway) assertCameraControlGateway(controlGateway, 'CameraService.controlGateway');
    this.#gateway = gateway;
    this.#streamAdapter = streamAdapter;
    this.#stateGateway = stateGateway || null;
    this.#controlGateway = controlGateway || null;
    this.#logger = logger;
  }

  listCameras() { return this.#gateway.listCameras(); }
  hasCamera(cameraId) { return this.#gateway.getCamera(cameraId) !== null; }
  async getSnapshot(cameraId, options) { return this.#gateway.fetchSnapshot(cameraId, options); }

  async startStream(cameraId) {
    const rtspUrl = this.#gateway.getStreamUrl(cameraId, 'sub');
    if (!rtspUrl) throw new Error(`No stream URL for camera: ${cameraId}`);
    return this.#streamAdapter.ensureStream(cameraId, rtspUrl);
  }

  touchStream(cameraId) { this.#streamAdapter.touch(cameraId); }
  stopStream(cameraId) { this.#streamAdapter.stop(cameraId); }
  isStreamActive(cameraId) { return this.#streamAdapter.isActive(cameraId); }
  stopAllStreams() { this.#streamAdapter.stopAll(); }

  async getDetectionState(cameraId) {
    if (!this.#stateGateway) return { detections: [], motion: false };
    return this.#stateGateway.getDetectionState(cameraId);
  }

  async listControls(cameraId) {
    if (!this.#controlGateway) return [];
    return this.#controlGateway.listControls(cameraId);
  }

  async executeControl(cameraId, controlId, action) {
    if (!this.#controlGateway) return { ok: false, error: 'Controls not configured' };
    return this.#controlGateway.executeControl(cameraId, controlId, action);
  }
}
