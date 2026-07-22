import { useCallback, useEffect, useRef, useState } from 'react';
import { languageLog } from './languageLog.js';

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

export function useSentenceAudio({ onSequenceEnd } = {}) {
  const elementRef = useRef(null);
  const preloadRef = useRef([]);
  const queueRef = useRef([]);
  const timerRef = useRef(null);
  const endRef = useRef(onSequenceEnd);

  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(-1);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => { endRef.current = onSequenceEnd; }, [onSequenceEnd]);

  useEffect(() => {
    const el = new Audio();
    el.preload = 'auto';
    elementRef.current = el;
    preloadRef.current = [new Audio(), new Audio()];
    for (const p of preloadRef.current) p.preload = 'auto';

    return () => {
      clearTimeout(timerRef.current);
      el.pause();
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

  const stop = useCallback(() => {
    clearTimer();
    const el = elementRef.current;
    if (el) {
      el.pause();
      el.onended = null;
    }
    queueRef.current = [];
    setPlaying(false);
    setStep(-1);
  }, []);

  // Advances the sequence. Defined as a ref-walking loop rather than
  // recursion through state so a rapid re-render mid-sequence cannot strand a
  // half-played prompt.
  const advance = useCallback(() => {
    const el = elementRef.current;
    if (!el) return;
    const queue = queueRef.current;

    if (queue.length === 0) {
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
      el.onended = () => advance();
      el.onerror = () => {
        // A missing clip must not freeze the rung — log it and move on so the
        // learner can still finish the sentence.
        languageLog.audioError('load-failed', { url: next.url });
        advance();
      };
      const result = el.play();
      if (result?.catch) {
        result.catch((err) => {
          languageLog.audioError('play-blocked', { url: next.url, error: err?.message });
          setBlocked(true);
          setPlaying(false);
        });
      }
    };

    if (next.gapMs) {
      timerRef.current = setTimeout(run, next.gapMs);
    } else {
      run();
    }
  }, []);

  /**
   * @param {Array<{url: string, gapMs?: number}>} clips
   */
  const playSequence = useCallback((clips) => {
    if (!clips?.length) {
      endRef.current?.();
      return;
    }
    clearTimer();
    setBlocked(false);
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

  return { playSequence, preload, stop, playing, step, blocked, REPEAT_GAP_MS };
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
