// frontend/src/modules/Media/search/useRowLabels.js
// What a result row calls its inline verbs (FIND.8b): a collection's play is
// "Play", or "Continue S2E7" when the household has one under way; a camera or
// single photo's destination verb is "Show on…". Shared by both search surfaces.
import { useCallback } from 'react';
import { useCollectionContinue } from '../household/collectionContinue.js';
import { isShowItem } from './showOn.js';
import { isContainer } from '../../Content/combobox/comboboxMachine.js';
import { useStartingOn } from '../cast/useStartingOn.js';

export function useRowLabels() {
  const { continueFor } = useCollectionContinue();
  const { startingOnFor } = useStartingOn();
  const rowLabelsFor = useCallback((item) => {
    if (!item) return null;
    // PLAY.1a/AC5: while its start is in flight the item itself says so.
    const subtitle = startingOnFor(item.id) ?? undefined;
    if (isContainer(item)) return { play: continueFor(item)?.label ?? 'Play', subtitle };
    if (isShowItem(item)) return { playOn: 'Show on…', subtitle };
    return subtitle ? { subtitle } : null;
  }, [continueFor, startingOnFor]);
  return { rowLabelsFor, continueFor };
}

export default useRowLabels;
