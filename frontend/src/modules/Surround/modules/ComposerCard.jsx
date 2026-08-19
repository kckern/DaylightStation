// frontend/src/modules/Surround/modules/ComposerCard.jsx
//
// The identity half of the printed programme, in the full-height rail. The piece
// — title, opus, composed/premiered dates — lives entirely in the top placard;
// this card is wholly the PERSON. The rail carries identity, not progress, so
// this module takes the clock props from the module contract and ignores them —
// it renders the same thing at 0:00 and at 53:00.
//
// ANATOMY (wave 3). Two zones, and only two:
//
//   HEADER ROW  portrait in its parchment mat on the LEFT at ~45% of the rail's
//               width; the brass nameplate carrying the name AND the dates
//               (museum convention: a plate reads name, then dates, engraved
//               together), with the birthplace stacked under it in parchment,
//               in the column to its RIGHT. Side by side — a mounted print with
//               its plate beside it, which is how the picture and the name read
//               as ONE object rather than as two stacked panels.
//   FACT        the dissolving bio fact, centred in whatever card height the
//               header leaves (`margin: auto 0`) rather than parked at the foot.
//
// The city photo LEFT this card in wave 3: place imagery — the city and the map
// — belongs to the `place-carousel` module in the rail region below. A card that
// carried the person AND the place had no room to give either of them a size.
//
// The card cycles COMPOSER-level facts — the ones the sidecar inherits from
// `_composer.yml`, about the person rather than the piece. They are quiet
// supporting text on their own timer: the card stays position-independent, and
// the beat deliberately does not line up with the footer ticker's (see
// COMPOSER_FACT_INTERVAL_MS). The dissolve itself is the house one, imported
// from `../dissolve.js` — one transition for the whole frame.
//
// Every asset degrades to an empty slot: a missing portrait hides itself and the
// card stays composed. The warning is capped so a broken path cannot flood the
// log store once per render.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { DaylightMediaPath } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';
import {
  DISSOLVE_FADE_MS, DISSOLVE_HOLD_MS, DISSOLVE_COMMIT_MS, prefersReducedMotion,
} from '../dissolve.js';
import './ComposerCard.scss';

/** At most this many surround.asset.missing warnings per card per minute. */
export const ASSET_WARN_PER_MINUTE = 5;
const ASSET_WARN_WINDOW_MS = 60000;

/**
 * How long one composer fact holds the rail.
 *
 * 27 s, against the footer ticker's 20 s, and coprime with it: the two panels
 * only ever swap in the same instant once every 9 minutes instead of every third
 * swap. A shared or harmonic beat makes the whole surround look like it blinked.
 */
export const COMPOSER_FACT_INTERVAL_MS = 27000;
/** Each half of the dissolve — the house duration, shared with the ticker. */
export const COMPOSER_FACT_FADE_MS = DISSOLVE_FADE_MS;
/** The beat of empty ground between the two halves ("through black"). */
export const COMPOSER_FACT_HOLD_MS = DISSOLVE_HOLD_MS;

const NO_FACT = Object.freeze({ key: 'empty', index: null, text: '' });

let moduleLogger = null;
function fallbackLogger() {
  if (!moduleLogger) moduleLogger = getLogger().child({ app: 'surround', component: 'composer-card' });
  return moduleLogger;
}
function resolveLogger(logger) {
  if (!logger) return fallbackLogger();
  return logger.child?.({ app: 'surround', component: 'composer-card' }) ?? logger;
}

/** `beethoven/portrait.jpg` + `surround/classical` -> /api/v1/static/img/... */
function assetUrl(assetBase, ref) {
  if (!assetBase || !ref) return null;
  const base = String(assetBase).replace(/^\/|\/$/g, '');
  const path = String(ref).replace(/^\//, '');
  return DaylightMediaPath(`media/img/${base}/${path}`);
}

const trimmed = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** "1770 – 1827", or "b. 1770" while only one year is known. */
function lifeSpan(composer) {
  const born = composer?.born;
  const died = composer?.died;
  if (born && died) return `${born} – ${died}`;
  if (born) return `b. ${born}`;
  if (died) return `d. ${died}`;
  return null;
}

export default function ComposerCard({
  // The clock arrives because the module contract is fixed. This card ignores it.
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
  const log = useMemo(() => resolveLogger(logger), [logger]);
  const contentId = data?.contentId ?? null;
  const composer = data?.composer ?? null;

  const portraitRef = composer?.portrait ?? null;
  const portraitSrc = useMemo(
    () => assetUrl(data?.assetBase, portraitRef), [data, portraitRef],
  );

  // Per-card budget. `logger.sampled` would cap the rate but downgrade the event
  // to info; the spec calls for a warn, so the window is kept here instead.
  const budget = useRef({ windowStart: 0, count: 0, skipped: 0 });

  const onAssetError = useCallback((event, ref) => {
    const el = event?.currentTarget;
    if (el) el.style.display = 'none';

    const now = Date.now();
    const state = budget.current;
    if (now - state.windowStart >= ASSET_WARN_WINDOW_MS) {
      if (state.skipped > 0) {
        log.warn('surround.asset.missing.aggregated', {
          contentId, skippedCount: state.skipped, window: '60s',
        });
      }
      state.windowStart = now;
      state.count = 0;
      state.skipped = 0;
    }
    if (state.count >= ASSET_WARN_PER_MINUTE) {
      state.skipped += 1;
      return;
    }
    state.count += 1;
    log.warn('surround.asset.missing', {
      contentId, ref, src: el?.getAttribute?.('src') ?? null, assetBase: data?.assetBase ?? null,
    });
  }, [log, contentId, data]);

  // ---- composer facts -------------------------------------------------------
  // Inherited from `_composer.yml`, so the pool is the same whatever is playing.
  const facts = useMemo(
    () => (Array.isArray(composer?.facts) ? composer.facts : [])
      .filter((f) => typeof f === 'string' && f.trim()),
    [composer],
  );

  const [factIndex, setFactIndex] = useState(0);

  // One fact is not a rotation, and no fact arms nothing at all.
  useEffect(() => {
    if (facts.length < 2) return undefined;
    const id = setInterval(() => setFactIndex((i) => i + 1), COMPOSER_FACT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [facts.length]);

  const nextFact = useMemo(() => {
    if (!facts.length) return NO_FACT;
    const i = ((factIndex % facts.length) + facts.length) % facts.length;
    return { key: `fact:${i}`, index: i, text: facts[i] };
  }, [facts, factIndex]);

  const [shownFact, setShownFact] = useState(() => nextFact);
  const [factHidden, setFactHidden] = useState(false);
  const fadeTimers = useRef([]);
  const clearFadeTimers = () => { fadeTimers.current.forEach(clearTimeout); fadeTimers.current = []; };

  useEffect(() => {
    if (nextFact.key === shownFact.key) return;
    clearFadeTimers();
    // Nothing on screen to fade out of — swap straight in.
    if (!shownFact.text || prefersReducedMotion()) {
      setShownFact(nextFact);
      setFactHidden(false);
      return;
    }
    // The same dissolve the ticker plays: out to the dark rail ground, a beat of
    // empty ground, then in. The rail's reserved fact height (see the SCSS) is
    // what keeps the card still while the ground is empty.
    setFactHidden(true);
    fadeTimers.current.push(setTimeout(() => {
      setShownFact(nextFact);
      setFactHidden(false);
    }, DISSOLVE_COMMIT_MS));
  }, [nextFact, shownFact]);

  useEffect(() => () => clearFadeTimers(), []);

  useEffect(() => {
    if (!shownFact.text) return;
    log.debug('surround.composer-fact.shown', { contentId, index: shownFact.index });
  }, [shownFact, contentId, log]);

  const dates = lifeSpan(composer);
  // THE PERIOD (design wave 6). The PIECE's period wins where it is authored,
  // because a composer's era and a work's era are not always the same claim:
  // Beethoven is `Classical`, the Eroica is `Classical to Romantic`, and on a
  // rail sitting beside that symphony the work's answer is the true one. The
  // composer's is the fallback, which is what every piece without its own
  // period (Vivaldi's Spring) actually uses.
  const period = trimmed(data?.piece?.period) ?? trimmed(composer?.period);
  const hasIdentity = Boolean(composer?.name || dates || composer?.birthplace || period);
  // The header row is a row only when it has two things to put side by side.
  // With one of them missing the survivor takes the whole width rather than
  // sitting in a column beside an empty one.
  const hasHeader = hasIdentity || Boolean(portraitSrc);

  return (
    <div className="surround-composer-card" data-testid="surround-composer-card">
      {hasHeader && (
        <div className="surround-composer-card__header" data-testid="surround-composer-header">
          {portraitSrc && (
            // Fix round 1 (review finding): the 45% share and "the mat hugs its
            // picture" are two different jobs and now live on two different
            // elements. The COLUMN below owns the 45% flex share of the row; the
            // MAT inside it is `width: fit-content`, so a tall (2:3) portrait
            // gets a snug mat sized to the picture rather than stretching to
            // fill a 45%-wide slab — the "pool of paper" wave 2 removed.
            <div className="surround-composer-card__portrait-col" data-testid="surround-portrait-col">
              <div className="surround-composer-card__plate" data-testid="surround-portrait-plate">
                <img
                  className="surround-composer-card__portrait"
                  data-testid="surround-portrait"
                  src={portraitSrc}
                  alt={composer?.name ? `Portrait of ${composer.name}` : 'Composer portrait'}
                  onError={(e) => onAssetError(e, portraitRef)}
                />
              </div>
            </div>
          )}

          {hasIdentity && (
            <div className="surround-composer-card__identity" data-testid="surround-composer-identity">
              {(composer?.name || dates) && (
                // Museum convention (settled 2026-08-19): the brass reads name,
                // then dates, engraved together — the dates are NOT rail voice.
                <div className="surround-composer-card__nameplate">
                  {composer?.name && <h2 className="surround-composer-card__name">{composer.name}</h2>}
                  {dates && <p className="surround-composer-card__dates">{dates}</p>}
                </div>
              )}
              {composer?.birthplace && (
                <p className="surround-composer-card__birthplace">{composer.birthplace}</p>
              )}
              {/* THE PERIOD (design wave 6). Rail voice, under the plate with
                  the birthplace — NOT engraved on the brass. The plate is
                  name + dates and that is settled (museum convention); an era
                  is an editor's classification, not something a museum casts
                  in metal. Place first, then time: the birthplace is a fact
                  about the person, the era is a fact about their music. */}
              {period && (
                <p
                  className="surround-composer-card__period"
                  data-testid="surround-composer-period"
                >
                  {period}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {shownFact.text && (
        <div className="surround-composer-card__fact-zone" data-testid="surround-composer-fact-zone">
          <hr className="surround-composer-card__fact-rule" />
          <p
            className={`surround-composer-card__fact${factHidden ? ' surround-composer-card__fact--hidden' : ''}`}
            data-testid="surround-composer-fact"
            style={{ transition: `opacity ${COMPOSER_FACT_FADE_MS}ms ease` }}
          >
            {/* Fix round 1 (review finding): the reserve (grid + align-content)
                and the ellipsis (the line clamp) are two jobs, and Chromium
                will not let one element do both — see CueTicker.jsx for the
                same split and the reasoning. This span clamps to three lines;
                the `<p>` around it centres whatever height that produces. */}
            <span className="surround-composer-card__fact-line">{shownFact.text}</span>
          </p>
        </div>
      )}
    </div>
  );
}

ComposerCard.propTypes = {
  position: PropTypes.number,
  duration: PropTypes.number,
  playing: PropTypes.bool,
  seeking: PropTypes.bool,
  data: PropTypes.object,
  region: PropTypes.object,
  logger: PropTypes.object,
};
