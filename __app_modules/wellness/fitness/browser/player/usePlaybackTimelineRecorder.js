import { useEffect, useRef } from 'react';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';

let sequence = 0;
const runId = () => `${Date.now()}-${++sequence}`;

/** Observe, never control, playback. Each attachment/replay is its own coverage
 * run; session finalization closes it before persistence and is terminal. */
export function usePlaybackTimelineRecorder({ session, contentId, mediaElement, governance, pauseDecision, resilience, evidence }) {
  const latest = useRef(null);
  latest.current = { governance, pauseDecision, resilience, evidence };
  const observer = useRef(null);
  const binding = useRef(null);
  const sessionId = session?.sessionId;

  useEffect(() => {
    if (!session?.logEvent || !contentId || ('sessionId' in session && !sessionId)) return undefined;
    // Content and element arrive in separate renders during the player's poll.
    // The old element cannot establish playback of the newly selected video.
    let attributable = !mediaElement || binding.current?.element !== mediaElement || binding.current?.contentId === contentId;
    if (mediaElement) binding.current = { element: mediaElement, contentId };
    let playbackRunId = runId();
    let closed = false;
    let disposed = false;
    let observedPlaying = false;
    let waiting = false;
    let started = false;
    let initialGateWait = false;
    let signature;
    let lastTime = mediaElement?.currentTime;
    let lastWall = Date.now();
    const record = (observation = 'change') => {
      if (closed || disposed) return;
      const context = latest.current;
      const gov = context.governance || {};
      const pause = context.pauseDecision || {};
      const health = context.resilience || {};
      const proof = gov.isGoverned === false ? null : context.evidence;
      const locked = Boolean(gov.videoLocked);
      if (locked && !started) initialGateWait = true;
      const held = pause.holdReason || (pause.reason === 'PAUSED_USER' ? 'manual' : null);
      let state = 'unknown'; let reason = 'unknown';
      if (observation === 'end') { state = 'none'; reason = null; }
      else if (held && mediaElement?.paused) { state = 'paused'; reason = held; }
      else if (locked && mediaElement?.paused !== false) {
        state = started ? 'governance_paused' : 'waiting';
        reason = gov.status === 'pending' ? 'startup_gate' : (proof?.reason || 'requirements_not_met');
      } else if (waiting || health.stalled || health.waitingToPlay) { state = 'buffering'; reason = 'buffering'; }
      else if (!started && initialGateWait) { state = 'waiting'; reason = 'startup_gate'; }
      else if (observedPlaying && mediaElement?.paused === false && !mediaElement?.seeking) {
        state = gov.status === 'warning' ? 'warning' : 'playing'; reason = null;
      } else if (mediaElement?.paused && started) { state = 'paused'; reason = 'unknown'; }
      const data = {
        version: 1, contentId, playbackRunId, observation, state, reason,
        mediaTimeSeconds: Number.isFinite(mediaElement?.currentTime) ? mediaElement.currentTime : null,
        governancePhase: gov.status || null, evidence: proof ? { ...proof } : null,
      };
      const next = JSON.stringify([state, reason, data.governancePhase, data.evidence]);
      if (observation !== 'change' || next !== signature) {
        session.logEvent('playback_state', data, Date.now());
        signature = next;
      }
    };
    const onPlaying = () => {
      if (disposed || !attributable) return;
      if (closed) {
        closed = false; playbackRunId = runId(); signature = undefined;
        observedPlaying = false; started = false; waiting = false; initialGateWait = false;
        record('begin');
      }
      observedPlaying = true; started = true; waiting = false; initialGateWait = false;
      record();
    };
    const onPause = () => { if (!attributable) return; observedPlaying = false; waiting = false; record(); };
    const onWaiting = () => { if (!attributable) return; observedPlaying = false; waiting = true; record(); };
    const onLoad = () => {
      attributable = true; observedPlaying = false; waiting = false;
      lastTime = mediaElement?.currentTime; lastWall = Date.now();
      record();
    };
    const onTime = () => {
      const now = Date.now(); const time = mediaElement?.currentTime;
      const delta = time - lastTime;
      const expected = Math.max(0, now - lastWall) / 1000 * (Number(mediaElement?.playbackRate) || 1);
      // A seek jump is not evidence that frames are playing. Subsequent normal
      // advancement can recover a playing event missed before late attachment.
      if (attributable && !mediaElement?.paused && !mediaElement?.seeking && mediaElement?.readyState >= 3
          && Number.isFinite(delta) && delta > 0 && delta <= expected + 0.5) onPlaying();
      lastTime = time; lastWall = now;
    };
    const end = () => { if (!closed && !disposed) { record('end'); closed = true; } };
    const stop = () => { end(); disposed = true; };
    const unsubscribe = session.onSessionEnding?.(stop);
    const listeners = { playing: onPlaying, pause: onPause, waiting: onWaiting, timeupdate: onTime, loadstart: onLoad, ended: () => { if (attributable) end(); } };
    for (const [event, handler] of Object.entries(listeners)) mediaElement?.addEventListener(event, handler);
    observer.current = record;
    record('begin');
    getLogger().debug('fitness.playback_observer.attached', { contentId, playbackRunId });
    return () => {
      for (const [event, handler] of Object.entries(listeners)) mediaElement?.removeEventListener(event, handler);
      stop(); unsubscribe?.();
      if (observer.current === record) observer.current = null;
    };
  }, [session, sessionId, contentId, mediaElement]);

  useEffect(() => { observer.current?.(); }, [governance, pauseDecision, resilience, evidence]);
}
