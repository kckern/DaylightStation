// frontend/src/hooks/media/useMediaHistory.js
import { useState, useEffect } from 'react';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useMediaHistory' });
  return _logger;
}

const HISTORY_KEY = 'media-play-history';
const MAX_HISTORY = 30;

export function recordPlay(item) {
  if (!item?.contentId) return;
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    const filtered = history.filter(h => h.contentId !== item.contentId);
    const entry = {
      contentId: item.contentId,
      title: item.title,
      format: item.format,
      thumbnail: item.thumbnail,
      timestamp: Date.now(),
      progress: item.progress || 0,
      duration: item.duration || 0,
    };
    const updated = [entry, ...filtered].slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch (err) {
    logger().warn('history.save-failed', { error: err.message });
  }
}

export function updateProgress(contentId, progress, duration) {
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    const idx = history.findIndex(h => h.contentId === contentId);
    if (idx >= 0) {
      history[idx].progress = progress;
      history[idx].duration = duration;
      history[idx].timestamp = Date.now();
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    }
  } catch { /* ignore */ }
}

export function useMediaHistory() {
  const [history, setHistory] = useState([]);

  useEffect(() => {
    try {
      setHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'));
    } catch { setHistory([]); }
  }, []);

  const continueItems = history.filter(h => h.progress > 0 && h.duration > 0 && (h.progress / h.duration) < 0.9);
  const recentlyPlayed = history.filter(h => !continueItems.includes(h)).slice(0, 10);

  return { continueItems, recentlyPlayed, refresh: () => {
    try { setHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')); } catch { /* */ }
  }};
}
