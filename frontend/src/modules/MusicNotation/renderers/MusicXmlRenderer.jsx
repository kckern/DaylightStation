import { useRef, useEffect, useState } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { osmdEngrave, osmdRepaint, extractLayoutSliced, scheduleYield } from './osmdRender.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'musicxml-renderer' });
  return _logger;
}

/**
 * MusicXmlRenderer — engraves a MusicXML score as SVG via OpenSheetMusicDisplay.
 *
 * Renders the engraved notation (beams, ties, stems, key signatures — real
 * sheet music) and reports the on-screen position of every melody note through
 * `onLayout({ width, height, events, notes, steps, tempoEntries })`, so an overlay
 * (cursor / play-along / per-notehead light-up) can position itself without
 * touching the renderer internals. `steps` carries every onset's noteheads across
 * all staves with geometry; `events` is the top-staff melody cursor track.
 *
 * @param {string} [musicXml] - raw MusicXML document
 * @param {number} [width] - render width (defaults to the parent's width)
 * @param {'wrapped'|'horizontal'} [flow]
 * @param {number} [scale]
 * @param {(res:{width,height,events,notes,steps,tempoEntries}) => void} [onLayout]
 * @param {(p:number) => void} [onProgress] - extraction progress fraction 0..1
 * @param {() => void} [onReady] - fired once geometry extraction completes and
 *   the play-along overlay can be armed (the sheet is already painted before this)
 * @param {React.ReactNode} [children] - overlay content positioned over the SVG
 */
export function MusicXmlRenderer({ musicXml, width, flow = 'wrapped', scale = 1, onLayout, onProgress, onReady, children }) {
  const hostRef = useRef(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resizeKey, setResizeKey] = useState(0);
  const renderSeq = useRef(0);
  const osmdRef = useRef(null);    // loaded OSMD instance (reused for zoom/resize)
  const osmdKeyRef = useRef(null); // `${flow}::${musicXml}` the instance was loaded for
  useEffect(() => () => { osmdRef.current = null; }, []);

  // Resize watchdog: re-fit when the container width changes (wrapped mode reflows
  // its systems to the new width). Debounced; ignores sub-pixel jitter.
  useEffect(() => {
    const parent = hostRef.current?.parentElement;
    if (!parent || typeof ResizeObserver === 'undefined') return undefined;
    let lastW = parent.clientWidth;
    let t;
    const ro = new ResizeObserver(() => {
      const w = parent.clientWidth;
      if (Math.abs(w - lastW) < 2) return;
      lastW = w;
      clearTimeout(t);
      t = setTimeout(() => setResizeKey((k) => k + 1), 120);
    });
    ro.observe(parent);
    return () => { clearTimeout(t); ro.disconnect(); };
  }, []);

  // A new document deserves a fresh attempt.
  useEffect(() => { setFailed(false); }, [musicXml]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !musicXml) return undefined;
    const seq = ++renderSeq.current;
    const stale = () => renderSeq.current !== seq;
    const w = width || host.parentElement?.clientWidth || 1000;
    const cacheKey = `${flow}::${musicXml}`;

    // Progress + result plumbing shared by both paths. Every setState is
    // stale-guarded so a superseded render can never clobber the live one.
    const reportProgress = (p) => { if (!stale()) { setProgress(p); onProgress?.(p); } };
    const publish = (res, engWidth, engHeight, engFlow) => {
      onLayout?.({ ...res, width: engWidth, height: engHeight, flow: engFlow });
      onReady?.(); // exactly once per successful extraction
    };

    (async () => {
      setExtracting(true);
      setProgress(0);
      try {
        // Cheap path: same document + flow (zoom / resize). Re-render the loaded
        // instance in place (skips the MusicXML re-parse, audit F1) to PAINT, then
        // run the expensive geometry extraction sliced so the tablet still breathes.
        if (osmdRef.current && osmdKeyRef.current === cacheKey) {
          try {
            const rr = osmdRepaint(osmdRef.current, host, { width: w, flow, scale });
            if (stale()) return;
            setFailed(false);
            setDims({ width: rr.width, height: rr.height }); // PAINT (sheet visible)
            const res = await extractLayoutSliced(osmdRef.current, {
              yieldFn: scheduleYield, onProgress: reportProgress, shouldAbort: stale,
            });
            if (stale() || !res) return;
            publish(res, rr.width, rr.height, flow);
            return;
          } catch (err) {
            if (stale()) return;
            logger().warn('musicxml.rerender-failed', { error: err?.message });
            osmdRef.current = null; // fall through to a full engrave below
          }
        }

        // Full path: PAINT the engraved sheet first (Manual mode usable at once),
        // THEN extract geometry in yielded slices with progress.
        setRendering(true);
        const eng = await osmdEngrave(host, musicXml, { width: w, flow, scale, shouldAbort: stale });
        if (!eng || stale()) return;
        osmdRef.current = eng.osmd;
        osmdKeyRef.current = cacheKey;
        setDims({ width: eng.width, height: eng.height }); // PAINT
        setFailed(false);
        setRendering(false); // sheet is visible; hide the "Engraving…" veil
        const res = await extractLayoutSliced(eng.osmd, {
          yieldFn: scheduleYield, onProgress: reportProgress, shouldAbort: stale,
        });
        if (stale() || !res) return;
        publish(res, eng.width, eng.height, eng.flow);
      } catch (err) {
        if (stale()) return;
        setFailed(true);
        logger().warn('musicxml.render-failed', { error: err?.message });
      } finally {
        // Only the live render resets its flags; a stale run leaves them to the
        // newer owner (or to unmount), so nothing gets stuck true.
        if (!stale()) { setRendering(false); setExtracting(false); }
      }
    })();
    return () => { if (renderSeq.current === seq) renderSeq.current++; };
  }, [musicXml, width, flow, scale, onLayout, onProgress, onReady, resizeKey]);

  const showPlaceholder = !musicXml || failed;
  return (
    <div
      className={`musicxml-renderer${showPlaceholder ? ' musicxml-renderer--placeholder' : ''}`}
      style={{ position: 'relative', width: showPlaceholder || !dims.width ? '100%' : dims.width }}
    >
      {showPlaceholder && <p>{musicXml ? 'Could not read this score.' : 'No score provided.'}</p>}
      {/* Host stays mounted even on failure so a new document can render into it. */}
      <div ref={hostRef} className="musicxml-renderer__svg" style={showPlaceholder ? { display: 'none' } : undefined} />
      {!showPlaceholder && rendering && dims.width > 0 && <div className="musicxml-renderer__busy">Engraving…</div>}
      {/* Determinate extraction progress; the painted sheet stays visible beneath it. Styling is Task 11. */}
      {!showPlaceholder && extracting && (
        <div className="musicxml-renderer__progress" style={{ '--p': progress }} aria-hidden="true" />
      )}
      {!showPlaceholder && !rendering && children}
    </div>
  );
}

export default MusicXmlRenderer;
