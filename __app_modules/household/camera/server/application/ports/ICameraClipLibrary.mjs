/**
 * ICameraClipLibrary Port — recorded camera clips for a day, and one clip's bytes.
 * @module applications/camera/ports
 *
 * listClips({cameraId, day}) → Promise<Array<{start: ISO, end: ISO, name, labels: string[]}>>
 *   ascending by start; never rejects because the camera is unreachable (→ []).
 * openClip({cameraId, name}) → Promise<resource> — an opaque local-file resource
 *   (`#system/http/streamFile.mjs`); rejects with a ValidationError for a name
 *   that is not a camera recording, and with a plain Error when the fetch fails.
 */
export class ICameraClipLibrary {
  async listClips(_args) { throw new Error('listClips must be implemented'); }
  async openClip(_args) { throw new Error('openClip must be implemented'); }
}

export function isCameraClipLibrary(obj) {
  return obj != null
    && typeof obj.listClips === 'function'
    && typeof obj.openClip === 'function';
}

export function assertCameraClipLibrary(obj, context = 'CameraClipLibrary') {
  if (!isCameraClipLibrary(obj)) {
    throw new Error(`${context} must implement ICameraClipLibrary (listClips, openClip)`);
  }
}

export default ICameraClipLibrary;
