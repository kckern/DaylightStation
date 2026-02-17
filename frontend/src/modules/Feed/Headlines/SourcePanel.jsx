import { useState, useRef } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import './Headlines.scss';

// Default neutral color palette (used if no col_colors in config)
const DEFAULT_COL_COLORS = [
  'hsl(220, 15%, 35%)',
  'hsl(220, 15%, 35%)',
  'hsl(220, 15%, 35%)',
  'hsl(220, 15%, 35%)',
  'hsl(220, 15%, 35%)',
];

export function SourcePanel({ source, col, totalCols, paywallProxy, onRefresh, colColors }) {
  const [refreshing, setRefreshing] = useState(false);
  const [faviconError, setFaviconError] = useState(false);
  const imgRef = useRef(null);

  if (!source) return <div className="source-cell source-cell--empty" />;

  const feedUrl = source.url || (source.urls && source.urls[0]) || '';
  const siteUrl = source.siteUrl || ('https://' + extractDomain(feedUrl));
  const faviconUrl = `/api/v1/feed/icon?url=${encodeURIComponent(siteUrl)}`;
  const items = source.items || [];
  const colors = colColors || DEFAULT_COL_COLORS;
  const headerColor = colors[col] || colors[Math.floor(totalCols / 2)];
  const isPaywalled = source.paywall && paywallProxy;

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
          {items.map((item, i) => {
            const link = stripTracking((item.link || '').trim());
            const href = isPaywalled ? paywallProxy + link : link;
            const desc = item.desc && item.desc !== item.title ? item.desc : null;
            return (
              <li key={i} className="source-headline">
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {smartQuotes(item.title)}
                </a>
                <div className="headline-tooltip">
                  <div className="headline-tooltip-header">
                    {!faviconError ? (
                      <img className="headline-tooltip-icon" src={faviconUrl} alt="" width={12} height={12} />
                    ) : (
                      <span className="headline-tooltip-icon-fallback">{source.label.charAt(0)}</span>
                    )}
                    <span className="headline-tooltip-source">{source.label}</span>
                  </div>
                  {item.image && <img className="headline-tooltip-image" src={item.image} alt="" />}
                  <div className="headline-tooltip-title">{smartQuotes(item.title)}</div>
                  {desc && <div className="headline-tooltip-desc">{smartQuotes(desc)}</div>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const TRACKING_PARAMS = /^(utm_\w+|fbclid|gclid|mc_[ce]id|msclkid|ref|source|ncid|ocid|_ga)$/i;

function stripTracking(url) {
  try {
    const u = new URL(url);
    const keysToDelete = [...u.searchParams.keys()].filter(k => TRACKING_PARAMS.test(k));
    keysToDelete.forEach(k => u.searchParams.delete(k));
    return u.toString();
  } catch {
    return url;
  }
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
