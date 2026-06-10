// frontend/src/modules/Media/shell/PeekPanel.jsx
// Remote control for one device. Becomes SessionSurface-based (remote
// controller + optimistic overlay) in the peek phase.
import React from 'react';
import { Stack, Title, Text, Button } from '@mantine/core';
import { useNav } from './NavProvider.jsx';

export function PeekPanel({ deviceId }) {
  const { pop } = useNav();
  return (
    <Stack data-testid="peek-panel" className="peek-panel" gap="md">
      <Button data-testid="peek-back" variant="subtle" color="gray" onClick={() => pop()} w="fit-content">
        ← Fleet
      </Button>
      <Title order={1}>Remote</Title>
      <Text c="dimmed">Remote control for {deviceId ?? 'this device'} lands in the peek phase.</Text>
    </Stack>
  );
}

export default PeekPanel;
