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
 * Interstitial behavior: when a button is clicked, an optimistic prediction
 * is registered via `predict`/`pending`. The corresponding control reads
 * `status._pending` and renders greyed + locked until the WS broadcaster
 * confirms (or a timeout lifts the prediction).
 *
 * - pause/play  : predict({ paused: !current })  — match-to-clear
 * - prev/next   : pending(['now_playing'])       — change-to-clear
 * - Play Now    : pending(['now_playing'])       — change-to-clear
 * - volume      : predict({ volume: released })  — match-to-clear
 */
export function TransportRow({ slot, status, mutations, predict, pending }) {
  const maxVol = slot?.volume?.max ?? 100;
  const minVol = slot?.volume?.min ?? 0;
  const defaultVol = slot?.volume?.default ?? 0;

  const [pickedValue, setPickedValue] = useState('');
  const [sliderValue, setSliderValue] = useState(status?.volume ?? defaultVol);

  const userInteractingRef = useRef(false);
  useEffect(() => {
    if (userInteractingRef.current) return;
    if (typeof status?.volume === 'number') {
      setSliderValue(status.volume);
    }
  }, [status?.volume]);

  const pendingFields = status?._pending;
  const isPendingPaused = pendingFields?.has('paused');
  const isPendingNowPlaying = pendingFields?.has('now_playing');
  const isPendingVolume = pendingFields?.has('volume');

  const debounceTimerRef = useRef(null);
  const scheduleVolumeSend = useCallback((vol) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      userInteractingRef.current = false;
      predict?.(slot.color, { volume: vol });
      mutations.sendCommand({
        action: 'volume',
        target: slot.color,
        volume: vol,
      });
    }, VOLUME_DEBOUNCE_MS);
  }, [mutations, slot.color, predict]);

  useEffect(() => () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
  }, []);

  const handlePrev = () => {
    pending?.(slot.color, ['now_playing']);
    mutations.sendCommand({ action: 'prev', target: slot.color });
  };
  const handleNext = () => {
    pending?.(slot.color, ['now_playing']);
    mutations.sendCommand({ action: 'next', target: slot.color });
  };
  const handlePause = () => {
    const nextPaused = !(status?.paused === true);
    predict?.(slot.color, { paused: nextPaused });
    mutations.sendCommand({ action: 'pause', target: slot.color });
  };
  const handlePlayNow = () => {
    if (!pickedValue) return;
    pending?.(slot.color, ['now_playing']);
    predict?.(slot.color, { paused: false });
    mutations.sendCommand({
      action: 'play',
      target: slot.color,
      contentId: pickedValue,
    });
  };

  // Read the optimistic state — `status.paused` already reflects the
  // prediction if one is in flight, since useStatusOverlay overlays it.
  const isPaused = status?.paused === true;

  return (
    <Group gap="sm" wrap="nowrap" align="center" mt="md">
      <ActionIcon
        size="lg" variant="default" onClick={handlePrev}
        aria-label="prev" title="Previous"
        disabled={isPendingNowPlaying}
        data-pending={isPendingNowPlaying ? 'true' : undefined}
      >
        <IconPlayerSkipBack size={18} />
      </ActionIcon>
      <ActionIcon
        size="lg" variant="default" onClick={handlePause}
        aria-label={isPaused ? 'play' : 'pause'} title={isPaused ? 'Resume' : 'Pause'}
        disabled={isPendingPaused}
        data-pending={isPendingPaused ? 'true' : undefined}
      >
        {isPaused ? <IconPlayerPlay size={18} /> : <IconPlayerPause size={18} />}
      </ActionIcon>
      <ActionIcon
        size="lg" variant="default" onClick={handleNext}
        aria-label="next" title="Next"
        disabled={isPendingNowPlaying}
        data-pending={isPendingNowPlaying ? 'true' : undefined}
      >
        <IconPlayerSkipForward size={18} />
      </ActionIcon>
      <Box
        style={{ width: 140 }}
        data-pending={isPendingVolume ? 'true' : undefined}
      >
        <Slider
          value={sliderValue}
          min={minVol}
          max={maxVol}
          disabled={isPendingVolume}
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
        disabled={!pickedValue || isPendingNowPlaying}
        data-pending={isPendingNowPlaying ? 'true' : undefined}
        onClick={handlePlayNow}
      >
        Play Now
      </Button>
    </Group>
  );
}

export default TransportRow;
