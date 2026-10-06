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

/**
 * @param {object} props
 * @param {object} props.item         { id, title, type, itemType, thumbnail }
 * @param {(kind: string) => void} props.onVerb
 * @param {boolean} [props.favourite] is it a favourite now
 * @param {boolean|null} [props.watched] true/false when known, null when not
 * @param {boolean} [props.removable] shown in a household list
 * @param {string} props.testId       prefix for the menu's test ids
 */
export function ItemMenu({ item, onVerb, favourite = false, watched = null, removable = false, testId }) {
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
        <Menu.Item data-testid={`${testId}-verb-playNow`} onClick={fire('playNow')}>Play now</Menu.Item>
        {collection && <Menu.Item data-testid={`${testId}-verb-shuffle`} onClick={fire('shuffle')}>Shuffle</Menu.Item>}
        <Menu.Item data-testid={`${testId}-verb-playNext`} onClick={fire('playNext')}>Play next</Menu.Item>
        <Menu.Item data-testid={`${testId}-verb-playFirst`} onClick={fire('playFirst')}>Play first</Menu.Item>
        <Menu.Item data-testid={`${testId}-verb-add`} onClick={fire('add')}>Add to queue</Menu.Item>
        <Menu.Item data-testid={`${testId}-verb-playOn`} onClick={fire('playOn')}>Play on…</Menu.Item>
        <Menu.Item data-testid={`${testId}-verb-addOn`} onClick={fire('addOn')}>Add on…</Menu.Item>
        <Menu.Item data-testid={`${testId}-verb-details`} onClick={fire('details')}>Details</Menu.Item>
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
