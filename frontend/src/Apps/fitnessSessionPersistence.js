import getLogger from '@/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'fitness-session-persistence' });
  return _logger;
}

const KEY = 'daylight.fitness.activeSession';

/** Persist the active play queue. An empty/absent queue clears the entry. */
export function saveActiveSession(queue) {
  try {
    if (!Array.isArray(queue) || queue.length === 0) { clearActiveSession(); return; }
    window.sessionStorage.setItem(KEY, JSON.stringify({ queue, savedAt: Date.now() }));
  } catch (err) {
    logger().warn('fitness.session_persist.save_failed', { message: err?.message ?? null });
  }
}

/** Load the active play queue, or null if none/corrupt. */
export function loadActiveSession() {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const queue = parsed?.queue;
    return Array.isArray(queue) && queue.length > 0 ? queue : null;
  } catch (err) {
    logger().warn('fitness.session_persist.load_failed', { message: err?.message ?? null });
    return null;
  }
}

export function clearActiveSession() {
  try { window.sessionStorage.removeItem(KEY); } catch { /* noop */ }
}
