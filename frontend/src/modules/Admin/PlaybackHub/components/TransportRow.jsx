import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Group, Slider, Button, ActionIcon, Box } from '@mantine/core';
import {
  IconPlayerSkipBack,
  IconPlayerSkipForward,
  IconPlayerPlay,
  IconPlayerPause,
} from '@tabler/icons-react';
import { LabeledContentPicker } from './LabeledContentPicker.jsx';

const VOLUME_DEBOUNCE_MS = 300;

/**
 * TransportRow — transport controls for a device.
 *
 * Layout: [⏮] [⏯] [⏭] | volume slider | LabeledContentPicker | [Play Now]
 *
 * Each transport button shows a loading state while its sendCommand is in
 * flight. Other buttons in the row dim during that window to make the active
 * op visible.
 */
export function TransportRow({ slot, status, mutations }) {
  const maxVol = slot?.volume?.max ?? 100;
  const minVol = slot?.volume?.min ?? 0;
  const defaultVol = slot?.volume?.default ?? 0;

  const [pickedValue, setPickedValue] = useState('');
  const [sliderValue, setSliderValue] = useState(status?.volume ?? defaultVol);
  const [busyKey, setBusyKey] = useState(null);

  const userInteractingRef = useRef(false);
  useEffect(() => {
    if (userInteractingRef.current) return;
    if (typeof status?.volume === 'number') {
      setSliderValue(status.volume);
    }
  }, [status?.volume]);

  const debounceTimerRef = useRef(null);
  const scheduleVolumeSend = useCallback((vol) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      userInteractingRef.current = false;
      mutations.sendCommand({
        action: 'volume',
        target: slot.color,
        volume: vol,
      });
    }, VOLUME_DEBOUNCE_MS);
  }, [mutations, slot.color]);

  useEffect(() => () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
  }, []);

  const run = useCallback(async (key, body) => {
    setBusyKey(key);
    try {
      await mutations.sendCommand(body);
    } finally {
      setBusyKey(null);
    }
  }, [mutations]);

  const handlePrev = () => run('prev', { action: 'prev', target: slot.color });
  const handleNext = () => run('next', { action: 'next', target: slot.color });
  const handlePause = () => run('pause', { action: 'pause', target: slot.color });
  const handlePlayNow = () => {
    if (!pickedValue) return;
    run('play', { action: 'play', target: slot.color, contentId: pickedValue });
  };

  const isPaused = status?.paused === true;
  const otherBusy = (k) => busyKey !== null && busyKey !== k;

  return (
    <Group gap="sm" wrap="nowrap" align="center" mt="md">
      <ActionIcon
        size="lg" variant="default" onClick={handlePrev}
        aria-label="prev" title="Previous"
        loading={busyKey === 'prev'} disabled={otherBusy('prev')}
      >
        <IconPlayerSkipBack size={18} />
      </ActionIcon>
      <ActionIcon
        size="lg" variant="default" onClick={handlePause}
        aria-label={isPaused ? 'play' : 'pause'} title={isPaused ? 'Resume' : 'Pause'}
        loading={busyKey === 'pause'} disabled={otherBusy('pause')}
      >
        {isPaused ? <IconPlayerPlay size={18} /> : <IconPlayerPause size={18} />}
      </ActionIcon>
      <ActionIcon
        size="lg" variant="default" onClick={handleNext}
        aria-label="next" title="Next"
        loading={busyKey === 'next'} disabled={otherBusy('next')}
      >
        <IconPlayerSkipForward size={18} />
      </ActionIcon>
      <Box style={{ width: 140 }}>
        <Slider
          value={sliderValue}
          min={minVol}
          max={maxVol}
          onChange={(v) => {
            userInteractingRef.current = true;
            setSliderValue(v);
            scheduleVolumeSend(v);
          }}
          label={(v) => `${v}/${maxVol}`}
        />
      </Box>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <LabeledContentPicker
          value={pickedValue}
          onChange={(id) => setPickedValue(id || '')}
          placeholder="Pick content..."
        />
      </Box>
      <Button
        size="sm"
        variant="filled"
        disabled={!pickedValue || otherBusy('play')}
        loading={busyKey === 'play'}
        onClick={handlePlayNow}
      >
        Play Now
      </Button>
    </Group>
  );
}

export default TransportRow;
