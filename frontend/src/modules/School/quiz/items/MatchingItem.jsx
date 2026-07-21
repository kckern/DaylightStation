/**
 * Pair the left column with the right. Two gestures, one mechanism:
 *  - tap a left chip (selects it), then tap a right chip -> pair
 *  - drag from a left chip and release on a right chip -> pair
 * Both are pointerdown-on-left / pointerup-on-right; a tap is just a drag of
 * zero distance with an intervening pointerup on the same chip (which keeps
 * the selection). Tapping an already-paired left chip unpairs it. Drag is
 * allowed on the Portal (R4.4) — this is NOT the fitness no-drag surface.
 * Rights are displayed shuffled so the answer isn't the layout.
 */
import { useMemo, useRef, useState } from 'react';

export default function MatchingItem({ item, onSubmit, verdict }) {
  const [selected, setSelected] = useState(null);      // left value awaiting a right
  const [pairs, setPairs] = useState({});               // left -> right
  const dragFrom = useRef(null);
  const rights = useMemo(
    () => [...item.pairs].map((p) => p.right).sort(() => 0.5 - Math.random()),
    [item],
  );
  const pairedRights = new Set(Object.values(pairs));
  const complete = Object.keys(pairs).length === item.pairs.length;

  const downLeft = (e, left) => {
    if (verdict) return;
    // Touch pointers get IMPLICIT POINTER CAPTURE: without this release, every
    // later pointer event (including the pointerup that lands on a right chip)
    // is retargeted to THIS chip, so drag-to-connect silently never completes
    // on the real panel. Tests dispatch events directly at elements and would
    // not catch it. releasePointerCapture makes pointerup hit what's under the
    // finger. Guarded: jsdom/mouse paths may not have the pointer captured.
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* not captured */ }
    if (pairs[left]) { // unpair
      setPairs((p) => { const n = { ...p }; delete n[left]; return n; });
      setSelected(null);
      return;
    }
    dragFrom.current = left;
    setSelected(left);
  };
  const upRight = (right) => {
    if (verdict || pairedRights.has(right)) return;
    const left = dragFrom.current || selected;
    if (!left) return;
    setPairs((p) => ({ ...p, [left]: right }));
    setSelected(null);
    dragFrom.current = null;
  };

  return (
    <div className="school-item school-item--matching">
      <p className="school-item__prompt">{item.prompt}</p>
      <div className="school-item__columns">
        <div className="school-item__col">
          {item.pairs.map(({ left }) => (
            <button key={left} type="button"
              className={`school-item__chip${selected === left ? ' school-item__chip--selected' : ''}${pairs[left] ? ' school-item__chip--paired' : ''}`}
              disabled={!!verdict}
              aria-label={left}
              onPointerDown={(e) => downLeft(e, left)}>
              {left}{pairs[left] ? ` → ${pairs[left]}` : ''}
            </button>
          ))}
        </div>
        <div className="school-item__col">
          {rights.map((right) => (
            <button key={right} type="button"
              className={`school-item__chip${pairedRights.has(right) ? ' school-item__chip--paired' : ''}`}
              disabled={!!verdict}
              onPointerUp={() => upRight(right)}>
              {right}
            </button>
          ))}
        </div>
      </div>
      {!verdict && (
        <button type="button" className="school-item__check" disabled={!complete}
          onClick={() => onSubmit(item.pairs.map(({ left }) => ({ left, right: pairs[left] })))}>
          Check
        </button>
      )}
      {verdict && !verdict.correct && (
        <div className="school-item__expected">
          {verdict.expected.map((p) => <p key={p.left}>{p.left} → {p.right}</p>)}
        </div>
      )}
    </div>
  );
}
