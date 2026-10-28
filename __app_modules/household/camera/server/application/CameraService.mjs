import { assertCameraGateway } from "./ports/ICameraGateway.mjs";
import { assertStreamAdapter } from "./ports/IStreamAdapter.mjs";
import { assertCameraStateGateway } from "./ports/ICameraStateGateway.mjs";
import { assertCameraControlGateway } from "./ports/ICameraControlGateway.mjs";
import { assertCameraClipLibrary } from "./ports/ICameraClipLibrary.mjs";
import { InvalidInputError, OperationUnavailableError } from "#apps/common/errors/SemanticErrors.mjs";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export class CameraService {
  #gateway;
  #streamAdapter;
  #stateGateway;
  #controlGateway;
  #clipLibrary;
  #logger;

  constructor({ gateway, streamAdapter, stateGateway, controlGateway, clipLibrary, logger = console }) {
    assertCameraGateway(gateway, 'CameraService.gateway');
    assertStreamAdapter(streamAdapter, 'CameraService.streamAdapter');
    if (stateGateway) assertCameraStateGateway(stateGateway, 'CameraService.stateGateway');
    if (controlGateway) assertCameraControlGateway(controlGateway, 'CameraService.controlGateway');
    if (clipLibrary) assertCameraClipLibrary(clipLibrary, 'CameraService.clipLibrary');
    this.#gateway = gateway;
    this.#streamAdapter = streamAdapter;
    this.#stateGateway = stateGateway || null;
    this.#controlGateway = controlGateway || null;
    this.#clipLibrary = clipLibrary || null;
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

  async getLivePlaylist(cameraId) {
    const rtspUrl = this.#gateway.getStreamUrl(cameraId, 'sub');
    if (!rtspUrl) throw new Error(`No stream URL for camera: ${cameraId}`);
    return this.#streamAdapter.readPlaylist(cameraId, rtspUrl);
  }

  async getLiveSegment(cameraId, segment) {
    const rtspUrl = this.#gateway.getStreamUrl(cameraId, 'sub');
    if (!rtspUrl) return null;
    return this.#streamAdapter.readSegment(cameraId, rtspUrl, segment);
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

  /** Recorded clips for one camera and day (YYYY-MM-DD), ascending by start. */
  async listClips(cameraId, day) {
    if (!this.#clipLibrary) throw new OperationUnavailableError('Camera clips not configured', { code: 'CAMERA_CLIPS_UNAVAILABLE' });
    if (typeof day !== 'string' || !DAY_RE.test(day)) {
      throw new InvalidInputError('day must be YYYY-MM-DD', { code: 'INVALID_DAY', details: { field: 'day', value: day } });
    }
    return this.#clipLibrary.listClips({ cameraId, day });
  }

  /** One recorded clip as an opaque file resource (fetched from the camera on first use). */
  async getClip(cameraId, name) {
    if (!this.#clipLibrary) throw new OperationUnavailableError('Camera clips not configured', { code: 'CAMERA_CLIPS_UNAVAILABLE' });
    return this.#clipLibrary.openClip({ cameraId, name });
  }
}
