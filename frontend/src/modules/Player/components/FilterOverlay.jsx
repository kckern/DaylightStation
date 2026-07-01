import React from 'react';
import PropTypes from 'prop-types';

/**
 * FilterOverlay — renders the OVERLAY-kind content-filter effects on top of the
 * video: regional blur / censor-bar / pixelate, full-frame blur, and plot/warning
 * title cards. Driven by useContentFilter's `activeOverlays` + `activeCard`.
 *
 * Rects are normalized (0..1) against the video content box; here they map to
 * percentages of this overlay layer, which is absolutely positioned to fill the
 * video element. (Letterbox-precise mapping — insetting to the real content rect
 * when object-fit letterboxes — is a follow-up; percentage-of-frame is correct
 * for the common fill case.)
 */

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

function OverlayEffect({ effect, cue, theme }) {
  const base = { pointerEvents: 'none', ...boxStyle(cue.rect) };
  switch (effect) {
    case 'censor-bar':
      return <div data-filter-effect="censor-bar" style={{ ...base, backgroundColor: theme.barColor || '#000' }} />;
    case 'pixelate':
      return <div data-filter-effect="pixelate" style={{ ...base, backdropFilter: 'blur(14px) contrast(0.9)', WebkitBackdropFilter: 'blur(14px)' }} />;
    case 'blur':
      return <div data-filter-effect="blur" style={{ ...base, backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)' }} />;
    case 'full-blur':
      return <div data-filter-effect="full-blur" style={{ ...base, backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)', backgroundColor: theme.fullBg || 'rgba(0,0,0,0.35)' }} />;
    case 'title-card':
      return <Card text={cue.text} theme={theme} effect="title-card" />;
    default:
      return null;
  }
}

function Card({ text, theme, effect = 'card' }) {
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
      {activeOverlays.map(({ effect, cue }) => (
        <OverlayEffect key={`${effect}:${cue.id}`} effect={effect} cue={cue} theme={theme} />
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
};

Card.propTypes = { text: PropTypes.string, theme: PropTypes.object.isRequired, effect: PropTypes.string };

FilterOverlay.propTypes = {
  activeOverlays: PropTypes.arrayOf(PropTypes.shape({ effect: PropTypes.string, cue: PropTypes.object })),
  activeCard: PropTypes.shape({ text: PropTypes.string }),
  theme: PropTypes.object,
};
