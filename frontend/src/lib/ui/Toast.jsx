import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './ds.scss';

/**
 * Where post-action feedback lives: a fixed region under the app header,
 * portalled to <body> so a notice appearing or retiring never moves the page
 * beneath it. Always mounted, even empty, so screen readers already know the
 * live region when the first toast arrives.
 */
export function ToastRegion({ label = 'Notifications', children }) {
  if (typeof document === 'undefined') return null;
  return createPortal(<div className="ds-toasts" role="region" aria-label={label}>{children}</div>, document.body);
}

/**
 * One card in the region. The caller owns the state (a toast is a view of
 * something the app already holds, e.g. an undo token), so actions stay
 * reactive — a busy Undo shows its spinner in place.
 *
 * `autoCloseMs` is for pure information only. Anything that offers an action
 * (Undo, Retry) must stay until the person uses or dismisses it: an undo that
 * expires while the phone is in a pocket is an undo that was never offered.
 * The countdown pauses while the pointer or focus is on the card.
 */
export function Toast({ tone = 'info', message, children, autoCloseMs = null, onAutoClose }) {
  const [held, setHeld] = useState(false);
  const onAutoCloseRef = useRef(onAutoClose);
  onAutoCloseRef.current = onAutoClose;
  useEffect(() => {
    if (!autoCloseMs || held) return undefined;
    const timer = setTimeout(() => onAutoCloseRef.current?.(), autoCloseMs);
    return () => clearTimeout(timer);
  }, [autoCloseMs, held, message]);
  return <div className={`ds-toast ds-toast--${tone}`} role={tone === 'error' ? 'alert' : 'status'}
    onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}
    onFocus={() => setHeld(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setHeld(false); }}>
    <span className="ds-toast__message">{message}</span>
    {children ? <span className="ds-toast__actions">{children}</span> : null}
  </div>;
}

export default Toast;
