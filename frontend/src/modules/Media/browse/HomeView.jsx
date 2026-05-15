import React, { useState, useEffect } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { useNav } from '../shell/NavProvider.jsx';
import { ResumeCard } from './ResumeCard.jsx';
import { RecentsRow } from './RecentsRow.jsx';

function cardPath(entry) {
  const segs = [entry.source];
  if (entry.mediaType) segs.push(entry.mediaType);
  return segs.filter(Boolean).join('/');
}
function cardKey(entry) {
  return `${entry.source}-${entry.mediaType ?? 'all'}`;
}

export function HomeView() {
  const [browse, setBrowse] = useState(null);
  const [error, setError] = useState(null);
  const { push } = useNav();

  useEffect(() => {
    let cancelled = false;
    DaylightAPI('api/v1/media/config')
      .then((cfg) => {
        if (cancelled) return;
        setBrowse(Array.isArray(cfg?.browse) ? cfg.browse : []);
      })
      .catch((err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <div data-testid="home-error">{error.message}</div>;
  if (!browse) return <div data-testid="home-loading">Loading…</div>;

  return (
    <div data-testid="home-view" className="home-view">
      <ResumeCard />
      <RecentsRow />
      <section className="home-curated">
        <h2 className="home-curated-title">Browse the catalog</h2>
        <div className="home-cards">
          {browse.map((entry) => (
            <button
              key={cardKey(entry)}
              data-testid={`home-card-${cardKey(entry)}`}
              onClick={() => push('browse', { path: cardPath(entry) })}
              className="home-card"
            >
              {entry.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

export default HomeView;
