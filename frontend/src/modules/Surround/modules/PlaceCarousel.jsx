// frontend/src/modules/Surround/modules/PlaceCarousel.jsx
//
// THE PLACE, at the foot of the rail. The composer card above is the person; this
// is where they were. It owns every piece of place imagery in the frame — the
// city photograph and the map — and shows them one at a time.
//
// Why a carousel rather than both at once. The rail is one column wide. A city
// photograph and a regional map stacked in it are each half the size they need
// to be: the photograph stops being a view and the map's neighbour labels fall
// through the 0.72rem ten-foot floor. Shown in turn, each gets the whole width
// and its own dwell — the same trade a printed programme makes when it gives a
// plate a full page instead of two thumbnails.
//
// The slides are derived from the composer payload as it already stands; there
// is no new schema here:
//
//   1. CITY PHOTO  `composer.city_image`, captioned by `composer.map.caption`,
//      falling back to `composer.map.city`. Matted, never cropped.
//   2. COUNTRY MAP `CountryMap` at regional zoom on `composer.map` — the country
//      in continental context, no star, no city name — captioned by the country
//      alone. The payload -> props decision is `mapPinFrom`, shared with the
//      standalone `country-map` module rather than copied.
//   3. CITY MAP    the SAME `CountryMap` at `zoom="city"` — the country's own
//      shape nearly filling the frame, with the star and the city's name on it,
//      captioned by the city alone. Two questions, asked in order: where is
//      that country, and then where in it. Only when a city is pinned.
//   4. ERA TIMELINE `EraTimeline` on `piece.period ?? composer.period` — the
//      engraved centuries with this work's era lit and a brass marker at its
//      year. LAST, because it is the only slide that is not a place: the
//      carousel asks where, then where in it, and only then when.
//
// A composer with neither renders NOTHING — not an empty frame, not a mat with a
// hole in it. That is the module contract's null discipline, the same one
// `CountryMapModule` keeps.
//
// The transition between slides is the house dissolve (`../dissolve.js`): fade
// out to the rail's own dark ground, hold it empty for a beat, fade in. The same
// language and the same constants as the composer fact rotating above it and the
// cue line in the band below — one transition in the whole frame.
//
// The clock props arrive because the module contract is fixed, and are ignored.
// The rail is IDENTITY: it cycles at 0:00 and at 53:00, paused or playing. The
// dwell is this module's own interval, cleaned up on unmount.

import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import CountryMap from '../map/CountryMap.jsx';
import EraTimeline from '../map/EraTimeline.jsx';
import { mapPinFrom } from './countryMapPayload.js';
import { prefersReducedMotion, useDissolve } from '../dissolve.js';
import { PLACE_FADE_MS } from './placeCarouselTiming.js';
import { countryCaptionFor, cityCaptionFor, eraCaptionFor } from '../placeCaption.js';
import { smartQuotes, trimmed } from '../typography.js';
import { surroundLogger, assetUrl } from '../moduleKit.js';
import './PlaceCarousel.scss';

/**
 * How long one slide holds the foot of the rail.
 *
 * 12 s: long enough to look at a photograph properly, short enough that a viewer
 * who glances up twice in a segment sees more than one slide. Deliberately NOT
 * coprime with the fact rotations the way those are with each other — the
 * pattern a viewer could notice here is "the picture changed", not "everything
 * changed at once", and 12 against 27 and 20 already never lands three swaps in
 * one instant.
 */
export const PLACE_SLIDE_MS = 12000;

export default function PlaceCarousel({
  // The clock arrives because the module contract is fixed. This module ignores
  // it: the rail is identity, and identity does not have a playhead.
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
  logger = null,
}) {
  const log = useMemo(() => surroundLogger(logger, 'place-carousel'), [logger]);
  const contentId = data?.contentId ?? null;
  const composer = data?.composer ?? null;

  const slides = useMemo(() => {
    const built = [];
    const map = composer?.map ?? null;
    const city = trimmed(map?.city);

    const photoSrc = assetUrl(data?.assetBase, composer?.city_image);
    // Does the PHOTOGRAPH take the authored `map.caption`? It is the better
    // plate for a sentence about the place, so where a photograph exists it
    // keeps it and the city map falls back to the bare name — one line under
    // two plates twelve seconds apart reads as a bug, not as emphasis. Seven of
    // the library's 354 composers have a `city_image`, so this is the rare path
    // and the city map is the one that normally carries the sentence.
    const photoTookCaption = Boolean(photoSrc) && Boolean(trimmed(map?.caption));

    if (photoSrc) {
      // Two registers for one slot. An authored caption is a human sentence —
      // "Venice — his lifelong home" — and is set as prose; a bare city name is a
      // label and keeps the tracked small caps. A sentence in tracked uppercase
      // reads as shouting; a one-word place name in sentence case reads as an
      // unfinished caption.
      const authored = trimmed(map?.caption);
      built.push({
        key: 'photo',
        kind: 'photo',
        src: photoSrc,
        ref: composer.city_image,
        alt: city ? `View of ${city}` : 'The composer\'s city',
        caption: authored ?? city,
        captionKind: authored ? 'sentence' : 'label',
      });
    }

    const pin = mapPinFrom(data);
    if (pin) {
      // COUNTRY-SCOPED, because the slide is. At regional zoom the map draws no
      // star and no city name (`ZOOM_PRESETS.region.showCity`), so a caption
      // naming the city would be answering the NEXT slide's question over this
      // one's picture.
      //
      // WAVE 11: and it is no longer the country's NAME. The plate letters
      // FRANCE across the lit shape; a caption reading FRANCE under it is the
      // one line of the slide a viewer reads first, spent saying nothing. What
      // the plate cannot draw is why THIS country is the lit one — Chopin is
      // Polish — so that is what `countryCaptionFor` derives, from the
      // nationality and birthplace every composer file carries. The bare label
      // survives inside it as the floor.
      const countryCaption = countryCaptionFor(composer);
      built.push({
        key: 'map',
        kind: 'map',
        pin,
        zoom: 'region',
        caption: countryCaption?.text ?? pin.country,
        captionKind: countryCaption?.kind ?? 'label',
      });
      // The zoomed map: having shown WHERE the country is, show where in it.
      // Same component, same payload, one `zoom` prop — the geography stays in
      // `map/` rather than sprouting a second map component. It only exists
      // when there is a city to zoom TO: a "city map" with no city would be the
      // country slide again at a different scale, which is not a slide.
      if (pin.city) {
        // The city leads on its own slide — that is what this one is about, and
        // wave 11 is where it stopped merely being NAMED on it. The star on the
        // plate is already lettered PARIS; the authored `map.caption` is a human
        // sentence about the place, present on 349 of 354 composers, and until
        // now it could only appear under a city photograph that exists for
        // seven of them. This is the plate that shows it.
        const cityCaption = cityCaptionFor(composer, { photoTookCaption });
        built.push({
          key: 'city-map',
          kind: 'city-map',
          pin,
          zoom: 'city',
          caption: cityCaption?.text ?? pin.city,
          captionKind: cityCaption?.kind ?? 'label',
        });
      }
    }

    // 4. WHEN — the era timeline (design wave 6). Last, because it is the only
    //    slide that is not a place: the carousel asks where the composer was,
    //    then where in that country, and only then when. The piece's own period
    //    overrides the composer's for the same reason it does on the card —
    //    Beethoven is Classical, the Eroica is Classical to Romantic.
    const period = trimmed(data?.piece?.period) ?? trimmed(composer?.period);
    if (period) {
      const year = Number(data?.piece?.year);
      const eraCaption = eraCaptionFor(data?.piece, composer);
      built.push({
        key: 'era',
        kind: 'era',
        period,
        year: Number.isFinite(year) ? year : null,
        note: trimmed(data?.piece?.period_note) ?? trimmed(composer?.period_note),
        // THE CAPTION IS THE DATE, NOT THE ERA — the one thing the plate does
        // not already say. The lit band, the brass marker and the note all
        // name the era three times over, and the composer card six inches up
        // the same rail names it a fourth (design wave 6, section 2): a caption
        // repeating it was measured on screen and read as a duplication bug.
        // What the plate cannot show is the precise dating the marker points
        // at — "1803-1804" against a marker standing at 1804 — so that is what
        // the caption carried, falling back to the era only where a piece
        // authors no date at all.
        //
        // WAVE 11 GOES ONE FURTHER, because the dating alone was still the dial
        // restated: the brass numeral IS the year. `eraCaptionFor` locates the
        // work in the composer's LIFE instead — "Composed 1829–1839, aged 19 to
        // 29" — which is the one axis a dial of four centuries cannot draw, and
        // it leads with WHERE the piece was written when that is somewhere the
        // two map slides did not just show (the Preludes, in Majorca).
        //
        // The period NOTE is not the caption either: it lives inside the plate,
        // where there is room for its three or four lines. The caption slot is
        // a two-line reserve shared with every other slide, and its fixed size
        // is what makes the swap a dissolve rather than a resize.
        caption: eraCaption?.text
          ?? (Number.isFinite(year) ? String(year) : null)
          ?? period,
        captionKind: eraCaption?.kind ?? 'label',
      });
    }

    return built;
  }, [composer, data]);

  const [index, setIndex] = useState(0);
  // Read once per render, not subscribed. Deliberate, consistent with wave 2's
  // fact rotations: a mid-session OS preference flip is vanishingly rare, and a
  // `matchMedia` listener here would be one more subscription for a slide index
  // that already resets to 0 on every genuine content change (below).
  const reduced = prefersReducedMotion();

  // Fix round 1 (review finding): a new composer can open MID-carousel — most
  // often from the map slide itself, when a tap on it takes the surround to a
  // different piece. Without this, the incoming composer opened on whatever
  // slide the outgoing one happened to be dwelling on (e.g. straight to its
  // map, never its photograph). Content identity always reopens at slide 0.
  useEffect(() => {
    setIndex(0);
  }, [contentId]);

  // One slide is not a carousel, and reduced motion asks for the first slide to
  // stand still — in both cases nothing is armed at all.
  useEffect(() => {
    if (slides.length < 2 || reduced) return undefined;
    const id = setInterval(() => setIndex((i) => i + 1), PLACE_SLIDE_MS);
    return () => clearInterval(id);
  }, [slides.length, reduced]);

  const next = useMemo(() => {
    if (!slides.length) return null;
    const i = ((index % slides.length) + slides.length) % slides.length;
    return slides[i];
  }, [slides, index]);

  // The house dissolve, and the SAME controller the band and the composer card
  // run (`../dissolve.js`). Its default identity is the slide's `key`, which is
  // what catches the slide SET changing under us (a new item, a different
  // composer) and not only the index. Its default "is there anything on screen"
  // is "the slide is not null", which is this module's answer too: a slide is
  // either a picture or it does not exist.
  const [shown, hidden] = useDissolve(next);

  useEffect(() => {
    if (!shown) return;
    log.debug('surround.place-slide.shown', { contentId, kind: shown.kind, of: slides.length });
  }, [shown, slides.length, contentId, log]);

  const onPhotoError = (event) => {
    const el = event?.currentTarget;
    if (el) el.style.display = 'none';
    log.warn('surround.asset.missing', {
      contentId,
      ref: shown?.ref ?? null,
      src: el?.getAttribute?.('src') ?? null,
      assetBase: data?.assetBase ?? null,
    });
  };

  // Nothing authored: no element at all. A mat with nothing in it is worse than
  // an absence — it is an absence the viewer has to look at.
  if (!slides.length || !shown) return null;

  return (
    <div
      className="surround-place-carousel"
      data-testid="surround-place-carousel"
      data-slide={shown.kind}
      data-slides={slides.length}
    >
      <figure
        className={`surround-place-carousel__slide${hidden ? ' surround-place-carousel__slide--hidden' : ''}`}
        data-testid="surround-place-slide"
        style={{ transition: `opacity ${PLACE_FADE_MS}ms ease` }}
      >
        <div className={`surround-place-carousel__mat surround-place-carousel__mat--${shown.kind}`}>
          {shown.kind === 'photo' ? (
            <img
              className="surround-place-carousel__photo"
              data-testid="surround-place-photo"
              src={shown.src}
              alt={shown.alt}
              onError={onPhotoError}
            />
          ) : shown.kind === 'era' ? (
            <EraTimeline
              className="surround-place-carousel__era"
              period={shown.period}
              year={shown.year}
              note={shown.note}
              logger={logger}
            />
          ) : (
            <CountryMap
              className="surround-place-carousel__map"
              country={shown.pin.country}
              city={shown.pin.city}
              lat={shown.pin.lat}
              lon={shown.pin.lon}
              zoom={shown.zoom}
              logger={logger}
            />
          )}
        </div>
        {shown.caption && (
          <figcaption
            className={`surround-place-carousel__caption surround-place-carousel__caption--${shown.captionKind}`}
            data-testid="surround-place-caption"
          >
            {/* Curled at the seam, like every other authored string the frame
                prints — a city caption may be authored ("Bonn, then the
                Elector's seat"). See `../typography.js`. */}
            {smartQuotes(shown.caption)}
          </figcaption>
        )}
      </figure>
    </div>
  );
}

PlaceCarousel.propTypes = {
  position: PropTypes.number,
  duration: PropTypes.number,
  playing: PropTypes.bool,
  seeking: PropTypes.bool,
  data: PropTypes.object,
  region: PropTypes.object,
  logger: PropTypes.object,
};
