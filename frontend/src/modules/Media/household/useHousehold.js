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
import {
  HOUSEHOLD_PATHS, addFavourite, removeFavourite, removeFromHouseholdList,
  restoreToHouseholdList, markWatched as postWatched, refreshHouseholdViews,
} from './householdApi.js';
import { createScreenNamer } from './householdModel.js';

export const HOUSEHOLD_UNDO_MS = 10_000;

const EMPTY_SET = new Set();

/** Ids of the household's favourites (items and collections). */
export function useFavourites() {
  const { data } = useApiResource(HOUSEHOLD_PATHS.favourites, { swr: true, label: 'media-favourites' });
  return useMemo(() => {
    const items = Array.isArray(data?.items) ? data.items : null;
    return items ? new Set(items.map(item => item?.id).filter(Boolean)) : EMPTY_SET;
  }, [data]);
}

/** `nameFor(deviceId)` from GET /api/v1/media/screens; this device is "this device". */
export function useScreenNamer() {
  const { data } = useApiResource(HOUSEHOLD_PATHS.screens, { swr: true, label: 'media-screens' });
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
