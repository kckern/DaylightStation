import { useEffect, useId, useRef } from 'react';
import Icon from '../ui/icons/Icon.jsx';

/** Accessible common shell for player and adult side sheets. */
export default function PianoSheet({ open, title, onClose, children, footer, className = '' }) {
  const titleId = useId();
  const sheet = useRef(null);
  const opener = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    opener.current = document.activeElement;
    const focus = () => sheet.current?.querySelector('[data-autofocus], button, [href], select, input, textarea, [tabindex]:not([tabindex="-1"])')?.focus();
    focus();
    const keydown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab') return;
      const nodes = [...sheet.current.querySelectorAll('button:not([disabled]), [href], select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!nodes.length) return;
      const first = nodes[0]; const last = nodes[nodes.length - 1];
      if (!sheet.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); opener.current?.focus?.(); };
  }, [open]);
  if (!open) return null;
  return <div className={`piano-sheet ${className}`}>
    <div className="piano-sheet__scrim" aria-hidden="true" onPointerDown={onClose} />
    <aside ref={sheet} className="piano-sheet__panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="piano-sheet__head"><h2 id={titleId}>{title}</h2><button type="button" data-autofocus className="piano-sheet__close" onClick={onClose} aria-label={`Close ${title}`}><Icon name="close" /></button></header>
      <div className="piano-sheet__body">{children}</div>
      {footer && <footer className="piano-sheet__foot">{footer}</footer>}
    </aside>
  </div>;
}
