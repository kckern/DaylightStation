import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { DispatchTargetPicker } from './DispatchTargetPicker.jsx';
import { useDismissable } from '../../../hooks/useDismissable.js';

const PICKER_WIDTH = 260; // mirrors .dispatch-target-picker min-width

export function CastButton({ contentId, queue, onAction }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);

  // useDismissable watches the popover node for outside clicks/Escape.
  // The button itself is outside the popover, so we suppress the dismiss when
  // the click target is the button (the toggle logic in onClick handles that).
  useDismissable(popoverRef, { open, onDismiss: close });

  const id = contentId ?? queue;
  const source = contentId ? { play: contentId } : { queue };

  // Compute fixed position from the trigger button's bounding rect each time
  // the picker opens so it tracks the button wherever it sits on screen.
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const right = window.innerWidth - rect.right;
    // Clamp so the picker stays within the viewport horizontally.
    const adjustedRight = Math.max(8, Math.min(right, window.innerWidth - PICKER_WIDTH - 8));
    setCoords({ top: rect.bottom + 6, right: adjustedRight });
  }, [open]);

  const onComplete = () => {
    setOpen(false);
    onAction?.();
  };

  const handleButtonClick = (e) => {
    e.stopPropagation();
    setOpen((v) => !v);
  };

  return (
    <>
      <button
        ref={buttonRef}
        data-testid={`cast-button-${id}`}
        className="cast-button"
        onClick={handleButtonClick}
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
        document.body,
      )}
    </>
  );
}

export default CastButton;
