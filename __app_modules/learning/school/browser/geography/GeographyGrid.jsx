import { useSchoolApi } from '../runtime/useSchoolApi.js';
import { SchoolButton } from '../portal/SchoolButton.jsx';
/** Topic grid for the geography section. Tiles come from GET /geography/decks;
 *  available tiles launch a drill via onLaunch (which enforces identity —
 *  never open a session directly here). Unavailable tiles are greyed. */
import { useSchoolResource } from '../runtime/useSchoolResource.js';
import { useSchoolSurface } from '../portal/SchoolSurface.jsx';

import Icon from "../home/icons/Icon.jsx";

const iconFor = (deckId) => {
  if (deckId.includes('flag')) return 'flags';
  if (deckId.includes('capital')) return 'capitals';
  if (deckId.includes('country')) return 'countries';
  if (deckId.includes('state')) return 'states';
  return 'geography';
};

export default function GeographyGrid({ onLaunch }) {
  const schoolApi = useSchoolApi();
  const { surfaceId, deviceId, resourceStore } = useSchoolSurface();
  const resource = useSchoolResource({
    key: [surfaceId, deviceId, 'geography', 'decks'], store: resourceStore,
    load: async () => {
      const result = await schoolApi.geoDecks();
      return result?.ok && !Array.isArray(result.data?.decks)
        ? { ...result, ok: false, error: { kind: 'invalid-data' } } : result;
    },
    isEmpty: data => !data.decks.length,
  });
  const decks = resource.data?.decks ?? [];
  if (resource.state === 'loading') return <div className="school-geo-grid" data-testid="geo-grid-loading">Loading…</div>;
  if (resource.error) return <div className="school-geo-grid"><p role="alert">Couldn’t load geography decks.</p><SchoolButton onClick={resource.retry}>Try again</SchoolButton></div>;

  return (
    <div className="school-geo-grid">
      {decks.map((d) => (d.available ? (
        <SchoolButton variant="plain" key={d.deckId} type="button" className="school-geo-tile"
          onClick={() => onLaunch({ id: d.bankId, title: d.title, audience: 'generic' }, 'drill')}>
          <Icon name={iconFor(d.deckId)} className="school-geo-tile__icon" />
          <span className="school-geo-tile__label">{d.title}</span>
        </SchoolButton>
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
