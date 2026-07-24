/** Topic grid for the geography section. Tiles come from GET /geography/decks;
 *  available tiles launch a drill via onLaunch (which enforces identity —
 *  never open a session directly here). Unavailable tiles are greyed. */
import { useEffect, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import Icon from '../home/icons/Icon.jsx';

const iconFor = (deckId) => {
  if (deckId.includes('flag')) return 'flags';
  if (deckId.includes('capital')) return 'capitals';
  if (deckId.includes('country')) return 'countries';
  if (deckId.includes('state')) return 'states';
  return 'geography';
};

export default function GeographyGrid({ onLaunch }) {
  const [decks, setDecks] = useState(null);
  useEffect(() => {
    let alive = true;
    schoolApi.geoDecks().then(({ ok, data }) => {
      if (alive) setDecks(ok && Array.isArray(data?.decks) ? data.decks : []);
    });
    return () => { alive = false; };
  }, []);

  if (decks === null) return <div className="school-geo-grid" data-testid="geo-grid-loading">Loading…</div>;
  return (
    <div className="school-geo-grid">
      {decks.map((d) => (d.available ? (
        <button key={d.deckId} type="button" className="school-geo-tile"
          onClick={() => onLaunch({ id: d.bankId, title: d.title, audience: 'generic' }, 'drill')}>
          <Icon name={iconFor(d.deckId)} className="school-geo-tile__icon" />
          <span className="school-geo-tile__label">{d.title}</span>
        </button>
      ) : (
        <div key={d.deckId} className="school-geo-tile school-geo-tile--soon" aria-disabled="true">
          <Icon name={iconFor(d.deckId)} className="school-geo-tile__icon" />
          <span className="school-geo-tile__label">{d.title}</span>
          <span className="school-geo-tile__soon">Coming soon</span>
        </div>
      )))}
    </div>
  );
}
