import { useRef, useEffect, useCallback, useMemo } from 'react';
import { BufferResilienceManager } from '../lib/BufferResilienceManager';

const serializePlaybackError = (error) => {
  if (!error) return null;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }
  if (typeof error === 'object') {
    const {
      code,
      severity,
      technology,
      message,
      data,
      category,
      detail,
      stack
    } = error;
    return {
      code: code ?? error?.detail?.code ?? null,
      severity: severity ?? error?.severity ?? null,
      technology: technology ?? error?.technology ?? null,
      category: category ?? null,
      message: message ?? error?.message ?? null,
      data: data ?? error?.data ?? null,
      detail: detail ?? null,
      stack: stack ?? error?.stack ?? null
    };
  }
  return { value: error };
};

const serializeTimeRanges = (ranges) => {
  if (!ranges || typeof ranges.length !== 'number') {
    return [];
  }
  const entries = [];
  for (let index = 0; index < ranges.length; index += 1) {
    try {
      entries.push({
        start: ranges.start(index),
        end: ranges.end(index)
      });
    } catch (_) {
      // ignore range errors
    }
  }
  return entries;
};

const computeBufferSnapshot = (mediaEl) => {
  if (!mediaEl) {
    return {
      currentTime: null,
      buffered: [],
      bufferAheadSeconds: null,
      bufferBehindSeconds: null,
      nextBufferStartSeconds: null,
      bufferGapSeconds: null
    };
  }
  const buffered = serializeTimeRanges(mediaEl.buffered);
  const currentTime = Number.isFinite(mediaEl.currentTime) ? Number(mediaEl.currentTime.toFixed(3)) : null;
  if (currentTime == null || !buffered.length) {
    return {
      currentTime,
      buffered,
      bufferAheadSeconds: null,
      bufferBehindSeconds: null,
      nextBufferStartSeconds: null,
      bufferGapSeconds: null
    };
  }
  let bufferAheadSeconds = null;
  let bufferBehindSeconds = null;
  let nextBufferStartSeconds = null;
  for (let index = 0; index < buffered.length; index += 1) {
    const range = buffered[index];
    if (currentTime >= range.start && currentTime <= range.end) {
      bufferAheadSeconds = Number((range.end - currentTime).toFixed(3));
      bufferBehindSeconds = Number((currentTime - range.start).toFixed(3));
      if (index + 1 < buffered.length) {
        nextBufferStartSeconds = buffered[index + 1].start;
      }
      break;
    }
    if (currentTime < range.start) {
      nextBufferStartSeconds = range.start;
      break;
    }
  }
  const bufferGapSeconds = Number.isFinite(nextBufferStartSeconds)
    ? Number((nextBufferStartSeconds - currentTime).toFixed(3))
    : null;
  return {
    currentTime,
    buffered,
    bufferAheadSeconds,
    bufferBehindSeconds,
    nextBufferStartSeconds,
    bufferGapSeconds
  };
};

export function useBufferResilience({
  mediaInstanceKey,
  logShakaDiagnostic,
  hardReset,
  getCurrentMediaElement,
  resilienceBridge,
  fetchVideoInfo,
  advance,
  seconds
}) {
  const manager = useMemo(() => new BufferResilienceManager({
    onSeek: (seekToSeconds) => hardReset({ seekToSeconds }),
    onLog: (level, event, payload) => logShakaDiagnostic(event, payload, level),
    onGetBufferInfo: () => computeBufferSnapshot(getCurrentMediaElement()),
    onHardReset: hardReset
  }), [hardReset, logShakaDiagnostic, getCurrentMediaElement]);

  // Reset manager state when media changes
  useEffect(() => {
    // Manager state is internal, but we can add a reset method if needed
    // For now, the instance is stable per mount, but we might want to recreate it
    // if mediaInstanceKey changes significantly.
  }, [mediaInstanceKey]);

  const handleNetworkResponse = useCallback((requestType, response) => {
    return manager.handleNetworkResponse(requestType, response);
  }, [manager]);

  const handlePlayerStateChange = useCallback((eventName, event) => {
    return manager.handlePlayerStateChange(eventName, event);
  }, [manager]);

  const handlePlaybackError = useCallback((error) => {
    // Legacy error handling logic kept in hook for now as it involves
    // complex interactions with fetchVideoInfo and advance which are
    // specific to the React component context.
    // We can migrate this to the manager in a future phase.
    
    const serializedError = serializePlaybackError(error);
    logShakaDiagnostic('shaka-playback-error', {
      error: serializedError
    }, 'error');

    if (typeof resilienceBridge?.onStartupSignal === 'function') {
      resilienceBridge.onStartupSignal({
        type: 'shaka-playback-error',
        timestamp: Date.now(),
        detail: serializedError
      });
    }
    
    // ... (rest of legacy error handling)
    // For now, we just use the existing logic below, but we could delegate
    // parts of it to the manager if we moved the state there.
    // Since we are in Phase 2/3 transition, let's keep the complex error flow here
    // but use the manager for the 404 suppression flow.
    
    // Re-implementing the legacy error flow using local refs for now
    // to avoid breaking the existing "hard reset on error" logic
    // while we test the 404 suppression.
    
    // Note: The original hook implementation had a local ref for this.
    // We should probably keep using a local ref for the *general* error recovery
    // while the manager handles the *network* error recovery.
    
    // ... (existing implementation continues below)
    
    const is404 = serializedError?.code === 1001 || String(serializedError?.message).includes('404');
    
    // If the manager is already handling a suppressed 404, we might not want to interfere.
    if (manager.state.suppressed404) {
       logShakaDiagnostic('shaka-error-suppressed', { reason: 'manager-handling-404' }, 'debug');
       return;
    }

    // Fallback to original logic
    legacyErrorRecovery(error);

  }, [manager, logShakaDiagnostic, resilienceBridge, seconds, hardReset, fetchVideoInfo, advance, getCurrentMediaElement]);

  // Helper for legacy error recovery (copied from original hook body)
  const shakaRecoveryStateRef = useRef({
    attempts: 0,
    pendingFetch: false,
    skipped: false,
    cooldownUntil: 0
  });
  
  useEffect(() => {
    shakaRecoveryStateRef.current = {
      attempts: 0,
      pendingFetch: false,
      skipped: false,
      cooldownUntil: 0
    };
  }, [mediaInstanceKey]);

  const legacyErrorRecovery = (error) => {
    const state = shakaRecoveryStateRef.current;
    if (!state || state.skipped) return;
    
    if (state.pendingFetch) return;
    
    const now = Date.now();
    if (state.cooldownUntil && now < state.cooldownUntil) return;

    state.cooldownUntil = now + 2000;
    state.attempts += 1;
    const attempt = state.attempts;
    const seekSeconds = Number.isFinite(seconds) ? Number(seconds.toFixed(3)) : null;
    const serializedError = serializePlaybackError(error);
    const is404 = serializedError?.code === 1001 || String(serializedError?.message).includes('404');

    if (attempt === 1) {
      if (is404) {
         // If we get here, it means the network filter didn't catch it (e.g. manifest 404)
         // or it bubbled up.
         const { currentTime, bufferAheadSeconds } = computeBufferSnapshot(getCurrentMediaElement()) || {};
         const effectiveBuffer = Number.isFinite(bufferAheadSeconds) ? bufferAheadSeconds : 0;
         const effectiveCurrent = Number.isFinite(currentTime) ? currentTime : (seekSeconds || 0);
         const isBufferEdgeError = effectiveBuffer > 2;
         const skipBase = isBufferEdgeError ? (effectiveCurrent + effectiveBuffer) : effectiveCurrent;
         const skipTarget = Number((skipBase + 2).toFixed(3));
         
         logShakaDiagnostic('shaka-recovery-action', {
            action: '404-skip-reset-legacy',
            attempt,
            seekSeconds: skipTarget
         }, 'warn');
         hardReset({ seekToSeconds: skipTarget });
         return;
      }
      hardReset({ seekToSeconds: seekSeconds });
      return;
    }
    
    if (attempt === 2 && typeof fetchVideoInfo === 'function') {
      state.pendingFetch = true;
       Promise.resolve(fetchVideoInfo({ reason: 'shaka-playback-error', attempt }))
        .finally(() => {
          state.pendingFetch = false;
          state.cooldownUntil = Date.now() + 1000;
        });
      return;
    }
    
    state.skipped = true;
    advance?.(1);
  };

  return {
    handleNetworkResponse,
    handlePlayerStateChange,
    handlePlaybackError
  };
}

