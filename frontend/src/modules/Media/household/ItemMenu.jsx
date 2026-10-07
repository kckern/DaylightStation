// frontend/src/modules/Media/household/ItemMenu.jsx
// One ⋯ menu with the whole verb set, used by every start-page tile, by
// Played earlier rows and Now-on cards. Which household verbs appear depends
// on where the item is shown: Remove from the household list only where the
// list shows it (recent, carry on, suggestions — FIND.13a), watched marks on
// playable items (FIND.10a/AC6), favourite on anything (FIND.12a).
import React from 'react';
import { ActionIcon, Menu } from '@mantine/core';
import { IconDotsVertical } from '@tabler/icons-react';
import { isCollection } from './useItemVerbs.jsx';
import { usePressHoldOffer } from '../../../lib/ui/usePressHoldOffer.js';
import mediaLog from '../logging/mediaLog.js';

// PLAY.5a/AC3: Play next, and — on press and hold — "At the very front".
function PlayNextItems({ testId, fire }) {
  const { offered, bind, guardClick } = usePressHoldOffer({ onOffered: () => mediaLog.playNextHoldOffered({ surface: 'item-menu' }) });
  return (
    <>
      <Menu.Item data-testid={`${testId}-verb-playNext`} closeMenuOnClick={!offered} {...bind} onClick={guardClick(fire('playNext'))}>Play next</Menu.Item>
      {offered && (
        <Menu.Item data-testid={`${testId}-verb-playNextFront`} onClick={(event) => { mediaLog.playNextFrontChosen({ surface: 'item-menu' }); fire('playFirst')(event); }}>At the very front</Menu.Item>
      )}
    </>
  );
}

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
 */
export function ItemMenu({
  item, onVerb, favourite = false, watched = null, removable = false, testId,
  editions = null, onEdition = null, continueLabel = null,
}) {
  const collection = isCollection(item);
  const fire = (kind) => (event) => { event?.stopPropagation?.(); onVerb(kind); };
  return (
    <Menu withinPortal position="bottom-end" shadow="sm">
      <Menu.Target>
        <ActionIcon
          size={44}
          variant="subtle"
          color="gray"
          aria-label={`More actions for ${item?.title ?? 'this item'}`}
          data-testid={`${testId}-more`}
          onClick={(event) => event.stopPropagation()}
        >
          <IconDotsVertical size={18} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown data-testid={`${testId}-menu`}>
        {continueLabel && (
          <Menu.Item data-testid={`${testId}-verb-continue`} onClick={fire('continue')}>{continueLabel}</Menu.Item>
        )}
        <Menu.Item data-testid={`${testId}-verb-playNow`} onClick={fire('playNow')}>Play now</Menu.Item>
        {collection && <Menu.Item data-testid={`${testId}-verb-shuffle`} onClick={fire('shuffle')}>Shuffle</Menu.Item>}
        <PlayNextItems testId={testId} fire={fire} />
        <Menu.Item data-testid={`${testId}-verb-playFirst`} onClick={fire('playFirst')}>Play first</Menu.Item>
        <Menu.Item data-testid={`${testId}-verb-add`} onClick={fire('add')}>Add to queue</Menu.Item>
        <Menu.Item data-testid={`${testId}-verb-playOn`} onClick={fire('playOn')}>Play on…</Menu.Item>
        <Menu.Item data-testid={`${testId}-verb-addOn`} onClick={fire('addOn')}>Add on…</Menu.Item>
        <Menu.Item data-testid={`${testId}-verb-details`} onClick={fire('details')}>Details</Menu.Item>
        {Array.isArray(editions) && editions.length > 1 && onEdition && (
          <>
            <Menu.Divider />
            <Menu.Label>{editions.length} editions</Menu.Label>
            {editions.map((edition, index) => (
              <Menu.Item
                key={edition.id}
                data-testid={`${testId}-edition-${index}`}
                onClick={(event) => { event?.stopPropagation?.(); onEdition(edition); }}
              >
                {`Open edition ${index + 1}`}
              </Menu.Item>
            ))}
          </>
        )}
        <Menu.Divider />
        <Menu.Item data-testid={`${testId}-verb-favourite`} onClick={fire(favourite ? 'unfavourite' : 'favourite')}>
          {favourite ? 'Remove from favourites' : 'Add to favourites'}
        </Menu.Item>
        {!collection && watched !== true && (
          <Menu.Item data-testid={`${testId}-verb-watched`} onClick={fire('watched')}>Mark watched</Menu.Item>
        )}
        {!collection && watched !== false && (
          <Menu.Item data-testid={`${testId}-verb-unwatched`} onClick={fire('unwatched')}>Mark unwatched</Menu.Item>
        )}
        {removable && (
          <Menu.Item data-testid={`${testId}-verb-hide`} onClick={fire('hide')}>Remove from household list</Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

export default ItemMenu;
