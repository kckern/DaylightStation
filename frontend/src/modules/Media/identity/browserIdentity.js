import { STORAGE_KEYS } from '../constants.js';

function fallbackUuid() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* fall through */ }
  return `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function defaultName(clientId) {
  return `Browser ${String(clientId).slice(0, 8)}`;
}

/** A name the app made up ("Browser 1a2b3c4d"), not one a person chose. */
export function isPlaceholderName(name) {
  return typeof name === 'string' && /^Browser [0-9a-zA-Z-]{1,8}$/.test(name.trim());
}

function persist(storage, identity) {
  storage?.setItem?.(STORAGE_KEYS.CLIENT_ID, identity.clientId);
  storage?.setItem?.(STORAGE_KEYS.DISPLAY_NAME, identity.name);
  storage?.setItem?.(STORAGE_KEYS.BROWSER_IDENTITY, JSON.stringify(identity));
  return identity;
}

export function createBrowserIdentity({
  storage = globalThis.localStorage,
  randomUuid = fallbackUuid,
  now = () => new Date(),
} = {}) {
  let stored = null;
  try { stored = JSON.parse(storage?.getItem?.(STORAGE_KEYS.BROWSER_IDENTITY) || 'null'); } catch { /* legacy recovery */ }
  if (stored?.clientId && stored?.name && stored?.connectedAt) {
    return persist(storage, {
      ...stored,
      deviceId: `browser:${stored.clientId}`,
    });
  }

  const clientId = clean(storage?.getItem?.(STORAGE_KEYS.CLIENT_ID)) || randomUuid();
  const identity = {
    clientId,
    deviceId: `browser:${clientId}`,
    name: clean(storage?.getItem?.(STORAGE_KEYS.DISPLAY_NAME)) || defaultName(clientId),
    connectedAt: now().toISOString(),
  };
  return persist(storage, identity);
}

export function renameBrowserIdentity(identity, {
  name,
  room,
  existingNames = [],
  storage = null,
} = {}) {
  const requested = clean(name) || defaultName(identity.clientId);
  const names = new Set(existingNames.map((candidate) => clean(candidate).toLocaleLowerCase()));
  let uniqueName = requested;
  if (names.has(uniqueName.toLocaleLowerCase())) {
    const suffix = identity.clientId.slice(0, 8);
    uniqueName = `${requested} (${suffix})`;
    let attempt = 2;
    while (names.has(uniqueName.toLocaleLowerCase())) {
      uniqueName = `${requested} (${suffix}-${attempt})`;
      attempt += 1;
    }
  }
  const next = {
    ...identity,
    name: uniqueName,
    ...(clean(room) ? { room: clean(room) } : {}),
  };
  if (!clean(room)) delete next.room;
  return storage ? persist(storage, next) : next;
}

export default createBrowserIdentity;
