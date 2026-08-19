// frontend/src/modules/Surround/modules/ComposerCard.jsx
//
// The identity half of the printed programme, in the full-height right rail: who
// wrote this and what it is. The rail carries identity, not progress, so this
// module takes the clock props from the module contract and ignores them — it
// renders the same thing at 0:00 and at 53:00.
//
// One plate frame with a brass hairline around the portrait — ArtMode's physical
// realism borrowed at a whisper, not its screwed-down gallery plaque. Labels are
// letterspaced small caps of the display face, the way a concert programme sets
// section headers; there is no third typeface.
//
// Beneath the piece data the card cycles COMPOSER-level facts — the ones the
// sidecar inherits from `_composer.yml`, about the person rather than the piece.
// They are quiet supporting text on their own timer: the card stays
// position-independent, and the beat deliberately does not line up with the
// footer ticker's (see COMPOSER_FACT_INTERVAL_MS).
//
// Every asset degrades to an empty slot: a missing portrait hides itself and the
// card stays composed. The warning is capped so a broken path cannot flood the
// log store once per render.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { DaylightMediaPath } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';
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
/** Old line out / new line in — the house 280 ms, as ArtPlacards and the ticker. */
export const COMPOSER_FACT_FADE_MS = 280;

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

function prefersReducedMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  } catch (_) {
    return false;
  }
}

/** `beethoven/portrait.jpg` + `library/classical` -> /api/v1/static/img/... */
function assetUrl(assetBase, ref) {
  if (!assetBase || !ref) return null;
  const base = String(assetBase).replace(/^\/|\/$/g, '');
  const path = String(ref).replace(/^\//, '');
  return DaylightMediaPath(`media/img/${base}/${path}`);
}

/** "1770 – 1827", or "b. 1770" while only one year is known. */
function lifeSpan(composer) {
  const born = composer?.born;
  const died = composer?.died;
  if (born && died) return `${born} – ${died}`;
  if (born) return `b. ${born}`;
  if (died) return `d. ${died}`;
  return null;
}

function Datum({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="surround-composer-card__datum">
      <dt className="surround-composer-card__label">{label}</dt>
      <dd className="surround-composer-card__value">{value}</dd>
    </div>
  );
}

Datum.propTypes = { label: PropTypes.string, value: PropTypes.node };

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
  const piece = data?.piece ?? null;

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
    setFactHidden(true);
    fadeTimers.current.push(setTimeout(() => {
      setShownFact(nextFact);
      setFactHidden(false);
    }, COMPOSER_FACT_FADE_MS));
  }, [nextFact, shownFact]);

  useEffect(() => () => clearFadeTimers(), []);

  useEffect(() => {
    if (!shownFact.text) return;
    log.debug('surround.composer-fact.shown', { contentId, index: shownFact.index });
  }, [shownFact, contentId, log]);

  const dates = lifeSpan(composer);

  return (
    <div className="surround-composer-card" data-testid="surround-composer-card">
      {portraitSrc && (
        <div className="surround-composer-card__plate">
          <img
            className="surround-composer-card__portrait"
            data-testid="surround-portrait"
            src={portraitSrc}
            alt={composer?.name ? `Portrait of ${composer.name}` : 'Composer portrait'}
            onError={(e) => onAssetError(e, portraitRef)}
          />
        </div>
      )}

      {composer?.name && (
        <h2 className="surround-composer-card__name">{composer.name}</h2>
      )}
      {dates && <p className="surround-composer-card__dates">{dates}</p>}
      {composer?.birthplace && (
        <p className="surround-composer-card__birthplace">{composer.birthplace}</p>
      )}

      <hr className="surround-composer-card__rule" />

      {piece?.title && (
        <h3 className="surround-composer-card__piece-title">{piece.title}</h3>
      )}

      <dl className="surround-composer-card__data">
        <Datum label="Opus" value={piece?.opus} />
        <Datum label="Composed" value={piece?.composed} />
        <Datum label="City" value={piece?.city} />
        <Datum label="Premiered" value={piece?.premiered} />
      </dl>

      {shownFact.text && (
        <>
          <hr className="surround-composer-card__fact-rule" />
          <p
            className={`surround-composer-card__fact${factHidden ? ' surround-composer-card__fact--hidden' : ''}`}
            data-testid="surround-composer-fact"
            style={{ transition: `opacity ${COMPOSER_FACT_FADE_MS}ms ease` }}
          >
            {shownFact.text}
          </p>
        </>
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
