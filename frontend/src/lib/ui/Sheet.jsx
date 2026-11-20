import { ActionIcon, FocusTrap } from '@mantine/core';
import { useViewOverlaysActive } from './AppFrame.jsx';
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
export function Sheet({ open, onClose, title, children, placement = 'center', returnFocusRef }) {
  const overlaysActive = useViewOverlaysActive();
  const visible = open && overlaysActive;
  const sheetRef = useKeyboardViewport(visible);
  useDismissLayer(open, onClose, { isActive: () => visible });
  useOverlayFocusReturn(open, returnFocusRef);
  useOverlayScrollLock(visible);

  if (!open) return null;
  const className = placement === 'side' || placement === 'fullscreen'
    ? `ds-sheet ds-sheet--${placement}` : 'ds-sheet';
  return (
    <div ref={sheetRef} className={className} hidden={!visible} role="dialog" aria-modal={visible || undefined} aria-label={title}>
      <div className="ds-sheet__scrim" onClick={onClose} />
      <FocusTrap active={visible}><div className="ds-sheet__panel" tabIndex={-1}>
        <header className="ds-sheet__header">
          <h3 className="ds-sheet__title">{title}</h3>
          <ActionIcon className="ds-touch-target" onClick={onClose} aria-label="Close">
            <UiIcon name="close" />
          </ActionIcon>
        </header>
        <div className="ds-sheet__body">{children}</div>
      </div></FocusTrap>
    </div>
  );
}

export default Sheet;
