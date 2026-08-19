// frontend/src/modules/Surround/modules/WorkPlacard.jsx
//
// The work's nameplate, above the stage: ArtMode's recessive dark-stone plate
// (see ArtMode.css `.artmode__music-plaque`) recut as a full-width band for the
// `top` region, carrying the piece — title, opus, composed, premiered. The
// clock props arrive because the module contract is fixed; this plate ignores
// them — it names the work, it does not track it, so it renders the same thing
// at 0:00 and at 53:00.
//
// The composer is NOT named here. That is a settled decision, not an oversight:
// the person lives on brass in the rail (ComposerCard); this plate is stone, and
// stone carries only the work. `data.composer` may be present in the payload but
// this module never reads it.
//
// An empty plate is worse than no plate: without a piece title there is nothing
// worth engraving, so the module renders null and the `top` region collapses.

import React from 'react';
import PropTypes from 'prop-types';
import './WorkPlacard.scss';

export default function WorkPlacard({
  // The clock arrives because the module contract is fixed. This plate ignores it.
  // eslint-disable-next-line no-unused-vars
  position = 0,
  // eslint-disable-next-line no-unused-vars
  duration = 0,
  // eslint-disable-next-line no-unused-vars
  playing = false,
  // eslint-disable-next-line no-unused-vars
  seeking = false,
  data = null,
  // eslint-disable-next-line no-unused-vars
  region = null,
  // eslint-disable-next-line no-unused-vars
  logger = null,
}) {
  const piece = data?.piece ?? null;
  if (!piece?.title) return null;

  const meta = [piece.opus, piece.composed, piece.premiered].filter(Boolean).join('   ·   ');

  return (
    <div className="surround-work-placard" data-testid="surround-work-placard">
      <h2 className="surround-work-placard__title">{piece.title}</h2>
      {meta ? <p className="surround-work-placard__meta">{meta}</p> : null}
    </div>
  );
}

WorkPlacard.propTypes = {
  position: PropTypes.number,
  duration: PropTypes.number,
  playing: PropTypes.bool,
  seeking: PropTypes.bool,
  data: PropTypes.object,
  region: PropTypes.object,
  logger: PropTypes.object,
};
