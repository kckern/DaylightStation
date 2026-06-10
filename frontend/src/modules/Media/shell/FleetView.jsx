// frontend/src/modules/Media/shell/FleetView.jsx
// Fleet observation. Skeleton until the fleet phase wires device config +
// live state.
import React from 'react';
import { Stack, Title, Text } from '@mantine/core';

export function FleetView() {
  return (
    <Stack data-testid="fleet-view" className="fleet-view" gap="md">
      <Title order={1}>Devices</Title>
      <Text c="dimmed" data-testid="fleet-placeholder">Live device cards land in the fleet phase.</Text>
    </Stack>
  );
}

export default FleetView;
