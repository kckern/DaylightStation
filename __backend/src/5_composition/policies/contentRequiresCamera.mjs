/**
 * contentRequiresCamera — decide whether the given trigger query needs the
 * Shield TV camera to be available.
 *
 * Default is "no camera" so we only pay the FKB camera-availability check
 * (~4s per cold trigger) on flows that genuinely need it. Add a query shape
 * here (with a corresponding test) when a new camera-using flow appears.
 *
 * @module applications/devices/services
 */

const CAMERA_APPS = new Set(['webcam']);

/**
 * @param {Object} [query] - The trigger query (action verb → target value).
 * @returns {boolean}
 */
export function contentRequiresCamera(query = {}) {
  if (typeof query.open === 'string' && query.open.startsWith('videocall/')) {
    return true;
  }
  if (typeof query.app === 'string' && CAMERA_APPS.has(query.app)) {
    return true;
  }
  // play / queue / list / display / read / launch / random / playlist
  // → none currently need the camera.
  return false;
}

export default contentRequiresCamera;
