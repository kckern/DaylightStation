import { useState } from 'react';

/**
 * One course/poster tile. The cover loads lazily and starts blurred
 * (`is-loading`); on load it un-blurs and fades in, so covers appear
 * progressively instead of all-at-once. Covers are cached by the display
 * redirect (see display.mjs Cache-Control), so revisits are instant.
 */
export default function CourseTile({ item, onSelect }) {
  const [loaded, setLoaded] = useState(false);
  const src = item.thumbnail || item.image;
  return (
    <li>
      <button type="button" className="piano-video-grid__tile" onClick={() => onSelect(item)} title={item.title}>
        {src && (
          <img
            src={src}
            alt={item.title}
            loading="lazy"
            decoding="async"
            className={`piano-cover${loaded ? '' : ' is-loading'}`}
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
          />
        )}
      </button>
    </li>
  );
}
