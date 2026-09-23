import { useCallback, useEffect, useRef, useState } from 'react';
import { languageLog } from './languageLog.js';
import { bindMediaToMaster } from '../../../../lib/volume/bindMediaToMaster.js';

/**
 * Sequenced sentence playback (design §5).
 *
 * A rung's prompt is an ordered list of clips — repetition plays
 * source → target → target — so this drives a small state machine rather than
 * a single `<audio>`. Two behaviours are carried over from the 2016 app
 * deliberately:
 *
 *  1. **Preload the NEXT sentence while the current one plays.** On a slow
 *     panel over a household LAN, the fetch gap between clips is the
 *     difference between a drill and a slideshow.
 *  2. **A pause before the repeated target clip.** That silence is where the
 *     learner actually speaks. Removing it makes the rung a listening
 *     exercise instead of a shadowing one.
 *
 * Autoplay: browsers block audible playback until the page has a user gesture,
 * and a kiosk may never get one on its own. Every sequence here is started by
 * a tap, which satisfies the gate; if `play()` is still rejected we surface
 * `blocked` rather than hanging on a sequence that will never advance.
 */

const REPEAT_GAP_MS = 1000;

/**
 * Silence before a looping sequence starts over. The typing rungs loop the
 * prompt as reinforcement while the learner types, but back-to-back repeats
 * turn support into a siren. This is the breath between repetitions — long
 * enough to type a few characters in quiet, short enough that the sentence
 * is still fresh when it returns.
 */
const LOOP_GAP_MS = 2500;

/**
 * @param {object} [options]
 * @param {() => void} [options.onSequenceEnd] fired when a sequence finishes
 * @param {(clip: object|null) => void} [options.onClip] fired when the clip
 *   sounding changes — the clip as it starts, null in a gap, at the end and
 *   on stop(). For a control that only applies while one clip plays.
 */
export function useSentenceAudio({ onSequenceEnd, onClip } = {}) {
  const elementRef = useRef(null);
  const preloadRef = useRef([]);
  const queueRef = useRef([]);
  const loopRef = useRef(null);
  const timerRef = useRef(null);
  // The end of a span (a clip with `endMs`) and the clip sounding now. Both
  // are cleared on every advance, so a clip that ends on its own can never
  // also fire a stale span timer that skips the step after it.
  const spanTimerRef = useRef(null);
  const activeRef = useRef(null);
  const endRef = useRef(onSequenceEnd);

  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(-1);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => { endRef.current = onSequenceEnd; }, [onSequenceEnd]);
  const clipRef = useRef(onClip);
  useEffect(() => { clipRef.current = onClip; }, [onClip]);
  // Only refs, so the callbacks below may hold it without listing it.
  const setActive = (clip) => {
    if (activeRef.current === clip) return;
    activeRef.current = clip;
    clipRef.current?.(clip);
  };

  useEffect(() => {
    const el = new Audio();
    el.preload = 'auto';
    // The panel's volume keys step a software master; a bare element ignores
    // it and plays at full gain. Follow the master for the element's life.
    const unbindVolume = bindMediaToMaster(el);
    elementRef.current = el;
    preloadRef.current = [new Audio(), new Audio()];
    for (const p of preloadRef.current) p.preload = 'auto';

    return () => {
      clearTimeout(timerRef.current);
      clearTimeout(spanTimerRef.current);
      spanTimerRef.current = null;
      activeRef.current = null;
      unbindVolume();
      el.pause();
      // Clearing `src` fires `error` on the element; with the sequence's
      // handler still attached that logged a phantom `load-failed` for a
      // clip that loaded fine, on every rung change.
      el.onended = null;
      el.onerror = null;
      el.src = '';
      elementRef.current = null;
      preloadRef.current = [];
    };
  }, []);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const clearSpan = () => {
    if (spanTimerRef.current) {
      clearTimeout(spanTimerRef.current);
      spanTimerRef.current = null;
    }
  };

  const stop = useCallback(() => {
    clearTimer();
    clearSpan();
    setActive(null);
    const el = elementRef.current;
    if (el) {
      el.pause();
      el.onended = null;
    }
    queueRef.current = [];
    loopRef.current = null;
    setPlaying(false);
    setStep(-1);
  }, []);

  // Advances the sequence. Defined as a ref-walking loop rather than
  // recursion through state so a rapid re-render mid-sequence cannot strand a
  // half-played prompt.
  const advance = useCallback(() => {
    const el = elementRef.current;
    if (!el) return;
    // NOTHING SOUNDS BETWEEN STEPS: a gap or the end of the sequence has no
    // position, so a live cut made there reads null rather than the last clip.
    clearSpan();
    setActive(null);
    const queue = queueRef.current;

    if (queue.length === 0) {
      if (loopRef.current?.length) {
        const [first, ...rest] = loopRef.current;
        queueRef.current = [{ ...first, gapMs: Math.max(first.gapMs || 0, LOOP_GAP_MS) }, ...rest];
        setStep(-1);
        advance();
        return;
      }
      setPlaying(false);
      setStep(-1);
      languageLog.audio('ended', {});
      endRef.current?.();
      return;
    }

    const next = queue.shift();
    setStep((s) => s + 1);

    const run = () => {
      el.src = next.url;
      // A SPAN: a piece of the model, for a take said in pieces. Seek before
      // play; the element honours a pre-metadata seek as its start position.
      if (next.startMs != null) el.currentTime = next.startMs / 1000;
      setActive(next);
      // Only the clip still active may advance. A span that ends where the
      // file ends can still fire `ended` after its timer has moved on.
      el.onended = () => {
        if (activeRef.current === next) advance();
      };
      el.onerror = () => {
        // A missing clip must not freeze the rung — log it and move on so the
        // learner can still finish the sentence.
        languageLog.audioError('load-failed', { url: next.url });
        advance();
      };
      // Armed only once play() has started, so the span is timed from sound,
      // not from the request. A rejected play() arms nothing.
      const armSpanEnd = () => {
        if (next.endMs == null || activeRef.current !== next) return;
        spanTimerRef.current = setTimeout(() => {
          spanTimerRef.current = null;
          el.onended = null;
          el.pause();
          advance();
        }, Math.max(0, next.endMs - (next.startMs || 0)));
      };
      const result = el.play();
      if (result?.then) {
        result.then(armSpanEnd, (err) => {
          // OUR OWN INTERRUPTION IS NOT A BLOCK. stop(), or a new sequence
          // taking the element, aborts the pending play() — and by then this
          // clip is no longer the active one. Only a refusal of the clip still
          // meant to be sounding is the browser saying no.
          if (activeRef.current !== next) {
            languageLog.audio('play-interrupted', { url: next.url, error: err?.name || err?.message });
            return;
          }
          languageLog.audioError('play-blocked', { url: next.url, error: err?.message });
          setActive(null);
          setBlocked(true);
          setPlaying(false);
        });
      } else {
        armSpanEnd();
      }
    };

    if (next.gapMs) {
      timerRef.current = setTimeout(run, next.gapMs);
    } else {
      run();
    }
  }, []);

  /**
   * @param {Array<{url: string, gapMs?: number, startMs?: number, endMs?: number}>} clips
   * A clip with `startMs`/`endMs` plays only that span of its file.
   * @param {{loop?: boolean}} [options] Repeat the complete sequence until
   * stopped. Used only by the typing rungs after a learner gesture.
   */
  const playSequence = useCallback((clips, { loop = false } = {}) => {
    if (!clips?.length) {
      endRef.current?.();
      return;
    }
    clearTimer();
    setBlocked(false);
    loopRef.current = loop ? [...clips] : null;
    queueRef.current = [...clips];
    setStep(-1);
    setPlaying(true);
    languageLog.audio('play', { steps: clips.length });
    advance();
  }, [advance]);

  /** Warm the cache for the sentence AFTER this one. */
  const preload = useCallback((urls = []) => {
    urls.slice(0, preloadRef.current.length).forEach((url, i) => {
      const el = preloadRef.current[i];
      if (el && url && el.src !== url) {
        el.src = url;
        el.load();
      }
    });
    if (urls.length) languageLog.audio('preload', { count: urls.length });
  }, []);

  /** The clip sounding now, how far into it playback is, and how long its
   *  file is — what a live cut reads. Null between sequences, during a gap and after stop(). */
  const position = useCallback(() => {
    const el = elementRef.current;
    const clip = activeRef.current;
    if (!el || !clip) return null;
    // `durationMs` is the whole FILE's length once its metadata is in, null
    // before — the log uses it to say where the last piece of a cut ends.
    const durationMs = Number.isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration * 1000) : null;
    return {
      language: clip.language, role: clip.role, ms: Math.round(el.currentTime * 1000), durationMs,
    };
  }, []);

  return { playSequence, preload, stop, position, playing, step, blocked, REPEAT_GAP_MS, LOOP_GAP_MS };
}

/**
 * Turn a queue entry's resolved prompt into playable clips.
 *
 * The role→language resolution already happened server-side, so this never
 * mentions a language code. The gap goes before a step that repeats the clip
 * before it — that silence is the learner's turn to speak.
 *
 * @param {{seq: number, prompt: Array<{role: string, language: string}>}} entry
 * @param {(seq: number, lang: string) => string} audioUrl
 */
export function clipsFor(entry, audioUrl) {
  return (entry.prompt || []).map((stepDef, i, all) => ({
    url: audioUrl(entry.seq, stepDef.language),
    gapMs: i > 0 && all[i - 1].language === stepDef.language ? REPEAT_GAP_MS : 0,
    role: stepDef.role,
    language: stepDef.language,
  }));
}

export default useSentenceAudio;
