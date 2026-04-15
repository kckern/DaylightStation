import { assertCameraGateway } from './ports/ICameraGateway.mjs';
import { assertStreamAdapter } from './ports/IStreamAdapter.mjs';

export class CameraService {
  #gateway;
  #streamAdapter;
  #logger;

  constructor({ gateway, streamAdapter, logger = console }) {
    assertCameraGateway(gateway, 'CameraService.gateway');
    assertStreamAdapter(streamAdapter, 'CameraService.streamAdapter');
    this.#gateway = gateway;
    this.#streamAdapter = streamAdapter;
    this.#logger = logger;
  }

  listCameras() { return this.#gateway.listCameras(); }
  hasCamera(cameraId) { return this.#gateway.getCamera(cameraId) !== null; }
  async getSnapshot(cameraId) { return this.#gateway.fetchSnapshot(cameraId); }

  async startStream(cameraId) {
    const rtspUrl = this.#gateway.getStreamUrl(cameraId, 'sub');
    if (!rtspUrl) throw new Error(`No stream URL for camera: ${cameraId}`);
    return this.#streamAdapter.ensureStream(cameraId, rtspUrl);
  }

  touchStream(cameraId) { this.#streamAdapter.touch(cameraId); }
  stopStream(cameraId) { this.#streamAdapter.stop(cameraId); }
  isStreamActive(cameraId) { return this.#streamAdapter.isActive(cameraId); }
  stopAllStreams() { this.#streamAdapter.stopAll(); }
}
