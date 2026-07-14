// frontend/src/modules/Media/shell/FleetIndicator.jsx
// At-a-glance fleet summary in the dock; opens the fleet view.
import React from 'react';
import { Button } from '@mantine/core';
import { IconDevices } from '@tabler/icons-react';
import { useNav } from './NavProvider.jsx';
import { useFleetSummary } from '../fleet/useFleetSummary.js';

export function FleetIndicator() {
  const { view, push } = useNav();
  const { active, total } = useFleetSummary();
  return (
    <Button
      variant="subtle"
      color="gray"
      size="sm"
      leftSection={<IconDevices size={18} />}
      data-testid="fleet-indicator"
      aria-current={view === 'fleet' ? 'page' : undefined}
      onClick={() => push('fleet', {})}
    >
      Devices {active}/{total}
    </Button>
  );
}

export default FleetIndicator;
