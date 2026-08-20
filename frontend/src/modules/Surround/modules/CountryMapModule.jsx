// frontend/src/modules/Surround/modules/CountryMapModule.jsx
//
// The surround-module face of `map/CountryMap.jsx`.
//
// `CountryMap` knows about countries and coordinates and nothing else, which is
// what keeps it reusable outside this feature. The surround payload — a composer
// carrying `map: { country, city, lat, lon }` — is this file's problem, and the
// fixed module contract `{ position, duration, playing, seeking, data, region }`
// is too. Both stop here.
//
// The map is identity, not progress, so the clock props arrive and are ignored.
// A composer with no `map` block renders nothing at all: no element, and no
// geodata request either, so an unmapped composer costs nothing.
//
// STANDING AS A MODULE. `place-carousel` is where the concert-hall definition
// puts the map from wave 3 on — the map is one of the carousel's slides. This
// module stays registered under `country-map` regardless: a definition that
// wants a bare, non-cycling map in a region of its own is a legitimate thing to
// author, and the registration costs one line. The two share the payload mapping
// below rather than each doing their own — `mapPinFrom` is the seam.
//
// PLACEMENT CONSTRAINT: the SVG is fluid, but `CountryMap` sizes its labels in
// the view units implied by RENDER_W x RENDER_H (~420 x 260). Painted much
// narrower than the rail it was drawn for, the neighbour labels fall through the
// design's 0.72rem ten-foot floor. Give this module roughly rail width or more.

import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import CountryMap from '../map/CountryMap.jsx';

/** A coordinate is only a coordinate if it is a finite number. */
function coord(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The surround payload -> `CountryMap` props, or null when there is no map to
 * draw. Exported because `PlaceCarousel` needs exactly this decision — "is there
 * a map here, and what is it of" — and two copies of it would be two places for
 * a payload change to have to land.
 */
export function mapPinFrom(data) {
  const map = data?.composer?.map ?? null;
  const country = typeof map?.country === 'string' && map.country.trim() ? map.country.trim() : null;
  if (!country) return null;
  return {
    country,
    city: typeof map?.city === 'string' && map.city.trim() ? map.city.trim() : null,
    lat: coord(map?.lat),
    lon: coord(map?.lon),
  };
}

export default function CountryMapModule({
  // eslint-disable-next-line no-unused-vars -- part of the fixed module contract
  position = 0,
  // eslint-disable-next-line no-unused-vars -- part of the fixed module contract
  duration = 0,
  // eslint-disable-next-line no-unused-vars -- part of the fixed module contract
  playing = false,
  // eslint-disable-next-line no-unused-vars -- part of the fixed module contract
  seeking = false,
  data = null,
  // eslint-disable-next-line no-unused-vars -- part of the fixed module contract
  region = null,
  logger = null,
}) {
  const pin = useMemo(() => mapPinFrom(data), [data]);

  // Nothing authored: an empty slot, per the surround quality floor.
  if (!pin) return null;

  return (
    <CountryMap
      country={pin.country}
      city={pin.city}
      lat={pin.lat}
      lon={pin.lon}
      /* A bare map in a region of its own is the ONLY map that item gets, so it
         carries the star: "where the composer worked" has to point somewhere.
         The place carousel draws two maps and splits the question in half, so
         its regional slide takes the preset's answer (no marker) instead. */
      showCity
      logger={logger}
    />
  );
}

CountryMapModule.propTypes = {
  position: PropTypes.number,
  duration: PropTypes.number,
  playing: PropTypes.bool,
  seeking: PropTypes.bool,
  data: PropTypes.object,
  region: PropTypes.object,
  logger: PropTypes.object,
};
