import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * iTunes-style 3D Cover Flow. Albums sit on a reflective floor; the centered
 * cover faces front while neighbors angle back in perspective. Drag/wheel/arrow
 * keys scrub the carousel; tap a side cover to center it, tap the center cover
 * (or Open) to select. Reduced-motion users get the same layout without the
 * sweeping transition.
 *
 * @param {Array<{id,title,image?,thumbnail?,isPlaylist?}>} items
 * @param {(item) => void} onOpen
 * @param {number} [startIndex]
 */
export default function CoverFlow({ items, onOpen, startIndex = 0 }) {
  const [center, setCenter] = useState(Math.min(startIndex, Math.max(0, items.length - 1)));
  const stageRef = useRef(null);
  const drag = useRef({ active: false, x: 0, moved: 0 });

  const clamp = useCallback((i) => Math.max(0, Math.min(items.length - 1, i)), [items.length]);
  const go = useCallback((d) => setCenter((c) => clamp(c + d)), [clamp]);

  useEffect(() => { setCenter((c) => clamp(c)); }, [items.length, clamp]);

  // Arrow keys scrub; Enter opens the centered cover.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') { go(-1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { go(1); e.preventDefault(); }
      else if (e.key === 'Enter') { onOpen?.(items[center]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onOpen, items, center]);

  const onWheel = (e) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(d) > 8) go(d > 0 ? 1 : -1);
  };

  // Pointer drag: every ~9rem of travel advances one cover.
  const onPointerDown = (e) => { drag.current = { active: true, x: e.clientX, moved: 0 }; stageRef.current?.setPointerCapture?.(e.pointerId); };
  const onPointerMove = (e) => {
    if (!drag.current.active) return;
    const dx = e.clientX - drag.current.x;
    const step = 90; // px per cover
    if (Math.abs(dx) >= step) {
      go(dx < 0 ? 1 : -1);
      drag.current.x = e.clientX;
      drag.current.moved += 1;
    }
  };
  const onPointerUp = (e) => { stageRef.current?.releasePointerCapture?.(e.pointerId); drag.current.active = false; };

  const onCover = (i) => {
    if (drag.current.moved) return; // a drag, not a tap
    if (i === center) onOpen?.(items[i]);
    else setCenter(i);
  };

  const cur = items[center];

  return (
    <div className="coverflow">
      <div
        className="coverflow__stage"
        ref={stageRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {items.map((item, i) => {
          const offset = i - center;
          const abs = Math.abs(offset);
          if (abs > 5) return null; // cull far covers
          const sign = Math.sign(offset);
          const x = offset === 0 ? 0 : sign * (12 + (abs - 1) * 5.4); // rem (scaled to 20rem covers)
          const z = offset === 0 ? 5 : -abs * 5; // rem depth (center pops forward)
          const rotate = offset === 0 ? 0 : -sign * 58; // deg
          const scale = offset === 0 ? 1 : 0.86;
          const src = item.thumbnail || item.image;
          return (
            <button
              key={item.id}
              type="button"
              className={`coverflow__cover${offset === 0 ? ' is-center' : ''}`}
              style={{
                transform: `translateX(${x}rem) translateZ(${z}rem) rotateY(${rotate}deg) scale(${scale})`,
                zIndex: 100 - abs,
                opacity: abs > 4 ? 0 : 1,
              }}
              onClick={() => onCover(i)}
              aria-label={item.title}
              title={item.title}
            >
              {src && <img className="coverflow__art" src={src} alt={item.title} loading="eager" decoding="async" />}
              {src && <img className="coverflow__reflection" src={src} alt="" aria-hidden="true" />}
              {item.isPlaylist && <span className="coverflow__badge">♫</span>}
            </button>
          );
        })}
      </div>

      <div className="coverflow__caption">{cur?.title}</div>

      <div className="coverflow__nav">
        <button type="button" className="coverflow__navbtn" onClick={() => go(-1)} disabled={center <= 0} aria-label="Previous album">‹</button>
        <button type="button" className="coverflow__open" onClick={() => onOpen?.(cur)}>Open</button>
        <button type="button" className="coverflow__navbtn" onClick={() => go(1)} disabled={center >= items.length - 1} aria-label="Next album">›</button>
      </div>
    </div>
  );
}
