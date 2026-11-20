import { ActionIcon } from '@mantine/core';
import { useLayoutEffect, useRef } from 'react';
import { hideOthers } from 'aria-hidden';
import { tabbable } from 'tabbable';
import { useViewOverlaysActive } from './AppFrame.jsx';
import { useDismissLayer } from './dismiss/useDismissLayer.js';
import { useOverlayFocusReturn } from './dismiss/useOverlayFocusReturn.js';
import { UiIcon } from './UiIcon.jsx';
import { useKeyboardViewport } from './useKeyboardViewport.js';
import { useOverlayScrollLock } from './useOverlayScrollLock.js';
import './ds.scss';

const dialogSelector = 'dialog, [role="dialog"], [role="alertdialog"]';

function keepTabInPanel(event) {
  if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const panel = event.currentTarget;
  const focused = event.target;
  if (!panel.contains(focused) || focused.closest(dialogSelector) !== panel.closest(dialogSelector)) return;

  const stops = tabbable(panel);
  const backwards = event.shiftKey;
  const edge = backwards ? stops[0] : stops.at(-1);
  // A programmatically focused loading region can sit beyond the last tab stop.
  const beyondEdge = edge && !stops.includes(focused) && Boolean(focused.compareDocumentPosition(edge) & (
    backwards ? Node.DOCUMENT_POSITION_FOLLOWING : Node.DOCUMENT_POSITION_PRECEDING
  ));
  if (edge && focused !== panel && focused !== edge && !beyondEdge) return;
  event.preventDefault();
  (backwards ? stops.at(-1) : stops[0])?.focus();
}

function useSheetFocus(visible) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);

  useLayoutEffect(() => {
    if (!visible) return undefined;
    const panel = panelRef.current;
    const owner = panel.ownerDocument;
    const bodyRoot = Array.from(owner.body.children).find(node => node.contains(panel));
    const unhide = bodyRoot ? hideOthers(bodyRoot) : undefined;
    const opening = setTimeout(() => {
      if (panel.contains(owner.activeElement)) return;
      panel.querySelector('[data-autofocus]')?.focus({ preventScroll: true });
      if (!panel.contains(owner.activeElement)) closeRef.current?.focus({ preventScroll: true });
    }, 0);
    return () => {
      clearTimeout(opening);
      unhide?.();
    };
  }, [visible]);

  return { panelRef, closeRef };
}

/**
 * The house overlay: bottom sheet on mobile; on desktop a centered dialog by
 * default. Use `placement="side"` for a desktop drill-in or
 * `placement="fullscreen"` for an edge-to-edge camera stage. A visible sheet
 * registers on the dismiss stack and locks its frame and the document.
 */
export function Sheet({ open, onClose, title, children, placement = 'center', returnFocusRef }) {
  const overlaysActive = useViewOverlaysActive();
  const visible = open && overlaysActive;
  const sheetRef = useKeyboardViewport(visible);
  useDismissLayer(open, onClose, { isActive: () => visible });
  useOverlayFocusReturn(open, returnFocusRef);
  useOverlayScrollLock(visible);
  const { panelRef, closeRef } = useSheetFocus(visible);

  if (!open) return null;
  const className = placement === 'side' || placement === 'fullscreen'
    ? `ds-sheet ds-sheet--${placement}` : 'ds-sheet';
  return (
    <div ref={sheetRef} className={className} hidden={!visible} role="dialog" aria-modal={visible || undefined} aria-label={title}>
      <div className="ds-sheet__scrim" onClick={onClose} />
      <div className="ds-sheet__panel" ref={panelRef} tabIndex={-1} onKeyDown={keepTabInPanel}>
        <header className="ds-sheet__header">
          <h3 className="ds-sheet__title">{title}</h3>
          <ActionIcon ref={closeRef} className="ds-touch-target" onClick={onClose} aria-label="Close">
            <UiIcon name="close" />
          </ActionIcon>
        </header>
        <div className="ds-sheet__body">{children}</div>
      </div>
    </div>
  );
}

export default Sheet;
