import { useEffect, useRef, useState } from 'react';
import { useSchoolCommandListener } from '../../portal/useSchoolCommands.js';
import '../../../../../../frontend/src/lib/ui/ds.scss'; // ds-cursor-blink
import './TypedText.scss';

// Per-character pace, and a ceiling on the whole line so a long prompt never
// keeps a child waiting: a 120-character question still finishes in ~2.2 s.
const MS_PER_CHAR = 24;
const MAX_MS = 2200;
// The cursor keeps blinking this long after the last character, then goes.
const CURSOR_LINGER_MS = 1600;

/** No animation where it would only get in the way: reduced motion, or no matchMedia (jsdom). */
function animationAllowed() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A line the debrief "says": typed out a character at a time behind a
 * blinking block cursor (owner, 2026-11-20: "as if it were writing it").
 *
 * - The untyped rest is already laid out (invisible), so the line never
 *   reflows and nothing below it moves while it types.
 * - A tap, or a key nothing else claimed, finishes the line at once.
 * - Screen readers get the whole line immediately; the animation is aria-hidden.
 * - `hold` keeps the cursor blinking after the text (a "thinking…" line).
 * - Without animation (reduced motion, tests) it is the plain text.
 */
export default function TypedText({ text, hold = false, className = '' }) {
  const full = String(text ?? '');
  const [animate] = useState(animationAllowed);
  const [count, setCount] = useState(animate ? 0 : full.length);
  const [cursor, setCursor] = useState(animate || hold);
  const finish = useRef(() => {});
  // Keys reach the line through the School dispatcher (one keyboard owner).
  // It sees a key only when nothing ahead of it took it, which is fine: a key
  // that did something has moved the child on anyway.
  useSchoolCommandListener(() => finish.current(), { enabled: animate, allowInInput: true });

  useEffect(() => {
    if (!animate) { setCount(full.length); return undefined; }
    setCount(0); setCursor(true);
    const total = Math.min(MAX_MS, full.length * MS_PER_CHAR);
    const started = performance.now();
    let raf = 0; let linger = 0; let done = false;
    const end = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      setCount(full.length);
      if (!hold) linger = setTimeout(() => setCursor(false), CURSOR_LINGER_MS);
    };
    finish.current = end;
    const tick = (now) => {
      const n = total ? Math.floor(((now - started) / total) * full.length) : full.length;
      if (n >= full.length) { end(); return; }
      setCount(n);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const skip = () => end();
    window.addEventListener('pointerdown', skip, true);
    return () => {
      cancelAnimationFrame(raf); clearTimeout(linger);
      finish.current = () => {};
      window.removeEventListener('pointerdown', skip, true);
    };
  }, [full, animate, hold]);

  // Finished (or never animated): one plain text node, plus the cursor while
  // it lingers, so the line reads and queries as ordinary text.
  if (!animate || count >= full.length) {
    return cursor
      ? <span className={`typed ${className}`.trim()}>{full}<span className="typed__cursor" aria-hidden="true" /></span>
      : <>{full}</>;
  }
  return (
    <span className={`typed ${className}`.trim()}>
      <span className="typed__sr">{full}</span>
      <span aria-hidden="true">
        {full.slice(0, count)}
        {cursor && <span className="typed__cursor is-typing" />}
        {/* The untyped rest holds its place as CSS content, not text, so the
            whole sentence exists once in the DOM (the screen-reader copy). */}
        <span className="typed__rest" data-rest={full.slice(count)} />
      </span>
    </span>
  );
}
