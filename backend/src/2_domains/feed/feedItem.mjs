import crypto from 'node:crypto';

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'dclid', 'mc_cid', 'mc_eid', 'ref', 'ref_src',
]);

export function canonicalizeFeedUrl(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return null;
  }
}

export function feedStateKey(item = {}) {
  const url = canonicalizeFeedUrl(
    item.url || item.link || item.canonical?.[0]?.href || item.alternate?.[0]?.href,
  );
  const identity = url || `${item.sourceType || item.source || 'feed'}:${item.sourceId || item.id || ''}`;
  return `feed:${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 32)}`;
}

function normalizeImage(item) {
  const value = item.image;
  if (!value && !item.imageUrl) return null;
  if (typeof value === 'object') return value;
  return {
    url: value || item.imageUrl,
    width: item.imageWidth || null,
    height: item.imageHeight || null,
    alt: item.imageAlt || '',
  };
}

export function normalizeFeedItem(item = {}, { origin = 'scroll', state = null } = {}) {
  const url = canonicalizeFeedUrl(
    item.url || item.link || item.canonical?.[0]?.href || item.alternate?.[0]?.href,
  );
  const sourceType = item.sourceType || item.source || (origin === 'reader' ? 'freshrss' : (String(item.id || '').split(':')[0] || 'feed'));
  const normalizedState = state || item.state || {
    isRead: !!item.isRead,
    isSaved: false,
    isArchived: false,
    readAt: item.isRead ? new Date().toISOString() : null,
    savedAt: null,
    archivedAt: null,
    syncStatus: 'synced',
  };

  return {
    ...item,
    id: String(item.id || `${sourceType}:${url || item.title || Date.now()}`),
    stateKey: item.stateKey || feedStateKey({ ...item, url, sourceType }),
    title: item.title || 'Untitled',
    summary: item.summary || item.preview || item.description || '',
    url,
    publishedAt: item.publishedAt || item.published || item.timestamp || null,
    author: item.author || null,
    tags: Array.isArray(item.tags) ? item.tags : [],
    tier: item.tier || null,
    contentType: item.contentType || 'article',
    source: sourceType,
    sourceInfo: {
      id: item.sourceInfo?.id || item.sourceId || item.feedId || sourceType,
      type: item.sourceInfo?.type || sourceType,
      label: item.sourceInfo?.label || item.sourceLabel || item.feedTitle || item.meta?.sourceName || sourceType,
      iconUrl: item.sourceInfo?.iconUrl || item.iconUrl || null,
    },
    image: typeof item.image === 'string' ? item.image : (item.image?.url || item.imageUrl || null),
    imageInfo: normalizeImage(item),
    origins: [...new Set([...(item.origins || []), origin])],
    state: normalizedState,
    capabilities: {
      markRead: true,
      markUnread: true,
      save: true,
      archive: true,
      openOriginal: !!url,
      readerView: !!url,
      play: !!(item.contentId || item.meta?.playable),
      ...(item.capabilities || {}),
    },
    // Transitional aliases used by existing Feed components.
    link: item.link || url,
    published: item.published || item.publishedAt || item.timestamp || null,
    timestamp: item.timestamp || item.publishedAt || item.published || null,
    preview: item.preview || item.summary || item.description || '',
    isRead: normalizedState.isRead,
  };
}

export function defaultFeedItemState() {
  return {
    isRead: false,
    isSaved: false,
    isArchived: false,
    readAt: null,
    savedAt: null,
    archivedAt: null,
    syncStatus: 'synced',
  };
}

export function applyFeedStateAction(previous, action, now = new Date().toISOString()) {
  const next = { ...defaultFeedItemState(), ...(previous || {}) };
  if (action === 'read') { next.isRead = true; next.readAt = now; }
  else if (action === 'unread') { next.isRead = false; next.readAt = null; }
  else if (action === 'save') { next.isSaved = true; next.savedAt = now; }
  else if (action === 'unsave') { next.isSaved = false; next.savedAt = null; }
  else if (action === 'archive') { next.isArchived = true; next.archivedAt = now; }
  else if (action === 'unarchive') { next.isArchived = false; next.archivedAt = null; }
  else throw new Error(`Unsupported feed state action: ${action}`);
  next.updatedAt = now;
  return next;
}
