// frontend/src/modules/Media/household/useItemVerbs.jsx
// The full verb set for an item wherever it appears on the start page, in
// Played earlier, or in an item's details (FIND.9a/AC2, FIND.11a/AC3):
// open / play at the aim / shuffle / play next / play first / add / play on… /
// add on… / details, plus favourite (FIND.12a), watched marks (FIND.10a/AC6)
// and removal from the household list (FIND.13a).
//
// Play obeys the saved spots (PLAY.4a): one spot → continue from it with
// Start over on the confirmation; screens holding different spots → the
// person chooses; no spot → from the beginning.
import React, { useCallback, useState } from 'react';
import { peekApiResource } from '../../../lib/hooks/useApiResource.js';
import { useContentDispatch } from '../search/useContentDispatch.js';
import { useNav } from '../shell/NavProvider.jsx';
import { isContainer } from '../../Content/combobox/comboboxMachine.js';
import { ItemDestinationPicker } from '../actions/ItemDestinationPicker.jsx';
import mediaLog from '../logging/mediaLog.js';
import { HOUSEHOLD_PATHS } from './householdApi.js';
import { resumePlan } from './householdModel.js';
import { useHouseholdActions, useScreenNamer } from './useHousehold.js';
import { SpotChooser } from './SpotChooser.jsx';

export const ITEM_VERBS = Object.freeze([
  'open', 'tap', 'playNow', 'shuffle', 'playNext', 'playFirst', 'add', 'playOn', 'addOn', 'details',
  'favourite', 'unfavourite', 'watched', 'unwatched', 'hide',
]);

/** The household entry (spots) for an item, from whatever the start page already loaded. */
export function householdEntryFor(contentId) {
  if (!contentId) return null;
  for (const path of [HOUSEHOLD_PATHS.carryOn, HOUSEHOLD_PATHS.recent]) {
    const items = peekApiResource(path)?.items;
    const found = Array.isArray(items) ? items.find(entry => entry?.contentId === contentId) : null;
    if (found) return found;
  }
  return null;
}

export function isCollection(item) {
  return !!item && item.itemType !== 'leaf' && isContainer(item);
}

export function useItemVerbs() {
  const { dispatch, dispatchLeafVerb, playContainerAsQueue, addContainerToQueue } = useContentDispatch();
  const { push } = useNav();
  const household = useHouseholdActions();
  const nameFor = useScreenNamer();
  const [oneShot, setOneShot] = useState(null);
  const [choice, setChoice] = useState(null);

  const playLeaf = useCallback((item, entry) => {
    const plan = resumePlan(entry ?? householdEntryFor(item.id));
    if (plan.kind === 'choose') {
      mediaLog.spotChoiceShown({ contentId: item.id, spots: plan.spots.length });
      setChoice({ item, spots: plan.spots });
      return 'choose';
    }
    return plan.kind === 'continue'
      ? dispatchLeafVerb('playNow', item.id, item, { resumedFrom: plan.spot.playhead })
      : dispatchLeafVerb('playNow', item.id, item);
  }, [dispatchLeafVerb]);

  const run = useCallback((kind, item, ctx = {}) => {
    if (!item?.id) return undefined;
    const collection = isCollection(item);
    switch (kind) {
      case 'tap':
        return collection ? dispatch(item.id, item) : playLeaf(item, ctx.entry);
      case 'open':
        if (collection) return dispatch(item.id, item);
        push('detail', { contentId: item.id });
        return 'detail';
      case 'details':
        push('detail', { contentId: item.id });
        return 'detail';
      case 'playNow':
        return collection ? playContainerAsQueue(item.id, item) : playLeaf(item, ctx.entry);
      case 'shuffle':
        return playContainerAsQueue(item.id, item, { shuffle: true });
      case 'add':
        return collection ? addContainerToQueue(item.id, item) : dispatchLeafVerb('add', item.id, item);
      case 'playNext':
      case 'playFirst':
        return dispatchLeafVerb(kind, item.id, collection ? { ...item, itemType: 'container' } : item);
      case 'playOn':
      case 'addOn':
        setOneShot({ kind, item });
        return 'picker';
      case 'favourite':
      case 'unfavourite':
        return household.toggleFavourite(item, kind === 'unfavourite');
      case 'watched':
      case 'unwatched':
        return household.markWatched(item, kind === 'watched');
      case 'hide':
        return household.removeFromList(item);
      default:
        return undefined;
    }
  }, [dispatch, playLeaf, push, playContainerAsQueue, addContainerToQueue, dispatchLeafVerb, household]);

  const choose = useCallback((startAt, spot) => {
    const current = choice;
    setChoice(null);
    if (!current) return;
    mediaLog.spotChosen({ contentId: current.item.id, startAt, deviceId: spot?.deviceId ?? null });
    dispatchLeafVerb('playNow', current.item.id, current.item, { startAt });
  }, [choice, dispatchLeafVerb]);

  const overlays = (
    <>
      <ItemDestinationPicker action={oneShot} onClose={() => setOneShot(null)} />
      <SpotChooser choice={choice} nameFor={nameFor} onChoose={choose} onClose={() => setChoice(null)} />
    </>
  );

  return { run, overlays, nameFor };
}
export default useItemVerbs;
