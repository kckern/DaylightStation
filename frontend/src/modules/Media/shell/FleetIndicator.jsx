// frontend/src/modules/Media/shell/FleetIndicator.jsx
// At-a-glance fleet summary in the dock; opens the fleet view. The live
// active-session badge arrives with the fleet store (Phase 4).
import React from 'react';
import { Button } from '@mantine/core';
import { IconDevices } from '@tabler/icons-react';
import { useNav } from './NavProvider.jsx';

export function FleetIndicator() {
  const { view, push } = useNav();
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
      Devices
    </Button>
  );
}

export default FleetIndicator;
