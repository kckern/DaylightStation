// frontend/src/modules/Media/house/houseApi.js
// The house contracts (tech doc §2.5 screens, §2.6 routines, §2.7 started
// by, §4.10 start status) as plain calls. Not DaylightAPI: a 409 from the
// screen registry carries what the person must see next (`suggestion`,
// `heldBy`, the `routines` a rename or retire touches), and DaylightAPI
// truncates error bodies to 300 characters inside a message string. This
// keeps the whole body on the error.
import getDeviceId from '../../../lib/deviceIdentity.js';

export class HouseApiError extends Error {
  constructor(message, { status = null, code = null, details = {}, transient = false } = {}) {
    super(message);
    this.name = 'HouseApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.transient = transient;
  }
}

/** A fleet device id ("livingroom-tv") as its registry screen id. */
export function screenIdFor(deviceId) {
  if (typeof deviceId !== 'string' || !deviceId) return null;
  if (/^(fleet|browser|screen):/.test(deviceId)) return deviceId;
  return `fleet:${deviceId}`;
}

/** The fleet device id a registry screen id renders as on the house view. */
export function deviceIdForScreen(screenId) {
  if (typeof screenId !== 'string') return null;
  return screenId.startsWith('fleet:') ? screenId.slice('fleet:'.length) : screenId;
}

function headers() {
  const out = { 'Content-Type': 'application/json' };
  try {
    const token = globalThis.localStorage?.getItem?.('ds_token');
    if (token) out.Authorization = `Bearer ${token}`;
  } catch { /* storage refused */ }
  try { out['X-Daylight-Device'] = getDeviceId(); } catch { /* no window */ }
  return out;
}

async function call(path, { method = 'GET', body } = {}) {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  let response;
  try {
    response = await fetch(`${base}/${path}`, {
      method,
      headers: headers(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    throw new HouseApiError(`Network error: ${error?.message ?? 'request failed'}`, { transient: true });
  }
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) {
    const { error, code, ...details } = payload && typeof payload === 'object' ? payload : {};
    throw new HouseApiError(error || `HTTP ${response.status}`, {
      status: response.status,
      code: code ?? null,
      details,
      transient: response.status >= 500 || response.status === 0,
    });
  }
  return payload;
}

const media = (path) => `api/v1/media/${path}`;
const screen = (id) => media(`screens/${encodeURIComponent(id)}`);

export const houseApi = {
  listScreens: () => call(media('screens')),
  announceScreen: ({ id, name, room, playing, previousId } = {}) => call(media('screens/announce'), {
    method: 'POST',
    body: { id, ...(name ? { name } : {}), ...(room ? { room } : {}), ...(playing ? { playing: true } : {}),
      ...(previousId ? { previousId } : {}) },
  }),
  getScreen: (id) => call(screen(id)),
  renameScreen: (id, { name, onCollision, confirm } = {}) => call(screen(id), {
    method: 'PATCH',
    body: { name, ...(onCollision ? { onCollision } : {}), ...(confirm ? { confirm: true } : {}) },
  }),
  setScreenRoom: (id, room) => call(screen(id), { method: 'PATCH', body: { room: room ? room : null } }),
  setRoomNeighbours: (room, neighbours = []) => call(media('screens/rooms/adjacency'), { method: 'PUT', body: { room, neighbours } }),
  addScreen: ({ name, room } = {}) => call(media('screens'), { method: 'POST', body: { name, ...(room ? { room } : {}) } }),
  mergeScreen: (id, { into, confirm } = {}) => call(`${screen(id)}/merge`, {
    method: 'POST', body: { into, ...(confirm ? { confirm: true } : {}) },
  }),
  unmergeScreen: (id) => call(`${screen(id)}/unmerge`, { method: 'POST', body: {} }),
  retireScreen: (id, { confirm } = {}) => call(`${screen(id)}/retire`, {
    method: 'POST', body: confirm ? { confirm: true } : {},
  }),
  restoreScreen: (id) => call(`${screen(id)}/restore`, { method: 'POST', body: {} }),
  screenRoutines: (id) => call(`${screen(id)}/routines`),
  startedByAll: () => call(media('started-by')),
  startedBy: (id) => call(`${screen(id)}/started-by`),
  routineHistory: ({ limit = 50 } = {}) => call(media(`routines/history?limit=${limit}`)),
  routineFlags: () => call(media('routines/flags')),
  startStatus: (deviceId) => call(`api/v1/device/${encodeURIComponent(deviceId)}/start-status`),
  screenOff: (deviceId) => call(`api/v1/device/${encodeURIComponent(deviceId)}/off`),
};

export default houseApi;
