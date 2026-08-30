import { useEffect, useRef, useState } from 'react';
import { getChildLogger } from '../../../../../lib/logging/singleton.js';
import SegmentedSecretText from '@gaming-ui/SegmentedSecretText.jsx';
import { normalizeMaskPixels } from './decoderPixels.js';

const logger = getChildLogger({ component: 'party-games-decoder' });

export function DecoderText({ children, accessibleText = 'Encoded clue for the performer' }) {
  return <SegmentedSecretText text={children} label="Activity clue" accessibleText={accessibleText} />;
}

export function HighContrastMask({ src, alt = '' }) {
  const canvasRef = useRef(null); const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true; const image = new Image(); image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (!live) return; const canvas = canvasRef.current; if (!canvas) return;
      try { canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0); context.putImageData(normalizeMaskPixels(context.getImageData(0, 0, canvas.width, canvas.height)), 0, 0); setFailed(false); }
      catch (error) { logger.warn('gaming.decoder.normalization-failed', { src, error: error.message }); setFailed(true); }
    };
    image.onerror = () => { if (live) { logger.warn('gaming.decoder.image-failed', { src }); setFailed(true); } };
    image.src = src; return () => { live = false; };
  }, [src]);
  return failed
    ? <img src={src} alt={alt} className="party-games-decoder-mask" style={{ filter: 'grayscale(1) contrast(4)' }} />
    : <canvas ref={canvasRef} role="img" aria-label={alt} className="party-games-decoder-mask" />;
}
