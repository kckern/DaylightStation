import React, { useEffect } from 'react';
import './RecapOverlay.scss';

/**
 * Full-frame, silent, looping playback of a session recap MP4 over the Fitness
 * UI. Muted autoplay is safe (recaps have no audio track). object-fit: contain
 * shows the whole 16:9 frame uncropped. Closes on Escape or a backdrop tap.
 * @param {{ src: string, onClose: () => void }} props
 */
export default function RecapOverlay({ src, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="recap-overlay"
      role="dialog"
      aria-label="Session recap"
      onPointerDown={onClose}
    >
      <video
        className="recap-overlay__video"
        src={src}
        muted
        autoPlay
        loop
        playsInline
        onPointerDown={(e) => e.stopPropagation()}
      />
      <button
        className="recap-overlay__close"
        onPointerDown={(e) => { e.stopPropagation(); onClose?.(); }}
        aria-label="Close recap"
      >{'×'}</button>
    </div>
  );
}
