// frontend/src/screen-framework/widgets/MusicPlaque.jsx
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import smartquotes from 'smartquotes';

const smartQuotes = (s) => (s == null ? s : smartquotes.string(String(s)));
const sameTrack = (a, b) =>
  (a?.title ?? null) === (b?.title ?? null) && (a?.artist ?? null) === (b?.artist ?? null);

const PLAQUE_FADE_MS = 280;   // old text out / new text in
const PLAQUE_RESIZE_MS = 420; // plate grows/shrinks to the new text, behind the fade

/**
 * MusicPlaque — the steel nameplate on the top frame rail.
 *
 * In HOLD mode the artwork stays put while songs change, so the plaque must
 * transition on its own: the old text fades out, the plate resizes to fit the new
 * title/artist, then the new text fades back in (choreographed, never a hard cut).
 *
 * In TRACK mode (animate=false) the plaque changes behind the closed curtain along
 * with the artwork, so the swap is instant — no visible transition is needed.
 *
 * Width can't be CSS-transitioned from `auto`, so the resize is a measured FLIP:
 * measure the new content's natural width, pin the old width, then transition to
 * the new one. Skipped where there's no layout (jsdom: offsetWidth 0).
 */
export default function MusicPlaque({
  track, animate = true, fadeMs = PLAQUE_FADE_MS, resizeMs = PLAQUE_RESIZE_MS,
}) {
  const [shown, setShown] = useState(track);   // the track currently rendered
  const [hidden, setHidden] = useState(false); // text faded out (fade-out + resize phases)
  const plateRef = useRef(null);
  const firstRef = useRef(true);
  const timersRef = useRef([]);

  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; };

  // Choreograph a song change. First appearance (no prior track) and track mode
  // both swap instantly; otherwise fade out → swap → fade in.
  useEffect(() => {
    if (sameTrack(track, shown)) return;
    if (!animate || !shown) { clearTimers(); setShown(track); setHidden(false); return; }
    clearTimers();
    setHidden(true);                                                   // 1) fade old text out
    timersRef.current.push(setTimeout(() => {
      setShown(track);                                                 // 2) swap (resize via layout effect)
      timersRef.current.push(setTimeout(() => setHidden(false), resizeMs)); // 3) fade new text in
    }, fadeMs));
  }, [track, shown, animate, fadeMs, resizeMs]);

  useEffect(() => () => clearTimers(), []);

  // Animate the plate width to the new content's natural width (FLIP).
  useLayoutEffect(() => {
    const el = plateRef.current;
    if (!el) return;
    el.style.transition = 'none';
    const prev = el.style.width;
    el.style.width = 'auto';
    const w = el.offsetWidth;
    if (!w) { el.style.width = ''; return; }            // no layout (jsdom) — leave auto
    if (firstRef.current) { firstRef.current = false; el.style.width = `${w}px`; return; }
    el.style.width = prev || `${w}px`;                  // pin the old width
    void el.offsetWidth;                                // reflow so the change animates
    el.style.transition = `width ${resizeMs}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    el.style.width = `${w}px`;                          // → new width
  }, [shown, resizeMs]);

  if (!shown || !(shown.title || shown.artist)) return null;
  return (
    <div className="artmode__placard artmode__music-plaque" data-testid="artmode-music-plaque" ref={plateRef}>
      <div
        className={`artmode__plaque-text${hidden ? ' artmode__plaque-text--hidden' : ''}`}
        style={{ transition: `opacity ${fadeMs}ms ease` }}
      >
        {shown.title && (
          <span className="artmode__placard-title artmode__placard-line">{`♪ ${smartQuotes(shown.title)} ♪`}</span>
        )}
        {shown.artist && (
          <span className="artmode__placard-artist artmode__placard-line">{smartQuotes(shown.artist)}</span>
        )}
      </div>
    </div>
  );
}
