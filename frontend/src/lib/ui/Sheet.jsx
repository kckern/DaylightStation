import { ActionIcon } from '@mantine/core';
import { useRef } from 'react';
import { useViewOverlaysActive } from './AppFrame.jsx';
import { useDialogFocus } from './dismiss/useDialogFocus.js';
import { useDismissLayer } from './dismiss/useDismissLayer.js';
import { useOverlayFocusReturn } from './dismiss/useOverlayFocusReturn.js';
import { UiIcon } from './UiIcon.jsx';
import { useKeyboardViewport } from './useKeyboardViewport.js';
import { useOverlayScrollLock } from './useOverlayScrollLock.js';
import './ds.scss';

/**
 * The house overlay: bottom sheet on mobile; on desktop a centered dialog by
 * default. Use `placement="side"` for a desktop drill-in or
 * `placement="fullscreen"` for an edge-to-edge camera stage. A visible sheet
 * registers on the dismiss stack and locks its frame and the document.
 */
export function Sheet({ open, onClose, title, children, placement = 'center', returnFocusRef, getFallbackFocusTarget }) {
  const overlaysActive = useViewOverlaysActive();
  const visible = open && overlaysActive;
  const sheetRef = useKeyboardViewport(visible);
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  useDismissLayer(open, onClose, { isActive: () => visible });
  useOverlayFocusReturn(open, returnFocusRef, getFallbackFocusTarget);
  useOverlayScrollLock(visible);
  const handleKeys = useDialogFocus(visible, panelRef, closeRef);

  if (!open) return null;
  const className = placement === 'side' || placement === 'fullscreen'
    ? `ds-sheet ds-sheet--${placement}` : 'ds-sheet';
  return (
    <div ref={sheetRef} className={className} hidden={!visible} role="dialog" aria-modal={visible || undefined} aria-label={title}>
      <div className="ds-sheet__scrim" onClick={onClose} />
      <div className="ds-sheet__panel" ref={panelRef} tabIndex={-1} onKeyDown={handleKeys}>
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
