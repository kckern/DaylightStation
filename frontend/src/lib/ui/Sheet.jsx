import { useEffect, useLayoutEffect } from 'react';
import { ActionIcon, FocusTrap } from '@mantine/core';
import { useDismissLayer } from './dismiss/useDismissLayer.js';
import './ds.scss';

// A dialog can be replaced in the same commit (entry -> coach). Transfer its
// return target before the detached button in the old dialog loses focus.
let pendingFocusReturn = null;

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/**
 * The house overlay: bottom sheet on mobile, centered dialog on desktop (CSS).
 * Registers on the dismiss stack (Escape), closes on scrim click, locks
 * body scroll while open.
 */
export function Sheet({ open, onClose, title, children }) {
  useDismissLayer(open, onClose);
  // Also handle sheets mounted already open and removed on close. A hook
  // listening only for opened -> false misses that common lifecycle.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const opener = pendingFocusReturn?.opener?.isConnected
      ? pendingFocusReturn.opener : document.activeElement;
    pendingFocusReturn = null;
    return () => {
      const request = { opener };
      pendingFocusReturn = request;
      queueMicrotask(() => {
        if (pendingFocusReturn !== request) return;
        pendingFocusReturn = null;
        if (opener?.isConnected) opener.focus?.({ preventScroll: true });
      });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    return lockSheetScroll();
  }, [open]);

  if (!open) return null;
  return (
    <div className="ds-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ds-sheet__scrim" onClick={onClose} />
      <FocusTrap active={open}><div className="ds-sheet__panel" tabIndex={-1}>
        <header className="ds-sheet__header">
          <h3 className="ds-sheet__title">{title}</h3>
          <ActionIcon onClick={onClose} aria-label="Close"><CloseIcon /></ActionIcon>
        </header>
        <div className="ds-sheet__body">{children}</div>
      </div></FocusTrap>
    </div>
  );
}

let locks = 0;
let restoreScroll = () => {};
function lockSheetScroll() {
  if (locks++ === 0) {
    const elements = [document.body, ...document.querySelectorAll('.ds-chrome__main')];
    const previous = elements.map(element => element.style.overflow);
    elements.forEach(element => { element.style.overflow = 'hidden'; });
    restoreScroll = () => elements.forEach((element, index) => { element.style.overflow = previous[index]; });
  }
  return () => { if (--locks === 0) restoreScroll(); };
}

export default Sheet;
