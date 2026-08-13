// frontend/src/modules/Auto/AutoStates.jsx
//
// The three states every panel can be in. Shared so "nothing here yet" reads
// the same everywhere, and — more importantly — so an empty panel always says
// WHY it is empty and what would fill it. A bare "No records" leaves the reader
// wondering whether the app is broken or they simply haven't logged anything.

export function Loading({ label = 'Loading' }) {
  return (
    <div className="auto-state auto-state--loading" role="status" aria-live="polite">
      <span className="auto-state__spinner" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function Failed({ error, onRetry }) {
  return (
    <div className="auto-state auto-state--error" role="alert">
      <p className="auto-state__title">Couldn’t load that</p>
      <p className="auto-state__detail">{error?.message || 'The request failed.'}</p>
      {onRetry && (
        <button type="button" className="auto-btn" onClick={onRetry}>Try again</button>
      )}
    </div>
  );
}

export function Empty({ title, detail, action }) {
  return (
    <div className="auto-state auto-state--empty">
      <p className="auto-state__title">{title}</p>
      {detail && <p className="auto-state__detail">{detail}</p>}
      {action}
    </div>
  );
}
