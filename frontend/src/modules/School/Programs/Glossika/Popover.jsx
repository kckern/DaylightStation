import { useCallback, useEffect, useState } from 'react';

/**
 * A menu anchored to its trigger, dismissible by tapping away.
 *
 * Exists because the first pass shipped a menu with no backdrop and no escape
 * path: on a touch panel, opening it and tapping elsewhere left a 320px list
 * floating over the drill indefinitely. There is no `Escape` key on this
 * device, so tapping away is the ONLY dismissal the learner has and it cannot
 * be the one thing missing.
 *
 * Both menus in this program use it, so there is one dismissal behaviour to
 * reason about rather than one per menu.
 */
export default function Popover({ label, ariaLabel, children, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  // A hardware keyboard is not guaranteed here, so Escape is a convenience for
  // the desktop case — never the primary path.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  return (
    <div className="lang-popover">
      <button
        type="button"
        className="lang-popover__trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={ariaLabel}
      >
        {label}
      </button>
      {open && (
        <>
          {/* Covers the viewport beneath the panel so any tap outside closes
              it. Rendered before the panel so the panel stacks above. */}
          <button
            type="button"
            className="lang-popover__backdrop"
            aria-label="Close menu"
            onClick={close}
          />
          <div className={`lang-popover__panel lang-popover__panel--${align}`} role="menu">
            {typeof children === 'function' ? children(close) : children}
          </div>
        </>
      )}
    </div>
  );
}
