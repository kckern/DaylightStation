import { useState, useEffect } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';

/**
 * Fetches content data from /api/v1/list/:contentId
 * Used by ShowView and SeasonView for metadata + child items (seasons/episodes).
 * Accepts a unified contentId (preferred) or legacy numeric ID (treated as plex:ID).
 *
 * @param {string} legacyId - Legacy numeric ID (falls back to plex:{id})
 * @param {number} refetchKey - Key to trigger refetch
 * @param {string} [contentId] - Unified compound content ID (e.g., "plex:12345")
 * @returns {{ data: object|null, loading: boolean, error: Error|null }}
 */
export function useFetchContentData(legacyId, refetchKey = 0, contentId = null) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Prefer contentId, fall back to constructing from legacyId
  // Convert compound ID (plex:12345) to path format (plex/12345) for list router
  const compoundId = contentId || (legacyId ? `plex:${legacyId}` : null);
  const resolvedId = compoundId ? compoundId.replace(':', '/') : null;

  useEffect(() => {
    if (!resolvedId) {
      setData(null);
      setLoading(false);
      return;
    }

    let canceled = false;
    setLoading(true);
    setError(null);

    async function fetchData() {
      try {
        const response = await DaylightAPI(`/api/v1/list/${resolvedId}`);
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
  }, [resolvedId, refetchKey]);

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

export default useFetchContentData;
