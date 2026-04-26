import React from 'react';
import './ActionLoadingShell.scss';

/**
 * ActionLoadingShell — minimal blank placeholder shown while an initial
 * action (play/queue/open) is bootstrapping its handler. Replaces the
 * YAML layout for the first paint to avoid a menu-flash.
 */
export function ActionLoadingShell() {
  return (
    <div className="action-loading-shell">
      <div className="action-loading-shell__spinner" aria-hidden="true" />
    </div>
  );
}

export default ActionLoadingShell;
