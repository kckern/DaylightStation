import React from 'react';

export const SESSION_CONTROL_LAYOUT = 'seek transport queue';

export function SessionControlFrame({ targetKind, children }) {
  return (
    <div
      className="session-control-frame"
      data-testid={`session-controls-${targetKind}`}
      data-control-layout={SESSION_CONTROL_LAYOUT}
    >
      {children}
    </div>
  );
}

export default SessionControlFrame;
