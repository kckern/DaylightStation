import React, { useLayoutEffect, useRef, useState } from 'react';
import { layoutVideoCards } from "./videoCardLayout.js";
import "./MarkerGutter.scss";

/**
 * Center gutter between the rings chart (top) and the heart-rate lanes (bottom):
 * it holds the video-change poster cards. The vertical lines that run through it
 * — video changes, challenges, race bands, seams — are TimelineOverlay's, drawn
 * once for the whole stack; the cards are placed from the same marks
 * (buildSessionMarks), so each card sits on its line.
 */
export default function MarkerGutter({ videoMarkers = [] }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const cardLayout = layoutVideoCards(videoMarkers, width);

  return (
    <div ref={ref} className="marker-gutter">
      {width > 0 && videoMarkers.map((m, i) => {
        const { flip, captionWidth, zIndex } = cardLayout[i];
        return (
          <div
            key={`vid-${i}`}
            className={`marker-gutter__chip marker-gutter__chip--video${flip ? ' marker-gutter__chip--flip' : ''}`}
            style={{ left: `${m.x}px`, zIndex }}
          >
            <div className="imgs">
              {m.posterUrl && <img className="poster" src={m.posterUrl} alt="" />}
              {m.thumbUrl && <img className="thumb" src={m.thumbUrl} alt="" />}
            </div>
            {m.episodeName && captionWidth != null && (
              <div className="caption" style={{ maxWidth: `${captionWidth}px` }}>{m.episodeName}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
