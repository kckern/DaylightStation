import { useState, useRef } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import './Headlines.scss';

// Muted color palette by column position (left→right political spectrum)
const COL_COLORS = [
  'hsl(215, 40%, 45%)',  // left — muted blue
  'hsl(195, 35%, 42%)',  // center-left — teal
  'hsl(260, 20%, 45%)',  // center — muted purple
  'hsl(30, 40%, 45%)',   // center-right — amber
  'hsl(0, 35%, 45%)',    // right — muted red
];

export function SourcePanel({ source, col, totalCols, onRefresh }) {
  const [refreshing, setRefreshing] = useState(false);
  const [faviconError, setFaviconError] = useState(false);
  const imgRef = useRef(null);

  if (!source) return <div className="source-cell source-cell--empty" />;

  const domain = extractDomain(source.url);
  const siteUrl = 'https://' + domain;
  const faviconUrl = `/api/v1/feed/icon?url=${encodeURIComponent(siteUrl)}`;
  const items = source.items || [];
  const headerColor = COL_COLORS[col] || COL_COLORS[Math.floor(totalCols / 2)];

  const handleRefresh = async (e) => {
    e.stopPropagation();
    setRefreshing(true);
    try {
      await DaylightAPI(`/api/v1/feed/headlines/harvest/${source.id}`, {}, 'POST');
      await onRefresh();
    } catch (err) {
      console.error(`Refresh ${source.id} failed:`, err);
    } finally {
      setRefreshing(false);
    }
  };

  const handleFaviconError = () => setFaviconError(true);

  return (
    <div className="source-cell">
      <a className="source-cell-header" href={siteUrl} target="_blank" rel="noopener noreferrer" style={{ backgroundColor: headerColor }}>
        {!faviconError ? (
          <img
            ref={imgRef}
            className="source-favicon"
            src={faviconUrl}
            alt=""
            width={14}
            height={14}
            onError={handleFaviconError}
          />
        ) : (
          <span className="source-favicon-fallback">{source.label.charAt(0)}</span>
        )}
        <span className="source-label">{source.label}</span>
        <span className="source-meta">
          {source.lastHarvest ? formatTime(source.lastHarvest) : ''}
        </span>
        <button
          className="source-refresh-btn"
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh this source"
        >
          {refreshing ? '...' : '↻'}
        </button>
      </a>
      {items.length > 0 && (
        <ul className="source-headlines">
          {items.map((item, i) => (
            <li key={i} className="source-headline" title={[item.title, item.desc].filter(Boolean).join('\n\n')}>
              <a href={item.link} target="_blank" rel="noopener noreferrer">
                {smartQuotes(item.title)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url?.replace(/https?:\/\//, '').split('/')[0] || '';
  }
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now - d) / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return d.toLocaleDateString();
}

function smartQuotes(text) {
  if (!text) return text;
  return text
    .replace(/(\s|^)"(\S)/g, '$1\u201c$2')   // opening double
    .replace(/"/g, '\u201d')                    // closing double
    .replace(/(\s|^)'(\S)/g, '$1\u2018$2')    // opening single
    .replace(/'/g, '\u2019')                    // closing single / apostrophe
    .replace(/\.\.\./g, '\u2026')              // ellipsis
    .replace(/--/g, '\u2014');                  // em dash
}
