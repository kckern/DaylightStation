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

const PICKER_WIDTH = 280; // mirrors .cast-picker min-width (Cast.scss)

export function CastButton({ contentId, queue, title, onAction }) {
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

  // Fixed position from the trigger's rect each open, clamped to viewport.
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const right = window.innerWidth - rect.right;
    const adjustedRight = Math.max(8, Math.min(right, window.innerWidth - PICKER_WIDTH - 8));
    setCoords({ top: rect.bottom + 6, right: adjustedRight });
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
          style={{ position: 'fixed', top: `${coords.top}px`, right: `${coords.right}px`, zIndex: 1000 }}
        >
          <DispatchTargetPicker source={source} onComplete={onComplete} />
        </div>,
        document.body
      )}
    </>
  );
}

export default CastButton;
