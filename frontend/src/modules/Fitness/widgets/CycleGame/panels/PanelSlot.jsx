import React from 'react';
import PropTypes from 'prop-types';
// Fade+slide on mount; CSS handles the transition (motion plays — the global
// animation-kill is Menu-scoped, not here). Keyed by panelId so a swap remounts.
export default function PanelSlot({ panelId, children }) {
  return (
    <div className="race-layout__slot" key={panelId} data-panel={panelId}>{children}</div>
  );
}
PanelSlot.propTypes = { panelId: PropTypes.string, children: PropTypes.node };
