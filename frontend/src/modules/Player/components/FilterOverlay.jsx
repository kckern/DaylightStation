import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

/**
 * FilterOverlay — renders the OVERLAY-kind content-filter effects on top of the
 * video: regional blur / censor-bar / pixelate, full-frame blur, and plot/warning
 * title cards. Driven by useContentFilter's `activeOverlays` + `activeCard`.
 *
 * Overlays fade in and out over FADE_MS instead of hard-cutting: the blur family
 * ramps its blur RADIUS 0↔full, solids/cards ramp opacity. The hook keeps an exited
 * overlay mounted with `visible:false` for the fade window so the ramp-to-0 plays
 * before unmount; here we ramp from 0 on mount (a rAF flips `mounted`) so the first
 * paint is blur(0) and the CSS transition has something to animate from.
 *
 * Rects are normalized (0..1) against the video content box; here they map to
 * percentages of this overlay layer, which is absolutely positioned to fill the
 * video element. (Letterbox-precise mapping — insetting to the real content rect
 * when object-fit letterboxes — is a follow-up; percentage-of-frame is correct
 * for the common fill case.)
 */

const FADE_MS = 300;
// Full blur radius (px) per blur-family effect; fades between 0 and this.
const BLUR_RADIUS = { blur: 22, 'full-blur': 40, pixelate: 14 };

/** Absolute position style for a cue: from its rect, or full-cover when absent. */
function boxStyle(rect) {
  if (!rect) return { position: 'absolute', inset: 0 };
  return {
    position: 'absolute',
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  };
}

/**
 * `shown` is false on the very first paint (so blur starts at 0 and the transition
 * animates in), then tracks `visible` — which the hook sets false to fade back out.
 */
function useFadeShown(visible) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return mounted && visible;
}

const FADE_TRANSITION =
  `backdrop-filter ${FADE_MS}ms ease, -webkit-backdrop-filter ${FADE_MS}ms ease, `
  + `background-color ${FADE_MS}ms ease, opacity ${FADE_MS}ms ease`;

function OverlayEffect({ effect, cue, theme, visible = true }) {
  const shown = useFadeShown(visible);
  const base = { pointerEvents: 'none', transition: FADE_TRANSITION, ...boxStyle(cue.rect) };
  const blur = (extra = '') => {
    const value = `blur(${shown ? (BLUR_RADIUS[effect] || 0) : 0}px)${extra}`;
    return { backdropFilter: value, WebkitBackdropFilter: value };
  };
  switch (effect) {
    case 'censor-bar':
      return <div data-filter-effect="censor-bar" style={{ ...base, opacity: shown ? 1 : 0, backgroundColor: theme.barColor || '#000' }} />;
    case 'pixelate':
      return <div data-filter-effect="pixelate" style={{ ...base, ...blur(' contrast(0.9)') }} />;
    case 'blur':
      return <div data-filter-effect="blur" style={{ ...base, ...blur() }} />;
    case 'full-blur':
      return <div data-filter-effect="full-blur" style={{ ...base, ...blur(), backgroundColor: shown ? (theme.fullBg || 'rgba(0,0,0,0.35)') : 'rgba(0,0,0,0)' }} />;
    case 'title-card':
      return <Card text={cue.text} theme={theme} effect="title-card" visible={visible} />;
    default:
      return null;
  }
}

function Card({ text, theme, effect = 'card', visible = true }) {
  const shown = useFadeShown(visible);
  if (!text) return null;
  return (
    <div
      className="filter-card"
      data-filter-effect={effect}
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        maxWidth: '70%',
        padding: '1.2em 1.6em',
        borderRadius: '0.4em',
        textAlign: 'center',
        fontFamily: theme.font || 'Roboto Condensed, sans-serif',
        fontSize: '1.4em',
        lineHeight: 1.3,
        color: theme.cardColor || '#fff',
        background: theme.cardBg || 'rgba(0,0,0,0.8)',
        pointerEvents: 'none',
        opacity: shown ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease`,
      }}
    >
      {text}
    </div>
  );
}

export function FilterOverlay({ activeOverlays = [], activeCard = null, theme = {} }) {
  if (!activeOverlays.length && !activeCard) return null;
  return (
    <div className="filter-overlay" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
      {activeOverlays.map(({ effect, cue, visible }) => (
        <OverlayEffect key={`${effect}:${cue.id}`} effect={effect} cue={cue} theme={theme} visible={visible !== false} />
      ))}
      {activeCard && <Card text={activeCard.text} theme={theme} />}
    </div>
  );
}

const rectShape = PropTypes.shape({
  x: PropTypes.number, y: PropTypes.number, w: PropTypes.number, h: PropTypes.number,
});

OverlayEffect.propTypes = {
  effect: PropTypes.string.isRequired,
  cue: PropTypes.shape({ id: PropTypes.string, rect: rectShape, text: PropTypes.string }).isRequired,
  theme: PropTypes.object.isRequired,
  visible: PropTypes.bool,
};

Card.propTypes = { text: PropTypes.string, theme: PropTypes.object.isRequired, effect: PropTypes.string, visible: PropTypes.bool };

FilterOverlay.propTypes = {
  activeOverlays: PropTypes.arrayOf(PropTypes.shape({ effect: PropTypes.string, cue: PropTypes.object, visible: PropTypes.bool })),
  activeCard: PropTypes.shape({ text: PropTypes.string }),
  theme: PropTypes.object,
};
