import React, { createContext, useContext, useMemo } from 'react';
import { useMediaDevices } from './useMediaDevices.js';
import { useWebcamStream } from './useWebcamStream.js';

const WebcamContext = createContext(null);

export function FitnessWebcamProvider({
  children,
  enabled = true,
  startOnMount = true,
  videoConstraints = { width: { ideal: 1280 }, height: { ideal: 720 } },
  audioConstraints = false,
}) {
  const devicesState = useMediaDevices(enabled);
  const {
    devices,
    activeVideoId,
    activeAudioId,
    setActiveVideoId,
    setActiveAudioId,
    nextVideo,
    nextAudio,
    permissionError,
  } = devicesState;

  const resolvedVideoConstraints = useMemo(() => {
    if (videoConstraints === false) return false;
    const base = typeof videoConstraints === 'object' && videoConstraints !== null
      ? { ...videoConstraints }
      : { facingMode: 'user' };
    if (activeVideoId) {
      base.deviceId = { exact: activeVideoId };
    }
    return base;
  }, [videoConstraints, activeVideoId]);

  const resolvedAudioConstraints = useMemo(() => {
    if (audioConstraints === false) return false;
    const base = typeof audioConstraints === 'object' && audioConstraints !== null
      ? { ...audioConstraints }
      : false;
    if (base && activeAudioId) {
      base.deviceId = { exact: activeAudioId };
    }
    return base;
  }, [audioConstraints, activeAudioId]);

  const streamState = useWebcamStream({
    enabled: enabled && startOnMount,
    videoConstraints: resolvedVideoConstraints,
    audioConstraints: resolvedAudioConstraints,
  });

  const value = useMemo(() => ({
    devices,
    activeVideoId,
    activeAudioId,
    setActiveVideoId,
    setActiveAudioId,
    nextVideo,
    nextAudio,
    permissionError,
    ...streamState,
  }), [
    devices,
    activeVideoId,
    activeAudioId,
    setActiveVideoId,
    setActiveAudioId,
    nextVideo,
    nextAudio,
    permissionError,
    streamState,
  ]);

  return (
    <WebcamContext.Provider value={value}>
      {children}
    </WebcamContext.Provider>
  );
}

export function useSharedWebcam() {
  return useContext(WebcamContext);
}

export function useSharedWebcamStream() {
  const ctx = useSharedWebcam();
  return {
    stream: ctx?.stream ?? null,
    status: ctx?.status ?? 'idle',
    error: ctx?.error ?? null,
    permissionError: ctx?.permissionError ?? null,
  };
}
