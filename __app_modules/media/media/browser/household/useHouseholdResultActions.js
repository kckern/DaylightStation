// frontend/src/modules/Media/household/useHouseholdResultActions.js
// Search and browse rows get the household verbs too (FIND.12a/AC1 "wherever
// it appears", FIND.10a/AC6 "any item"): add/remove favourite in one step and
// mark a playable item watched or unwatched. They ride the row's own ⋯ menu
// through ResultRow's additive `extraActions`, and come back as ordinary
// onAction kinds that `runHousehold` handles.
import { useCallback } from 'react';
import { isCollection } from "./useItemVerbs.jsx";
import { useFavourites, useHouseholdActions } from "./useHousehold.js";
import { usePhoneKeeps } from "../cast/usePhoneKeeps.jsx";

export const HOUSEHOLD_RESULT_KINDS = new Set(['favourite', 'unfavourite', 'watched', 'unwatched']);

export function useHouseholdResultActions() {
  const favourites = useFavourites();
  const household = useHouseholdActions();
  const phoneKeeps = usePhoneKeeps();

  const extraActions = useCallback((item) => {
    if (!item?.id) return [];
    const favourite = favourites.has(item.id);
    const actions = [{ kind: favourite ? 'unfavourite' : 'favourite', label: favourite ? 'Remove from favourites' : 'Add to favourites' }];
    if (!isCollection(item)) {
      actions.push({ kind: 'watched', label: 'Mark watched' }, { kind: 'unwatched', label: 'Mark unwatched' });
    }
    return actions;
  }, [favourites]);

  /** Returns true when `kind` was a household verb or a Keep on Phone verb (and has been run). */
  const runHousehold = useCallback((kind, item) => {
    if (phoneKeeps.run(kind, item)) return true;
    if (!HOUSEHOLD_RESULT_KINDS.has(kind) || !item?.id) return false;
    if (kind === 'favourite' || kind === 'unfavourite') household.toggleFavourite(item, kind === 'unfavourite');
    else household.markWatched(item, kind === 'watched');
    return true;
  }, [household, phoneKeeps]);

  return { extraActions, runHousehold };
}

export default useHouseholdResultActions;
