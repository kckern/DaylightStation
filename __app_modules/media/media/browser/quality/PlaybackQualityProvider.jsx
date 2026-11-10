import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Button, Group, NumberInput, NativeSelect, Stack, Switch, Text } from '@mantine/core';
import { Sheet } from '@/lib/ui';
import { normalizePlaybackQuality } from '@shared-contracts/media/playbackQuality.mjs';
import { useDismissLayer } from '../shell/useDismissLayer.js';
import mediaLog from '../logging/mediaLog.js';

const Context = createContext(null);
const STORAGE_KEY = 'media-app.quality-overrides.v1';
const EMPTY = Object.freeze({});
let sequence = 0;

function restoreOverrides() {
  try {
    const values = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}');
    return Object.fromEntries(Object.entries(values).flatMap(([id, value]) => {
      try { return [[id, normalizePlaybackQuality(value)]]; } catch { return []; }
    }));
  } catch { return {}; }
}

/** Preferences are scoped to an item and this browser tab, never a fleet default. */
export function PlaybackQualityProvider({ children }) {
  const [overrides, setOverrides] = useState(restoreOverrides);
  const [request, setRequest] = useState(null);
  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(overrides)); } catch { /* private mode */ }
  }, [overrides]);
  const getOverrides = useCallback(id => overrides[id] ?? EMPTY, [overrides]);
  const close = useCallback(() => setRequest(null), []);
  const openForItem = useCallback(item => {
    const contentId = item.contentId ?? item.id;
    mediaLog.qualityOpened({ scope: 'selected', contentId });
    setRequest({ sequence: ++sequence, mode: 'selected', item, contentId, initial: getOverrides(contentId) });
  }, [getOverrides]);
  const openForPlayback = useCallback(({ controller, snapshot, targetLabel }) => {
    const entry = snapshot.queue?.items?.[snapshot.queue?.currentIndex];
    const item = snapshot.currentItem;
    if (!item) return;
    mediaLog.qualityOpened({ scope: 'playing', contentId: item.contentId, target: controller.id });
    setRequest({ sequence: ++sequence, mode: 'playing', item, controller, targetLabel,
      initial: normalizePlaybackQuality({ ...entry, ...item }),
      target: { contentId: item.contentId,
        ...(entry?.queueItemId ? { queueItemId: entry.queueItemId } : {}),
        ...(snapshot.sessionId ? { sessionId: snapshot.sessionId } : {}) },
    });
  }, []);
  const apply = useCallback(async quality => {
    if (!request) return { ok: false, code: 'NO_PLAYBACK' };
    const normalized = normalizePlaybackQuality(quality);
    if (request.mode === 'selected') {
      setOverrides(previous => {
        const next = { ...previous };
        if (Object.keys(normalized).length) next[request.contentId] = normalized;
        else delete next[request.contentId];
        return next;
      });
      mediaLog.qualityChanged({ scope: 'selected', contentId: request.contentId, quality: normalized });
      close();
      return { ok: true };
    }
    try {
      const result = await request.controller.quality.setOverrides({ ...request.target, quality: normalized });
      if (result?.ok !== true) {
        mediaLog.qualityChangeFailed({ target: request.controller.id, contentId: request.item.contentId, code: result?.code ?? 'UNCONFIRMED' });
        return { ...result, ok: false, code: result?.code ?? 'UNCONFIRMED' };
      }
      mediaLog.qualityChanged({ scope: 'playing', target: request.controller.id, contentId: request.item.contentId, quality: normalized });
      close();
      return { ok: true };
    } catch (error) {
      mediaLog.qualityChangeFailed({ target: request.controller.id, contentId: request.item.contentId, code: error.code, error: error.message });
      return { ok: false, code: error.code, error: error.message };
    }
  }, [request, close]);
  const value = useMemo(() => ({ request, getOverrides, openForItem, openForPlayback, apply, close }),
    [request, getOverrides, openForItem, openForPlayback, apply, close]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const usePlaybackQuality = () => useContext(Context);

function QualityForm({ request, onApply }) {
  const [resolution, setResolution] = useState(request.initial.maxResolution ?? '');
  const [bitrate, setBitrate] = useState(request.initial.maxVideoBitrate ?? '');
  const [transcode, setTranscode] = useState(request.initial.transcode ?? 'auto');
  const [adaptive, setAdaptive] = useState(request.initial.adaptive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const apply = async defaults => {
    setError(null);
    setBusy(true);
    try {
      const quality = defaults ? {} : normalizePlaybackQuality({
        ...(resolution ? { maxResolution: resolution } : {}),
        ...(bitrate !== '' ? { maxVideoBitrate: bitrate } : {}), transcode, adaptive,
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
      data={[{ value: '', label: 'Player default' }, ...['1080', '720', '480', '360', '240'].map(value => ({ value, label: `${value}p` }))]} disabled={busy} />
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

/** Mounted inside MediaAppShell so Escape participates in Media's dismiss stack. */
export function PlaybackQualityHost() {
  const context = usePlaybackQuality();
  const request = context?.request;
  useDismissLayer(!!request, context?.close);
  return <Sheet open={!!request} onClose={context?.close} title="Playback quality">
    {request && <QualityForm key={request.sequence} request={request} onApply={context.apply} />}
  </Sheet>;
}
