// frontend/src/hooks/useStreamingSearch.js
import { useState, useCallback, useRef, useEffect } from 'react';
import getLogger from '../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useStreamingSearch' });
  return _logger;
}

/**
 * Hook for streaming search via SSE with AbortController for race condition handling.
 *
 * @param {string} endpoint - SSE endpoint URL (without query params)
 * @param {string} [extraQueryString] - Additional query params to append (e.g. 'capability=listable&source=plex')
 * @returns {{
 *   results: Array,
 *   pending: string[],
 *   isSearching: boolean,
 *   search: (query: string) => void
 * }}
 */
export function useStreamingSearch(endpoint, extraQueryString = '') {
  const [results, setResults] = useState([]);
  const [pending, setPending] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const eventSourceRef = useRef(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const search = useCallback((query) => {
    // Cancel any in-flight request
    if (eventSourceRef.current) {
      logger().debug('search.cancelled', { reason: 'new-query' });
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // Short queries: clear and don't search
    if (!query || query.length < 2) {
      setResults([]);
      setPending([]);
      setIsSearching(false);
      return;
    }

    // Start new search
    setIsSearching(true);
    logger().info('search.started', { query, endpoint, filterParams: extraQueryString || null });
    setResults([]);
    setPending([]);

    const url = `${endpoint}?text=${encodeURIComponent(query)}${extraQueryString ? '&' + extraQueryString : ''}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      // Check if this request was cancelled
      if (eventSourceRef.current !== eventSource) {
        eventSource.close();
        return;
      }

      try {
        const data = JSON.parse(event.data);

        if (data.event === 'pending') {
          setPending(data.sources);
        } else if (data.event === 'results') {
          const newItems = data.items?.length || 0;
          setResults(prev => [...prev, ...data.items]);
          logger().info('search.results-received', { source: data.source, newItems });
          setPending(data.pending);
        } else if (data.event === 'complete') {
          logger().info('search.completed', { query });
          setPending([]);
          setIsSearching(false);
          eventSource.close();
        } else if (data.event === 'error') {
          logger().warn('search.error', { query, error: data.message });
          setIsSearching(false);
          setPending([]);
          eventSource.close();
        }
      } catch {
        // Ignore malformed JSON
      }
    };

    eventSource.onerror = () => {
      logger().warn('search.connection-error', { endpoint });
      if (eventSourceRef.current === eventSource) {
        setIsSearching(false);
        setPending([]);
      }
      eventSource.close();
    };
  }, [endpoint, extraQueryString]);

  return { results, pending, isSearching, search };
}

export default useStreamingSearch;
