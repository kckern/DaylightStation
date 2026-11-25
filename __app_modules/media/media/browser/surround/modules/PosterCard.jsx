// The rail's identity panel for a concert that has its own poster: the key
// art, the title and year, who is on stage, and one rotating fact. It reads
// nothing from the clock except the fact interval, because a concert's
// identity is the same at 0:00 and at 80:00.
import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { smartQuotes, trimmed } from "../../../../../../__capabilities/playback/browser/surround-typography.mjs";
import { surroundLogger } from "../../../../../../__capabilities/playback/browser/surround-module-kit.mjs";
import "./PosterCard.scss";

export const POSTER_FACT_INTERVAL_MS = 20000;

export default function PosterCard({ data = null, logger = null }) {
  const log = useMemo(() => surroundLogger(logger, 'poster-card'), [logger]);
  const contentId = data?.contentId ?? null;
  const facts = useMemo(
    () => (Array.isArray(data?.facts) ? data.facts.filter((t) => typeof t === 'string' && t.trim()) : []),
    [data],
  );
  const [factIndex, setFactIndex] = useState(0);
  const [brokenFor, setBrokenFor] = useState(null);

  useEffect(() => {
    setFactIndex(0);
    if (facts.length < 2) return undefined;
    const id = setInterval(() => setFactIndex((i) => (i + 1) % facts.length), POSTER_FACT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [facts]);

  if (!data) return null;
  const piece = data.piece ?? {};
  const title = smartQuotes(trimmed(piece.title));
  const performance = smartQuotes(trimmed(piece.performance));
  const src = contentId && brokenFor !== contentId ? `/api/v1/display/${contentId}` : null;
  const fact = facts.length ? smartQuotes(facts[factIndex % facts.length]) : null;

  return (
    <section className="poster-card">
      {src && (
        <img
          className="poster-card__poster"
          src={src}
          alt=""
          onError={() => { log.warn?.('surround.poster.missing', { contentId }); setBrokenFor(contentId); }}
        />
      )}
      {title && <h2 className="poster-card__title">{title}</h2>}
      {piece.year && <div className="poster-card__year">{String(piece.year)}</div>}
      {performance && <div className="poster-card__performance">{performance}</div>}
      {fact && <p key={factIndex} className="poster-card__fact">{fact}</p>}
    </section>
  );
}

PosterCard.propTypes = {
  data: PropTypes.object,
  logger: PropTypes.object,
};
