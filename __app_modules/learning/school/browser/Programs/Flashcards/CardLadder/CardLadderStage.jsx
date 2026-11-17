import { useEffect, useRef, useState } from 'react';
import { useSchoolSurface } from '../../../portal/SchoolSurface.jsx';

const DEFAULT_REFERENCE_SIZE = Object.freeze({ width: 1280, height: 800 });

/** Declared teaching canvas uniformly fitted to its actual containing surface. */
export default function CardLadderStage({ children, referenceSize = DEFAULT_REFERENCE_SIZE }) {
  const { bounds } = useSchoolSurface();
  const frameRef = useRef(null);
  const [frameBounds, setFrameBounds] = useState(null);
  useEffect(() => {
    const frame = frameRef.current;
    const measure = rect => {
      const next = { width: Math.max(0, rect.width || 0), height: Math.max(0, rect.height || 0) };
      setFrameBounds(previous => previous?.width === next.width && previous?.height === next.height ? previous : next);
    };
    measure(frame.getBoundingClientRect());
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
      const entry = entries.find(item => item.target === frame);
      if (entry) measure(entry.contentRect);
    }) : null;
    observer?.observe(frame);
    return () => observer?.disconnect();
  }, [bounds.width, bounds.height]);
  // The activity may reserve room for its own header/actions inside the host.
  const available = frameBounds ?? bounds;
  const width = Number.isFinite(referenceSize.width) && referenceSize.width > 0 ? referenceSize.width : DEFAULT_REFERENCE_SIZE.width;
  const height = Number.isFinite(referenceSize.height) && referenceSize.height > 0 ? referenceSize.height : DEFAULT_REFERENCE_SIZE.height;
  const scale = available.width > 0 && available.height > 0 ? Math.min(available.width / width, available.height / height, 1) : 0;
  return <div ref={frameRef} className="wl-stage-frame"><div className="wl-stage" style={{ width, height, transform: `scale(${scale})` }}>{children}</div></div>;
}
