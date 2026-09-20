// frontend/src/modules/Media/shell/FleetIndicator.jsx
// Shared house playback summary; opens the canonical Fleet view.
import React from 'react';
import { Button } from '@mantine/core';
import { IconDevices } from '@tabler/icons-react';
import { useNav } from './NavProvider.jsx';
import { useFleetSummary } from '../fleet/useFleetSummary.js';

export function FleetIndicator() {
  const { view, push } = useNav();
  const { playing, paused } = useFleetSummary();
  const summary = paused ? `${playing} playing · ${paused} paused` : `${playing} playing`;
  return (
    <Button
      variant="subtle"
      color="gray"
      size="sm"
      leftSection={<IconDevices size={18} />}
      data-testid="house-indicator"
      aria-current={view === 'fleet' ? 'page' : undefined}
      onClick={() => push('fleet', {})}
    >
      {summary}
    </Button>
  );
}

export default FleetIndicator;
