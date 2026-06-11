// frontend/src/modules/Media/shell/TransportBar.jsx
// Transport controls bound to any session controller — used by Now Playing
// (local) and Peek (remote) identically. Live content collapses to
// play/pause/stop (no seek, no skip-within-item).
import React from 'react';
import { ActionIcon, Slider, Group } from '@mantine/core';
import {
  IconPlayerPlayFilled,
  IconPlayerPauseFilled,
  IconPlayerStopFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
  IconArrowsShuffle,
  IconRepeat,
  IconRepeatOnce,
  IconVolume,
} from '@tabler/icons-react';
import { useSessionController } from '../controller/useSessionController.js';

const PLAYING_STATES = new Set(['playing', 'buffering']);
const REPEAT_NEXT = { off: 'all', all: 'one', one: 'off' };

export function TransportBar({ target }) {
  const { snapshot, transport, config } = useSessionController(target);
  if (!snapshot?.currentItem) return null;

  const isPlaying = PLAYING_STATES.has(snapshot.state);
  const shuffle = !!snapshot.config?.shuffle;
  const repeat = snapshot.config?.repeat ?? 'off';
  const volume = snapshot.config?.volume ?? 100;

  return (
    <div className="transport-bar" data-testid="np-transport">
      <Group justify="center" gap="sm" className="transport-buttons">
        <ActionIcon
          data-testid="np-shuffle"
          aria-label="Shuffle"
          aria-pressed={shuffle}
          color={shuffle ? 'amber' : 'gray'}
          onClick={() => config.setShuffle?.(!shuffle)}
        >
          <IconArrowsShuffle size={20} />
        </ActionIcon>
        <ActionIcon data-testid="np-prev" aria-label="Previous" onClick={() => transport.skipPrev?.()}>
          <IconPlayerSkipBackFilled size={22} />
        </ActionIcon>
        <ActionIcon
          data-testid="np-toggle"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          variant="filled"
          color="amber"
          size={56}
          radius="xl"
          onClick={() => (isPlaying ? transport.pause?.() : transport.play?.())}
        >
          {isPlaying ? <IconPlayerPauseFilled size={28} /> : <IconPlayerPlayFilled size={28} />}
        </ActionIcon>
        <ActionIcon data-testid="np-next" aria-label="Next" onClick={() => transport.skipNext?.()}>
          <IconPlayerSkipForwardFilled size={22} />
        </ActionIcon>
        <ActionIcon
          data-testid="np-repeat"
          aria-label={`Repeat: ${repeat}`}
          color={repeat !== 'off' ? 'amber' : 'gray'}
          onClick={() => config.setRepeat?.(REPEAT_NEXT[repeat])}
        >
          {repeat === 'one' ? <IconRepeatOnce size={20} /> : <IconRepeat size={20} />}
        </ActionIcon>
        <ActionIcon data-testid="np-stop" aria-label="Stop" onClick={() => transport.stop?.()}>
          <IconPlayerStopFilled size={20} />
        </ActionIcon>
      </Group>
      <Group gap="xs" className="transport-volume">
        <IconVolume size={18} aria-hidden />
        <Slider
          data-testid="np-volume"
          className="volume-slider"
          min={0}
          max={100}
          step={1}
          value={volume}
          aria-label="Volume"
          onChange={(v) => config.setVolume?.(v)}
        />
      </Group>
    </div>
  );
}

export default TransportBar;
