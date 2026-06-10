// frontend/src/modules/Media/shell/NowPlayingView.jsx
// Full local transport surface. Becomes SessionSurface-based in the
// local-experience phase.
import React from 'react';
import { Stack, Title, Text, Button } from '@mantine/core';
import { useNav } from './NavProvider.jsx';

export function NowPlayingView() {
  const { pop } = useNav();
  return (
    <Stack data-testid="now-playing-view" gap="md">
      <Button data-testid="now-playing-back" variant="subtle" color="gray" onClick={() => pop()} w="fit-content">
        ← Back
      </Button>
      <Title order={1}>Now Playing</Title>
      <Text c="dimmed">The player surface lands in the local-experience phase.</Text>
    </Stack>
  );
}

export default NowPlayingView;
