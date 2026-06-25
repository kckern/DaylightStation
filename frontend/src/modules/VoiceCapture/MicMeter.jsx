import { useEffect, useRef } from 'react';

/**
 * Ref-driven mic level bar. Reads `levelRef.current` (0..1) on a rAF loop and
 * writes it to a transform — never re-renders the React tree. Lifted from the
 * original FeedbackPanel VU meter.
 */
export function MicMeter({ levelRef, active }) {
  const fillRef = useRef(null);
  const rafRef = useRef(null);
  useEffect(() => {
    if (!active) { if (rafRef.current) cancelAnimationFrame(rafRef.current); return undefined; }
    const tick = () => {
      const lvl = Math.max(0.02, Math.min(1, levelRef?.current || 0));
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${lvl.toFixed(3)})`;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [active, levelRef]);
  return (
    <div className="voice-capture-overlay__meter" aria-hidden="true">
      <span ref={fillRef} className="voice-capture-overlay__meter-fill" />
    </div>
  );
}

export default MicMeter;
