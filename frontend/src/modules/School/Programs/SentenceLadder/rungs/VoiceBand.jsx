import { useEffect, useRef } from 'react';
import { barCount, binsFromSamples, drawBand, rmsOfBytes, shapeLevel } from './voiceBand.js';

/**
 * The recording rung's voice band — the child's own sound, drawn as it
 * happens, in the accent colour, the width of the stage.
 *
 * Three things it can show, decided by props:
 *   `stream`  a live microphone: recent levels scroll in from the right.
 *             This is also the volume meter — a flat band means nothing is
 *             arriving, whatever the red Stop disc claims.
 *   `take`    a finished recording (mono samples), fitted to the width. With `getPlayhead`
 *             the bars already heard are lit and the rest wait in grey, so
 *             hearing yourself back is watching your own line get coloured in.
 *   neither   the last live levels, frozen — the picture stays while the take
 *             decodes, and stands in if decoding fails.
 *
 * A canvas, not DOM bars: the kiosk WebView drops frames under CSS
 * transitions, and sixty animated divs is sixty layout invalidations a frame.
 * One canvas repaint at ~30fps is well inside its budget. Colours are read
 * from the School tokens once per resize, never per frame.
 *
 * `onLevel(level)` reports each live sample (0..1) so the rung can decide,
 * in words, that the microphone is silent.
 */
export default function VoiceBand({ stream = null, take = null, getPlayhead = null, onLevel = null }) {
  const canvasRef = useRef(null);
  const historyRef = useRef([]);
  const analyserRef = useRef(null);
  const contextRef = useRef(null);
  const onLevelRef = useRef(onLevel);
  useEffect(() => { onLevelRef.current = onLevel; }, [onLevel]);

  // Web Audio for the live stream. Guarded: jsdom, and the odd embedded
  // browser, have no AudioContext, and the band then simply stays a baseline.
  useEffect(() => {
    const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!stream || !Ctx) return undefined;
    let ctx;
    try {
      ctx = new Ctx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyserRef.current = analyser;
      contextRef.current = ctx;
      // A fresh take starts a fresh row.
      historyRef.current = [];
      // Android WebViews hand out a suspended context even after a gesture.
      if (ctx.state === 'suspended') ctx.resume?.().catch?.(() => {});
    } catch {
      analyserRef.current = null;
    }
    return () => {
      analyserRef.current = null;
      contextRef.current = null;
      ctx?.close?.().catch?.(() => {});
    };
  }, [stream]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx2d = canvas?.getContext?.('2d');
    if (!canvas || !ctx2d) return undefined;

    const reduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const frameMs = reduced ? 100 : 33;

    let colors = null;
    let size = { width: 0, height: 0 };
    const measure = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return false;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      size = { width, height };
      const style = getComputedStyle(canvas);
      colors = {
        voice: style.getPropertyValue('--school-accent').trim() || '#2ec46f',
        rest: style.getPropertyValue('--school-border').trim() || '#34343f',
        baseline: style.getPropertyValue('--school-muted').trim() || '#9a9aa6',
      };
      return true;
    };

    const bytes = new Uint8Array(1024);
    // The take is binned to however many bars fit, once per width.
    let fitted = { count: 0, bins: null };
    const takeBins = (count) => {
      if (fitted.count !== count) fitted = { count, bins: binsFromSamples(take, count) };
      return fitted.bins;
    };
    const paint = () => {
      if (!colors && !measure()) return;
      const analyser = analyserRef.current;
      if (analyser) {
        analyser.getByteTimeDomainData(bytes);
        const level = shapeLevel(rmsOfBytes(bytes));
        const history = historyRef.current;
        history.push(level);
        const cap = barCount(size.width);
        if (history.length > cap) history.splice(0, history.length - cap);
        onLevelRef.current?.(level);
      }
      const levels = take ? takeBins(barCount(size.width)) : Float32Array.from(historyRef.current);
      const playhead = take && getPlayhead ? getPlayhead() : null;
      drawBand(ctx2d, { ...size, levels, playhead, ...colors });
    };

    const live = Boolean(stream) || Boolean(take && getPlayhead);
    let raf = 0;
    let last = 0;
    const loop = (now) => {
      if (now - last >= frameMs) { last = now; paint(); }
      raf = requestAnimationFrame(loop);
    };
    const ro = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => { colors = null; paint(); })
      : null;
    ro?.observe(canvas);

    paint();
    if (live) raf = requestAnimationFrame(loop);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [stream, take, getPlayhead]);

  return (
    <div className="lang-voice" data-testid="voice-band">
      <canvas ref={canvasRef} className="lang-voice__canvas" aria-hidden="true" />
    </div>
  );
}
