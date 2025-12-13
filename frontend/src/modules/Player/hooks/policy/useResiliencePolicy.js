import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RESILIENCE_STATUS } from '../useResilienceState.js';

export const POLICY_STATE = Object.freeze({
  IDLE: 'IDLE',
  PLAYING: 'PLAYING',
  STALLED: 'STALLED',
  RECOVERING: 'RECOVERING',
  LOCKED: 'LOCKED'
});

const SHAKA_STALL_GRACE_MS = 2000;

const deriveDroppedRatio = (decoderMetrics = null) => {
  if (!decoderMetrics) return null;
  const { droppedFrames, totalFrames } = decoderMetrics;
  if (!Number.isFinite(totalFrames) || totalFrames <= 0) {
    return null;
  }
  const dropped = Number.isFinite(droppedFrames) ? droppedFrames : 0;
  return Math.max(0, dropped) / totalFrames;
};

const summarizeDiagnosticsForLog = (diagnostics = null) => {
  if (!diagnostics) {
    return null;
  }
  const buffer = diagnostics.buffer || {};
  const decoder = diagnostics.decoder || {};
  const shaka = diagnostics.shaka || null;
  
  return {
    // Buffer state
    bufferAheadSeconds: buffer.bufferAheadSeconds ?? null,
    bufferBehindSeconds: buffer.bufferBehindSeconds ?? null,
    bufferGapSeconds: buffer.bufferGapSeconds ?? null,
    nextBufferStartSeconds: buffer.nextBufferStartSeconds ?? null,
    // Decoder metrics
    droppedFrames: decoder.droppedFrames ?? null,
    totalFrames: decoder.totalFrames ?? null,
    // Media element state
    readyState: diagnostics.readyState ?? null,
    networkState: diagnostics.networkState ?? null,
    playbackRate: diagnostics.playbackRate ?? null,
    paused: diagnostics.paused ?? null,
    currentTime: diagnostics.currentTime ?? null,
    // Shaka player stats (critical for DASH debugging)
    shaka: shaka ? {
      width: shaka.width,
      height: shaka.height,
      streamBandwidth: shaka.streamBandwidth,
      estimatedBandwidth: shaka.estimatedBandwidth,
      decodedFrames: shaka.decodedFrames,
      droppedFrames: shaka.droppedFrames,
      bufferLength: shaka.bufferLength
    } : null
  };
};

const classifyStallNature = (diagnostics, playbackHealthSnapshot, isStartupPhase = false) => {
  if (!diagnostics) {
    return 'unknown';
  }
  const readyState = diagnostics?.readyState;
  const networkState = diagnostics?.networkState;
  const buffered = diagnostics?.buffer?.buffered || diagnostics?.buffer?.raw || [];
  const totalFrames = diagnostics?.decoder?.totalFrames;

  // During startup, treat missing data as pending instead of stalled
  if (isStartupPhase) {
    if (Number.isFinite(readyState) && readyState < 2) {
      return 'startup-pending';
    }
    if ((!buffered || buffered.length === 0) && (!Number.isFinite(totalFrames) || totalFrames === 0)) {
      return 'startup-buffering';
    }
  }

  const bufferAhead = diagnostics?.buffer?.bufferAheadSeconds;
  if (Number.isFinite(bufferAhead) && bufferAhead < 0.75) {
    return 'buffer-starved';
  }
  const bufferGap = diagnostics?.buffer?.bufferGapSeconds;
  if (Number.isFinite(bufferGap) && bufferGap > 0.25) {
    return 'seek-gap';
  }
  const droppedRatio = deriveDroppedRatio(diagnostics?.decoder);
  const frameInfo = playbackHealthSnapshot?.frameInfo;
  if (frameInfo?.supported && frameInfo.advancing === false) {
    return 'decoder-stall';
  }
  if (droppedRatio != null && droppedRatio > 0.2) {
    return 'decoder-stall';
  }
  // If we had frames or buffered data but lost readiness, treat as decoder stall
  if ((Number.isFinite(totalFrames) && totalFrames > 0) || (buffered && buffered.length > 0)) {
    if (Number.isFinite(readyState) && readyState < 3) {
      return 'decoder-stall';
    }
  }
  if (Number.isFinite(networkState) && (networkState === 0 || networkState === 3)) {
    return 'network-stall';
  }
  return 'unknown';
};

export function useResiliencePolicy({
  status,
  externalPauseReason,
  monitorSuspended = false,
  playbackHealth,
  isStartupPhase = false,
  readDiagnostics,
  reduceBitrateAfterHardReset,
  requestDecoderNudge,
  logResilienceEvent
}) {
  const [stallClassification, setStallClassification] = useState('unknown');
  const stallInsightsRef = useRef({
    classification: 'unknown',
    lastLoggedAt: 0,
    lastMitigationAt: 0,
    lastDetectedAt: 0
  });

  const policyState = useMemo(() => {
    if (monitorSuspended) return POLICY_STATE.LOCKED;
    if (externalPauseReason === 'PAUSED_GOVERNANCE') return POLICY_STATE.LOCKED;
    if (status === RESILIENCE_STATUS.recovering) return POLICY_STATE.RECOVERING;
    if (status === RESILIENCE_STATUS.stalling) return POLICY_STATE.STALLED;
    if (status === RESILIENCE_STATUS.playing) return POLICY_STATE.PLAYING;
    return POLICY_STATE.IDLE;
  }, [externalPauseReason, monitorSuspended, status]);

  const classify = useCallback(
    (diagnostics) => classifyStallNature(diagnostics, playbackHealth, isStartupPhase),
    [playbackHealth, isStartupPhase]
  );

  useEffect(() => {
    if (policyState !== POLICY_STATE.STALLED && policyState !== POLICY_STATE.RECOVERING) {
      stallInsightsRef.current = { classification: 'unknown', lastLoggedAt: 0, lastMitigationAt: 0 };
      setStallClassification('unknown');
      return;
    }

    let diagnostics = null;
    try {
      diagnostics = typeof readDiagnostics === 'function' ? readDiagnostics() : null;
    } catch (error) {
      logResilienceEvent?.('policy-diagnostics-error', {
        message: error?.message || 'policy-diagnostics-error'
      }, { level: 'warn' });
      diagnostics = null;
    }

    if (!diagnostics) {
      setStallClassification('unknown');
      return;
    }

    const classification = classify(diagnostics) || 'unknown';
    setStallClassification(classification);

    if (classification === 'unknown' || classification === 'startup-pending' || classification === 'startup-buffering') {
      return;
    }

    const now = Date.now();
    const lastSnapshot = stallInsightsRef.current;

    if (classification !== lastSnapshot.classification || (now - lastSnapshot.lastLoggedAt) > 4000) {
      logResilienceEvent?.('stall-root-cause', {
        classification,
        diagnostics: summarizeDiagnosticsForLog(diagnostics)
      }, { level: classification === 'buffer-starved' ? 'warn' : 'info' });
      stallInsightsRef.current = {
        ...lastSnapshot,
        classification,
        lastLoggedAt: now,
        lastDetectedAt: now
      };
    }

    if (classification === 'buffer-starved') {
      if ((now - lastSnapshot.lastMitigationAt) > 3000) {
        reduceBitrateAfterHardReset?.({ reason: 'buffer-starved', source: 'stall-guard' });
        stallInsightsRef.current = {
          ...stallInsightsRef.current,
          lastMitigationAt: now
        };
      }
      return;
    }

    if (classification === 'decoder-stall') {
      const detectedAgo = now - (lastSnapshot.lastDetectedAt || now);
      if (detectedAgo < SHAKA_STALL_GRACE_MS) {
        return; // allow Shaka a brief window to self-recover
      }
      requestDecoderNudge?.('decoder-stall', {
        droppedRatio: deriveDroppedRatio(diagnostics?.decoder)
      });
      stallInsightsRef.current = {
        ...stallInsightsRef.current,
        lastMitigationAt: now
      };
    }
  }, [classify, logResilienceEvent, policyState, readDiagnostics, reduceBitrateAfterHardReset, requestDecoderNudge]);

  return useMemo(() => ({
    policyState,
    stallClassification
  }), [policyState, stallClassification]);
}

export default useResiliencePolicy;
