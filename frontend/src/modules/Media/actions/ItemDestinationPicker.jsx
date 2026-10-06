import React from 'react';
import { Modal } from '@mantine/core';
import { DispatchTargetPicker } from '../cast/DispatchTargetPicker.jsx';
import { resultToQueueInput } from '../search/resultToQueueInput.js';
import { isContainerInput } from '../session/containerExpansion.js';

export function ItemDestinationPicker({ action, onClose }) {
  if (!action) return null;
  const item = resultToQueueInput(action.item);
  if (action.kind === 'showBrieflyOn') {
    // Show briefly (RQ-PLAY-11): over the screen's programme, which then returns.
    return <Modal opened onClose={onClose} title="Show briefly on…">
      <DispatchTargetPicker source={{ play: item.contentId, title: item.title, brief: true }} verb="Show briefly" onComplete={onClose} />
    </Modal>;
  }
  const adding = action.kind === 'addOn';
  const source = {
    [adding ? 'queue' : 'play']: item.contentId, title: item.title,
    itemAction: { kind: adding ? 'add' : 'playNow', item, clearRest: !adding && isContainerInput(item) },
  };
  return <Modal opened onClose={onClose} title={adding ? 'Add on…' : 'Play on…'}>
    <DispatchTargetPicker source={source} verb={adding ? 'Add' : 'Play'} onComplete={onClose} />
  </Modal>;
}
