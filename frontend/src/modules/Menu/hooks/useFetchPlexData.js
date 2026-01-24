import { useState, useEffect } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';

/**
 * Fetches rich Plex data from /api/v1/list/plex/:id
 * Used by ShowView and SeasonView for detailed metadata.
 * 
 * @param {string} plexId - Plex rating key
 * @returns {{ data: object|null, loading: boolean, error: Error|null }}
 */
export function useFetchPlexData(plexId) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!plexId) {
      setData(null);
      setLoading(false);
      return;
    }

    let canceled = false;
    setLoading(true);
    setError(null);

    async function fetchData() {
      try {
        const response = await DaylightAPI(`/api/v1/item/plex/${plexId}`);
        if (!canceled) {
          setData(response);
          setLoading(false);
        }
      } catch (err) {
        if (!canceled) {
          setError(err);
          setLoading(false);
        }
      }
    }

    fetchData();
    return () => { canceled = true; };
  }, [plexId]);

  return { data, loading, error };
}

/**
 * Format duration in seconds to human-readable string
 * @param {number} seconds 
 * @returns {string} e.g., "56m" or "1h 20m"
 */
export function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

/**
 * Format watch progress as percentage string
 * @param {number} progress - 0 to 1
 * @returns {string} e.g., "60%"
 */
export function formatProgress(progress) {
  if (!progress || progress <= 0) return '';
  return `${Math.round(progress * 100)}%`;
}

export default useFetchPlexData;
