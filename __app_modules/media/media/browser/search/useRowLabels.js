// frontend/src/modules/Media/search/useRowLabels.js
// What a result row calls its inline verbs (FIND.8b) — shared by both search
// surfaces and Browse:
//   - every playable row has ONE ▶ that names where it plays: "Office Screen"
//     (aimed or learned), or "Play" when it plays here (habits/playDestination.js);
//   - a collection under way says "Continue S2E7" instead;
//   - a camera or single photo's destination verb is "Show on…";
//   - the ⋯ menu's Play Now says the same place, and offers "Play here" when
//     the ▶ goes elsewhere.
// A tap on the row itself only ever opens the item — these labels are the
// only way a row plays.
import { useCallback } from 'react';
import { useCollectionContinue } from "../household/collectionContinue.js";
import { isShowItem } from "./showOn.js";
import { isContainer } from "../../../../../__capabilities/content-catalog/browser/combobox-state.mjs";
import { useStartingOn } from "../cast/useStartingOn.js";
import { usePlayDestination } from "../habits/usePlayDestination.js";

export function useRowLabels() {
  const { continueFor } = useCollectionContinue();
  const { startingOnFor } = useStartingOn();
  const { destinationFor, labelsFor } = usePlayDestination();
  const rowLabelsFor = useCallback((item) => {
    if (!item) return null;
    // PLAY.1a/AC5: while its start is in flight the item itself says so.
    const subtitle = startingOnFor(item.id) ?? undefined;
    if (isShowItem(item)) return { playOn: 'Show on…', subtitle };
    const { short, sentence } = labelsFor(item);
    const elsewhere = destinationFor(item).targetIds.length > 0;
    const title = item.title ? `${sentence.replace(/^Play/, `Play ${item.title}`)}` : sentence;
    const named = {
      playTitle: title,
      playNow: sentence,
      playHere: elsewhere ? 'Play here' : null,
      playElsewhere: elsewhere,
      subtitle,
    };
    if (isContainer(item)) {
      // The spoken name starts with the words on the button (label in name):
      // "Continue S2E7 on Office Screen", "Play Bluey here".
      const cont = continueFor(item)?.label ?? null;
      const where = elsewhere ? ` on ${short}` : ' here';
      return { ...named, play: cont ?? short, playTitle: cont ? `${cont}${where}` : title };
    }
    return { ...named, play: short };
  }, [continueFor, startingOnFor, destinationFor, labelsFor]);
  return { rowLabelsFor, continueFor };
}

export default useRowLabels;
