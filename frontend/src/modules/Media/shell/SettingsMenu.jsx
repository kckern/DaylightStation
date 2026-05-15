import React, { useState, useCallback, useRef } from 'react';
import { useDismissable } from '../../../hooks/useDismissable.js';

export function SettingsMenu({ onResetSession }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);
  useDismissable(rootRef, { open, onDismiss: close });

  const onReset = () => {
    close();
    onResetSession?.();
  };

  return (
    <div data-testid="settings-menu-root" ref={rootRef} className="settings-menu-root">
      <button
        data-testid="settings-menu-trigger"
        className="settings-menu-trigger"
        aria-label="Settings"
        onClick={() => setOpen((v) => !v)}
      >
        ⚙
      </button>
      {open && (
        <div data-testid="settings-menu-panel" className="settings-menu-panel">
          <button
            data-testid="settings-reset-session"
            className="settings-menu-item"
            onClick={onReset}
          >
            Reset session
          </button>
        </div>
      )}
    </div>
  );
}

export default SettingsMenu;
