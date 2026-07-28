import { useEffect, useState } from 'react';

/**
 * Fixed design canvas for the kiosk (piano.yml `display.designWidth/Height`,
 * default 1280×800 — the SM-T590 tablet's CSS viewport). The whole app lays
 * out at the design resolution and scales uniformly to fit the real viewport,
 * so a desktop browser shows exactly the tablet's layout (letterboxed when
 * aspect differs). On the tablet itself the scale is 1 — a no-op.
 *
 * Cue from the screen framework's physical-size telemetry: normalize on CSS
 * pixels at a declared design size rather than chasing every viewport.
 * Disabled (children pass through untouched) when either dimension is unset.
 */
export default function PianoDesignScale({ width, height, children }) {
  const enabled = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (!enabled) return undefined;
    const compute = () => setScale(Math.min(window.innerWidth / width, window.innerHeight / height));
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [enabled, width, height]);

  if (!enabled) return children;
  return (
    <div className="piano-design-viewport">
      <div
        className="piano-design-canvas"
        style={{ width: `${width}px`, height: `${height}px`, transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}
