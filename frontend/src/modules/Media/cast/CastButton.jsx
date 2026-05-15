import React, { useState, useRef, useCallback } from 'react';
import { DispatchTargetPicker } from './DispatchTargetPicker.jsx';
import { useDismissable } from '../../../hooks/useDismissable.js';

export function CastButton({ contentId, queue, onAction }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissable(rootRef, { open, onDismiss: close });

  const id = contentId ?? queue;
  const source = contentId ? { play: contentId } : { queue };

  const onComplete = () => {
    setOpen(false);
    onAction?.();
  };

  return (
    <span data-testid={`cast-button-root-${id}`} className="cast-button-root" ref={rootRef}>
      <button
        data-testid={`cast-button-${id}`}
        className="cast-button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        Cast
      </button>
      {open && (
        <div className="cast-button-popover">
          <DispatchTargetPicker source={source} onComplete={onComplete} />
        </div>
      )}
    </span>
  );
}

export default CastButton;
