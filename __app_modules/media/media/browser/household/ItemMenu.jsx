import { usePlaybackQuality } from "../quality/PlaybackQualityProvider.jsx";
import { supportsQualityOverrides } from "../quality/PlaybackQualityButtons.jsx";
// frontend/src/modules/Media/household/ItemMenu.jsx
// One ⋯ menu with the whole verb set, used by every start-page tile, by
// Played earlier rows and Now-on cards. Which household verbs appear depends
// on where the item is shown: Remove from the household list only where the
// list shows it (recent, carry on, suggestions — FIND.13a), watched marks on
// playable items (FIND.10a/AC6), favourite on anything (FIND.12a).
import React, { useRef } from 'react';
import { ActionIcon, Menu } from '@mantine/core';
import { ActionMenu } from '@/lib/ui/ActionMenu.jsx';
import { IconDotsVertical } from '@tabler/icons-react';
import { isCollection } from "./useItemVerbs.jsx";
import { isShowItem } from "../search/showOn.js";
import { usePressHoldOffer } from "../../../../../frontend/src/lib/ui/usePressHoldOffer.js";
import mediaLog from "../logging/mediaLog.js";
import { usePlayDestination } from "../habits/usePlayDestination.js";
import { itemMenuEntries, menuItemKind, MENU_LABELS } from "../actions/itemMenuTable.js";

// PLAY.5a/AC3: Play next, and — on press and hold — "At the very front".
function PlayNextItems({ testId, fire, label }) {
  const { offered, bind, guardClick } = usePressHoldOffer({ onOffered: () => mediaLog.playNextHoldOffered({ surface: 'item-menu' }) });
  return (
    <>
      <Menu.Item data-testid={`${testId}-verb-playNext`} closeMenuOnClick={!offered} {...bind} onClick={guardClick(fire('playNext'))}>{label}</Menu.Item>
      {offered && (
        <Menu.Item data-testid={`${testId}-verb-playNextFront`} onClick={(event) => { mediaLog.playNextFrontChosen({ surface: 'item-menu' }); fire('playFirst')(event); }}>{MENU_LABELS.playNextFront}</Menu.Item>
      )}
    </>
  );
}

// Test ids predate the table: a favourite toggle keeps one id either way.
const TEST_ID_KIND = { unfavourite: 'favourite' };

/**
 * @param {object} props
 * @param {object} props.item         { id, title, type, itemType, thumbnail }
 * @param {(kind: string) => void} props.onVerb
 * @param {boolean} [props.favourite] is it a favourite now
 * @param {boolean|null} [props.watched] true/false when known, null when not
 * @param {boolean} [props.removable] shown in a household list
 * @param {string} props.testId       prefix for the menu's test ids
 * @param {{id: string, title?: string}[]|null} [props.editions] other editions of this
 *   item that a collapsed tile stands for (the tile's own first, then the rest)
 * @param {(edition: object) => void} [props.onEdition] open one edition
 * @param {string|null} [props.continueLabel] "Continue <part>" entry, when there is a next part
 * @param {{ name: string }|null} [props.playingOn] the screen it is on right now:
 *   offers "Open <screen>" (onVerb('openScreen'), addendum item 5)
 */
export function ItemMenu({
  item, onVerb, favourite = false, watched = null, removable = false, testId,
  editions = null, onEdition = null, continueLabel = null, playingOn = null,
}) {
  const quality = usePlaybackQuality();
  const triggerRef = useRef(null);
  const collection = isCollection(item);
  // The menu's plays and queue verbs go where the tile's ▶ goes; say so.
  const { labelsFor, destinationFor } = usePlayDestination();
  const elsewhere = destinationFor(item).targetIds.length > 0;
  const named = labelsFor(item);
  const fire = (kind) => (event) => { event?.stopPropagation?.(); onVerb(kind); };
  const openQuality = event => {
    event.stopPropagation();
    triggerRef.current?.focus({ preventScroll: true });
    quality.openForItem(item);
  };
  // Addendum item 7: the entries and their words come from the one table.
  const entries = itemMenuEntries({
    surface: 'tile',
    kind: menuItemKind({ collection, show: isShowItem(item) }),
    where: { elsewhere, short: named.short, sentence: named.sentence },
    playingOn, continueLabel, favourite, watched, removable,
    quality: !!quality && supportsQualityOverrides(item),
  });
  return (
    <ActionMenu
      withinPortal
      position="bottom-end"
      shadow="sm"
      dropdownProps={{ 'data-testid': `${testId}-menu` }}
      trigger={
        <ActionIcon
          ref={triggerRef}
          size={44}
          variant="subtle"
          color="gray"
          aria-label={`More actions for ${item?.title ?? 'this item'}`}
          data-testid={`${testId}-more`}
          onClick={(event) => event.stopPropagation()}
        >
          <IconDotsVertical size={18} />
        </ActionIcon>
      }
    >
      {entries.map((entry, index) => {
        if (entry.divider) return <Menu.Divider key={`divider-${index}`} />;
        if (entry.kind === 'playNext') return <PlayNextItems key="playNext" testId={testId} fire={fire} label={entry.label} />;
        const item_ = (
          <Menu.Item key={entry.kind} data-testid={`${testId}-verb-${TEST_ID_KIND[entry.kind] ?? entry.kind}`}
            onClick={entry.kind === 'quality' ? openQuality : fire(entry.kind)}>
            {entry.label}
          </Menu.Item>
        );
        if (entry.kind !== 'details' || !(Array.isArray(editions) && editions.length > 1 && onEdition)) return item_;
        return (
          <React.Fragment key="details">
            {item_}
            <Menu.Divider />
            <Menu.Label>{editions.length} editions</Menu.Label>
            {editions.map((edition, i) => (
              <Menu.Item
                key={edition.id}
                data-testid={`${testId}-edition-${i}`}
                onClick={(event) => { event?.stopPropagation?.(); onEdition(edition); }}
              >
                {`Open edition ${i + 1}`}
              </Menu.Item>
            ))}
          </React.Fragment>
        );
      })}
    </ActionMenu>
  );
}

export default ItemMenu;
