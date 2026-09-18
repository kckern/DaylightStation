// frontend/src/modules/Surround/modules/PlayCard.jsx
//
// The rail's identity panel for a STAGE WORK — what ComposerCard is to a
// composer, this is to the PLAY: title, genre, setting, and one rotating
// pool mixing work-level facts with hierarchy-scoped character cards
// (`../segments.js#characterPool`).
//
// UNLIKE ComposerCard, THIS CARD IS CLOCK-AWARE. A composer's bio is true at
// 0:00 and at 53:00, so ComposerCard ignores position/duration entirely. A
// play's character roster is not: which characters are in scope, and how
// their description reads, both change with the Act that is playing — so
// this card reads position/contentId and resolves the current segment the
// same way CueTicker does, gated the same way CueTicker gates its own LEFT
// zone: only when the rail actually carries hierarchy (`ancestors`), so a
// FLAT work (no groups) keeps a static pool exactly like ComposerCard's,
// rather than scoping to a movement that was never meant to narrow it.
//
// No new rendering machinery: `characterPool()`'s cards are formatted into
// plain strings and merged into the same rotating pool `factPool()` already
// feeds, reusing the identical dissolve/timing chassis ComposerCard uses.

import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { smartQuotes, smartQuotesAll, trimmed } from '../typography.js';
import { surroundLogger } from '../moduleKit.js';
import { useDissolve } from '../dissolve.js';
import { segmentAt, factPool, characterPool } from '../segments.js';
import { PLAY_FACT_INTERVAL_MS, PLAY_FACT_FADE_MS } from './playCardTiming.js';
import './PlayCard.scss';

const NO_FACT = Object.freeze({ key: 'empty', text: '' });
const FACT_DISSOLVE = Object.freeze({ hasContent: (v) => Boolean(v?.text) });

/** "Petruchio, a gentleman of Verona — A fortune-hunter." */
function formatCharacter(c) {
  const head = c.role ? `${c.name}, ${c.role}` : c.name;
  return c.description ? `${head} — ${c.description}` : head;
}

export default function PlayCard({
  position = 0,
  // eslint-disable-next-line no-unused-vars
  duration = 0,
  // eslint-disable-next-line no-unused-vars
  playing = false,
  // eslint-disable-next-line no-unused-vars
  seeking = false,
  data = null,
  region = null,
  logger = null,
}) {
  const log = useMemo(() => surroundLogger(logger, 'play-card'), [logger]);
  const contentId = data?.contentId ?? null;
  const piece = data?.piece ?? null;
  /**
   * DOES THIS CARD CARRY ITS ROTATING FACT?
   *
   * Declared by the definition on the region, exactly as `orientation` is. The
   * card's fact and the listening band's LEFT register draw from the same
   * work-level pool, so a frame mounting both prints the same material twice —
   * and in a rail that must also hold a timeline and both registers, that
   * duplication is what puts the column over its height: measured, the card is
   * 220px with its fact and about 130px without.
   *
   * The card is TOLD. It does not inspect what else is mounted to work out
   * whether a ticker is showing facts elsewhere — a module that changes shape
   * because of its siblings is the coupling this frame has spent its whole
   * design avoiding, and I made exactly that mistake once in this rail already.
   */
  const showFacts = region?.facts !== false;

  /**
   * DOES THIS CARD CARRY ITS IDENTITY BLOCK? The mirror of `facts`, and for the
   * same reason: in a rail under a placard that already sets the work's title,
   * the header prints it a second time. The definition decides; the card is told.
   */
  const showIdentity = region?.identity !== false;

  // Same gate CueTicker's LEFT zone uses: scope by the sounding segment only
  // when the rail actually carries hierarchy (a group-authored work), so a
  // flat work's pool stays static rather than narrowing to a movement.
  const rail = useMemo(() => (Array.isArray(data?.segments) ? data.segments : []), [data]);
  const scoped = useMemo(() => rail.some((segment) => (
    Array.isArray(segment?.facts) || Array.isArray(segment?.ancestors) || Array.isArray(segment?.characters)
  )), [rail]);
  const railIndex = useMemo(
    () => (scoped ? segmentAt({ segments: rail, contentId, position }).index : -1),
    [scoped, rail, contentId, position],
  );

  const pool = useMemo(() => {
    const facts = smartQuotesAll(factPool(data, railIndex));
    const characters = characterPool(data, railIndex).map((c) => smartQuotes(formatCharacter(c)));
    return [...facts, ...characters];
  }, [data, railIndex]);

  const [factIndex, setFactIndex] = useState(0);
  useEffect(() => { setFactIndex(0); }, [railIndex, contentId]);
  useEffect(() => {
    if (pool.length < 2) return undefined;
    const id = setInterval(() => setFactIndex((i) => i + 1), PLAY_FACT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pool.length]);

  const nextFact = useMemo(() => {
    if (!pool.length) return NO_FACT;
    const i = ((factIndex % pool.length) + pool.length) % pool.length;
    return { key: `fact:${i}:${pool[i]}`, text: pool[i] };
  }, [pool, factIndex]);

  const [shownFact, factHidden] = useDissolve(nextFact, FACT_DISSOLVE);

  useEffect(() => {
    if (!shownFact.text) return;
    log.debug('surround.play-fact.shown', { contentId });
  }, [shownFact, contentId, log]);

  const title = smartQuotes(trimmed(piece?.title));
  const genre = smartQuotes(trimmed(piece?.genre));
  const setting = smartQuotes(trimmed(piece?.setting));
  const hasIdentity = Boolean(title || genre || setting);

  // NULL DISCIPLINE, same law every sibling module keeps: nothing worth
  // showing renders nothing, not an empty panel the viewer has to look at.
  if (!(showIdentity && hasIdentity) && !(showFacts && shownFact.text)) return null;

  return (
    <div className="surround-play-card" data-testid="surround-play-card">
      {showIdentity && hasIdentity && (
        <div className="surround-play-card__header" data-testid="surround-play-header">
          {title && <h2 className="surround-play-card__title">{title}</h2>}
          {genre && <p className="surround-play-card__genre">{genre}</p>}
          {setting && <p className="surround-play-card__setting">{setting}</p>}
        </div>
      )}
      {showFacts && shownFact.text && (
        <div className="surround-play-card__fact-zone" data-testid="surround-play-fact-zone">
          <hr className="surround-play-card__fact-rule" />
          <p
            className={`surround-play-card__fact${factHidden ? ' surround-play-card__fact--hidden' : ''}`}
            data-testid="surround-play-fact"
            style={{ transition: `opacity ${PLAY_FACT_FADE_MS}ms ease` }}
          >
            <span className="surround-play-card__fact-line">{shownFact.text}</span>
          </p>
        </div>
      )}
    </div>
  );
}

PlayCard.propTypes = {
  position: PropTypes.number,
  duration: PropTypes.number,
  playing: PropTypes.bool,
  seeking: PropTypes.bool,
  data: PropTypes.object,
  region: PropTypes.object,
  logger: PropTypes.object,
};

export { PLAY_FACT_INTERVAL_MS };
