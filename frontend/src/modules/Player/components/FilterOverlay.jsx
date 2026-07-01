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

function OverlayEffect({ effect, cue, theme, art }) {
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
      return <Card text={cue.text} theme={theme} effect="title-card" art={art} />;
    default:
      return null;
  }
}

/** Hide an <img> that fails to load (e.g. a title with no clearLogo). */
const hideOnError = (e) => { e.currentTarget.style.display = 'none'; };

function Card({ text, theme, effect = 'card', art }) {
  if (!text) return null;
  const font = theme.font || 'Roboto Condensed, sans-serif';

  // Cinematic slide: dimmed film backdrop + clearLogo + intertitle text.
  if (art && art.background) {
    return (
      <div
        className="filter-card filter-card-art"
        data-filter-effect={effect}
        style={{
          position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          width: '72%', maxWidth: '900px', aspectRatio: '16 / 7',
          borderRadius: '0.5em', overflow: 'hidden', pointerEvents: 'none',
          backgroundImage: `url(${art.background})`, backgroundSize: 'cover', backgroundPosition: 'center',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          textAlign: 'center', color: '#fff', fontFamily: font, boxShadow: '0 0 40px rgba(0,0,0,0.65)',
        }}
      >
        <div style={{ position: 'absolute', inset: 0, background: theme.cardBg || 'rgba(0,0,0,0.58)' }} />
        {art.logo && (
          <img
            src={art.logo} alt="" onError={hideOnError}
            style={{ position: 'relative', maxWidth: '55%', maxHeight: '34%', objectFit: 'contain', marginBottom: '0.6em', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.75))' }}
          />
        )}
        <div style={{ position: 'relative', fontSize: '1.5em', lineHeight: 1.3, padding: '0 1.4em', maxWidth: '82%', textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>
          {text}
        </div>
      </div>
    );
  }

  // Plain themed fallback (no art available).
  return (
    <div
      className="filter-card"
      data-filter-effect={effect}
      style={{
        position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        maxWidth: '70%', padding: '1.2em 1.6em', borderRadius: '0.4em', textAlign: 'center',
        fontFamily: font, fontSize: '1.4em', lineHeight: 1.3,
        color: theme.cardColor || '#fff', background: theme.cardBg || 'rgba(0,0,0,0.8)', pointerEvents: 'none',
      }}
    >
      {text}
    </div>
  );
}

export function FilterOverlay({ activeOverlays = [], activeCard = null, theme = {}, art = null }) {
  if (!activeOverlays.length && !activeCard) return null;
  return (
    <div className="filter-overlay" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
      {activeOverlays.map(({ effect, cue }) => (
        <OverlayEffect key={`${effect}:${cue.id}`} effect={effect} cue={cue} theme={theme} art={art} />
      ))}
      {activeCard && <Card text={activeCard.text} theme={theme} art={art} />}
    </div>
  );
}

const rectShape = PropTypes.shape({
  x: PropTypes.number, y: PropTypes.number, w: PropTypes.number, h: PropTypes.number,
});
const artShape = PropTypes.shape({ poster: PropTypes.string, background: PropTypes.string, logo: PropTypes.string });

OverlayEffect.propTypes = {
  effect: PropTypes.string.isRequired,
  cue: PropTypes.shape({ id: PropTypes.string, rect: rectShape, text: PropTypes.string }).isRequired,
  theme: PropTypes.object.isRequired,
  art: artShape,
};

Card.propTypes = { text: PropTypes.string, theme: PropTypes.object.isRequired, effect: PropTypes.string, art: artShape };

FilterOverlay.propTypes = {
  activeOverlays: PropTypes.arrayOf(PropTypes.shape({ effect: PropTypes.string, cue: PropTypes.object })),
  activeCard: PropTypes.shape({ text: PropTypes.string }),
  theme: PropTypes.object,
  art: artShape,
};
