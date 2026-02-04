// frontend/src/hooks/useStreamingSearch.js
import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Hook for streaming search via SSE with AbortController for race condition handling.
 *
 * @param {string} endpoint - SSE endpoint URL (without query params)
 * @returns {{
 *   results: Array,
 *   pending: string[],
 *   isSearching: boolean,
 *   search: (query: string) => void
 * }}
 */
export function useStreamingSearch(endpoint) {
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
    setResults([]);
    setPending([]);

    const url = `${endpoint}?text=${encodeURIComponent(query)}`;
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
          setResults(prev => [...prev, ...data.items]);
          setPending(data.pending);
        } else if (data.event === 'complete') {
          setPending([]);
          setIsSearching(false);
          eventSource.close();
        } else if (data.event === 'error') {
          setIsSearching(false);
          setPending([]);
          eventSource.close();
        }
      } catch {
        // Ignore malformed JSON
      }
    };

    eventSource.onerror = () => {
      if (eventSourceRef.current === eventSource) {
        setIsSearching(false);
        setPending([]);
      }
      eventSource.close();
    };
  }, [endpoint]);

  return { results, pending, isSearching, search };
}

export default useStreamingSearch;
