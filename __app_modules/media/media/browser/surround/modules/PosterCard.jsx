// The rail's identity panel for a concert that has its own poster: the key
// art as large as the rail allows, one rotating fact, and the ensemble's own
// mark at the foot (`composer.logo`, resolved against the payload's asset
// tree like a composer portrait). Title, year and performers are NOT set here:
// the poster prints them and the placard names them. It reads nothing from the
// clock except the fact interval, because a concert's identity is the same at
// 0:00 and at 80:00.
import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { smartQuotes, trimmed } from "../../../../../../__capabilities/playback/browser/surround-typography.mjs";
import { surroundLogger, assetUrl } from "../../../../../../__capabilities/playback/browser/surround-module-kit.mjs";
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
  const [logoBroken, setLogoBroken] = useState(null);

  useEffect(() => {
    setFactIndex(0);
    if (facts.length < 2) return undefined;
    const id = setInterval(() => setFactIndex((i) => (i + 1) % facts.length), POSTER_FACT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [facts]);

  if (!data) return null;
  const logo = assetUrl(data.assetBase, data.composer?.logo);
  const logoAlt = trimmed(data.composer?.name) || '';
  const src = contentId && brokenFor !== contentId ? `/api/v1/display/${contentId}` : null;
  const fact = facts.length ? smartQuotes(facts[factIndex % facts.length]) : null;

  return (
    <section className="poster-card">
      <div className="poster-card__art">
        {src && (
          <img
            className="poster-card__poster"
            src={src}
            alt=""
            onError={() => { log.warn?.('surround.poster.missing', { contentId }); setBrokenFor(contentId); }}
          />
        )}
      </div>
      {/* A fixed slot: rotating facts of different lengths never move the poster. */}
      <div className="poster-card__fact-slot">
        {fact && <p key={factIndex} className="poster-card__fact">{fact}</p>}
      </div>
      {logo && logoBroken !== logo && (
        <img
          className="poster-card__logo"
          src={logo}
          alt={logoAlt}
          onError={() => { log.warn?.('surround.poster.logo-missing', { contentId, logo }); setLogoBroken(logo); }}
        />
      )}
    </section>
  );
}

PosterCard.propTypes = {
  data: PropTypes.object,
  logger: PropTypes.object,
};
