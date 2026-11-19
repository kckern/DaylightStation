import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { PlaybackQualityForm } from '../../../../../__capabilities/playback/browser/public.mjs';
import { browserPreference } from '@/lib/browserPreference.js';
import { Sheet } from '@/lib/ui';
import { normalizePlaybackQuality } from '@shared-contracts/media/playbackQuality.mjs';
import { useDismissLayer } from '@/lib/ui/dismiss/useDismissLayer.js';
import mediaLog from '../logging/mediaLog.js';

const Context = createContext(null);
const STORAGE_KEY = 'media-app.quality-overrides.v1';
const EMPTY = Object.freeze({});
let sequence = 0;

function decodeOverrides(raw) {
  return Object.fromEntries(Object.entries(JSON.parse(raw)).flatMap(([id, value]) => {
    try { return [[id, normalizePlaybackQuality(value)]]; } catch { return []; }
  }));
}

const overridePreference = browserPreference(STORAGE_KEY, EMPTY, decodeOverrides, () => sessionStorage);

/** Preferences are scoped to an item and this browser tab, never a fleet default. */
export function PlaybackQualityProvider({ children }) {
  const [overrides, setOverrides] = useState(overridePreference.read);
  const [request, setRequest] = useState(null);
  useEffect(() => {
    overridePreference.write(JSON.stringify(overrides));
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

/** Mounted inside MediaAppShell so Escape participates in Media's dismiss stack. */
export function PlaybackQualityHost() {
  const context = usePlaybackQuality();
  const request = context?.request;
  useDismissLayer(!!request, context?.close);
  return <Sheet open={!!request} onClose={context?.close} title="Playback quality">
    {request && <PlaybackQualityForm key={request.sequence} request={request} onApply={context.apply} />}
  </Sheet>;
}
