import { useEffect } from 'react';
import { ActionIcon } from '@mantine/core';
import { useDismissLayer } from './dismiss/useDismissLayer.js';
import './ds.scss';

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/**
 * The house overlay: bottom sheet on mobile, right panel on desktop (CSS).
 * Registers on the dismiss stack (Escape), closes on scrim click, locks
 * body scroll while open.
 */
export function Sheet({ open, onClose, title, children }) {
  useDismissLayer(open, onClose);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;
  return (
    <div className="ds-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ds-sheet__scrim" onClick={onClose} />
      <div className="ds-sheet__panel">
        <header className="ds-sheet__header">
          <h3 className="ds-sheet__title">{title}</h3>
          <ActionIcon onClick={onClose} aria-label="Close"><CloseIcon /></ActionIcon>
        </header>
        <div className="ds-sheet__body">{children}</div>
      </div>
    </div>
  );
}

export default Sheet;
