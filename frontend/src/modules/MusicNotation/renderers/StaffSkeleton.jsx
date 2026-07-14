/**
 * StaffSkeleton — engrave-phase placeholder for the sheet-music renderer.
 *
 * Shown while OSMD is still engraving (nothing painted yet), it shimmers a stack
 * of 5-line staff systems so the loading state reads as "sheet music is coming"
 * rather than a bare "Engraving…" label (audit H0). Decorative only (aria-hidden);
 * the shimmer reuses the piano skeleton's `is-shimmer` sweep and flattens under
 * prefers-reduced-motion via CSS.
 *
 * @param {object} p
 * @param {number} [p.systems=4] - number of staff systems (rows) to draw
 */
export default function StaffSkeleton({ systems = 4 }) {
  return (
    <div className="staff-skeleton" aria-hidden="true">
      {Array.from({ length: systems }, (_, s) => (
        <div key={s} className="staff-skeleton__system">
          {Array.from({ length: 5 }, (_, l) => (
            <div key={l} className="staff-skeleton__line piano-skeleton is-shimmer" />
          ))}
        </div>
      ))}
    </div>
  );
}
