/**
 * A single radial progress mark, reused at program / season / course. Conic fill
 * driven by `--p`; a teal-ish "done" state shows a check. No 0/32 text anywhere.
 */
export default function ProgressRing({ percent = 0, label, done = false, size }) {
  const p = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const style = { '--p': String(p) };
  if (size) style.width = style.height = size;
  return (
    <span className={`psc-ring${done ? ' is-done' : ''}`} style={style} aria-hidden="true">
      <span className="psc-ring__c">{done ? '✓' : label}</span>
    </span>
  );
}
