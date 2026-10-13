// frontend/src/modules/Media/session/playOrigin.js
// Who started this playback, as `POST /api/v1/play/log` takes it (tech doc
// §2.4: `{kind: "device"|"routine", id, name}`). Only an origin OTHER than a
// person at this device is reported: the session's default origin is this
// browser itself, which the ledger already reads from a null origin.

/** @returns {{kind: string, id?: string, name?: string}|null} */
export function playLogOrigin(origin, clientId) {
  if (!origin || typeof origin !== 'object') return null;
  if (origin.kind === 'routine' && (origin.id || origin.name)) {
    return { kind: 'routine', ...(origin.id ? { id: origin.id } : {}), ...(origin.name ? { name: origin.name } : {}) };
  }
  if (origin.kind === 'device' && typeof origin.id === 'string' && origin.id) {
    if (clientId && origin.id === `browser:${clientId}`) return null;
    return { kind: 'device', id: origin.id, ...(origin.name ? { name: origin.name } : {}) };
  }
  return null;
}

export default playLogOrigin;
