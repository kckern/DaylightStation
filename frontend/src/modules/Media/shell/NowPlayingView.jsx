// frontend/src/modules/Media/shell/NowPlayingView.jsx
// Full local transport surface. Claims the player host so the ambient
// Player's visual output portals here; navigation away releases the host and
// audio continues from the hidden mount.
import React, { useRef } from 'react';
import { Button, Title, Text, Stack } from '@mantine/core';
import { useSessionController } from '../controller/useSessionController.js';
import { usePlayerHost } from '../session/usePlayerHost.js';
import { useNav } from './NavProvider.jsx';
import { TransportBar } from './TransportBar.jsx';
import { SeekBar } from './SeekBar.jsx';
import { QueuePanel } from './QueuePanel.jsx';
import { DispatchTargetPicker } from '../cast/DispatchTargetPicker.jsx';

export function NowPlayingView() {
  const { snapshot, portability } = useSessionController('local');
  const item = snapshot?.currentItem;
  const hostRef = useRef(null);
  usePlayerHost(hostRef);
  const { pop } = useNav();

  return (
    <Stack data-testid="now-playing-view" className="now-playing-view" gap="md">
      <div className="now-playing-toolbar">
        <Button
          data-testid="now-playing-back"
          variant="subtle"
          color="gray"
          onClick={() => pop()}
        >
          ← Back
        </Button>
        <Text size="sm" c="dimmed" data-testid="np-state">{snapshot?.state}</Text>
      </div>

      <Title
        order={1}
        className="now-playing-title"
        data-testid="now-playing-title"
        data-content-id={item?.contentId ?? ''}
      >
        {item ? `Now Playing: ${item.title ?? item.contentId}` : 'Nothing playing'}
      </Title>

      <div data-testid="now-playing-host" ref={hostRef} className="now-playing-host" />

      {item && (
        <>
          <SeekBar target="local" />
          <TransportBar target="local" />
        </>
      )}

      <QueuePanel target="local" />

      {item && (
        <div className="handoff-section" data-testid="handoff-section">
          <Text size="sm" fw={600} mb="xs">Hand off to device</Text>
          <DispatchTargetPicker
            source={{ getSnapshot: () => portability.snapshotForHandoff?.() }}
            submitLabel="Hand off"
            autoFocus={false}
          />
        </div>
      )}
    </Stack>
  );
}

export default NowPlayingView;
