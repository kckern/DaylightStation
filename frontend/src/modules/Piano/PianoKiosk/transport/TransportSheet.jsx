import { useEffect, useId, useRef } from 'react';
import TransportButton from './TransportButton.jsx';
import './Transport.scss';

const FOCUSABLE = 'button:not([disabled]), [href], select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open sheets. The top sheet is the one latest in DOCUMENT order, decided at
// use time — not push order, because React 18 runs a child's effect before
// its parent's, so a nested pair mounted open in one commit would otherwise
// crown the outer sheet.
const openSheets = [];
const top = () => openSheets.reduce((a, b) =>
  (a.current && b.current && (a.current.compareDocumentPosition(b.current) & Node.DOCUMENT_POSITION_FOLLOWING)) ? b : a);

/**
 * TransportSheet — the kiosk's one modal-sheet shell: full-screen scrim that
 * dismisses on tap, a titled panel with a 48px close button, focus trapped
 * inside, Escape closes, focus returns to the opener on unmount.
 *
 * `size="auto"` (default) is the centered transport sheet (volume, key, tempo,
 * loop). `size="canvas"` fills the design canvas minus a margin for the
 * settings sheets, whose bodies lay out in columns and must never scroll.
 *
 * Initial focus goes to `[data-autofocus]` if the body opts in, else the first
 * content control; Close is the fallback only when the body has nothing
 * focusable. Controls with `tabindex="-1"` are never trap targets.
 *
 * Invariant: only the topmost open sheet (latest in document order) handles
 * keys, captures the opener and takes initial focus. Escape is stopped at the
 * document so the screen framework's window listener never sees it as its
 * own escape action.
 */
export default function TransportSheet({ open, title, onClose, children, size = 'auto', className = '' }) {
  const titleId = useId();
  const panel = useRef(null);
  const opener = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    openSheets.push(panel);
    const focusables = () => [...(panel.current?.querySelectorAll(FOCUSABLE) || [])].filter((node) => node.tabIndex >= 0);
    if (top() === panel) {
      opener.current = document.activeElement;
      const initial = focusables();
      (panel.current?.querySelector('[data-autofocus]')
        || initial.find((node) => !node.classList.contains('piano-tsheet__close'))
        || initial[0])?.focus();
    }
    const keydown = (event) => {
      if (top() !== panel) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCloseRef.current(); return; }
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
    return () => {
      document.removeEventListener('keydown', keydown);
      const at = openSheets.indexOf(panel);
      if (at !== -1) openSheets.splice(at, 1);
      opener.current?.focus?.();
    };
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
