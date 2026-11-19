// Registry refusals carry the full list of routines affected by a rename or retirement.
import { daylightApiResponse } from '../../../../../frontend/src/lib/api.mjs';

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

async function call(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await daylightApiResponse(path, { method, data: body, signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new HouseApiError(`Network error: ${error?.message ?? 'request failed'}`, { transient: true });
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
  }
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
  startedByAll: ({ signal } = {}) => call(media('started-by'), { signal }),
  startedBy: (id, { signal } = {}) => call(`${screen(id)}/started-by`, { signal }),
  routineHistory: ({ limit = 50 } = {}) => call(media(`routines/history?limit=${limit}`)),
  routineFlags: () => call(media('routines/flags')),
  startStatus: (deviceId) => call(`api/v1/device/${encodeURIComponent(deviceId)}/start-status`),
  screenOff: (deviceId) => call(`api/v1/device/${encodeURIComponent(deviceId)}/off`),
};

export default houseApi;
