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
// PLACEMENT CONSTRAINT: the SVG is fluid, but `CountryMap` sizes its city label
// in the view units implied by RENDER_W x RENDER_H (~420 x 260). Painted much
// narrower than the rail it was drawn for, that label falls through the design's
// 0.72rem ten-foot floor. Give this module roughly rail width or more.

import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import CountryMap from '../map/CountryMap.jsx';

/** A coordinate is only a coordinate if it is a finite number. */
function coord(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
  const map = data?.composer?.map ?? null;
  const country = typeof map?.country === 'string' && map.country.trim() ? map.country : null;

  const pin = useMemo(() => ({
    city: typeof map?.city === 'string' && map.city.trim() ? map.city : null,
    lat: coord(map?.lat),
    lon: coord(map?.lon),
  }), [map]);

  // Nothing authored: an empty slot, per the surround quality floor.
  if (!country) return null;

  return (
    <CountryMap
      country={country}
      city={pin.city}
      lat={pin.lat}
      lon={pin.lon}
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
