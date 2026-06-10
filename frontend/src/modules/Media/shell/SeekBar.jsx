// frontend/src/modules/Media/shell/SeekBar.jsx
// Live seek bar bound to any session controller. Reads the hot position tier
// (tick-rate updates re-render only this component), holds a local scrub
// value while dragging, commits seekAbs on release. Live content gets a LIVE
// badge instead of a scrubber.
import React, { useState } from 'react';
import { Slider, Text, Badge, Group } from '@mantine/core';
import { useSessionController } from '../controller/useSessionController.js';
import { usePlaybackPosition } from '../controller/usePlaybackPosition.js';

function fmt(s) {
  const t = Math.max(0, Math.floor(s ?? 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function SeekBar({ target }) {
  const { controller, snapshot, transport, capabilities } = useSessionController(target);
  const live = usePlaybackPosition(controller);
  const [scrub, setScrub] = useState(null);

  const item = snapshot?.currentItem;
  if (!item) return null;

  if (item.isLive || !capabilities.seekable) {
    return (
      <Group gap="xs" className="seek-bar seek-bar--live">
        <Badge color="red" variant="light" size="sm">LIVE</Badge>
      </Group>
    );
  }

  const duration = item.duration ?? 0;
  const position = scrub ?? live.seconds ?? snapshot.position ?? 0;

  return (
    <div className="seek-bar">
      <Text size="xs" c="dimmed" className="seek-time">{fmt(position)}</Text>
      <Slider
        data-testid="np-seek"
        className="seek-slider"
        min={0}
        max={duration || 0}
        step={1}
        value={Math.min(position, duration || 0)}
        disabled={!duration}
        label={fmt}
        aria-label="Seek"
        onChange={(v) => setScrub(v)}
        onChangeEnd={(v) => { transport.seekAbs?.(v); setScrub(null); }}
      />
      <Text size="xs" c="dimmed" className="seek-time">{duration ? fmt(duration) : '–:––'}</Text>
    </div>
  );
}

export default SeekBar;
