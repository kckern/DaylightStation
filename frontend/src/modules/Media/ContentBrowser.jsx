// frontend/src/modules/Media/ContentBrowser.jsx
import React, { useState, useMemo, useCallback } from 'react';
import { useStreamingSearch } from '../../hooks/useStreamingSearch.js';
import { useContentBrowse } from '../../hooks/media/useContentBrowse.js';
import { useMediaApp } from '../../contexts/MediaAppContext.jsx';
import { ContentDisplayUrl } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';

const FILTERS = [
  { label: 'All', params: '' },
  { label: 'Music', params: 'source=plex&mediaType=audio' },
  { label: 'Video', params: 'source=plex&mediaType=video' },
  { label: 'Hymns', params: 'source=singalong' },
  { label: 'Audiobooks', params: 'source=readable' },
];

const ContentBrowser = ({ open, onClose }) => {
  const { queue } = useMediaApp();
  const logger = useMemo(() => getLogger().child({ component: 'ContentBrowser' }), []);
  const [activeFilter, setActiveFilter] = useState(0);
  const [searchText, setSearchText] = useState('');

  const filterParams = FILTERS[activeFilter].params;
  const { results, pending, isSearching, search } = useStreamingSearch(
    '/api/v1/content/query/search/stream',
    filterParams
  );
  const { breadcrumbs, browseResults, browsing, loading: browseLoading, browse, goBack, exitBrowse } = useContentBrowse();

  const handleSearch = useCallback((e) => {
    const val = e.target.value;
    setSearchText(val);
    exitBrowse();
    search(val);
  }, [search, exitBrowse]);

  const handlePlayNow = useCallback((item) => {
    logger.info('content-browser.play-now', { contentId: item.contentId, title: item.title });
    queue.addItems([{ contentId: item.contentId, title: item.title, format: item.format }], 'next')
      .then(() => {
        queue.setPosition(queue.position + 1);
      });
  }, [queue, logger]);

  const handleAddToQueue = useCallback((item) => {
    logger.info('content-browser.add-to-queue', { contentId: item.contentId, title: item.title });
    queue.addItems([{ contentId: item.contentId, title: item.title, format: item.format }]);
  }, [queue, logger]);

  const handlePlayNext = useCallback((item) => {
    logger.info('content-browser.play-next', { contentId: item.contentId, title: item.title });
    queue.addItems([{ contentId: item.contentId, title: item.title, format: item.format }], 'next');
  }, [queue, logger]);

  const handleDrillDown = useCallback((item) => {
    if (item.contentId) {
      const [source, ...rest] = item.contentId.split(':');
      logger.debug('content-browser.drill-down', { source, localId: rest.join(':'), title: item.title });
      browse(source, rest.join(':'), item.title);
    }
  }, [browse, logger]);

  const displayResults = browsing ? browseResults : results;

  if (!open) return null;

  return (
    <div className="content-browser">
      <div className="content-browser-header">
        <input
          type="text"
          className="content-browser-search"
          placeholder="Search..."
          value={searchText}
          onChange={handleSearch}
        />
        <button className="content-browser-close" onClick={onClose}>&#x2715;</button>
      </div>

      <div className="content-browser-filters">
        {FILTERS.map((f, i) => (
          <button
            key={f.label}
            className={`filter-chip ${i === activeFilter ? 'active' : ''}`}
            onClick={() => { setActiveFilter(i); search(searchText); }}
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

      <div className="content-browser-results">
        {(isSearching || browseLoading) && <div className="search-loading">Searching...</div>}
        {pending.length > 0 && (
          <div className="search-pending">Loading from: {pending.join(', ')}</div>
        )}
        {displayResults.map((item, i) => (
          <div key={item.contentId || i} className="search-result-item">
            <div className="search-result-thumb">
              {item.contentId && <img src={ContentDisplayUrl(item.contentId)} alt="" />}
            </div>
            <div className="search-result-info" onClick={() => item.isContainer ? handleDrillDown(item) : handlePlayNow(item)}>
              <div className="search-result-title">{item.title}</div>
              <div className="search-result-meta">
                {item.source && <span className="source-badge">{item.source}</span>}
                {item.duration && <span>{Math.round(item.duration / 60)}m</span>}
              </div>
            </div>
            <div className="search-result-actions">
              <button onClick={() => handlePlayNow(item)} title="Play Now">&#9654;</button>
              <button onClick={() => handlePlayNext(item)} title="Play Next">&#10549;</button>
              <button onClick={() => handleAddToQueue(item)} title="Add to Queue">+</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ContentBrowser;
