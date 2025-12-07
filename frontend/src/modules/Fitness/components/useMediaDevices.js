import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const emptyDevices = { video: [], audio: [] };

export function useMediaDevices(enabled = true) {
  const [devices, setDevices] = useState(emptyDevices);
  const [activeVideoId, setActiveVideoId] = useState(null);
  const [activeAudioId, setActiveAudioId] = useState(null);
  const [permissionError, setPermissionError] = useState(null);
  const mountedRef = useRef(false);

  const refreshDevices = useCallback(async () => {
    if (!enabled) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      setDevices(emptyDevices);
      return;
    }
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const video = list.filter((d) => d.kind === 'videoinput');
      const audio = list.filter((d) => d.kind === 'audioinput');
      setDevices({ video, audio });
      if (!activeVideoId && video.length) {
        setActiveVideoId(video[0].deviceId || null);
      }
      if (!activeAudioId && audio.length) {
        setActiveAudioId(audio[0].deviceId || null);
      }
      setPermissionError(null);
    } catch (_err) {
      setDevices(emptyDevices);
      setPermissionError(err);
    }
  }, [enabled, activeVideoId, activeAudioId]);

  useEffect(() => {
    mountedRef.current = true;
    refreshDevices();
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) return undefined;
    const handler = () => refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', handler);
    return () => {
      mountedRef.current = false;
      navigator.mediaDevices.removeEventListener('devicechange', handler);
    };
  }, [refreshDevices]);

  const selectNext = useCallback((kind) => {
    setDevices((current) => {
      const list = kind === 'audio' ? current.audio : current.video;
      if (!list.length) return current;
      if (kind === 'audio') {
        const idx = list.findIndex((d) => d.deviceId === activeAudioId);
        const next = list[(idx + 1) % list.length];
        setActiveAudioId(next.deviceId || null);
      } else {
        const idx = list.findIndex((d) => d.deviceId === activeVideoId);
        const next = list[(idx + 1) % list.length];
        setActiveVideoId(next.deviceId || null);
      }
      return current;
    });
  }, [activeAudioId, activeVideoId]);

  const value = useMemo(() => ({
    devices,
    activeVideoId,
    activeAudioId,
    setActiveVideoId,
    setActiveAudioId,
    refreshDevices,
    permissionError,
    nextVideo: () => selectNext('video'),
    nextAudio: () => selectNext('audio'),
  }), [devices, activeVideoId, activeAudioId, selectNext, refreshDevices]);

  return value;
}
