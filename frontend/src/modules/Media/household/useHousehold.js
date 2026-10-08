// frontend/src/modules/Media/household/useHousehold.js
// Hooks over the household media memory: favourites (shared, one step either
// way — FIND.12a), removal from the household list with Undo (FIND.13a),
// watched marks (FIND.10a/AC6), and screen names from the registry. Every
// write reports through the one outcome system (DispatchProvider records),
// never a toast, and refreshes every household view afterwards so a change
// shows everywhere the item appears.
import { useCallback, useContext, useMemo } from 'react';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { getDeviceId } from '../../../lib/deviceIdentity.js';
import { DispatchContext } from '../cast/DispatchProvider.jsx';
import mediaLog from '../logging/mediaLog.js';
import getLogger from '../../../lib/logging/Logger.js';
import {
  HOUSEHOLD_PATHS, addFavourite, removeFavourite, removeFromHouseholdList,
  restoreToHouseholdList, markWatched as postWatched, refreshHouseholdViews,
} from './householdApi.js';
import { createScreenNamer } from './householdModel.js';

export const HOUSEHOLD_UNDO_MS = 10_000;

// The logger every household read hands useApiResource: resolved lazily (no
// import-time logger) and tolerant of a partial logger.
let _resourceLog;
function resourceLog() {
  if (!_resourceLog) {
    const root = getLogger();
    _resourceLog = root?.child?.({ app: 'media', component: 'media-household' }) ?? root;
  }
  return _resourceLog;
}
export const householdResourceLogger = {
  debug: (event, data) => resourceLog()?.debug?.(event, data),
  warn: (event, data) => resourceLog()?.warn?.(event, data),
};

const EMPTY_SET = new Set();

/** Ids of the household's favourites (items and collections). */
export function useFavourites() {
  const { data } = useApiResource(HOUSEHOLD_PATHS.favourites, { swr: true, label: 'media-favourites', logger: householdResourceLogger });
  return useMemo(() => {
    const items = Array.isArray(data?.items) ? data.items : null;
    return items ? new Set(items.map(item => item?.id).filter(Boolean)) : EMPTY_SET;
  }, [data]);
}

/**
 * The household entry (spots) for one item, loading the carry-on and recent lists itself so a page
 * opened straight to an item (a link, a reload) still knows how far anyone has got (FIND.8a/AC2).
 */
export function useHouseholdEntry(contentId) {
  const carryOn = useApiResource(HOUSEHOLD_PATHS.carryOn, { swr: true, label: 'media-carry-on', logger: householdResourceLogger });
  const recent = useApiResource(HOUSEHOLD_PATHS.recent, { swr: true, label: 'media-recent', logger: householdResourceLogger });
  return useMemo(() => {
    if (!contentId) return null;
    for (const list of [carryOn.data?.items, recent.data?.items]) {
      const found = Array.isArray(list) ? list.find(entry => entry?.contentId === contentId) : null;
      if (found) return found;
    }
    return null;
  }, [contentId, carryOn.data, recent.data]);
}

/** `nameFor(deviceId)` from GET /api/v1/media/screens; this device is "this device". */
export function useScreenNamer() {
  const { data } = useApiResource(HOUSEHOLD_PATHS.screens, { swr: true, label: 'media-screens', logger: householdResourceLogger });
  return useMemo(() => createScreenNamer(data, { selfId: getDeviceId() }), [data]);
}

function outcomeItem(item) {
  return { contentId: item?.id ?? item?.contentId ?? null, title: item?.title ?? null };
}

export function useHouseholdActions() {
  const outcomes = useContext(DispatchContext);

  const run = useCallback(async ({ kind, item, write, undo = null, log }) => {
    const target = outcomeItem(item);
    const attemptId = outcomes?.recordLocal?.({ kind, phase: 'running', item: target, undo }) ?? null;
    try {
      await write();
      log?.();
      outcomes?.resolveLocal?.(attemptId, { phase: 'confirmed' });
      refreshHouseholdViews();
      return { ok: true };
    } catch (error) {
      const reason = error?.message ?? 'Something went wrong';
      mediaLog.householdActionFailed({ kind, contentId: target.contentId, error: reason });
      outcomes?.resolveLocal?.(attemptId, { phase: 'failed', reason });
      return { ok: false, reason };
    }
  }, [outcomes]);

  const toggleFavourite = useCallback((item, isFavourite) => run({
    kind: isFavourite ? 'unfavourite' : 'favourite',
    item,
    write: () => (isFavourite ? removeFavourite(item.id) : addFavourite(item)),
    log: () => mediaLog.favouriteToggled({ contentId: item.id, favourite: !isFavourite }),
  }), [run]);

  const removeFromList = useCallback((item) => run({
    kind: 'hide',
    item,
    write: () => removeFromHouseholdList(item.id),
    log: () => mediaLog.householdRemoved({ contentId: item.id }),
    undo: {
      operationId: `hide:${item.id}`,
      expiresAt: Date.now() + HOUSEHOLD_UNDO_MS,
      run: async () => {
        await restoreToHouseholdList(item.id);
        mediaLog.householdRestored({ contentId: item.id });
        refreshHouseholdViews();
        return { ok: true };
      },
    },
  }), [run]);

  const markWatched = useCallback((item, watched) => run({
    kind: watched ? 'watched' : 'unwatched',
    item,
    write: () => postWatched(item.id, watched),
    log: () => mediaLog.watchedMarked({ contentId: item.id, watched: !!watched }),
  }), [run]);

  return useMemo(() => ({ toggleFavourite, removeFromList, markWatched }), [toggleFavourite, removeFromList, markWatched]);
}
