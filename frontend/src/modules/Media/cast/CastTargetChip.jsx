import React, { useState, useRef, useCallback } from 'react';
import { useCastTarget } from './useCastTarget.js';
import { useFleetContext } from '../fleet/FleetProvider.jsx';
import { CastPopover } from './CastPopover.jsx';
import { useDismissable } from '../../../hooks/useDismissable.js';

export function CastTargetChip() {
  const { targetIds } = useCastTarget();
  const { devices } = useFleetContext();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);
  useDismissable(rootRef, { open, onDismiss: close });

  const selectedNames = targetIds
    .map((id) => devices.find((d) => d.id === id)?.name ?? id)
    .join(', ');
  const label = targetIds.length === 0 ? 'No target' : selectedNames;

  return (
    <div className="cast-target-chip-root" ref={rootRef}>
      <button
        data-testid="cast-target-chip"
        className="cast-target-chip"
        onClick={() => setOpen((o) => !o)}
      >
        Cast: {label}
      </button>
      {open && <CastPopover />}
    </div>
  );
}

export default CastTargetChip;
