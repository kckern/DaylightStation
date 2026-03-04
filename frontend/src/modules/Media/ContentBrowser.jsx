// frontend/src/modules/Media/ContentBrowser.jsx
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useStreamingSearch } from '../../hooks/useStreamingSearch.js';
import { useContentBrowse } from '../../hooks/media/useContentBrowse.js';
import { useMediaApp } from '../../contexts/MediaAppContext.jsx';
import { ContentDisplayUrl } from '../../lib/api.mjs';
import CastButton from './CastButton.jsx';
import getLogger from '../../lib/logging/Logger.js';

export function resolveContentId(item) {
  return item.id || item.contentId;
}

const ContentBrowser = ({ hasMiniplayer }) => {
  const { queue } = useMediaApp();
  const logger = useMemo(() => getLogger().child({ component: 'ContentBrowser' }), []);
  const [activeFilter, setActiveFilter] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [browseConfig, setBrowseConfig] = useState([]);
  const searchTimerRef = useRef(null);

  // Fetch browse categories from backend config
  useEffect(() => {
    logger.info('content-browser.mounted');
    fetch('/api/v1/media/config')
      .then(r => r.json())
      .then(data => {
        const categories = data.browse || [];
        setBrowseConfig(categories);
        logger.info('content-browser.config-loaded', { categoryCount: categories.length, categories: categories.map(c => c.label) });
      })
      .catch(err => logger.warn('content-browser.config-fetch-failed', { error: err.message }));
    return () => logger.info('content-browser.unmounted');
  }, [logger]);

  useEffect(() => {
    return () => clearTimeout(searchTimerRef.current);
  }, []);

  // Build filters from config: "All" + entries with searchFilter: true
  const filters = useMemo(() => {
    const configFilters = browseConfig
      .filter(c => c.searchFilter)
      .map(c => ({
        label: c.label.replace(/^Browse\s+/i, ''),
        params: ['capability=playable', c.source && `source=${c.source}`, c.mediaType && `mediaType=${c.mediaType}`]
          .filter(Boolean).join('&'),
      }));
    return [{ label: 'All', params: 'capability=playable' }, ...configFilters];
  }, [browseConfig]);

  const filterParams = filters[activeFilter]?.params || '';
  const { results, pending, isSearching, search } = useStreamingSearch(
    '/api/v1/content/query/search/stream',
    filterParams
  );
  const { breadcrumbs, browseResults, browsing, loading: browseLoading, browse, goBack, exitBrowse } = useContentBrowse();

  const handleSearch = useCallback((e) => {
    const val = e.target.value;
    setSearchText(val);
    exitBrowse();
    if (val.length > 0) logger.debug('content-browser.search', { query: val });

    clearTimeout(searchTimerRef.current);
    if (!val || val.length < 2) {
      search(val); // immediate clear
      return;
    }
    searchTimerRef.current = setTimeout(() => search(val), 300);
  }, [search, exitBrowse, logger]);

  const handlePlayNow = useCallback((item) => {
    const contentId = resolveContentId(item);
    if (!contentId) { logger.warn('content-browser.play-now.no-content-id', { title: item.title }); return; }
    logger.info('content-browser.play-now', { contentId, title: item.title });
    queue.playNow([{ contentId, title: item.title, format: item.format, thumbnail: item.thumbnail }]);
  }, [queue, logger]);

  const handleAddToQueue = useCallback((item) => {
    const contentId = resolveContentId(item);
    if (!contentId) { logger.warn('content-browser.add-to-queue.no-content-id', { title: item.title }); return; }
    logger.info('content-browser.add-to-queue', { contentId, title: item.title });
    queue.addItems([{ contentId, title: item.title, format: item.format, thumbnail: item.thumbnail }]);
  }, [queue, logger]);

  const handlePlayNext = useCallback((item) => {
    const contentId = resolveContentId(item);
    if (!contentId) { logger.warn('content-browser.play-next.no-content-id', { title: item.title }); return; }
    logger.info('content-browser.play-next', { contentId, title: item.title });
    queue.addItems([{ contentId, title: item.title, format: item.format, thumbnail: item.thumbnail }], 'next');
  }, [queue, logger]);

  const handleDrillDown = useCallback((item) => {
    const contentId = resolveContentId(item);
    if (contentId) {
      const [source, ...rest] = contentId.split(':');
      logger.debug('content-browser.drill-down', { source, localId: rest.join(':'), title: item.title });
      browse(source, rest.join(':'), item.title);
    }
  }, [browse, logger]);

  const handleBrowseCategory = useCallback((cat) => {
    logger.info('content-browser.browse-category', { source: cat.source, label: cat.label });
    browse(cat.source, '', cat.label);
  }, [browse, logger]);

  // Exclude image-only items from search results — MediaApp is for audio/video, not photos.
  // Immich returns photos as PlayableItem (mediaType:'image') which pass capability=playable
  // but aren't meaningful media player content.
  const displayResults = browsing ? browseResults : results.filter(r => r.mediaType !== 'image');

  useEffect(() => {
    if (displayResults.length > 0) {
      const withThumbs = displayResults.filter(r => !!(r.thumbnail || resolveContentId(r))).length;
      const withDirectThumb = displayResults.filter(r => !!r.thumbnail).length;
      const sourceBreakdown = {};
      displayResults.forEach(r => {
        sourceBreakdown[r.source || 'unknown'] = (sourceBreakdown[r.source || 'unknown'] || 0) + 1;
      });
      logger.info('content-browser.results-rendered', {
        count: displayResults.length,
        withThumbnails: withThumbs,
        withDirectThumbnail: withDirectThumb,
        sources: sourceBreakdown,
        source: browsing ? 'browse' : 'search',
      });
    }
  }, [displayResults.length, browsing, logger]);

  useEffect(() => {
    logger.info('content-browser.loading-state', { isSearching, browseLoading });
  }, [isSearching, browseLoading, logger]);

  const isSearchActive = searchText.length > 0 || browsing;

  return (
    <div className={`content-browser ${hasMiniplayer ? 'content-browser--with-miniplayer' : ''}`}>
      <div className="content-browser-header">
        <input
          type="text"
          className="content-browser-search"
          placeholder="Search media..."
          value={searchText}
          onChange={handleSearch}
        />
      </div>

      <div className="content-browser-filters">
        {filters.map((f, i) => (
          <button
            key={f.label}
            className={`filter-chip ${i === activeFilter ? 'active' : ''}`}
            onClick={() => {
              const oldFilter = filters[activeFilter]?.label;
              logger.info('content-browser.filter-changed', {
                from: oldFilter,
                to: f.label,
                params: f.params,
              });
              setActiveFilter(i);
              if (searchText.length >= 2) {
                search(searchText, f.params);
              }
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {browsing && (
        <div className="content-browser-breadcrumbs">
          <button onClick={goBack}>&larr; Back</button>
          {breadcrumbs.map((b, i) => (
            <span key={i} className="breadcrumb">{b.title}</span>
          ))}
        </div>
      )}

      <div className="content-browser-body">
        {isSearchActive && (
          <div className="content-browser-results">
            {(isSearching || browseLoading) && (
              <div className="search-loading">
                <span className="search-loading-spinner" />
                <span>
                  {pending.length > 0
                    ? `Searching ${pending.length} source${pending.length > 1 ? 's' : ''}...`
                    : 'Searching...'}
                </span>
              </div>
            )}
            {displayResults.map((item, i) => {
              const contentId = resolveContentId(item);
              return (
              <div key={contentId || i} className="search-result-item">
                <div className="search-result-thumb">
                  {(item.thumbnail || contentId) && <img src={item.thumbnail || ContentDisplayUrl(contentId)} alt="" />}
                </div>
                <div className="search-result-info" onClick={() => item.isContainer ? handleDrillDown(item) : handlePlayNow(item)}>
                  <div className="search-result-title">{item.title}</div>
                  <div className="search-result-meta">
                    {item.source && <span className="source-badge">{item.source}</span>}
                    {item.duration && <span>{Math.round(item.duration / 60)}m</span>}
                    {item.format && (
                      <span className={`format-badge format-badge--${item.format}`}>{item.format}</span>
                    )}
                  </div>
                </div>
                <div className="search-result-actions">
                  <button onClick={() => handlePlayNow(item)} title="Play Now">&#9654;</button>
                  <button onClick={() => handlePlayNext(item)} title="Play Next">&#10549;</button>
                  <button onClick={() => handleAddToQueue(item)} title="Add to Queue">+</button>
                  <CastButton contentId={contentId} className="search-action-cast" />
                </div>
              </div>
              );
            })}
          </div>
        )}

        {!isSearchActive && (
          <div className="content-browser-home">
            {browseConfig.map((cat, i) => (
              <button
                key={`${cat.source}-${cat.mediaType || i}`}
                className="browse-category-row"
                onClick={() => handleBrowseCategory(cat)}
              >
                <span className="browse-category-label">{cat.label}</span>
                <span className="browse-category-arrow">&rarr;</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ContentBrowser;
