import { useEffect, useRef } from 'react';
import GameButton from './GameButton.jsx';
import './gameChrome.scss';

/**
 * A panel over the board — settings, a roster, anything that is a pause in the
 * game rather than a different room.
 *
 * Every game that needed one built its own. Chess's `.chess-settings` was a
 * bare `<section>` with no dialog semantics at all: nothing announced it, Escape
 * did nothing, focus stayed wherever it had been, and with six groups on an
 * 800px canvas the last one simply fell off the bottom with no way to reach it.
 *
 * OPAQUE, deliberately. A translucent panel over a chessboard leaves the board
 * showing through the controls, which is unreadable — and on the kiosk tablet it
 * costs real frames, because a see-through full-width layer defeats occlusion
 * culling.
 *
 * The scrim is a sibling rather than a parent so the sheet is not nested inside
 * a click-to-dismiss target: a stray tap on a control must never close the panel
 * on a touchscreen.
 */
export default function GameSheet({
  title,
  onClose,
  closeLabel = 'Done',
  footer = null,
  className = '',
  children,
}) {
  const sheet = useRef(null);

  useEffect(() => {
    // The panel is a pause; Escape resumes. A kiosk has no keyboard, but the
    // browser-driven tests and a desk review both do, and a dialog that cannot
    // be dismissed from the keyboard is not a dialog.
    const onKey = (event) => { if (event.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    // Move focus INTO the sheet so a screen reader lands on it and does not keep
    // reading the board behind it.
    sheet.current?.focus?.();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="pg-sheet__scrim" aria-hidden="true" onClick={onClose} />
      <section
        ref={sheet}
        className={`pg-sheet ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="pg-sheet__head">
          <h2 className="pg-sheet__title">{title}</h2>
          <GameButton variant="ghost" onClick={onClose}>{closeLabel}</GameButton>
        </header>
        {/* Scrolls on its own, so a panel with more groups than fit is reachable
            rather than truncated — and the head and foot stay put while it does. */}
        <div className="pg-sheet__body">{children}</div>
        {footer && <footer className="pg-sheet__foot">{footer}</footer>}
      </section>
    </>
  );
}

/**
 * One labelled setting inside a sheet.
 *
 * `note` is for the caveat a control cannot say itself — "next game" on a
 * setting that cannot safely take effect mid-play. It sits under the control
 * rather than inside its label, because a caveat inside a button's accessible
 * name is read out on every single option.
 */
export function GameField({ label, note = null, children, className = '' }) {
  return (
    <div className={`pg-field ${className}`.trim()}>
      <h3 className="pg-field__label">{label}</h3>
      {children}
      {note && <p className="pg-field__note">{note}</p>}
    </div>
  );
}
