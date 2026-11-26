// React face of the habits store + the destination rule (playDestination.js).
// Every play surface asks this hook the same two questions — "where would ▶
// send this?" and "what is ▶ called?" — so the label and the send can never
// disagree.
import { useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import { CastTargetContext } from "../cast/CastTargetProvider.jsx";
import { FleetContext } from "../fleet/FleetProvider.jsx";
import { habitsStore, itemKind } from "./mediaHabits.js";
import { resolvePlayDestination, destinationLabels } from "./playDestination.js";
import mediaLog from "../logging/mediaLog.js";

const NO_AIM = Object.freeze([]);

export function useHabits() {
  const store = habitsStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { store, snapshot };
}

/**
 * @param {{ aimIds?: string[] }} [options] - a caller that already holds the
 *   aim (useContentDispatch reads it through useCastTarget) passes it, so the
 *   two can never disagree.
 */
export function usePlayDestination({ aimIds: aimOverride } = {}) {
  const { store, snapshot } = useHabits();
  // Optional contexts: embedders without a fleet or aim (tests, the kiosk
  // shells) get "here" for everything.
  const aim = useContext(CastTargetContext);
  const fleet = useContext(FleetContext);
  const aimIds = aimOverride ?? aim?.targetIds ?? NO_AIM;
  const devices = fleet?.devices ?? NO_AIM;
  const localId = fleet?.identity?.deviceId ?? null;

  const destinationFor = useCallback((item) => {
    const kind = itemKind(item);
    return resolvePlayDestination({
      aimIds, learnedIds: kind ? store.screenFor(kind) : null, devices, localId, kind,
    });
  // snapshot: re-resolve when something new is learned.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aimIds, devices, localId, store, snapshot]);

  const labelsFor = useCallback((item, opts) => destinationLabels(destinationFor(item), opts), [destinationFor]);

  /** A deliberate play of `item` went to `targetIds` ([] = here). */
  const recordPlay = useCallback((item, targetIds) => {
    const kind = itemKind(item);
    if (!kind) return;
    const ids = (targetIds ?? []).filter(id => id !== localId);
    if (store.recordScreen(kind, ids)) {
      mediaLog.habitScreenRecorded({ kind, targetIds: ids });
    }
  }, [store, localId]);

  /** The person chose `item` for the words `text`. */
  const recordPick = useCallback((text, item, via) => {
    if (store.recordPick(text, item)) {
      mediaLog.habitPickRecorded({ contentId: item?.id ?? null, textLength: String(text ?? '').trim().length, via });
    }
  }, [store]);

  const scoresFor = useCallback((text) => store.scoresFor(text),
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, snapshot]);

  return useMemo(
    () => ({ destinationFor, labelsFor, recordPlay, recordPick, scoresFor }),
    [destinationFor, labelsFor, recordPlay, recordPick, scoresFor],
  );
}

export default usePlayDestination;
