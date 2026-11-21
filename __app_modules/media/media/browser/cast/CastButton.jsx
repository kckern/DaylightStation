import React, { useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useDismissLayer } from '@/lib/ui/dismiss/useDismissLayer.js';
import { observeVisualViewport } from '@/lib/ui/observeVisualViewport.js';
import { DispatchTargetPicker } from "./DispatchTargetPicker.jsx";
import { isContainer } from "../../../../../__capabilities/content-catalog/browser/combobox-state.mjs";

const PICKER_WIDTH = 280; // mirrors .cast-picker min-width (Cast.scss)
const VIEWPORT_MARGIN = 8;
const POPOVER_GAP = 6;
// The picker chrome (label, mode controls and CTA) needs enough room to
// remain visible while the device list scrolls.  When there is less room
// below the trigger, prefer the larger space above it.
const PICKER_MIN_USABLE_HEIGHT = 240;

export function CastButton({ contentId, queue, title, item, onAction }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);

  const closeToTrigger = () => {
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  };
  useDismissLayer(open, closeToTrigger);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const button = buttonRef.current;
    const popover = popoverRef.current;
    const reposition = () => positionPicker(button, popover);
    const repositionOnAnchorScroll = (event) => {
      if (event.target?.contains?.(button)) reposition();
    };
    const stopObserving = observeVisualViewport(reposition);
    // Scroll events do not bubble, so capture them to reposition when a nested
    // app scroller moves the trigger while the picker is portaled to body. Ignore
    // scrolls inside the picker, which cannot change the trigger's coordinates.
    window.addEventListener('scroll', repositionOnAnchorScroll, true);
    popover.focus({ preventScroll: true });

    const dismissOutside = (event) => {
      const path = event.composedPath();
      if (!path.includes(button) && !path.includes(popover)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    return () => {
      stopObserving();
      window.removeEventListener('scroll', repositionOnAnchorScroll, true);
      document.removeEventListener('pointerdown', dismissOutside, true);
    };
  }, [open]);

  const id = contentId ?? queue;
  // `title` (optional, additive) is the human content name the progress
  // tray shows instead of the raw content id.
  const source = contentId ? { play: contentId, title } : { queue, title };
  source.itemAction = { kind: contentId ? 'playNow' : 'add', item: { ...item, contentId: id, title },
    clearRest: !!contentId && isContainer(item ?? {}) };

  const onComplete = () => {
    closeToTrigger();
    onAction?.();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid={`cast-button-${id}`}
        className="result-action cast-button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        Cast
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Cast to a device"
          tabIndex={-1}
          data-testid={`cast-button-popover-${id}`}
          className="media-app-portal cast-button-popover-portal"
        >
          <DispatchTargetPicker source={source} onComplete={onComplete} autoFocus={false} />
        </div>,
        document.body
      )}
    </>
  );
}

function positionPicker(button, popover) {
  const rect = button.getBoundingClientRect();
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const left = viewportLeft + VIEWPORT_MARGIN;
  const right = viewportLeft + viewportWidth - VIEWPORT_MARGIN;
  const top = viewportTop + VIEWPORT_MARGIN;
  const bottom = viewportTop + viewportHeight - VIEWPORT_MARGIN;
  const pickerRight = Math.min(right, Math.max(rect.right, left + PICKER_WIDTH));
  const belowAnchor = Math.max(top, rect.bottom + POPOVER_GAP);
  const aboveAnchor = Math.min(bottom, rect.top - POPOVER_GAP);
  const spaceBelow = Math.max(0, bottom - belowAnchor);
  const spaceAbove = Math.max(0, aboveAnchor - top);
  const openAbove = spaceBelow < PICKER_MIN_USABLE_HEIGHT && spaceAbove > spaceBelow;

  popover.style.top = openAbove ? '' : `${belowAnchor}px`;
  popover.style.bottom = openAbove ? `${window.innerHeight - aboveAnchor}px` : '';
  popover.style.right = `${window.innerWidth - pickerRight}px`;
  popover.style.setProperty('--cast-picker-max-width', `${pickerRight - left}px`);
  popover.style.setProperty('--cast-picker-max-height', `${openAbove ? spaceAbove : spaceBelow}px`);
}

export default CastButton;
