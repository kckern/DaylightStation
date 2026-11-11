import React, { useEffect, useMemo, useRef, useState } from 'react';
import useEpisodeStills from './useEpisodeStills.js';

// The rail at the top of the episode panel: the season's poster on the left
// and, to its right, a carousel the poster's height that cycles ten frames —
// a 3×3 mosaic of nine stills from inside the episode, then each still on its
// own. The frames crossfade (motion, not a translucent resting state); under
// prefers-reduced-motion nothing advances and the mosaic stays. It pauses
// while the page is hidden or the rail is scrolled out of view. Every still
// is in the DOM from the start, so the next frame is always already loaded,
// and the carousel only takes over from the episode's own art once all nine
// have arrived — no blank tile, no flash. The rail's size is fixed by CSS
// aspect ratios, so nothing moves when the images land.

export const FRAME_MS = 1500;

const reducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function EpisodeStillsRail({ episode, seasonImage, episodeImage, intervalMs = FRAME_MS }) {
  const { stills } = useEpisodeStills(episode);
  const ready = Array.isArray(stills) && stills.length > 0;
  const [loaded, setLoaded] = useState(0);
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const railRef = useRef(null);
  const stillKey = ready ? stills.join('|') : '';

  // A new episode's stills start again from the mosaic, unloaded.
  useEffect(() => { setLoaded(0); setIndex(0); }, [stillKey]);

  // Pause when the tab is hidden or the rail is off screen.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVisibility = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    let observer = null;
    if (typeof IntersectionObserver === 'function' && railRef.current) {
      observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting && document.visibilityState !== 'hidden'));
      observer.observe(railRef.current);
    }
    return () => { document.removeEventListener('visibilitychange', onVisibility); observer?.disconnect(); };
  }, []);

  const playing = ready && loaded >= stills.length && visible && !reducedMotion();
  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => setIndex((i) => (i + 1) % (stills.length + 1)), intervalMs);
    return () => clearInterval(t);
  }, [playing, intervalMs, stills?.length]);

  const frames = useMemo(() => (ready ? [null, ...stills] : []), [ready, stills]);
  const showCarousel = ready && loaded >= stills.length;

  return (
    <div className="episode-rail" ref={railRef} data-testid="episode-rail">
      <div className="episode-rail__poster">
        {seasonImage && <img src={seasonImage} alt="" />}
      </div>
      <div className={`episode-rail__carousel${showCarousel ? ' is-live' : ''}`} data-frame={showCarousel ? index : 'art'}>
        <div className="episode-rail__art">
          {episodeImage && <img src={episodeImage} alt="" />}
        </div>
        {frames.map((src, i) => (
          <div
            key={src || 'mosaic'}
            className={`episode-rail__frame${i === index ? ' is-current' : ''}${src ? '' : ' episode-rail__frame--mosaic'}`}
            aria-hidden={i !== index}
          >
            {src
              ? <img src={src} alt="" />
              : (
                <div className="episode-rail__mosaic" data-testid="episode-mosaic">
                  {stills.map((tile) => (
                    <img key={tile} src={tile} alt="" onLoad={() => setLoaded((n) => n + 1)} onError={() => setLoaded((n) => n + 1)} />
                  ))}
                </div>
              )}
          </div>
        ))}
      </div>
    </div>
  );
}
