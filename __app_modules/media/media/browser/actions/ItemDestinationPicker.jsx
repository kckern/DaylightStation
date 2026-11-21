import React from 'react';
import { useDismissLayer } from '@/lib/ui/dismiss/useDismissLayer.js';
import { useOverlayFocusReturn } from '@/lib/ui/dismiss/useOverlayFocusReturn.js';
import { Modal } from '@mantine/core';
import { DispatchTargetPicker } from "../cast/DispatchTargetPicker.jsx";
import { resultToQueueInput } from "../search/resultToQueueInput.js";
import { isContainerInput } from "../session/containerExpansion.js";
import { isShowItem } from "../search/showOn.js";

// Above the search dropdown (Mantine popover layer, 300): a picker opened from a search row must sit over
// the still-open results, not under them (FIND.1a/AC5).
const PICKER_Z_INDEX = 600;

export function ItemDestinationPicker({ action, onClose, returnFocusRef }) {
  const open = Boolean(action);
  const usesDismissStack = useDismissLayer(open, onClose);
  useOverlayFocusReturn(open && Boolean(returnFocusRef), returnFocusRef);
  if (!open) return null;
  const modalProps = { opened: true, onClose, closeOnEscape: !usesDismissStack, returnFocus: !returnFocusRef, zIndex: PICKER_Z_INDEX };
  const item = resultToQueueInput(action.item);
  if (action.kind === 'showBrieflyOn') {
    // Show briefly (RQ-PLAY-11): over the screen's programme, which then returns.
    return <Modal {...modalProps} title="Show briefly on…">
      <DispatchTargetPicker source={{ play: item.contentId, title: item.title, brief: true }} verb="Show briefly" onComplete={onClose} />
    </Modal>;
  }
  const adding = action.kind === 'addOn';
  const showing = !adding && isShowItem(action.item);
  const source = {
    [adding ? 'queue' : 'play']: item.contentId, title: item.title,
    itemAction: { kind: adding ? 'add' : 'playNow', item, clearRest: !adding && isContainerInput(item) },
  };
  return <Modal {...modalProps} title={adding ? 'Add on…' : (showing ? 'Show on…' : 'Play on…')}>
    <DispatchTargetPicker source={source} verb={adding ? 'Add' : (showing ? 'Show' : 'Play')} onComplete={onClose} />
  </Modal>;
}
