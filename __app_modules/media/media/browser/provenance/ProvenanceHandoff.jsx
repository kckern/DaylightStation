/**
 * ProvenanceHandoff — the scene before a title that streams elsewhere: the
 * service's logo on a dark field, two lines reaching in from either side with
 * dots pulsing in the gap; when the film starts the lines meet, the field
 * clears, and the logo shrinks into the top-right corner and fades.
 *
 * No words: the logo and the joining lines say it. Phases come from
 * useSceneTimeline (driven by the Player's intro stage). Reference: __docs/reference/media/provenance.md
 */
import React from 'react';
import PropTypes from 'prop-types';
import './ProvenanceHandoff.scss';

/** Brand accent for the lines and dots. Unlisted providers use white. */
export const PROVIDER_ACCENTS = Object.freeze({
  netflix: '#e50914',
  'prime-video': '#1399ff',
  hulu: '#1ce783',
  'disney-plus': '#1f80e0',
  'hbo-max': '#5a2ff5',
  'paramount-plus': '#0064ff',
  tubi: '#ffff13',
  'pluto-tv': '#fff200',
  peacock: '#ffffff',
  'apple-tv': '#ffffff',
});

export function ProvenanceHandoff({ phase, provenance, linkMs = null }) {
  if (!provenance?.logoUrl) return null;
  const accent = PROVIDER_ACCENTS[provenance.provider] || '#ffffff';
  return (
    <div
      className={`provenance-handoff provenance-handoff--${phase}`}
      style={{ '--ph-accent': accent, ...(linkMs ? { '--ph-link-ms': `${linkMs}ms` } : {}) }}
      data-provider={provenance.provider}
      aria-hidden="true"
    >
      <div className="provenance-handoff__field" />
      <div className="provenance-handoff__link">
        <span className="provenance-handoff__line provenance-handoff__line--left" />
        <span className="provenance-handoff__dots"><i /><i /><i /></span>
        <span className="provenance-handoff__line provenance-handoff__line--right" />
        <span className="provenance-handoff__spark" />
      </div>
      <div className={`provenance-handoff__badge${provenance.plate ? ' provenance-handoff__badge--plate' : ''}`}>
        <img className="provenance-handoff__logo" src={provenance.logoUrl} alt="" draggable={false} />
      </div>
    </div>
  );
}

ProvenanceHandoff.propTypes = {
  phase: PropTypes.oneOf(['linking', 'linked', 'docked', 'leaving']).isRequired,
  provenance: PropTypes.shape({ provider: PropTypes.string, logoUrl: PropTypes.string, plate: PropTypes.bool }),
  /** How long the video is held (5-10 s, random per play): the lines take that long to reach in. */
  linkMs: PropTypes.number,
};
