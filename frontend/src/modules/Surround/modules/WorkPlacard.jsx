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
import { smartQuotes } from '../typography.js';
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

  // The plate is the frame's largest type, so it is the surface where a straight
  // quote is most obviously unset — both live works have a nickname in quotes
  // ("Eroica", "Spring"). One curl at the render seam, `../typography.js`.
  //
  // THE INTERPUNCT IS AN ELEMENT, NOT WHITESPACE. This line was joined with
  // `'   ·   '` — three spaces either side of the mark — and HTML collapses a
  // whitespace run to a single space unless a `white-space: pre*` rule applies,
  // which none did. The engraved plate's breathing room existed only in the
  // source. A separator span with an `em` margin is the correct mechanism
  // anyway: three space glyphs are whatever this face happens to make them,
  // while an em is a fraction of the type's own size and holds at every screen
  // in the fleet.
  const parts = [piece.opus, piece.composed, piece.premiered].filter(Boolean);

  return (
    <div className="surround-work-placard" data-testid="surround-work-placard">
      <h2 className="surround-work-placard__title">{smartQuotes(piece.title)}</h2>
      {parts.length > 0 ? (
        <p className="surround-work-placard__meta">
          {parts.map((part, i) => (
            // The parts are authored strings from one corpus entry, in a fixed
            // order; the index is their identity as much as their value is.
            // eslint-disable-next-line react/no-array-index-key
            <React.Fragment key={`${i}:${part}`}>
              {i > 0 && (
                <span className="surround-work-placard__sep" aria-hidden="true">·</span>
              )}
              {smartQuotes(String(part))}
            </React.Fragment>
          ))}
        </p>
      ) : null}
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
