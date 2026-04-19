import React, { useState } from 'react';
import { useCastTarget } from './useCastTarget.js';
import { useFleetContext } from '../fleet/FleetProvider.jsx';
import { CastPopover } from './CastPopover.jsx';

export function CastTargetChip() {
  const { targetIds } = useCastTarget();
  const { devices } = useFleetContext();
  const [open, setOpen] = useState(false);

  const selectedNames = targetIds
    .map((id) => devices.find((d) => d.id === id)?.name ?? id)
    .join(', ');
  const label = targetIds.length === 0 ? 'No target' : selectedNames;

  return (
    <div className="cast-target-chip-root">
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
