// frontend/src/hooks/media/useScopePrefs.js
import { useState, useCallback } from 'react';

const STORAGE_KEYS = {
  last: 'media-scope-last',
  recents: 'media-scope-recents',
  favorites: 'media-scope-favorites',
};

const MAX_RECENTS = 5;

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Manages scope persistence in localStorage: last-used, recents, favorites.
 *
 * @returns {{
 *   lastScopeKey: string,
 *   recents: string[],
 *   favorites: string[],
 *   recordUsage: (key: string) => void,
 *   toggleFavorite: (key: string) => void,
 *   isFavorite: (key: string) => boolean,
 * }}
 */
export function useScopePrefs() {
  const [lastScopeKey] = useState(() => localStorage.getItem(STORAGE_KEYS.last) || 'all');
  const [recents, setRecents] = useState(() => readJSON(STORAGE_KEYS.recents, []));
  const [favorites, setFavorites] = useState(() => readJSON(STORAGE_KEYS.favorites, []));

  const recordUsage = useCallback((key) => {
    localStorage.setItem(STORAGE_KEYS.last, key);
    setRecents(prev => {
      const next = [key, ...prev.filter(k => k !== key)].slice(0, MAX_RECENTS);
      localStorage.setItem(STORAGE_KEYS.recents, JSON.stringify(next));
      return next;
    });
  }, []);

  const toggleFavorite = useCallback((key) => {
    setFavorites(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(next));
      return next;
    });
  }, []);

  const isFavorite = useCallback((key) => favorites.includes(key), [favorites]);

  return { lastScopeKey, recents, favorites, recordUsage, toggleFavorite, isFavorite };
}

export default useScopePrefs;
