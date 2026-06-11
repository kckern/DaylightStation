import { useEffect, useRef, useState } from 'react';
import { createRealtimeBpmAnalyzer } from 'realtime-bpm-analyzer';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'dance-bpm' });
  return _logger;
}

export const BPM_MIN = 40;
export const BPM_MAX = 200;
// Ignore wobble below this delta so the strobe clock isn't restarted by
// ±1 BPM jitter between analyzer votes.
export const BPM_HYSTERESIS = 2;

const POLL_MS = 1000;

/**
 * Pure candidate selection: take the analyzer's top tempo vote, round it,
 * and keep the current value when the candidate is missing, implausible
 * (outside 40–200), or within the hysteresis band of what we already have.
 */
export function pickBpm(candidates, current) {
  const tempo = Number(candidates?.[0]?.tempo);
  if (!Number.isFinite(tempo)) return current ?? null;
  const rounded = Math.round(tempo);
  if (rounded < BPM_MIN || rounded > BPM_MAX) return current ?? null;
  if (current != null && Math.abs(rounded - current) < BPM_HYSTERESIS) return current;
  return rounded;
}

/**
 * Live BPM detection from the dance audio Player, via realtime-bpm-analyzer
 * (AudioWorklet). Audio graph: media element source → analyzer node →
 * destination (the worklet passes audio through, per the library's
 * documented element wiring).
 *
 * Safety invariant: createMediaElementSource permanently reroutes the
 * element's audio through the AudioContext, so we ONLY attach while the
 * context is `running` — wiring into a suspended context would silence the
 * party music. Until the context resumes (autoplay policy), detection just
 * stays off and the caller falls back to the configured BPM.
 *
 * The Player remounts its <audio> element on every track change
 * (key={mediaInstanceKey} in AudioPlayer), so a 1s poll watches
 * getMediaElement() and re-attaches each new element. Same-origin proxied
 * mediaUrls (/api/v1/proxy/plex/...) mean the samples are readable (no CORS
 * taint → silent analyser).
 */
export function useDanceBpm({ playerRef, enabled = true, trackKey = null } = {}) {
  const [detectedBpm, setDetectedBpm] = useState(null);
  const ctxRef = useRef(null);
  const analyzerRef = useRef(null);
  const analyzerFailedRef = useRef(false);
  const attachedElRef = useRef(null);
  const sourceRef = useRef(null);

  // New song → clear the vote history so the previous track's peaks don't
  // outvote the new tempo. detectedBpm is kept until fresh votes replace it.
  useEffect(() => {
    if (trackKey == null) return;
    analyzerRef.current?.reset?.();
  }, [trackKey]);

  useEffect(() => {
    if (!enabled || !playerRef) return undefined;
    let cancelled = false;

    const ensurePipeline = async () => {
      if (analyzerFailedRef.current) return null;
      if (!ctxRef.current) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) {
          analyzerFailedRef.current = true;
          logger().warn('fitness.dance.bpm.web_audio_unavailable', {});
          return null;
        }
        ctxRef.current = new Ctx();
      }
      const ctx = ctxRef.current;
      if (ctx.state !== 'running') {
        try { await ctx.resume(); } catch { /* retried on next poll */ }
        if (ctx.state !== 'running') return null;
      }
      if (!analyzerRef.current) {
        try {
          const analyzer = await createRealtimeBpmAnalyzer(ctx, {
            continuousAnalysis: true,
            stabilizationTime: 20000
          });
          if (cancelled) { analyzer.stop?.(); return null; }
          analyzer.on('bpm', (data) => {
            setDetectedBpm((current) => {
              const next = pickBpm(data?.bpm, current);
              if (next !== current) {
                logger().info('fitness.dance.bpm.detected', { bpm: next, topCandidate: data?.bpm?.[0] ?? null });
              }
              return next;
            });
          });
          analyzer.node.connect(ctx.destination);
          analyzerRef.current = analyzer;
          logger().info('fitness.dance.bpm.analyzer_ready', {});
        } catch (err) {
          // One-shot: a worklet that failed to load will fail every poll.
          analyzerFailedRef.current = true;
          logger().warn('fitness.dance.bpm.analyzer_failed', { message: err?.message ?? null });
          return null;
        }
      }
      return analyzerRef.current;
    };

    const attach = async () => {
      const el = playerRef.current?.getMediaElement?.() ?? null;
      if (!el || el === attachedElRef.current) return;
      const analyzer = await ensurePipeline();
      if (!analyzer || cancelled) return;
      // The element may have swapped again while the pipeline was awaited.
      const liveEl = playerRef.current?.getMediaElement?.() ?? null;
      if (!liveEl || liveEl === attachedElRef.current) return;
      try {
        const source = ctxRef.current.createMediaElementSource(liveEl);
        sourceRef.current?.disconnect?.();
        source.connect(analyzer.node);
        sourceRef.current = source;
        attachedElRef.current = liveEl;
        logger().debug('fitness.dance.bpm.element_attached', {});
      } catch (err) {
        // e.g. InvalidStateError: element already routed elsewhere. Mark it
        // attached so we don't throw once a second for the same element.
        attachedElRef.current = liveEl;
        logger().warn('fitness.dance.bpm.attach_failed', { message: err?.message ?? null });
      }
    };

    attach();
    const id = setInterval(attach, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled, playerRef]);

  // Unmount teardown. Closing the context also kills any element still routed
  // through it — fine here, because the widget unmounts its Players with it.
  useEffect(() => () => {
    analyzerRef.current?.stop?.();
    analyzerRef.current?.disconnect?.();
    analyzerRef.current = null;
    ctxRef.current?.close?.().catch?.(() => {});
    ctxRef.current = null;
  }, []);

  return { detectedBpm };
}

export default useDanceBpm;
