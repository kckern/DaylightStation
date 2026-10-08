// frontend/src/modules/Media/house/useScreenAdmin.js
// Screen admin actions (RQ-HOUSE-08): add, name/room, merge a duplicate
// (Undo through the outcome tray, Unmerge on the screen afterwards), retire
// (after the routines that target it were shown) and restore. Each re-reads
// the registry so every row and name in the app follows.
import { useCallback, useContext } from 'react';
import { DispatchContext } from '../cast/DispatchProvider.jsx';
import { houseApi as defaultApi } from './houseApi.js';
import houseLog from './houseLog.js';
import { resetScreenRoomsCache } from '../cast/screenRooms.js';

const UNDO_MS = 10_000;

function failure(error) {
  return { ok: false, code: error?.code ?? 'FAILED', error: error?.message ?? 'Something went wrong', ...(error?.details ?? {}) };
}

export function useScreenAdmin({ registry, api = defaultApi } = {}) {
  const outcomes = useContext(DispatchContext);
  const refresh = registry?.refresh;
  const report = useCallback((kind, primary, secondary = null, undo = null) => {
    outcomes?.recordLocal?.({ kind, phase: 'confirmed', item: { contentId: null, title: null }, command: { copy: { primary, secondary } }, undo });
  }, [outcomes]);

  const nameScreen = useCallback(async (screen, { name, room, confirm, onCollision } = {}) => {
    const nextName = (name ?? '').trim();
    const nextRoom = (room ?? '').trim();
    try {
      let result = null;
      if (nextName && nextName !== screen.name) {
        result = await api.renameScreen(screen.id, { name: nextName, confirm, onCollision });
        houseLog.screenRenamed({ deviceId: screen.id, from: screen.name, to: result?.screen?.name ?? nextName, routines: result?.routines?.length ?? 0 });
      }
      if (nextRoom !== (screen.room ?? '')) {
        result = await api.setScreenRoom(screen.id, nextRoom || null);
        houseLog.roomSet({ deviceId: screen.id, room: nextRoom || null });
      }
      await refresh?.();
      return { ok: true, screen: result?.screen ?? null };
    } catch (error) {
      if (error?.code === 'NAME_TAKEN' || error?.code === 'ROUTINES_TARGET') houseLog.renameConflict({ deviceId: screen.id, code: error.code });
      else houseLog.adminActionFailed({ action: 'name', deviceId: screen.id, status: error?.status ?? null, code: error?.code ?? null, error: error?.message });
      return failure(error);
    }
  }, [api, refresh]);

  // Which rooms neighbour `room` (the several-screen drift warning); the link is mutual.
  const setNeighbours = useCallback(async (room, neighbours) => {
    try {
      const res = await api.setRoomNeighbours(room, neighbours);
      houseLog.roomNeighboursSet({ room, neighbours });
      resetScreenRoomsCache();
      await refresh?.();
      return { ok: true, roomAdjacency: res?.roomAdjacency ?? null };
    } catch (error) {
      houseLog.adminActionFailed({ action: 'room-neighbours', status: error?.status ?? null, code: error?.code ?? null, error: error?.message });
      return failure(error);
    }
  }, [api, refresh]);

  const addScreen = useCallback(async ({ name, room }) => {
    try {
      const res = await api.addScreen({ name: name.trim(), room: room?.trim() || undefined });
      houseLog.screenAdded({ deviceId: res?.screen?.id ?? null, name: res?.screen?.name ?? name });
      await refresh?.();
      report('screenAdded', `Added ${res?.screen?.name ?? name}`, res?.screen?.room ?? null);
      return { ok: true, screen: res?.screen ?? null };
    } catch (error) {
      houseLog.adminActionFailed({ action: 'add', status: error?.status ?? null, code: error?.code ?? null, error: error?.message });
      return failure(error);
    }
  }, [api, refresh, report]);

  const unmerge = useCallback(async (aliasId, { quiet = false } = {}) => {
    try {
      const res = await api.unmergeScreen(aliasId);
      houseLog.screenUnmerged({ deviceId: aliasId, restoredSpots: res?.restoredSpots ?? null });
      await refresh?.();
      if (!quiet) report('screenUnmerged', `${res?.screen?.name ?? 'The duplicate'} is its own screen again`);
      return { ok: true };
    } catch (error) {
      houseLog.adminActionFailed({ action: 'unmerge', deviceId: aliasId, status: error?.status ?? null, code: error?.code ?? null, error: error?.message });
      return failure(error);
    }
  }, [api, refresh, report]);

  const merge = useCallback(async (duplicate, into) => {
    try {
      const res = await api.mergeScreen(duplicate.id, { into: into.id, confirm: true });
      houseLog.screenMerged({ deviceId: duplicate.id, into: into.id, movedSpots: res?.movedSpots ?? null });
      await refresh?.();
      report('screenMerged', `Merged ${duplicate.name} into ${into.name}`, 'Its plays and spots now belong to it', {
        operationId: `unmerge:${duplicate.id}`,
        expiresAt: Date.now() + UNDO_MS,
        run: async () => unmerge(duplicate.id, { quiet: true }),
      });
      return { ok: true };
    } catch (error) {
      houseLog.adminActionFailed({ action: 'merge', deviceId: duplicate.id, into: into.id, status: error?.status ?? null, code: error?.code ?? null, error: error?.message });
      return failure(error);
    }
  }, [api, refresh, report, unmerge]);

  const routinesFor = useCallback(async (screen) => {
    try {
      const res = await api.screenRoutines(screen.id);
      return { ok: true, routines: Array.isArray(res?.items) ? res.items : [] };
    } catch (error) {
      houseLog.adminActionFailed({ action: 'routines', deviceId: screen.id, status: error?.status ?? null, error: error?.message });
      return failure(error);
    }
  }, [api]);

  const retire = useCallback(async (screen) => {
    try {
      const res = await api.retireScreen(screen.id, { confirm: true });
      houseLog.screenRetired({ deviceId: screen.id, routines: res?.routines?.length ?? 0 });
      await refresh?.();
      report('screenRetired', `Retired ${screen.name}`, 'Restore it from Retired screens');
      return { ok: true };
    } catch (error) {
      houseLog.adminActionFailed({ action: 'retire', deviceId: screen.id, status: error?.status ?? null, code: error?.code ?? null, error: error?.message });
      return failure(error);
    }
  }, [api, refresh, report]);

  const restore = useCallback(async (screen) => {
    try {
      const res = await api.restoreScreen(screen.id);
      houseLog.screenRestored({ deviceId: screen.id });
      await refresh?.();
      report('screenRestored', `Restored ${res?.screen?.name ?? screen.name}`);
      return { ok: true };
    } catch (error) {
      houseLog.adminActionFailed({ action: 'restore', deviceId: screen.id, status: error?.status ?? null, code: error?.code ?? null, error: error?.message });
      return failure(error);
    }
  }, [api, refresh, report]);

  return { nameScreen, setNeighbours, addScreen, merge, unmerge, routinesFor, retire, restore };
}

export default useScreenAdmin;
