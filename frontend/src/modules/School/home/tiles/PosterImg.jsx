import { useState } from 'react';

/**
 * PosterImg — a poster that SHIMMERS until its art arrives (M9 fix 2): Plex
 * serves posters slowly on a cold cache (12s observed), and a flat dark
 * rectangle for that long reads as a broken TV. The wrapper carries
 * `school-poster--loading` until the img's onLoad fires (or errors).
 */
export default function PosterImg({ src, alt, className = 'school-tile__poster' }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <span className={`school-poster-frame${loaded ? '' : ' school-poster--loading'}`}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={className}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        style={loaded ? undefined : { opacity: 0 }}
      />
    </span>
  );
}
