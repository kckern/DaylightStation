// frontend/src/modules/Media/cast/CastButton.jsx
// Per-item Cast affordance: opens the DispatchTargetPicker in a body portal
// positioned at the trigger. The portal carries .media-app-portal so the
// search overlay's outside-click logic treats it as inside (the historical
// unstyled/auto-closing portal bugs are both structural here: Mantine-free
// markup styled via unscoped classes, dismissal owned by useDismissable).
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { DispatchTargetPicker } from './DispatchTargetPicker.jsx';
import { useDismissable } from '../../../hooks/useDismissable.js';
import { isContainer } from '../../Content/combobox/comboboxMachine.js';

const PICKER_WIDTH = 280; // mirrors .cast-picker min-width (Cast.scss)
const VIEWPORT_MARGIN = 8;
const POPOVER_GAP = 6;
// The picker chrome (label, mode controls and CTA) needs enough room to
// remain visible while the device list scrolls.  When there is less room
// below the trigger, prefer the larger space above it.
const PICKER_MIN_USABLE_HEIGHT = 240;

export function CastButton({ contentId, queue, title, item, onAction }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);
  useDismissable(popoverRef, { open, onDismiss: close });

  const id = contentId ?? queue;
  // `title` (optional, additive) is the human content name the progress
  // tray shows instead of the raw content id.
  const source = contentId ? { play: contentId, title } : { queue, title };
  source.itemAction = { kind: contentId ? 'playNow' : 'add', item: { ...item, contentId: id, title },
    clearRest: !!contentId && isContainer(item ?? {}) };

  // Fixed position from the trigger's rect each open, clamped to viewport.
  // A tall device list must not push the mode controls and CTA outside the
  // browser viewport, so expose the available vertical space to Cast.scss.
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const right = window.innerWidth - rect.right;
    const adjustedRight = Math.max(VIEWPORT_MARGIN, Math.min(right, window.innerWidth - PICKER_WIDTH - VIEWPORT_MARGIN));
    const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - POPOVER_GAP - VIEWPORT_MARGIN);
    const spaceAbove = Math.max(0, rect.top - POPOVER_GAP - VIEWPORT_MARGIN);
    const openAbove = spaceBelow < PICKER_MIN_USABLE_HEIGHT && spaceAbove > spaceBelow;
    const maxHeight = openAbove ? spaceAbove : spaceBelow;

    setCoords({
      top: openAbove ? undefined : rect.bottom + POPOVER_GAP,
      bottom: openAbove ? window.innerHeight - rect.top + POPOVER_GAP : undefined,
      right: adjustedRight,
      maxHeight,
    });
  }, [open]);

  const onComplete = () => {
    setOpen(false);
    onAction?.();
  };

  return (
    <>
      <button
        ref={buttonRef}
        data-testid={`cast-button-${id}`}
        className="result-action cast-button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        Cast
      </button>
      {open && coords && createPortal(
        <div
          ref={popoverRef}
          data-testid={`cast-button-popover-${id}`}
          className="media-app-portal cast-button-popover-portal"
          style={{
            position: 'fixed',
            top: coords.top === undefined ? undefined : `${coords.top}px`,
            bottom: coords.bottom === undefined ? undefined : `${coords.bottom}px`,
            right: `${coords.right}px`,
            '--cast-picker-max-height': `${coords.maxHeight}px`,
            zIndex: 1000,
          }}
        >
          <DispatchTargetPicker source={source} onComplete={onComplete} />
        </div>,
        document.body
      )}
    </>
  );
}

export default CastButton;
