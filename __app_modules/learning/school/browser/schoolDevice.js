/**
 * Which device is this school surface running on? Set once where the Portal
 * screen mounts (SchoolApp, from `deviceIdFor(screenId)`); every school API
 * client merges `schoolDeviceHeaders(...)` into its request headers so the
 * server can tell the study-room Portal from other screens running the same
 * browser module. No device id, no header.
 */
export const DEVICE_HEADER = 'X-Daylight-Device';

let deviceId = null;

export function setSchoolDeviceId(id) {
  deviceId = id ? String(id) : null;
}

export function getSchoolDeviceId() {
  return deviceId;
}

/** `headers` plus the device header when this screen has a device id. */
export function schoolDeviceHeaders(headers = {}) {
  return deviceId ? { ...headers, [DEVICE_HEADER]: deviceId } : headers;
}
