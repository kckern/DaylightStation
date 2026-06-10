// frontend/src/modules/Media/shell/MiniPlayer.jsx
// The always-visible handle on the ambient local session: a bottom bar with
// the current item (tap → Now Playing), queue position, one play/pause
// toggle, and stop. Renders a slim "Idle" bar when no session — never
// disappears entirely, so the session always has a visible anchor.
import React from 'react';
import { UnstyledButton, ActionIcon, Text } from '@mantine/core';
import {
  IconPlayerPlayFilled,
  IconPlayerPauseFilled,
  IconPlayerStopFilled,
} from '@tabler/icons-react';
import { useSessionController } from '../controller/useSessionController.js';
import { useNav } from './NavProvider.jsx';

const PLAYING_STATES = new Set(['playing', 'buffering']);

export function MiniPlayer() {
  const { snapshot, transport } = useSessionController('local');
  const { push, view } = useNav();
  const item = snapshot?.currentItem;

  if (!item) {
    return (
      <div data-testid="media-mini-player" className="mini-player mini-player--idle">
        <Text size="sm" c="dimmed">Idle</Text>
      </div>
    );
  }

  const isPlaying = PLAYING_STATES.has(snapshot.state);
  const queueCount = snapshot.queue?.items?.length ?? 0;
  const queuePos = snapshot.queue?.currentIndex ?? -1;

  return (
    <div data-testid="media-mini-player" className="mini-player">
      {item.thumbnail && (
        <img className="mini-player-thumb" src={item.thumbnail} alt="" loading="lazy" />
      )}
      <UnstyledButton
        data-testid="mini-player-open-nowplaying"
        className="mini-player-title"
        onClick={() => { if (view !== 'nowPlaying') push('nowPlaying', {}); }}
      >
        <span className="mini-player-title-text">{item.title ?? item.contentId}</span>
        {queueCount > 1 && queuePos >= 0 && (
          <span className="mini-queue-count" data-testid="mini-queue-count">
            {queuePos + 1}/{queueCount}
          </span>
        )}
      </UnstyledButton>
      <div className="mini-player-controls">
        <ActionIcon
          data-testid="mini-toggle"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          variant="filled"
          color="amber"
          onClick={() => (isPlaying ? transport.pause() : transport.play())}
        >
          {isPlaying ? <IconPlayerPauseFilled size={20} /> : <IconPlayerPlayFilled size={20} />}
        </ActionIcon>
        <ActionIcon
          data-testid="mini-stop"
          aria-label="Stop"
          title="Stop and clear current item"
          onClick={() => transport.stop()}
        >
          <IconPlayerStopFilled size={18} />
        </ActionIcon>
      </div>
    </div>
  );
}

export default MiniPlayer;
