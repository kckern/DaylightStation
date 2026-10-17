import { useEffect, useRef } from 'react';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';

// An attachment is an observation run, not an episode ID: a reload or element
// replacement cannot silently claim uninterrupted playback of the same episode.
let sequence = 0;
export function usePlaybackTimelineRecorder({ session, contentId, mediaElement, governance, pauseDecision, resilience, evidence }) {
  const latest = useRef(null);
  latest.current = { governance, pauseDecision, resilience, evidence };
  const observer = useRef(null);

  useEffect(() => {
    if (!session?.logEvent || !contentId) return undefined;
    const playbackRunId = `${Date.now()}-${++sequence}`;
    let closed = false;
    let observedPlaying = false;
    let waiting = false;
    let started = false;
    let signature;
    const record = (observation = 'change') => {
      if (closed) return;
      const context = latest.current;
      const gov = context.governance || {};
      const pause = context.pauseDecision || {};
      const health = context.resilience || {};
      const proof = context.evidence;
      const locked = Boolean(gov.videoLocked);
      const held = pause.holdReason || (pause.reason === 'PAUSED_USER' ? 'manual' : null);
      let state = 'unknown'; let reason = 'unknown';
      if (observation === 'end') { state = 'none'; reason = null; }
      else if (held && mediaElement?.paused) { state = 'paused'; reason = held; }
      else if (locked && mediaElement?.paused !== false) {
        state = started ? 'governance_paused' : 'waiting';
        reason = gov.status === 'pending' ? 'startup_gate' : (proof?.reason || 'requirements_not_met');
      } else if (waiting || health.stalled || health.waitingToPlay) { state = 'buffering'; reason = 'buffering'; }
      else if (observedPlaying && mediaElement?.paused === false && !mediaElement?.seeking) {
        state = gov.status === 'warning' ? 'warning' : 'playing'; reason = null;
      } else if (mediaElement?.paused && started) { state = 'paused'; reason = 'unknown'; }
      const data = {
        version: 1, contentId, playbackRunId, observation, state, reason,
        mediaTimeSeconds: Number.isFinite(mediaElement?.currentTime) ? mediaElement.currentTime : null,
        governancePhase: gov.status || null,
        evidence: proof ? { ...proof } : null,
      };
      // Media time/HR ticks alone must not produce an event stream.
      const next = JSON.stringify([state, reason, data.governancePhase, data.evidence]);
      if (observation !== 'change' || next !== signature) {
        session.logEvent('playback_state', data, Date.now());
        signature = next;
      }
    };
    const onPlaying = () => { observedPlaying = true; started = true; waiting = false; record(); };
    const onPause = () => { observedPlaying = false; waiting = false; record(); };
    const onWaiting = () => { observedPlaying = false; waiting = true; record(); };
    const end = () => { if (!closed) { record('end'); closed = true; } };
    const listeners = { playing: onPlaying, pause: onPause, waiting: onWaiting, ended: end };
    for (const [event, handler] of Object.entries(listeners)) mediaElement?.addEventListener(event, handler);
    observer.current = record;
    record('begin');
    getLogger().debug('fitness.playback_observer.attached', { contentId, playbackRunId });
    return () => {
      for (const [event, handler] of Object.entries(listeners)) mediaElement?.removeEventListener(event, handler);
      end();
      if (observer.current === record) observer.current = null;
    };
  }, [session, contentId, mediaElement]);

  useEffect(() => { observer.current?.(); }, [governance, pauseDecision, resilience, evidence]);
}
