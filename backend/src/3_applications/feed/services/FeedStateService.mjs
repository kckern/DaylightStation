import { randomUUID } from 'node:crypto';
import { applyFeedStateAction, defaultFeedItemState, normalizeFeedItem } from '#domains/feed/feedItem.mjs';

const ACTIONS = new Set(['read', 'unread', 'save', 'unsave', 'archive', 'unarchive']);
const MODES = new Set(['reader', 'headlines', 'scroll', 'search']);
const THEMES = new Set(['dark', 'sepia', 'light']);
const ANNOTATION_COLORS = new Set(['yellow', 'blue', 'green', 'pink', 'none']);
const SOURCE_PREFERENCE_LEVELS = new Set(['more', 'less', 'mute']);
const DEFAULT_PREFERENCES = Object.freeze({ theme: 'dark', density: 'comfortable', fontScale: 1, lineHeight: 1.65, measure: 72, sessionBudget: 0 });

function finiteIn(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function normalizePreferences(value = {}) {
  return {
    theme: THEMES.has(value.theme) ? value.theme : DEFAULT_PREFERENCES.theme,
    density: value.density === 'compact' ? 'compact' : DEFAULT_PREFERENCES.density,
    fontScale: finiteIn(value.fontScale, 0.8, 1.5, DEFAULT_PREFERENCES.fontScale),
    lineHeight: finiteIn(value.lineHeight, 1.3, 2.2, DEFAULT_PREFERENCES.lineHeight),
    measure: Math.round(finiteIn(value.measure, 40, 100, DEFAULT_PREFERENCES.measure)),
    sessionBudget: [0, 30, 60, 100].includes(Number(value.sessionBudget)) ? Number(value.sessionBudget) : DEFAULT_PREFERENCES.sessionBudget,
  };
}

function validTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeCheckpoint(value = {}, { preserveVisitedAt = false } = {}) {
  return {
    itemId: cleanText(value.itemId, 512) || null,
    scrollOffset: Math.max(0, Math.round(finiteIn(value.scrollOffset, 0, 100_000_000, 0))),
    visitedAt: preserveVisitedAt ? (validTimestamp(value.visitedAt) || new Date().toISOString()) : new Date().toISOString(),
  };
}

function normalizeImportedState(value = {}) {
  const isRead = value.isRead === true;
  const isSaved = value.isSaved === true;
  const isArchived = value.isArchived === true;
  return {
    ...defaultFeedItemState(),
    isRead,
    isSaved,
    isArchived,
    readAt: isRead ? validTimestamp(value.readAt) : null,
    savedAt: isSaved ? validTimestamp(value.savedAt) : null,
    archivedAt: isArchived ? validTimestamp(value.archivedAt) : null,
    syncStatus: 'synced',
    updatedAt: new Date().toISOString(),
  };
}

function normalizeImportedHistoryItem(value) {
  if (!value || typeof value !== 'object') return null;
  const id = cleanText(value.id, 512);
  const stateKey = cleanText(value.stateKey, 1024);
  const title = cleanText(value.title, 2_000);
  if (!id || !stateKey || !title) return null;
  const sourceInfo = value.sourceInfo && typeof value.sourceInfo === 'object' ? {
    id: cleanText(value.sourceInfo.id, 512),
    type: cleanText(value.sourceInfo.type, 128),
    label: cleanText(value.sourceInfo.label, 512),
    iconUrl: cleanText(value.sourceInfo.iconUrl, 2_048) || null,
  } : undefined;
  return normalizeFeedItem({
    id,
    stateKey,
    title,
    summary: cleanText(value.summary, 10_000),
    url: cleanText(value.url || value.link, 4_096) || null,
    publishedAt: validTimestamp(value.publishedAt || value.published),
    author: cleanText(value.author, 512) || null,
    tags: Array.isArray(value.tags) ? value.tags.slice(0, 100).map(tag => cleanText(tag, 128)).filter(Boolean) : [],
    tier: cleanText(value.tier, 64) || null,
    contentType: cleanText(value.contentType, 128) || 'article',
    source: cleanText(value.source, 128) || 'feed',
    sourceInfo,
    image: cleanText(value.image, 4_096) || null,
    origins: Array.isArray(value.origins) ? value.origins.filter(mode => MODES.has(mode)).slice(0, MODES.size) : [],
    sourceRefs: Array.isArray(value.sourceRefs) ? value.sourceRefs.slice(0, 100).map(ref => cleanText(ref, 512)).filter(Boolean) : [],
    sourceLinks: Array.isArray(value.sourceLinks) ? value.sourceLinks.slice(0, 100).map(link => ({
      type: cleanText(link?.type, 128),
      id: cleanText(link?.id, 512),
    })).filter(link => link.type && link.id) : [],
  }, { origin: value.origins?.find(mode => MODES.has(mode)) || 'search' });
}

function normalizeSourcePreferences(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const preferences = {};
  for (const [rawKey, level] of Object.entries(value).slice(0, 500)) {
    const key = cleanText(rawKey, 256);
    if (key && SOURCE_PREFERENCE_LEVELS.has(level)) preferences[key] = level;
  }
  return preferences;
}

function normalizeAnnotation(value, prior = null) {
  const now = new Date().toISOString();
  const note = cleanText(value.note, 10_000);
  const quote = cleanText(value.quote, 5_000);
  if (!note && !quote) throw new Error('Annotation requires a note or quote');
  return {
    id: prior?.id || randomUUID(),
    itemId: cleanText(value.itemId || prior?.itemId, 512),
    stateKey: cleanText(value.stateKey || prior?.stateKey, 1024),
    quote,
    note,
    color: ANNOTATION_COLORS.has(value.color) ? value.color : (prior?.color || 'yellow'),
    locator: cleanText(value.locator || prior?.locator, 1_000) || null,
    createdAt: prior?.createdAt || now,
    updatedAt: now,
  };
}

export class FeedStateService {
  #store;
  #history;
  #sourceAdapters;
  #logger;
  #backfills = new Map();
  #legacyDismissedStore;
  #legacyMigrations = new Set();
  #retrying = new Set();
  #retryTimers = new Map();

  constructor({ store, historyStore, sourceAdapters = [], legacyDismissedStore = null, logger = console }) {
    this.#store = store;
    this.#history = historyStore;
    this.#sourceAdapters = new Map(sourceAdapters.map(adapter => [adapter.sourceType, adapter]));
    this.#legacyDismissedStore = legacyDismissedStore;
    this.#logger = logger;
  }

  enrich(username, items, origin) {
    const normalized = items.map(item => normalizeFeedItem(item, { origin }));
    const states = this.#store.getMany(username, normalized.map(item => item.stateKey));
    const legacyDismissed = this.#legacyDismissedStore?.load() || new Set();
    const enriched = normalized.map(item => normalizeFeedItem(item, {
      origin,
      state: states.get(item.stateKey) || (legacyDismissed.has(item.id)
        ? { ...defaultFeedItemState(), isArchived: true, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
        : item.state || defaultFeedItemState()),
    }));
    const migrations = enriched.filter(item => legacyDismissed.has(item.id) && !states.get(item.stateKey) && !this.#legacyMigrations.has(`${username}:${item.stateKey}`));
    if (migrations.length) {
      for (const item of migrations) this.#legacyMigrations.add(`${username}:${item.stateKey}`);
      this.#store.update(username, data => {
        data.items ||= {};
        data.aliases ||= {};
        for (const item of migrations) {
          data.items[item.stateKey] = item.state;
          data.aliases[item.id] = item.stateKey;
        }
        return data;
      }).catch(error => this.#logger.warn?.('feed.state.legacy_migration_failed', { username, count: migrations.length, error: error.message }));
    }
    this.#history.record(username, enriched.map(item => this.#historyDocument(item)));
    this.retryPending(username).catch(error => this.#logger.warn?.('feed.state.retry_cycle_failed', { username, error: error.message }));
    return enriched;
  }

  async mutate(username, itemIds, action) {
    if (!ACTIONS.has(action)) throw new Error(`Unsupported feed state action: ${action}`);
    const resolved = itemIds.map(id => this.#history.findById(username, id) || normalizeFeedItem({ id }));
    const now = new Date().toISOString();
    let updated;
    await this.#store.update(username, data => {
      data.version = 1;
      data.items ||= {};
      data.aliases ||= {};
      updated = resolved.map(item => {
        const state = applyFeedStateAction(data.items[item.stateKey], action, now);
        data.items[item.stateKey] = state;
        data.aliases[item.id] = item.stateKey;
        return { id: item.id, stateKey: item.stateKey, state };
      });
      return data;
    });

    if (action === 'save' || action === 'unsave') {
      this.#history.setSaved(username, resolved.map(item => this.#historyDocument(item)), action === 'save');
    }

    const syncAction = action === 'read' ? 'markRead' : action === 'unread' ? 'markUnread' : null;
    if (syncAction) {
      const groups = new Map();
      for (const item of resolved) {
        const links = item.sourceLinks?.length
          ? item.sourceLinks
          : (item.sourceRefs || [item.id]).map(ref => ({ type: item.sourceInfo?.type, id: ref }));
        for (const link of links) {
          const ref = link.id;
          const type = link.type || item.sourceInfo?.type || (String(ref).includes(':') ? String(ref).split(':')[0] : null);
          const adapter = this.#sourceAdapters.get(type);
          if (!adapter || typeof adapter[syncAction] !== 'function') continue;
          if (!groups.has(type)) groups.set(type, { adapter, refs: new Set(), entries: new Map() });
          const group = groups.get(type);
          group.refs.add(ref);
          if (!group.entries.has(item.stateKey)) group.entries.set(item.stateKey, { stateKey: item.stateKey, refs: new Set() });
          group.entries.get(item.stateKey).refs.add(ref);
        }
      }
      for (const [sourceType, { adapter, refs, entries }] of groups) {
        try {
          await adapter[syncAction]([...refs], username);
          await this.#recordSyncSuccess(username, sourceType, [...entries.values()]);
        }
        catch (error) {
          this.#logger.warn?.('feed.state.source_sync.pending', { username, action, count: refs.size, error: error.message });
          for (const result of updated) {
            if (entries.has(result.stateKey)) result.state.syncStatus = 'pending';
          }
          await this.#store.update(username, data => {
            data.pendingSync ||= [];
            for (const entry of entries.values()) {
              if (data.items?.[entry.stateKey]) data.items[entry.stateKey].syncStatus = 'pending';
              const operation = {
                key: `${sourceType}:${entry.stateKey}`,
                sourceType,
                stateKey: entry.stateKey,
                refs: [...entry.refs],
                action: syncAction,
                attempts: 0,
                nextAttemptAt: Date.now() + 1_000,
                lastError: error.message,
              };
              const index = data.pendingSync.findIndex(value => value.key === operation.key);
              if (index >= 0) data.pendingSync[index] = operation;
              else data.pendingSync.push(operation);
            }
            return data;
          });
          this.#scheduleRetry(username, 1_000);
        }
      }
    }
    return updated;
  }

  search(username, options) {
    const all = this.#store.load(username);
    const states = new Map(Object.entries(all.items || {}));
    const result = this.#history.search(username, { ...options, states });
    return {
      ...result,
      items: result.items.map(item => normalizeFeedItem(item, {
        origin: item.origins?.[0] || 'search',
        state: states.get(item.stateKey) || defaultFeedItemState(),
      })),
    };
  }

  find(username, id) {
    const item = this.#history.findById(username, id);
    if (!item) return null;
    const state = this.#store.getMany(username, [item.stateKey]).get(item.stateKey);
    return normalizeFeedItem(item, { origin: item.origins?.[0] || 'history', state: state || defaultFeedItemState() });
  }

  summary(username) {
    const data = this.#store.load(username);
    const historySummary = this.#history.summarize?.(username, new Map(Object.entries(data.items || {}))) || { unread: 0, saved: 0, archived: 0 };
    return {
      ...historySummary,
      pendingSync: (data.pendingSync || []).length,
    };
  }

  getWorkspace(username) {
    const data = this.#store.load(username);
    const checkpoints = {};
    for (const [mode, checkpoint] of Object.entries(data.checkpoints || {})) {
      if (MODES.has(mode)) checkpoints[mode] = normalizeCheckpoint(checkpoint, { preserveVisitedAt: true });
    }
    return {
      preferences: normalizePreferences(data.preferences),
      preferencesStored: !!data.preferences,
      sourcePreferences: normalizeSourcePreferences(data.sourcePreferences),
      checkpoints,
    };
  }

  async updatePreferences(username, partial) {
    let preferences;
    await this.#store.update(username, data => {
      preferences = normalizePreferences({ ...(data.preferences || {}), ...(partial || {}) });
      data.preferences = preferences;
      return data;
    });
    return preferences;
  }

  async recordCheckpoint(username, mode, value = {}) {
    if (!MODES.has(mode)) throw new Error('Unsupported feed checkpoint mode');
    const checkpoint = normalizeCheckpoint(value);
    await this.#store.update(username, data => {
      data.checkpoints ||= {};
      data.checkpoints[mode] = checkpoint;
      return data;
    });
    return checkpoint;
  }

  getSourcePreferences(username) {
    return normalizeSourcePreferences(this.#store.load(username).sourcePreferences);
  }

  async updateSourcePreference(username, sourceKey, level) {
    const key = cleanText(sourceKey, 256);
    if (!key) throw new Error('Source key required');
    if (level !== 'normal' && !SOURCE_PREFERENCE_LEVELS.has(level)) throw new Error('Unsupported source preference');
    let sourcePreferences;
    await this.#store.update(username, data => {
      data.sourcePreferences = normalizeSourcePreferences(data.sourcePreferences);
      if (level === 'normal') delete data.sourcePreferences[key];
      else data.sourcePreferences[key] = level;
      sourcePreferences = { ...data.sourcePreferences };
      return data;
    });
    return sourcePreferences;
  }

  listAnnotations(username, itemId = null) {
    const data = this.#store.load(username);
    const annotations = Object.values(data.annotations || {});
    if (!itemId) return annotations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const item = this.#history.findById(username, itemId);
    const stateKey = item?.stateKey;
    return annotations
      .filter(annotation => annotation.itemId === itemId || (stateKey && annotation.stateKey === stateKey))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  async createAnnotation(username, value) {
    const item = this.#history.findById(username, value?.itemId);
    if (!item) throw new Error('Feed item not found');
    const requestedId = cleanText(value?.id, 128);
    if (requestedId && this.#store.load(username).annotations?.[requestedId]) throw new Error('Annotation already exists');
    const annotation = normalizeAnnotation(
      { ...value, itemId: item.id, stateKey: item.stateKey },
      requestedId ? { id: requestedId } : null,
    );
    await this.#store.update(username, data => {
      data.annotations ||= {};
      data.annotations[annotation.id] = annotation;
      return data;
    });
    return annotation;
  }

  async updateAnnotation(username, annotationId, value) {
    let annotation;
    await this.#store.update(username, data => {
      const prior = data.annotations?.[annotationId];
      if (!prior) throw new Error('Annotation not found');
      annotation = normalizeAnnotation({
        ...prior,
        note: value?.note ?? prior.note,
        quote: value?.quote ?? prior.quote,
        color: value?.color ?? prior.color,
        locator: value?.locator ?? prior.locator,
      }, prior);
      data.annotations[annotationId] = annotation;
      return data;
    });
    return annotation;
  }

  async deleteAnnotation(username, annotationId) {
    let removed = false;
    await this.#store.update(username, data => {
      if (data.annotations?.[annotationId]) {
        delete data.annotations[annotationId];
        removed = true;
      }
      return data;
    });
    return removed;
  }

  exportData(username) {
    const data = this.#store.load(username);
    const checkpoints = {};
    for (const [mode, checkpoint] of Object.entries(data.checkpoints || {})) {
      if (MODES.has(mode)) checkpoints[mode] = normalizeCheckpoint(checkpoint, { preserveVisitedAt: true });
    }
    return {
      format: 'daylight.feed-export/v1',
      exportedAt: new Date().toISOString(),
      preferences: normalizePreferences(data.preferences),
      sourcePreferences: normalizeSourcePreferences(data.sourcePreferences),
      checkpoints,
      states: Object.entries(data.items || {}).map(([stateKey, state]) => ({ stateKey, state: normalizeImportedState(state) })),
      annotations: Object.values(data.annotations || {}),
      items: this.#history.exportDocuments?.(username) || [],
    };
  }

  async importData(username, payload) {
    if (payload?.format !== 'daylight.feed-export/v1') throw new Error('Unsupported feed export format');
    const states = Array.isArray(payload.states) ? payload.states.slice(0, 20_000) : [];
    const annotations = Array.isArray(payload.annotations) ? payload.annotations.slice(0, 20_000) : [];
    const items = Array.isArray(payload.items) ? payload.items.slice(0, 50_000) : [];
    let importedStates = 0;
    let importedAnnotations = 0;
    await this.#store.update(username, data => {
      data.items ||= {};
      data.annotations ||= {};
      data.checkpoints ||= {};
      data.preferences = normalizePreferences({ ...(data.preferences || {}), ...(payload.preferences || {}) });
      data.sourcePreferences = {
        ...normalizeSourcePreferences(data.sourcePreferences),
        ...normalizeSourcePreferences(payload.sourcePreferences),
      };
      for (const [mode, checkpoint] of Object.entries(payload.checkpoints || {})) {
        if (MODES.has(mode) && checkpoint && typeof checkpoint === 'object') {
          data.checkpoints[mode] = normalizeCheckpoint(checkpoint, { preserveVisitedAt: true });
        }
      }
      for (const entry of states) {
        const stateKey = cleanText(entry?.stateKey, 1024);
        if (!stateKey || !entry?.state || typeof entry.state !== 'object') continue;
        data.items[stateKey] = normalizeImportedState(entry.state);
        importedStates += 1;
      }
      for (const raw of annotations) {
        try {
          const annotation = normalizeAnnotation(raw, raw?.id ? { ...raw, id: cleanText(raw.id, 128) } : null);
          if (annotation.id && annotation.itemId && annotation.stateKey) {
            data.annotations[annotation.id] = annotation;
            importedAnnotations += 1;
          }
        } catch { /* ignore invalid imported annotation */ }
      }
      return data;
    });
    const safeItems = items.map(normalizeImportedHistoryItem).filter(Boolean).map(item => this.#historyDocument(item));
    this.#history.record(username, safeItems);
    const current = this.#store.load(username);
    const saved = safeItems.filter(item => current.items?.[item.stateKey]?.isSaved);
    if (saved.length) this.#history.setSaved(username, saved, true);
    return { states: importedStates, annotations: importedAnnotations, items: safeItems.length };
  }

  async retryPending(username, { force = false } = {}) {
    if (this.#retrying.has(username)) return;
    const scheduled = this.#retryTimers.get(username);
    if (scheduled) {
      clearTimeout(scheduled);
      this.#retryTimers.delete(username);
    }
    const pending = this.#store.load(username).pendingSync || [];
    const due = pending.filter(operation => force || !operation.nextAttemptAt || operation.nextAttemptAt <= Date.now());
    if (!due.length) {
      const next = pending.reduce((minimum, operation) => Math.min(minimum, operation.nextAttemptAt || Infinity), Infinity);
      if (Number.isFinite(next)) this.#scheduleRetry(username, Math.max(250, next - Date.now()));
      return;
    }
    this.#retrying.add(username);
    try {
      for (const operation of due) {
        const adapter = this.#sourceAdapters.get(operation.sourceType);
        try {
          if (!adapter || typeof adapter[operation.action] !== 'function') throw new Error(`Source adapter unavailable: ${operation.sourceType}`);
          await adapter[operation.action](operation.refs, username);
          await this.#recordSyncSuccess(username, operation.sourceType, [operation]);
          this.#logger.info?.('feed.state.source_sync.recovered', { username, sourceType: operation.sourceType, stateKey: operation.stateKey, attempts: operation.attempts + 1 });
        } catch (error) {
          await this.#store.update(username, data => {
            const current = (data.pendingSync || []).find(value => value.key === operation.key);
            if (current) {
              current.attempts = (current.attempts || 0) + 1;
              current.lastError = error.message;
              current.nextAttemptAt = Date.now() + Math.min(5 * 60_000, 1_000 * (2 ** current.attempts));
            }
            return data;
          });
        }
      }
    } finally {
      this.#retrying.delete(username);
      const remaining = this.#store.load(username).pendingSync || [];
      const next = remaining.reduce((minimum, operation) => Math.min(minimum, operation.nextAttemptAt || Date.now()), Infinity);
      if (Number.isFinite(next)) this.#scheduleRetry(username, Math.max(250, next - Date.now()));
    }
  }

  async #recordSyncSuccess(username, sourceType, entries) {
    const keys = new Set(entries.map(entry => entry.stateKey));
    await this.#store.update(username, data => {
      data.pendingSync = (data.pendingSync || []).filter(operation => operation.sourceType !== sourceType || !keys.has(operation.stateKey));
      for (const stateKey of keys) {
        const stillPending = data.pendingSync.some(operation => operation.stateKey === stateKey);
        if (data.items?.[stateKey] && !stillPending) data.items[stateKey].syncStatus = 'synced';
      }
      return data;
    });
  }

  #scheduleRetry(username, delay) {
    const existing = this.#retryTimers.get(username);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.#retryTimers.delete(username);
      this.retryPending(username).catch(error => this.#logger.warn?.('feed.state.retry_cycle_failed', { username, error: error.message }));
    }, Math.min(delay, 5 * 60_000));
    timer.unref?.();
    this.#retryTimers.set(username, timer);
  }

  ensureHistoryBackfill(username) {
    const existing = this.#backfills.get(username);
    if (existing?.status === 'running' || existing?.status === 'complete') return existing;
    const persisted = this.#history.getBackfillStatus?.(username);
    if (persisted?.status === 'complete' && Date.now() - new Date(persisted.completedAt || 0).getTime() < 24 * 60 * 60 * 1000) {
      this.#backfills.set(username, persisted);
      return persisted;
    }
    const adapter = this.#sourceAdapters.get('freshrss');
    if (!adapter?.getHistoryPage) return { status: 'unavailable', indexed: 0 };
    const progress = { status: 'running', indexed: 0, startedAt: new Date().toISOString() };
    this.#backfills.set(username, progress);
    this.#history.setBackfillStatus?.(username, progress);
    progress.promise = this.#runHistoryBackfill(username, adapter, progress);
    return progress;
  }

  historyBackfillStatus(username) {
    const value = this.#backfills.get(username);
    if (!value) return { status: 'not_started', indexed: 0 };
    const { promise, ...status } = value;
    return status;
  }

  async #runHistoryBackfill(username, adapter, progress) {
    const cutoff = Date.now() - (365 * 24 * 60 * 60 * 1000);
    let continuation = null;
    try {
      do {
        const page = await adapter.getHistoryPage(username, { count: 500, continuation });
        const items = (page.items || []).map(item => ({
          ...item,
          sourceType: 'freshrss',
          isRead: item.isRead || (item.categories || []).includes('user/-/state/com.google/read'),
        }));
        this.enrich(username, items, 'reader');
        progress.indexed += items.length;
        this.#history.setBackfillStatus?.(username, { status: progress.status, indexed: progress.indexed, startedAt: progress.startedAt });
        continuation = page.continuation || null;
        const oldest = Math.min(...items.map(item => new Date(item.publishedAt || item.published || item.timestamp || 0).getTime()).filter(Number.isFinite));
        if (!items.length || oldest < cutoff || progress.indexed >= 10_000) continuation = null;
      } while (continuation);
      progress.status = 'complete';
      progress.completedAt = new Date().toISOString();
      this.#history.setBackfillStatus?.(username, this.historyBackfillStatus(username));
    } catch (error) {
      progress.status = 'failed';
      progress.error = error.message;
      this.#history.setBackfillStatus?.(username, this.historyBackfillStatus(username));
      this.#logger.warn?.('feed.history.backfill_failed', { username, indexed: progress.indexed, error: error.message });
    }
  }

  #historyDocument(item) {
    const { content, html, state, ...safe } = item;
    return safe;
  }
}

export default FeedStateService;
