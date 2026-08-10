import { useCallback, useEffect, useRef, useState } from 'react';
import { loopToEvents } from '@shared-music/loopScheduler.mjs';
import { transposeToTargetKey } from './keyModel.js';
import { PEEK_CHANNEL, PEEK_DRUM_CHANNEL } from './usePeek.js';

const TIME_SIG_BEATS = 4;

function cleanBpm(value) {
  return Number.isFinite(value) && value > 0 ? value : 120;
}

/** One-shot preview for generated takes. It shares the production router, uses
 * the same target-key rule as Loop/Song, and tracks exact active notes so drum
 * preview never blanket-silences a concurrently playing groove. */
export function useTakePreview({
  router,
  bpm,
  keyShift = 0,
  layers = [],
  onAudioGesture,
}) {
  const [isPreviewing, setIsPreviewing] = useState(false);
  const routerRef = useRef(router); routerRef.current = router;
  const bpmRef = useRef(bpm); bpmRef.current = bpm;
  const keyRef = useRef(keyShift); keyRef.current = keyShift;
  const layersRef = useRef(layers); layersRef.current = layers;
  const audioRef = useRef(onAudioGesture); audioRef.current = onAudioGesture;
  const runRef = useRef(null);
  const tokenRef = useRef(0);

  const stopPreview = useCallback(() => {
    tokenRef.current += 1;
    const run = runRef.current;
    runRef.current = null;
    if (run) {
      cancelAnimationFrame(run.raf);
      for (const key of run.active) {
        const split = key.indexOf(':');
        routerRef.current?.noteOff?.(Number(key.slice(0, split)), Number(key.slice(split + 1)));
      }
      run.active.clear();
      if (run.channel === PEEK_CHANNEL) routerRef.current?.allNotesOff?.(PEEK_CHANNEL);
    }
    setIsPreviewing(false);
  }, []);

  const previewTake = useCallback((take) => {
    stopPreview();
    if (!take?.notes?.length) return false;
    const groove = take.kind === 'groove' || take.drumMode;
    if (!groove && layersRef.current.some((layer) => layer?.channel === PEEK_CHANNEL)) return false;

    audioRef.current?.();
    const liveBpm = cleanBpm(bpmRef.current);
    const channel = groove ? PEEK_DRUM_CHANNEL : PEEK_CHANNEL;
    const transpose = transposeToTargetKey(
      { role: groove ? 'groove' : (take.kind ?? 'idea'), source: { kind: 'take' } },
      keyRef.current,
    );
    if (!groove) routerRef.current?.configureLayer?.(channel, { program: 0, gain: 1 });
    const events = loopToEvents(take.notes, {
      ppq: take.ppq ?? 480,
      bpm: liveBpm,
      transpose,
      channel,
      gain: 0.9,
      velocity: 90,
    });
    const lengthMs = Math.max(1, take.lengthBars ?? 1) * TIME_SIG_BEATS * (60000 / liveBpm);
    const token = tokenRef.current;
    const run = { raf: 0, active: new Set(), fired: 0, startedAt: performance.now(), events, lengthMs, channel };
    runRef.current = run;
    setIsPreviewing(true);

    const tick = () => {
      if (token !== tokenRef.current || runRef.current !== run) return;
      const elapsed = performance.now() - run.startedAt;
      while (run.fired < events.length && events[run.fired].t <= elapsed) {
        const event = events[run.fired++];
        const key = `${event.channel}:${event.note}`;
        if (event.type === 'note_on' && event.velocity > 0) {
          routerRef.current?.noteOn?.(event.channel, event.note, event.velocity);
          run.active.add(key);
        } else {
          routerRef.current?.noteOff?.(event.channel, event.note);
          run.active.delete(key);
        }
      }
      if (elapsed >= lengthMs) {
        runRef.current = null;
        for (const key of run.active) {
          const split = key.indexOf(':');
          routerRef.current?.noteOff?.(Number(key.slice(0, split)), Number(key.slice(split + 1)));
        }
        run.active.clear();
        setIsPreviewing(false);
        return;
      }
      run.raf = requestAnimationFrame(tick);
    };
    run.raf = requestAnimationFrame(tick);
    return true;
  }, [stopPreview]);

  useEffect(() => () => stopPreview(), [stopPreview]);

  return { previewTake, stopPreview, isPreviewing };
}

export default useTakePreview;
