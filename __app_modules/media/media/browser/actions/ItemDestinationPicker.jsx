import React from 'react';
import { FormDialog } from '@/lib/ui/FormDialog.jsx';
import { useOverlayFocusReturn } from '@/lib/ui/dismiss/useOverlayFocusReturn.js';
import { DispatchTargetPicker } from "../cast/DispatchTargetPicker.jsx";
import { resultToQueueInput } from "../search/resultToQueueInput.js";
import { isContainerInput } from "../session/containerExpansion.js";
import { isShowItem } from "../search/showOn.js";

/** "Play Sonic the Hedgehog on…" — the one heading names the item. */
export function pickerHeading(verb, title) {
  const name = typeof title === 'string' ? title.trim() : '';
  return name ? `${verb} ${name} on…` : `${verb} on…`;
}

// Above the search dropdown (Mantine popover layer, 300): a picker opened from a search row must sit over
// the still-open results, not under them (FIND.1a/AC5).
const PICKER_Z_INDEX = 600;

export function ItemDestinationPicker({ action, onClose, returnFocusRef }) {
  const open = Boolean(action);
  useOverlayFocusReturn(open && Boolean(returnFocusRef), returnFocusRef);
  if (!open) return null;
  const modalProps = { opened: true, onClose, returnFocus: !returnFocusRef, zIndex: PICKER_Z_INDEX };
  const item = resultToQueueInput(action.item);
  if (action.kind === 'showBrieflyOn') {
    // Show briefly (RQ-PLAY-11): over the screen's programme, which then returns.
    return <FormDialog {...modalProps} title={pickerHeading('Show briefly', item.title)}>
      <DispatchTargetPicker source={{ play: item.contentId, title: item.title, brief: true }} verb="Show briefly" onComplete={onClose} />
    </FormDialog>;
  }
  const adding = action.kind === 'addOn';
  const showing = !adding && isShowItem(action.item);
  const source = {
    [adding ? 'queue' : 'play']: item.contentId, title: item.title,
    itemAction: { kind: adding ? 'add' : 'playNow', item, clearRest: !adding && isContainerInput(item) },
  };
  return <FormDialog {...modalProps} title={pickerHeading(adding ? 'Add' : (showing ? 'Show' : 'Play'), item.title)}>
    <DispatchTargetPicker source={source} verb={adding ? 'Add' : (showing ? 'Show' : 'Play')} onComplete={onClose} />
  </FormDialog>;
}
