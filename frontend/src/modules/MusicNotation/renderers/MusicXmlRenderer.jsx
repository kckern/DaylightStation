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
export function MusicXmlRenderer({ musicXml, score: scoreProp, width, onLayout, children }) {
  const hostRef = useRef(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });

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
      const res = vexflowRender(host, score, { width: w });
      setDims({ width: res.width, height: res.height });
      onLayout?.(res);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('MusicXmlRenderer: render failed', err?.message);
    }
  }, [score, width, onLayout]);

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
