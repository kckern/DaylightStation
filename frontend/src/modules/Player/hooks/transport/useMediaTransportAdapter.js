import { useCallback, useEffect, useMemo, useRef } from 'react';
import { playbackLog } from '../../lib/playbackLogger.js';

const toNumber = (value) => {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(n) ? n : null;
};

const normalizeDiagnostics = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const buffer = raw.buffer || {};
  const decoder = raw.decoder || {};
  return {
    buffer: {
      bufferAheadSeconds: toNumber(buffer.bufferAheadSeconds),
      bufferGapSeconds: toNumber(buffer.bufferGapSeconds),
      nextBufferStartSeconds: toNumber(buffer.nextBufferStartSeconds)
    },
    decoder: {
      droppedFrames: toNumber(decoder.droppedFrames),
      totalFrames: toNumber(decoder.totalFrames)
    },
    readyState: raw.readyState ?? raw.ready_state ?? null,
    networkState: raw.networkState ?? raw.network_state ?? null
  };
};

const guard = (label, fn) => (...args) => {
  try {
    return fn(...args);
  } catch (error) {
    playbackLog('transport-guard-error', { action: label, message: error?.message || 'transport-error' }, { level: 'warn' });
    return null;
  }
};

export function useMediaTransportAdapter({ controllerRef, mediaAccess }) {
  const warnedMissingMediaRef = useRef(false);

  const getMediaEl = useCallback(() => {
    const accessEl = typeof mediaAccess?.getMediaEl === 'function' ? mediaAccess.getMediaEl() : null;
    if (accessEl) return accessEl;
    const transportEl = controllerRef?.current?.transport?.getMediaEl;
    if (typeof transportEl === 'function') {
      try {
        return transportEl();
      } catch (error) {
        playbackLog('transport-getMediaEl-error', { message: error?.message || 'transport-error' }, { level: 'warn' });
        return null;
      }
    }
    return null;
  }, [controllerRef, mediaAccess]);

  useEffect(() => {
    if (warnedMissingMediaRef.current) return;
    const hasMediaEl = typeof mediaAccess?.getMediaEl === 'function' || typeof controllerRef?.current?.transport?.getMediaEl === 'function';
    if (!hasMediaEl) {
      warnedMissingMediaRef.current = true;
      playbackLog('transport-capability-missing', { capability: 'getMediaEl' }, { level: 'warn' });
    }
  }, [controllerRef, mediaAccess]);

  const play = useMemo(() => guard('play', () => controllerRef?.current?.transport?.play?.()), [controllerRef]);
  const pause = useMemo(() => guard('pause', () => controllerRef?.current?.transport?.pause?.()), [controllerRef]);
  const seek = useMemo(() => guard('seek', (seconds) => controllerRef?.current?.transport?.seek?.(seconds)), [controllerRef]);
  const nudge = useMemo(() => guard('nudge', (...args) => mediaAccess?.nudgePlayback?.(...args)), [mediaAccess]);

  const readDiagnostics = useCallback(() => {
    try {
      const raw = typeof mediaAccess?.getTroubleDiagnostics === 'function'
        ? mediaAccess.getTroubleDiagnostics()
        : null;
      return normalizeDiagnostics(raw);
    } catch (error) {
      playbackLog('transport-diagnostics-error', { message: error?.message || 'diagnostics-error' }, { level: 'warn' });
      return null;
    }
  }, [mediaAccess]);

  return {
    getMediaEl,
    play,
    pause,
    seek,
    nudge,
    readDiagnostics
  };
}

export default useMediaTransportAdapter;
