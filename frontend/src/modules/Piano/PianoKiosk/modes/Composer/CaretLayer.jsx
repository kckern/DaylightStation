export function CaretLayer({ steps = [], caretStepIndex = 0, scale = 1 }) {
  if (!steps.length) return null;
  const clamped = Math.min(caretStepIndex, steps.length - 1);
  const step = steps[clamped];
  const note = step?.notes?.[0];
  if (!note) return null;
  // Past-the-end caret parks just right of the last note; otherwise sits at the step's x.
  const past = caretStepIndex >= steps.length;
  const x = past ? note.x + (note.width || 12) + 6 * scale : note.x;
  const height = Math.max(40 * scale, (note.bottom - note.top) || 40);
  return (
    <div
      className="composer-caret"
      style={{ transform: `translate3d(${x}px, ${note.top}px, 0)`, width: Math.round(18 * scale), height }}
    />
  );
}
