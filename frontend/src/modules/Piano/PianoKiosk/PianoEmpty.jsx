/** Consistent loading / empty / error message for kiosk lists, with an optional
 *  action button (e.g. "Try again" on a load failure). */
export default function PianoEmpty({ loading, message, actionLabel, onAction }) {
  return (
    <div className="piano-mode__placeholder">
      <p>{loading ? 'Loading…' : (message || 'Nothing here yet.')}</p>
      {!loading && actionLabel && onAction && (
        <button type="button" className="piano-empty__action" onClick={onAction}>{actionLabel}</button>
      )}
    </div>
  );
}
