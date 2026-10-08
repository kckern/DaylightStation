import React from 'react';
import { Modal } from '@mantine/core';
import { DispatchTargetPicker } from '../cast/DispatchTargetPicker.jsx';
import { resultToQueueInput } from '../search/resultToQueueInput.js';
import { isContainerInput } from '../session/containerExpansion.js';
import { isShowItem } from '../search/showOn.js';

// Above the search dropdown (Mantine popover layer, 300): a picker opened from a search row must sit over
// the still-open results, not under them (FIND.1a/AC5).
const PICKER_Z_INDEX = 600;

export function ItemDestinationPicker({ action, onClose }) {
  if (!action) return null;
  const item = resultToQueueInput(action.item);
  if (action.kind === 'showBrieflyOn') {
    // Show briefly (RQ-PLAY-11): over the screen's programme, which then returns.
    return <Modal opened onClose={onClose} zIndex={PICKER_Z_INDEX} title="Show briefly on…">
      <DispatchTargetPicker source={{ play: item.contentId, title: item.title, brief: true }} verb="Show briefly" onComplete={onClose} />
    </Modal>;
  }
  const adding = action.kind === 'addOn';
  const showing = !adding && isShowItem(action.item);
  const source = {
    [adding ? 'queue' : 'play']: item.contentId, title: item.title,
    itemAction: { kind: adding ? 'add' : 'playNow', item, clearRest: !adding && isContainerInput(item) },
  };
  return <Modal opened onClose={onClose} zIndex={PICKER_Z_INDEX} title={adding ? 'Add on…' : (showing ? 'Show on…' : 'Play on…')}>
    <DispatchTargetPicker source={source} verb={adding ? 'Add' : (showing ? 'Show' : 'Play')} onComplete={onClose} />
  </Modal>;
}
