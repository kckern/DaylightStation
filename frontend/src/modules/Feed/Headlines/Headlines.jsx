import { useState, useEffect } from 'react';
import { SourcePanel } from './SourcePanel.jsx';
import { DaylightAPI } from '../../../lib/api.mjs';
import './Headlines.scss';

export default function Headlines({ pageId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchHeadlines = async () => {
    try {
      const qs = pageId ? `?page=${pageId}` : '';
      const result = await DaylightAPI(`/api/v1/feed/headlines${qs}`);
      setData(result);
    } catch (err) {
      console.error('Failed to fetch headlines:', err);
    } finally {
      setLoading(false);
    }
  };

  const triggerHarvestAll = async () => {
    setLoading(true);
    try {
      const qs = pageId ? `?page=${pageId}` : '';
      await DaylightAPI(`/api/v1/feed/headlines/harvest${qs}`, {}, 'POST');
      await fetchHeadlines();
    } catch (err) {
      console.error('Harvest failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setData(null);
    fetchHeadlines();
  }, [pageId]);

  if (loading) return <div className="feed-placeholder">Loading headlines...</div>;

  const grid = data?.grid;
  const colColors = data?.col_colors || null;
  const sources = data?.sources || {};
  const paywallProxy = data?.paywallProxy || null;
  const rows = grid?.rows || [];
  const cols = grid?.cols || [];

  // Build 2D array from sources
  const cells = [];
  for (let r = 0; r < rows.length; r++) {
    const row = [];
    for (let c = 0; c < cols.length; c++) {
      const entry = Object.entries(sources).find(
        ([, s]) => s.row === r && s.col === c
      );
      row.push(entry ? { id: entry[0], ...entry[1] } : null);
    }
    cells.push(row);
  }

  return (
    <div className="headlines-view">
      <div className="headlines-toolbar">
        <span className="headlines-meta">
          {Object.keys(sources).length} sources
          {data?.lastHarvest && ` · ${formatTime(data.lastHarvest)}`}
        </span>
        <button
          className="headlines-harvest-btn"
          onClick={triggerHarvestAll}
          disabled={loading}
        >
          Refresh All
        </button>
      </div>

      <div className="headlines-matrix">
        {cells.map((row, r) => (
          <div key={r} className="matrix-row">
            {row.map((cell, c) => (
              <SourcePanel
                key={cell?.id || `empty-${r}-${c}`}
                source={cell}
                col={c}
                totalCols={cols.length}
                paywallProxy={paywallProxy}
                onRefresh={fetchHeadlines}
                colColors={colColors}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now - d) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return d.toLocaleDateString();
}
