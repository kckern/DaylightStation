import { useState, useEffect } from 'react';
import { SourcePanel } from './SourcePanel.jsx';
import { DaylightAPI } from '../../../lib/api.mjs';
import './Headlines.scss';

export default function Headlines() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [harvesting, setHarvesting] = useState(false);

  const fetchHeadlines = async () => {
    try {
      const result = await DaylightAPI('/api/v1/feed/headlines');
      setData(result);
    } catch (err) {
      console.error('Failed to fetch headlines:', err);
    } finally {
      setLoading(false);
    }
  };

  const triggerHarvest = async () => {
    setHarvesting(true);
    try {
      await DaylightAPI('/api/v1/feed/headlines/harvest', {}, 'POST');
      await fetchHeadlines();
    } catch (err) {
      console.error('Harvest failed:', err);
    } finally {
      setHarvesting(false);
    }
  };

  useEffect(() => { fetchHeadlines(); }, []);

  if (loading) return <div className="feed-placeholder">Loading headlines...</div>;

  const sources = data?.sources || {};
  const sourceKeys = Object.keys(sources);

  return (
    <div className="headlines-view">
      <div className="headlines-toolbar">
        <span className="headlines-meta">
          {sourceKeys.length} sources
          {data?.lastHarvest && ` \u00b7 Last updated ${new Date(data.lastHarvest).toLocaleTimeString()}`}
        </span>
        <button
          className="headlines-harvest-btn"
          onClick={triggerHarvest}
          disabled={harvesting}
        >
          {harvesting ? 'Harvesting...' : 'Refresh'}
        </button>
      </div>
      <div className="headlines-grid">
        {sourceKeys.map(key => (
          <SourcePanel
            key={key}
            source={key}
            label={sources[key].label}
            items={sources[key].items || []}
          />
        ))}
        {sourceKeys.length === 0 && (
          <div className="feed-placeholder">
            No headline sources configured. Run a harvest first.
          </div>
        )}
      </div>
    </div>
  );
}
