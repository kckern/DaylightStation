import { useEffect, useId, useRef } from 'react';
import TransportButton from './TransportButton.jsx';
import './Transport.scss';

const FOCUSABLE = 'button:not([disabled]), [href], select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * TransportSheet — the kiosk's one modal-sheet shell: full-screen scrim that
 * dismisses on tap, a titled panel with a 48px close button, focus trapped
 * inside, Escape closes, focus returns to the opener on unmount.
 *
 * `size="auto"` (default) is the centered transport sheet (volume, key, tempo,
 * loop). `size="canvas"` fills the design canvas minus a margin for the
 * settings sheets, whose bodies lay out in columns and must never scroll.
 *
 * Initial focus goes to the first content control; Close is the fallback only
 * when the body has nothing focusable.
 */
export default function TransportSheet({ open, title, onClose, children, size = 'auto', className = '' }) {
  const titleId = useId();
  const panel = useRef(null);
  const opener = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    opener.current = document.activeElement;
    const focusables = () => [...(panel.current?.querySelectorAll(FOCUSABLE) || [])];
    const initial = focusables();
    (initial.find((node) => !node.classList.contains('piano-tsheet__close')) || initial[0])?.focus();
    const keydown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab') return;
      const nodes = focusables();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!panel.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); opener.current?.focus?.(); };
  }, [open]);

  if (!open) return null;
  const classes = ['piano-tsheet', size === 'canvas' ? 'piano-tsheet--canvas' : '', className].filter(Boolean).join(' ');
  return (
    <div className={classes} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button type="button" className="piano-tsheet__scrim" aria-label={`Dismiss ${title}`} tabIndex={-1} onClick={onClose} />
      <div ref={panel} className="piano-tsheet__panel">
        <header className="piano-tsheet__head">
          <h2 id={titleId}>{title}</h2>
          <TransportButton icon="close" ariaLabel={`Close ${title}`} emphasis="quiet" className="piano-tsheet__close" onPress={onClose} />
        </header>
        {children}
      </div>
    </div>
  );
}
