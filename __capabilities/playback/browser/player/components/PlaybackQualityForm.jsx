import React, { useState } from 'react';
import { Button, Group, NumberInput, NativeSelect, Stack, Switch, Text } from '@mantine/core';
import { normalizePlaybackQuality } from '@shared-contracts/media/playbackQuality.mjs';

const RESOLUTION_OPTIONS = ['1080', '720', '480', '360', '240'];
const MAX_RESOLUTION = Math.max(...RESOLUTION_OPTIONS.map(Number));

export function PlaybackQualityForm({ request, onApply }) {
  const [resolution, setResolution] = useState(request.initial.maxResolution ?? '');
  const [bitrate, setBitrate] = useState(request.initial.maxVideoBitrate ?? '');
  const [transcode, setTranscode] = useState(request.initial.transcode ?? 'auto');
  const [adaptive, setAdaptive] = useState(request.initial.adaptive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const requestedResolution = Number(resolution);
  const resolutionOptions = [
    { value: '', label: 'Player default' },
    ...(Number.isFinite(requestedResolution) && requestedResolution > MAX_RESOLUTION
      ? [{ value: resolution, label: `${resolution}p requested (${MAX_RESOLUTION}p playback limit)`, disabled: true }]
      : []),
    ...RESOLUTION_OPTIONS.map(value => ({ value, label: `${value}p` })),
  ];
  const apply = async defaults => {
    setError(null);
    setBusy(true);
    try {
      const quality = defaults ? {} : normalizePlaybackQuality({
        ...(resolution ? { maxResolution: resolution } : {}),
        ...(bitrate !== '' ? { maxVideoBitrate: bitrate } : {}),
        ...(Object.hasOwn(request.initial, 'transcode') || transcode !== 'auto' ? { transcode } : {}),
        ...(Object.hasOwn(request.initial, 'adaptive') || adaptive !== true ? { adaptive } : {}),
      });
      const result = await onApply(quality);
      if (result?.ok === false) setError(result.code === 'PLAYBACK_CHANGED'
        ? 'The playing item changed. Close Quality and open it for the current item.'
        : result.error ?? 'Could not confirm the quality change. Please try again.');
    } catch (problem) { setError(problem.message); }
    finally { setBusy(false); }
  };
  return <Stack gap="md">
    <Text fw={600}>{request.item.title ?? 'Selected video'}</Text>
    <Text size="sm" c="dimmed">{request.mode === 'playing'
      ? `Apply to ${request.targetLabel ?? 'current playback'}. The video briefly reloads at its current position and keeps its pause state.`
      : 'Use these overrides when playing or queuing this item from this tab.'}</Text>
    <NativeSelect label="Maximum resolution" value={resolution} onChange={event => setResolution(event.currentTarget.value)}
      data={resolutionOptions} disabled={busy} />
    <NumberInput label="Maximum bitrate (kbps)" description="Leave blank for the player default. 4000 kbps is 4 Mbps."
      value={bitrate} onChange={setBitrate} min={1} max={8000} allowDecimal={false} disabled={busy} />
    <NativeSelect label="Conversion" value={transcode} onChange={event => setTranscode(event.currentTarget.value)}
      data={[{ value: 'auto', label: 'Automatic' }, { value: 'force', label: 'Force transcode' }]} disabled={busy} />
    <Switch label="Automatic quality" description="Allow Plex to adjust quality within these limits."
      checked={adaptive} onChange={event => setAdaptive(event.currentTarget.checked)} disabled={busy} />
    {error && <Text role="alert" c="red" size="sm">{error}</Text>}
    <Group justify="space-between">
      <Button variant="subtle" onClick={() => apply(true)} disabled={busy}>Use defaults</Button>
      <Button onClick={() => apply(false)} loading={busy}>{request.mode === 'playing' ? 'Apply to current playback' : 'Save overrides'}</Button>
    </Group>
  </Stack>;
}
