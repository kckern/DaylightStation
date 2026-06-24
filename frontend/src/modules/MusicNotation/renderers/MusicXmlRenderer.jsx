import { useRef, useEffect, useState, useMemo } from 'react';
import { parseMusicXml } from '../parseMusicXml.js';
import { vexflowRender } from './vexflowRender.js';

/**
 * MusicXmlRenderer — engraves a MusicXML score as SVG via VexFlow.
 *
 * Renders the static notation and reports the on-screen position of every melody
 * note through `onLayout({ width, height, events })`, so an overlay (cursor /
 * play-along) can light notes up without touching the renderer internals.
 *
 * @param {string} [musicXml] - raw MusicXML document
 * @param {object} [score] - a pre-parsed Score (skips parsing)
 * @param {number} [width] - render width (defaults to the parent's width)
 * @param {(res:{width,height,events}) => void} [onLayout]
 * @param {React.ReactNode} [children] - overlay content positioned over the SVG
 */
export function MusicXmlRenderer({ musicXml, score: scoreProp, width, flow = 'wrapped', scale = 1, onLayout, children }) {
  const hostRef = useRef(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const [resizeKey, setResizeKey] = useState(0);

  // Resize watchdog: re-fit when the container width changes (wrapped mode reflows
  // its measures-per-line to the new width). Debounced; ignores sub-pixel jitter.
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

  const score = useMemo(() => {
    if (scoreProp) return scoreProp;
    if (!musicXml) return null;
    try { return parseMusicXml(musicXml); } catch { return null; }
  }, [scoreProp, musicXml]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !score) return;
    const w = width || host.parentElement?.clientWidth || 1000;
    try {
      const res = vexflowRender(host, score, { width: w, flow, scale });
      setDims({ width: res.width, height: res.height });
      onLayout?.(res);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('MusicXmlRenderer: render failed', err?.message);
    }
  }, [score, width, flow, scale, onLayout, resizeKey]);

  if (!score) {
    return (
      <div className="musicxml-renderer musicxml-renderer--placeholder">
        <p>{musicXml ? 'Could not read this score.' : 'No score provided.'}</p>
      </div>
    );
  }

  return (
    <div className="musicxml-renderer" style={{ position: 'relative', width: dims.width || '100%' }}>
      <div ref={hostRef} className="musicxml-renderer__svg" />
      {children}
    </div>
  );
}

export default MusicXmlRenderer;
