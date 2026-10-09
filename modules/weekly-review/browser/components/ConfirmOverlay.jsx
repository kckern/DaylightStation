import React, { useEffect, useRef } from 'react';

// Shared modal shell. Moves keyboard/AT focus to the dialog on open so screen
// readers announce it. Key handling stays on the document-level listener in
// WeeklyReview (a focused tabIndex=-1 div does not intercept arrow/Enter/Escape).
export default function ConfirmOverlay({ labelId, ariaLive, children }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="weekly-review-confirm-overlay">
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        aria-live={ariaLive}
        tabIndex={-1}
        ref={ref}
      >
        {children}
      </div>
    </div>
  );
}
