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
import { usePlayingOn } from "../fleet/usePlayingOn.js";
import { useFavourites } from "../household/useHousehold.js";
import { itemMenuEntries, menuItemKind } from "../actions/itemMenuTable.js";

/**
 * Addendum items 5–7 for any result row (search, Browse): the ⋯ entries from
 * the one menu table, "On <screen>" with its Pause, and whether this row's ▶
 * is the one spinning. `screenFor` names the screen its "Open <screen>" opens.
 */
export function useRowExtras() {
  const { isStarting } = useStartingOn();
  const { destinationFor, labelsFor } = usePlayDestination();
  const { playingOnFor, toggle } = usePlayingOn();
  const favourites = useFavourites();
  const rowExtrasFor = useCallback((item) => {
    if (!item?.id) return { menu: null, playingOn: null, playBusy: false };
    const { short, sentence } = labelsFor(item);
    const where = destinationFor(item);
    const elsewhere = where.targetIds.length > 0;
    // Item 5: already on a screen → "On <screen>", Pause (or Resume) there.
    const on = playingOnFor(item.id);
    const playingOn = on ? {
      // The row's own line says where ("On Office Screen"); the button is the verb.
      onLine: `On ${on.name}`,
      text: on.paused ? 'Resume' : 'Pause',
      paused: on.paused,
      toggleLabel: `${on.paused ? 'Resume' : 'Pause'} ${item.title ?? 'it'} on ${on.name}`,
      onToggle: () => toggle(on, item.id),
      deviceId: on.deviceId,
    } : null;
    // Item 7: the ⋯ entries and their words, from the one table.
    const menu = itemMenuEntries({
      surface: 'row',
      kind: menuItemKind({ collection: isContainer(item), show: isShowItem(item) }),
      where: { elsewhere, short, sentence: where.source === 'ask' ? null : sentence },
      playingOn: on,
      favourite: favourites.has(item.id),
    });
    // Item 6: this row's ▶ alone spins while its start is in flight.
    return { menu, playingOn, playBusy: isStarting(item.id) };
  }, [isStarting, destinationFor, labelsFor, playingOnFor, toggle, favourites]);
  const screenFor = useCallback((item) => playingOnFor(item?.id)?.deviceId ?? null, [playingOnFor]);
  return { rowExtrasFor, screenFor };
}

export function useRowLabels() {
  const { continueFor } = useCollectionContinue();
  const { startingOnFor } = useStartingOn();
  const { destinationFor, labelsFor } = usePlayDestination();
  const { rowExtrasFor, screenFor } = useRowExtras();
  const rowLabelsFor = useCallback((item) => {
    if (!item) return null;
    // PLAY.1a/AC5: while its start is in flight the item itself says so.
    const extras = rowExtrasFor(item);
    const subtitle = startingOnFor(item.id) ?? extras.playingOn?.onLine ?? undefined;
    if (isShowItem(item)) return { playOn: 'Show on…', subtitle, menu: extras.menu, playingOn: extras.playingOn };
    const { short, sentence } = labelsFor(item);
    const where = destinationFor(item);
    const elsewhere = where.targetIds.length > 0;
    const title = item.title ? `${sentence.replace(/^Play/, `Play ${item.title}`)}` : sentence;
    const named = {
      playTitle: title,
      // Asking ("Play on…") already has its own menu item: Play Now keeps its name.
      playNow: where.source === 'ask' ? null : sentence,
      playHere: elsewhere ? 'Play here' : null,
      playElsewhere: elsewhere,
      queueWhere: elsewhere ? short : null,
      subtitle,
      ...extras,
    };
    if (isContainer(item)) {
      // The spoken name starts with the words on the button (label in name):
      // "Continue S2E7 on Office Screen", "Play Bluey here".
      const cont = continueFor(item)?.label ?? null;
      const where = elsewhere ? ` on ${short}` : ' here';
      return { ...named, play: cont ?? short, playTitle: cont ? `${cont}${where}` : title };
    }
    return { ...named, play: short };
  }, [continueFor, startingOnFor, rowExtrasFor, destinationFor, labelsFor]);
  return { rowLabelsFor, continueFor, screenFor };
}

export default useRowLabels;
