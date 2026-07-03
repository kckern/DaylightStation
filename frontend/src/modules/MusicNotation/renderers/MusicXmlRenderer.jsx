import { useRef, useEffect, useState } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { osmdRender } from './osmdRender.js';

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
 * `onLayout({ width, height, events })`, so an overlay (cursor / play-along)
 * can light notes up without touching the renderer internals.
 *
 * @param {string} [musicXml] - raw MusicXML document
 * @param {number} [width] - render width (defaults to the parent's width)
 * @param {'wrapped'|'horizontal'} [flow]
 * @param {number} [scale]
 * @param {(res:{width,height,events}) => void} [onLayout]
 * @param {React.ReactNode} [children] - overlay content positioned over the SVG
 */
export function MusicXmlRenderer({ musicXml, width, flow = 'wrapped', scale = 1, onLayout, children }) {
  const hostRef = useRef(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [resizeKey, setResizeKey] = useState(0);
  const renderSeq = useRef(0);

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
    setRendering(true);
    (async () => {
      try {
        const res = await osmdRender(host, musicXml, { width: w, flow, scale, shouldAbort: stale });
        if (!res || stale()) return;
        setFailed(false);
        setDims({ width: res.width, height: res.height });
        onLayout?.(res);
      } catch (err) {
        if (stale()) return;
        setFailed(true);
        logger().warn('musicxml.render-failed', { error: err?.message });
      } finally {
        if (!stale()) setRendering(false);
      }
    })();
    return () => { if (renderSeq.current === seq) renderSeq.current++; };
  }, [musicXml, width, flow, scale, onLayout, resizeKey]);

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
      {!showPlaceholder && !rendering && children}
    </div>
  );
}

export default MusicXmlRenderer;
