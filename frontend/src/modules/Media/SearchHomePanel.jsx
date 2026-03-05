// frontend/src/modules/Media/SearchHomePanel.jsx
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStreamingSearch } from '../../hooks/useStreamingSearch.js';
import { useMediaApp } from '../../contexts/MediaAppContext.jsx';
import { ContentDisplayUrl } from '../../lib/api.mjs';
import { useScopePrefs } from '../../hooks/media/useScopePrefs.js';
import ScopeDropdown from './ScopeDropdown.jsx';
import ScopeChips from './ScopeChips.jsx';
import CastButton from './CastButton.jsx';
import { useMediaHistory } from '../../hooks/media/useMediaHistory.js';
import getLogger from '../../lib/logging/Logger.js';
import { toast } from './Toast.jsx';

// --- Recent Searches (localStorage) ---
const RECENT_SEARCHES_KEY = 'media-recent-searches';
const MAX_RECENT_SEARCHES = 10;

function loadRecentSearches() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]');
  } catch { return []; }
}

function saveRecentSearch(query, scope) {
  const existing = loadRecentSearches().filter(s => s.query !== query);
  const updated = [{ query, scope, timestamp: Date.now() }, ...existing].slice(0, MAX_RECENT_SEARCHES);
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
  return updated;
}

export function resolveContentId(item) {
  return item.id || item.contentId;
}

const SearchHomePanel = () => {
  const { queue } = useMediaApp();
  const navigate = useNavigate();
  const logger = useMemo(() => getLogger().child({ component: 'SearchHomePanel' }), []);
  const [searchText, setSearchText] = useState('');
  const [searchScopes, setSearchScopes] = useState([]);
  const [recentSearches, setRecentSearches] = useState(loadRecentSearches);
  const searchTimerRef = useRef(null);
  const playingRef = useRef(false);
  const { continueItems, recentlyPlayed } = useMediaHistory();

  // Scope persistence
  const { lastScopeKey, recents, favorites, recordUsage, toggleFavorite } = useScopePrefs();
  const [activeScopeKey, setActiveScopeKey] = useState(lastScopeKey);

  const activeScopeParams = useMemo(() => {
    for (const scope of searchScopes) {
      if (scope.key === activeScopeKey) return scope.params || '';
      if (scope.children) {
        const child = scope.children.find(c => c.key === activeScopeKey);
        if (child) return child.params || '';
      }
    }
    return 'capability=playable&take=25';
  }, [searchScopes, activeScopeKey]);

  // Fetch search scopes from backend
  useEffect(() => {
    logger.info('search-home.mounted');
    fetch('/api/v1/media/config')
      .then(r => r.json())
      .then(data => {
        setSearchScopes(data.searchScopes || []);
        logger.info('search-home.scopes-loaded', { scopeCount: (data.searchScopes || []).length });
      })
      .catch(err => logger.warn('search-home.config-fetch-failed', { error: err.message }));
    return () => {
      logger.info('search-home.unmounted');
      clearTimeout(searchTimerRef.current);
    };
  }, [logger]);

  const { results, pending, isSearching, search } = useStreamingSearch(
    '/api/v1/content/query/search/stream',
    activeScopeParams
  );

  const handleSearch = useCallback((e) => {
    const val = e.target.value;
    setSearchText(val);
    clearTimeout(searchTimerRef.current);
    if (!val || val.length < 2) {
      search(val);
      return;
    }
    searchTimerRef.current = setTimeout(() => search(val), 300);
  }, [search]);

  const handleScopeSelect = useCallback((scope) => {
    logger.info('search-home.scope-changed', { key: scope.key });
    setActiveScopeKey(scope.key);
    if (searchText.length >= 2) {
      search(searchText, scope.params);
    }
  }, [logger, searchText, search]);

  // Record recent search when user interacts with a result
  const recordSearchInteraction = useCallback(() => {
    if (searchText.length >= 2) {
      const updated = saveRecentSearch(searchText, activeScopeKey);
      setRecentSearches(updated);
      logger.debug('search-home.recent-recorded', { query: searchText });
    }
  }, [searchText, activeScopeKey, logger]);

  const handleResultClick = useCallback((item) => {
    recordSearchInteraction();
    const contentId = resolveContentId(item);
    if (contentId) navigate(`/media/view/${contentId}`);
  }, [recordSearchInteraction, navigate]);

  const handlePlayNow = useCallback((item) => {
    if (playingRef.current) return;
    playingRef.current = true;
    setTimeout(() => { playingRef.current = false; }, 2000);
    recordSearchInteraction();
    const contentId = resolveContentId(item);
    if (!contentId) return;
    logger.info('search-home.play-now', { contentId, title: item.title });
    queue.playNow([{ contentId, title: item.title, format: item.format, thumbnail: item.thumbnail }]);
  }, [recordSearchInteraction, queue, logger]);

  const handlePlayNext = useCallback((item) => {
    recordSearchInteraction();
    const contentId = resolveContentId(item);
    if (!contentId) return;
    logger.info('search-home.play-next', { contentId });
    queue.addItems([{ contentId, title: item.title, format: item.format, thumbnail: item.thumbnail }], 'next');
    toast(`"${item.title}" plays next`);
  }, [recordSearchInteraction, queue, logger]);

  const handleAddToQueue = useCallback((item) => {
    recordSearchInteraction();
    const contentId = resolveContentId(item);
    if (!contentId) return;
    logger.info('search-home.add-to-queue', { contentId });
    queue.addItems([{ contentId, title: item.title, format: item.format, thumbnail: item.thumbnail }]);
    toast(`"${item.title}" added to queue`);
  }, [recordSearchInteraction, queue, logger]);

  const handleRecentSearchClick = useCallback((entry) => {
    setSearchText(entry.query);
    if (entry.scope) setActiveScopeKey(entry.scope);
    search(entry.query);
    logger.debug('search-home.recent-clicked', { query: entry.query });
  }, [search, logger]);

  const handleSourceBadgeClick = useCallback((source) => {
    for (const scope of searchScopes) {
      if (scope.children) {
        const match = scope.children.find(c => {
          const p = new URLSearchParams(c.params);
          return p.get('source') === source;
        });
        if (match) { handleScopeSelect(match); return; }
      }
    }
  }, [searchScopes, handleScopeSelect]);

  const isSearchActive = searchText.length > 0;

  return (
    <div className="search-home-panel">
      <div className="search-home-header">
        <ScopeDropdown
          scopes={searchScopes}
          activeKey={activeScopeKey}
          onSelect={handleScopeSelect}
          recents={recents}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
        />
        <input
          type="text"
          className="search-home-input"
          placeholder="Search media..."
          value={searchText}
          onChange={handleSearch}
        />
      </div>

      <div className="search-home-body">
        {isSearchActive ? (
          <div className="search-home-results">
            <ScopeChips
              results={results}
              scopes={searchScopes}
              activeKey={activeScopeKey}
              onSelect={handleScopeSelect}
            />
            {(isSearching) && (
              <div className="search-loading">
                <span className="search-loading-spinner" />
                <span>{pending.length > 0 ? `Searching ${pending.length} source${pending.length > 1 ? 's' : ''}...` : 'Searching...'}</span>
              </div>
            )}
            {results.map((item, i) => {
              const contentId = resolveContentId(item);
              return (
                <div key={contentId || i} className="search-result-item">
                  <div className="search-result-thumb">
                    {(item.thumbnail || contentId) && <img src={item.thumbnail || ContentDisplayUrl(contentId)} alt="" />}
                  </div>
                  <div className="search-result-info" onClick={() => handleResultClick(item)}>
                    <div className="search-result-title">{item.title}</div>
                    <div className="search-result-meta">
                      {item.source && (
                        <span className="source-badge source-badge--clickable"
                              onClick={(e) => { e.stopPropagation(); handleSourceBadgeClick(item.source); }}
                              title={`Search only ${item.source}`}>
                          {item.source}
                        </span>
                      )}
                      {item.duration && <span>{Math.round(item.duration / 60)}m</span>}
                      {item.format && <span className={`format-badge format-badge--${item.format}`}>{item.format}</span>}
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
        ) : (
          <div className="search-home-sections">
            {continueItems.length > 0 && (
              <div className="search-home-section">
                <h3 className="search-home-section-title">Continue</h3>
                {continueItems.map(item => (
                  <div key={item.contentId} className="search-result-item" onClick={() => navigate(`/media/view/${item.contentId}`)}>
                    <div className="search-result-thumb">
                      <img src={item.thumbnail || ContentDisplayUrl(item.contentId)} alt="" />
                      {item.duration > 0 && (
                        <div className="continue-progress-bar">
                          <div className="continue-progress-fill" style={{ width: `${(item.progress / item.duration) * 100}%` }} />
                        </div>
                      )}
                    </div>
                    <div className="search-result-info">
                      <div className="search-result-title">{item.title}</div>
                      {item.format && <div className="search-result-meta"><span className={`format-badge format-badge--${item.format}`}>{item.format}</span></div>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {recentlyPlayed.length > 0 && (
              <div className="search-home-section">
                <h3 className="search-home-section-title">Recently Played</h3>
                {recentlyPlayed.map(item => (
                  <div key={item.contentId} className="search-result-item" onClick={() => navigate(`/media/view/${item.contentId}`)}>
                    <div className="search-result-thumb">
                      <img src={item.thumbnail || ContentDisplayUrl(item.contentId)} alt="" />
                    </div>
                    <div className="search-result-info">
                      <div className="search-result-title">{item.title}</div>
                      {item.format && <div className="search-result-meta"><span className={`format-badge format-badge--${item.format}`}>{item.format}</span></div>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Recent Searches */}
            {recentSearches.length > 0 && (
              <div className="search-home-section">
                <h3 className="search-home-section-title">Recent Searches</h3>
                {recentSearches.map((entry, i) => (
                  <button key={i} className="recent-search-item" onClick={() => handleRecentSearchClick(entry)}>
                    <span className="recent-search-query">{entry.query}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchHomePanel;
