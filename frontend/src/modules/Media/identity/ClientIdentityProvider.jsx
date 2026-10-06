// frontend/src/modules/Media/identity/ClientIdentityProvider.jsx
// Stable per-browser identity: clientId (UUID, persisted) + display name.
// Logs, broadcasts, and external control address this browser by these.
//
// Naming part 2 (RQ-HOUSE-06): the household screen registry (tech doc §2.5)
// is the authority for this browser's name. On start the browser announces
// itself (`POST /screens/announce`) and adopts the name/room the registry
// holds; a rename goes through `PATCH /screens/browser:<clientId>`, so a
// taken name (409 NAME_TAKEN, with a free suggestion) and a screen routines
// use (409 ROUTINES_TARGET, resend with confirm) come back to the person.
// With the registry unreachable the rename stays local and unique among the
// names this device can see, as before.
import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useControlRegistration } from '../externalControl/useControlRegistration.js';
import { createBrowserIdentity, renameBrowserIdentity, isPlaceholderName } from './browserIdentity.js';
import { houseApi as defaultHouseApi } from '../house/houseApi.js';
import houseLog from '../house/houseLog.js';
import { STORAGE_KEYS } from '../constants.js';
import { adoptBrowserDeviceId } from '../../../lib/deviceIdentity.js';

export const ClientIdentityContext = createContext(null);

// RQ-RELY-12: set once the first-use moment has been answered (named or
// skipped) on this device.
export const FIRST_USE_KEY = 'media-app.first-use-done';
// The header token this browser used before it adopted its clientId: sent on
// announce until the registry has folded it (its spots follow the new id).
export const PREVIOUS_ID_KEY = 'media-app.previous-device-id';

function uuidV4() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* ignore */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function storage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function readFirstUse(identity) {
  try {
    if (storage()?.getItem(FIRST_USE_KEY)) return false;
  } catch { return false; }
  return isPlaceholderName(identity.name);
}

function persistIdentity(next) {
  const store = storage();
  if (!store) return next;
  try {
    store.setItem(STORAGE_KEYS.CLIENT_ID, next.clientId);
    store.setItem(STORAGE_KEYS.DISPLAY_NAME, next.name);
    store.setItem(STORAGE_KEYS.BROWSER_IDENTITY, JSON.stringify(next));
  } catch { /* storage refused: the in-memory identity still holds */ }
  return next;
}

/** Take the registry's name/room as this browser's own. */
function adopt(current, screen) {
  if (!screen || typeof screen.name !== 'string' || !screen.name) return current;
  const room = typeof screen.room === 'string' && screen.room ? screen.room : null;
  if (current.name === screen.name && (current.room ?? null) === room) return current;
  const next = { ...current, name: screen.name };
  if (room) next.room = room; else delete next.room;
  return persistIdentity(next);
}

export function ClientIdentityProvider({ children, api = defaultHouseApi }) {
  const [identity, setIdentity] = useState(() => {
    const created = createBrowserIdentity({ randomUuid: uuidV4 });
    // One id per browser: every request now names this browser the way the
    // screen registry and the house view do (set before any child effect
    // issues a request).
    const previous = adoptBrowserDeviceId(created.clientId);
    if (previous) { try { storage()?.setItem(PREVIOUS_ID_KEY, previous); } catch { /* storage refused */ } }
    return created;
  });
  const [firstUse, setFirstUse] = useState(() => readFirstUse(identity));
  const [registered, setRegistered] = useState(null); // registry Screen for this browser
  const registration = useControlRegistration(identity.clientId);
  const identityRef = useRef(identity);
  identityRef.current = identity;

  // Announce once this browser is a screen worth listing: named by a person,
  // or playing. An unnamed browser that merely opened the app is not
  // registered (every private window would become a lasting row), and the
  // made-up "Browser 1a2b…" name is never sent — the registry synthesizes it.
  const [playing, setPlaying] = useState(false);
  const markPlaying = useCallback(() => setPlaying(true), []);
  const named = !isPlaceholderName(identity.name);
  useEffect(() => {
    if (!named && !playing) return undefined;
    let cancelled = false;
    const { deviceId, name, room } = identityRef.current;
    let previousId = null;
    try { previousId = storage()?.getItem(PREVIOUS_ID_KEY) || null; } catch { /* storage refused */ }
    api.announceScreen({ id: deviceId, name: isPlaceholderName(name) ? undefined : name, room, playing, previousId })
      .then((res) => {
        if (previousId) { try { storage()?.removeItem(PREVIOUS_ID_KEY); } catch { /* storage refused */ } }
        if (cancelled || !res?.screen) return;
        houseLog.screenAnnounced({ deviceId, name: res.screen.name, adopted: res.screen.name !== name });
        setRegistered(res.screen);
        setIdentity((current) => adopt(current, res.screen));
      })
      .catch((error) => {
        if (!cancelled) houseLog.announceFailed({ deviceId, status: error?.status ?? null, code: error?.code ?? null, error: error?.message });
      });
    return () => { cancelled = true; };
  }, [api, identity.deviceId, named, playing]);

  /**
   * Rename this browser (and/or set its room). Resolves to
   * `{ ok: true, screen?, local? }` or `{ ok: false, code, suggestion?, heldBy?, routines?, error? }`.
   * Pass `confirm: true` after showing the routines a ROUTINES_TARGET listed;
   * `onCollision: "suffix"` takes the registry's free suggestion.
   */
  const rename = useCallback(async ({ name, room, confirm = false, onCollision, existingNames = [] } = {}) => {
    const current = identityRef.current;
    const nextName = typeof name === 'string' ? name.trim() : '';
    const nextRoom = typeof room === 'string' ? room.trim() : '';
    const nameChanged = !!nextName && nextName !== current.name;
    const roomChanged = nextRoom !== (current.room ?? '');
    const id = current.deviceId;
    try {
      let screen = null;
      if (nameChanged) {
        const send = () => api.renameScreen(id, { name: nextName, confirm, onCollision });
        const res = await send().catch(async (error) => {
          if (error?.code !== 'SCREEN_NOT_FOUND') throw error;
          await api.announceScreen({ id, name: isPlaceholderName(current.name) ? undefined : current.name, room: current.room, playing: true });
          return send();
        });
        screen = res?.screen ?? null;
        houseLog.screenRenamed({ deviceId: id, from: current.name, to: screen?.name ?? nextName, routines: res?.routines?.length ?? 0, self: true });
      }
      if (roomChanged) {
        const res = await api.setScreenRoom(id, nextRoom || null);
        screen = res?.screen ?? screen;
        houseLog.roomSet({ deviceId: id, room: nextRoom || null, self: true });
      }
      if (screen) {
        setRegistered(screen);
        setIdentity((prev) => adopt(prev, screen));
      }
      return { ok: true, screen };
    } catch (error) {
      if (error?.code === 'NAME_TAKEN' || error?.code === 'ROUTINES_TARGET') {
        houseLog.renameConflict({ deviceId: id, code: error.code, routines: error.details?.routines?.length ?? 0 });
        return { ok: false, code: error.code, ...error.details };
      }
      if (error?.transient || error?.status === 501) {
        // The registry is out of reach: rename locally, unique among the
        // names this device can see (the registry re-reads it on announce).
        houseLog.adminActionFailed({ action: 'rename-self', deviceId: id, error: error?.message, fallback: 'local' });
        setIdentity((prev) => persistIdentity(renameBrowserIdentity(prev, {
          name: nextName || prev.name, room: nextRoom, existingNames,
        })));
        return { ok: true, local: true };
      }
      houseLog.adminActionFailed({ action: 'rename-self', deviceId: id, status: error?.status ?? null, code: error?.code ?? null, error: error?.message });
      return { ok: false, code: error?.code ?? 'FAILED', error: error?.message ?? 'Could not rename' };
    }
  }, [api]);

  const completeFirstUse = useCallback((how) => {
    try { storage()?.setItem(FIRST_USE_KEY, new Date().toISOString()); } catch { /* storage refused */ }
    setFirstUse(false);
    if (how === 'skipped') houseLog.firstUseSkipped({ deviceId: identityRef.current.deviceId });
    else houseLog.firstUseNamed({ deviceId: identityRef.current.deviceId, name: identityRef.current.name });
  }, []);

  const value = useMemo(() => ({
    ...identity,
    displayName: identity.name,
    controlClientId: identity.clientId,
    controlReady: registration.ready,
    registered,
    rename,
    markPlaying,
    firstUse,
    completeFirstUse,
  }), [identity, registration.ready, registered, rename, markPlaying, firstUse, completeFirstUse]);

  return (
    <ClientIdentityContext.Provider value={value}>
      {children}
    </ClientIdentityContext.Provider>
  );
}

export default ClientIdentityProvider;
