export const RECENTS_KEY = 'media-app.recents';
export const MAX_RECENTS = 20;

function safeRead() {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeWrite(items) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(items));
  } catch { /* quota: drop silently */ }
}

export function readRecents() {
  return safeRead();
}

export function recordRecent(item) {
  if (!item || typeof item.contentId !== 'string' || item.contentId.length === 0) return;
  const next = [{
    contentId: item.contentId,
    title: item.title ?? null,
    thumbnail: item.thumbnail ?? null,
    format: item.format ?? null,
    recordedAt: new Date().toISOString(),
  }];
  for (const r of safeRead()) {
    if (r.contentId !== item.contentId) next.push(r);
    if (next.length >= MAX_RECENTS) break;
  }
  safeWrite(next);
}
