// frontend/src/modules/Media/search/useRowLabels.js
// What a result row calls its inline verbs (FIND.8b): a collection's play is
// "Play", or "Continue S2E7" when the household has one under way; a camera or
// single photo's destination verb is "Show on…". Shared by both search surfaces.
import { useCallback } from 'react';
import { useCollectionContinue } from '../household/collectionContinue.js';
import { isShowItem } from './showOn.js';
import { isContainer } from '../../Content/combobox/comboboxMachine.js';

export function useRowLabels() {
  const { continueFor } = useCollectionContinue();
  const rowLabelsFor = useCallback((item) => {
    if (!item) return null;
    if (isContainer(item)) return { play: continueFor(item)?.label ?? 'Play' };
    if (isShowItem(item)) return { playOn: 'Show on…' };
    return null;
  }, [continueFor]);
  return { rowLabelsFor, continueFor };
}

export default useRowLabels;
