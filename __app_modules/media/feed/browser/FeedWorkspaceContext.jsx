import { useRefreshableRead } from '../../../../frontend/src/lib/hooks/useRefreshableRead.js';
import { browserPreference } from '../../../../frontend/src/lib/browserPreference.js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { notifications } from '@mantine/notifications';
import { DaylightAPI } from "../../../../frontend/src/lib/api.mjs";
import getLogger from "../../../../frontend/src/lib/logging/Logger.js";
import { createBrowserMutationQueue } from "../../../../frontend/src/lib/browserMutationQueue.js";
import { feedQueueOwner } from "./offline/feedOfflineStore.js";

const FeedWorkspaceContext = createContext(null);
const log = getLogger().child({ app: 'feed', module: 'workspace' });
const storedPreferences = browserPreference('feed:reading-preferences', {}, JSON.parse);
const storedDensity = browserPreference('feed:density', null);
const lastVisit = mode => browserPreference(`feed:last-visit:${mode}`, null);
const PENDING_PREFIX = 'feed:pending-mutations:';
const DEFAULT_READING_PREFERENCES = Object.freeze({ theme: 'dark', density: 'comfortable', fontScale: 1, lineHeight: 1.65, measure: 72, sessionBudget: 0 });
const READING_PREFERENCES_PATH = '/api/v1/feed/workspace/preferences';
const preferenceTails = new Map();

// A write accepted before navigation must finish before the replacement
// workspace reads or saves preferences for the same account.
function enqueuePreferenceTask(owner, task) {
  const result = (preferenceTails.get(owner) ?? Promise.resolve()).then(task);
  const tail = result.catch(() => {});
  preferenceTails.set(owner, tail);
  tail.then(() => {
    if (preferenceTails.get(owner) === tail) preferenceTails.delete(owner);
  });
  return result;
}

const actions = new Set(['read', 'unread', 'save', 'unsave', 'archive', 'unarchive']);
const itemMutations = createBrowserMutationQueue({
  prefix: PENDING_PREFIX,
  getOwner: feedQueueOwner,
  idOf: row => row.id,
  valid: row => row?.id && actions.has(row.action) && Array.isArray(row.itemIds),
});

function loadReadingPreferences() {
  const stored = storedPreferences.read();
  const density = storedDensity.read();
  return { ...DEFAULT_READING_PREFERENCES, ...stored, ...(density ? { density } : {}) };
}

function updateItemState(item, state) {
  return { ...item, state, isRead: state.isRead };
}

function applyAction(item, action, { pending = false, now = new Date().toISOString() } = {}) {
  const state = { ...(item.state || {}) };
  if (action === 'read') { state.isRead = true; state.readAt = now; }
  if (action === 'unread') { state.isRead = false; state.readAt = null; }
  if (action === 'save') { state.isSaved = true; state.savedAt = now; }
  if (action === 'unsave') { state.isSaved = false; state.savedAt = null; }
  if (action === 'archive') { state.isArchived = true; state.archivedAt = now; }
  if (action === 'unarchive') { state.isArchived = false; state.archivedAt = null; }
  if (pending) state.syncStatus = 'pending';
  return updateItemState(item, state);
}

function isNetworkFailure(error) {
  return (typeof navigator !== 'undefined' && navigator.onLine === false)
    || error?.name === 'TypeError'
    || /failed to fetch|networkerror|network request failed/i.test(error?.message || '');
}

function mutationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function FeedWorkspaceProvider({ children }) {
  const userScopeRef = useRef(feedQueueOwner());
  const snapshotsRef = useRef(new Map());
  const checkpointsRef = useRef({});
  const pendingRef = useRef(itemMutations.snapshot(userScopeRef.current));
  const activeReplayOwner = useRef(null);
  const [readingPreferences, setReadingPreferencesState] = useState(loadReadingPreferences);
  const readingPreferencesRef = useRef(readingPreferences);
  const preferenceView = useRef(null);
  const preferenceRevision = useRef(0);
  const preferenceEdits = useRef(new Map());
  const [checkpoints, setCheckpoints] = useState({});
  const [sourcePreferences, setSourcePreferences] = useState({});
  const sourcePreferencesRef = useRef({});
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [pendingMutations, setPendingMutations] = useState(pendingRef.current);
  const [revision, setRevision] = useState(0);
  const [summary, setSummary] = useState({ unread: 0, readerUnread: 0, saved: 0, archived: 0, pendingSync: 0 });

  const readSummary = useCallback(async (isCurrent, signal) => {
    const owner = feedQueueOwner();
    try {
      const value = await DaylightAPI('/api/v1/feed/items/state/summary', {}, 'GET', { signal });
      if (isCurrent() && owner === feedQueueOwner()) setSummary(value);
    } catch (error) {
      if (isCurrent()) log.warn('feed.state.summary_failed', { error: error.message });
    }
  }, []);
  const { reload: refreshSummary } = useRefreshableRead(readSummary);
  useEffect(() => { refreshSummary(); }, [refreshSummary]);

  const publishReadingPreferences = useCallback(next => {
    readingPreferencesRef.current = next;
    setReadingPreferencesState(next);
    storedPreferences.write(JSON.stringify(next));
    storedDensity.write(next.density);
  }, []);

  const acceptReadingPreferences = useCallback((preferences, revision, keys = Object.keys(DEFAULT_READING_PREFERENCES)) => {
    if (!preferences) return;
    const next = { ...readingPreferencesRef.current };
    for (const key of keys) {
      if (Object.hasOwn(preferences, key) && (preferenceEdits.current.get(key) ?? 0) <= revision) {
        next[key] = preferences[key];
      }
    }
    publishReadingPreferences(next);
  }, [publishReadingPreferences]);

  const refreshWorkspace = useCallback(({ migrateLocal = false } = {}) => {
    const owner = feedQueueOwner();
    const view = preferenceView.current;
    const revision = preferenceRevision.current;
    const localBeforeRead = readingPreferencesRef.current;
    const isCurrent = () => view && preferenceView.current === view && owner === feedQueueOwner();
    return enqueuePreferenceTask(owner, async () => {
      if (!isCurrent()) return null;
      const workspace = await DaylightAPI('/api/v1/feed/workspace');
      if (!isCurrent()) return workspace;

      if (workspace?.preferencesStored) {
        acceptReadingPreferences({ ...DEFAULT_READING_PREFERENCES, ...workspace.preferences }, revision);
      } else {
        publishReadingPreferences(readingPreferencesRef.current);
      }
      const nextCheckpoints = workspace?.checkpoints || {};
      checkpointsRef.current = nextCheckpoints;
      setCheckpoints(nextCheckpoints);
      const nextSourcePreferences = workspace?.sourcePreferences || {};
      sourcePreferencesRef.current = nextSourcePreferences;
      setSourcePreferences(nextSourcePreferences);

      if (migrateLocal && !workspace?.preferencesStored) {
        // Render using the local snapshot during migration. Later writes wait
        // in order, so a partial edit cannot prevent the initial full save.
        setWorkspaceReady(true);
        try {
          const result = await DaylightAPI(READING_PREFERENCES_PATH, localBeforeRead, 'PATCH');
          if (isCurrent()) acceptReadingPreferences(result?.preferences, revision);
        } catch (error) {
          log.warn('feed.preferences.migration_failed', { error: error.message });
        }
      }
      return workspace;
    });
  }, [acceptReadingPreferences, publishReadingPreferences]);

  const publishPending = useCallback(next => {
    pendingRef.current = next;
    setPendingMutations(next);
  }, []);

  const synchronizeUserScope = useCallback(() => {
    const currentUser = feedQueueOwner();
    if (currentUser === userScopeRef.current) return currentUser;
    userScopeRef.current = currentUser;
    const next = itemMutations.snapshot(currentUser);
    pendingRef.current = next;
    setPendingMutations(next);
    return currentUser;
  }, []);

  const flushPendingMutations = useCallback(async () => {
    const owner = synchronizeUserScope();
    if (!owner || activeReplayOwner.current === owner || navigator.onLine === false) return;
    activeReplayOwner.current = owner;
    try {
      const completed = await itemMutations.flush(owner, operation =>
        DaylightAPI('/api/v1/feed/items/state', { itemIds: operation.itemIds, action: operation.action }, 'PATCH'), {
        onDequeue: publishPending,
        onError(error, operation) {
          if (!isNetworkFailure(error)) log.warn('feed.offline_replay.failed', { operationId: operation?.id, error: error.message });
        },
      });
      if (completed && owner === feedQueueOwner()) {
        publishPending(itemMutations.snapshot(owner));
        refreshSummary();
        notifications.show({ title: 'Offline changes synchronized', message: `${completed} queued change${completed === 1 ? '' : 's'} saved.` });
      }
    } finally {
      if (activeReplayOwner.current === owner) activeReplayOwner.current = null;
    }
  }, [publishPending, refreshSummary, synchronizeUserScope]);

  useEffect(() => {
    const view = {};
    preferenceView.current = view;
    refreshWorkspace({ migrateLocal: true }).catch(error => {
      if (preferenceView.current === view) log.warn('feed.workspace.load_failed', { error: error.message });
    }).finally(() => {
      if (preferenceView.current === view) setWorkspaceReady(true);
    });
    return () => { preferenceView.current = null; };
  }, [refreshWorkspace]);

  useEffect(() => {
    const handleOnline = () => flushPendingMutations();
    window.addEventListener('online', handleOnline);
    flushPendingMutations();
    return () => window.removeEventListener('online', handleOnline);
  }, [flushPendingMutations]);

  const setReadingPreference = useCallback((key, value) => {
    const view = preferenceView.current;
    if (!view) return;
    const owner = feedQueueOwner();
    const revision = ++preferenceRevision.current;
    preferenceEdits.current.set(key, revision);
    publishReadingPreferences({ ...readingPreferencesRef.current, [key]: value });
    enqueuePreferenceTask(owner, async () => {
      if (owner !== feedQueueOwner()) return;
      const result = await DaylightAPI(READING_PREFERENCES_PATH, { [key]: value }, 'PATCH');
      if (preferenceView.current === view && owner === feedQueueOwner()) {
        acceptReadingPreferences(result?.preferences, revision, [key]);
      }
    }).catch(error => log.warn('feed.preferences.save_failed', { key, error: error.message }));
  }, [acceptReadingPreferences, publishReadingPreferences]);

  const setDensity = useCallback((value) => setReadingPreference('density', value === 'compact' ? 'compact' : 'comfortable'), [setReadingPreference]);
  const density = readingPreferences.density;

  const setSourcePreference = useCallback(async (sourceKey, level) => {
    const previous = sourcePreferencesRef.current;
    const optimistic = { ...previous };
    if (level === 'normal') delete optimistic[sourceKey]; else optimistic[sourceKey] = level;
    sourcePreferencesRef.current = optimistic;
    setSourcePreferences(optimistic);
    try {
      const result = await DaylightAPI(`/api/v1/feed/workspace/sources/${encodeURIComponent(sourceKey)}`, { level }, 'PUT');
      sourcePreferencesRef.current = result.sourcePreferences || {};
      setSourcePreferences(sourcePreferencesRef.current);
      notifications.show({ title: 'Feed preference saved', message: level === 'mute' ? `${sourceKey} will be hidden from For you.` : level === 'normal' ? `${sourceKey} is back to normal.` : `${sourceKey} will appear ${level} often.` });
      return result.sourcePreferences || {};
    } catch (error) {
      sourcePreferencesRef.current = previous;
      setSourcePreferences(previous);
      notifications.show({ color: 'red', title: 'Preference not saved', message: 'Your feed mix was not changed.' });
      throw error;
    }
  }, []);

  const getSnapshot = useCallback((key) => snapshotsRef.current.get(key) || null, []);
  const setSnapshot = useCallback((key, value) => {
    snapshotsRef.current.set(key, typeof value === 'function' ? value(snapshotsRef.current.get(key)) : value);
    setRevision(value => value + 1);
  }, []);

  const getLastVisit = useCallback((mode) => checkpointsRef.current[mode]?.visitedAt || lastVisit(mode).read(), []);
  const markVisited = useCallback((mode, timestamp = new Date().toISOString(), position = {}) => {
    const optimistic = { itemId: position.itemId || null, scrollOffset: Math.max(0, Math.round(position.scrollOffset || 0)), visitedAt: timestamp };
    lastVisit(mode).write(timestamp);
    checkpointsRef.current = { ...checkpointsRef.current, [mode]: optimistic };
    setCheckpoints(checkpointsRef.current);
    DaylightAPI(`/api/v1/feed/workspace/checkpoints/${encodeURIComponent(mode)}`, optimistic, 'PUT')
      .then(result => {
        if (!result?.checkpoint) return;
        checkpointsRef.current = { ...checkpointsRef.current, [mode]: result.checkpoint };
        setCheckpoints(checkpointsRef.current);
        lastVisit(mode).write(result.checkpoint.visitedAt);
      })
      .catch(error => log.warn('feed.checkpoint.save_failed', { mode, error: error.message }));
  }, []);

  const applyPendingMutations = useCallback((items) => {
    return pendingRef.current.reduce((current, operation) => current.map(item => (
      operation.itemIds.includes(item.id) ? applyAction(item, operation.action, { pending: true, now: operation.createdAt }) : item
    )), items || []);
  }, []);

  const mutateItems = useCallback(async (items, action, { onApply } = {}) => {
    if (!items.length) return null;
    const owner = synchronizeUserScope();
    const previous = new Map(items.map(item => [item.id, item.state]));
    const now = new Date().toISOString();
    const optimistic = items.map(item => applyAction(item, action, { now }));
    onApply?.(optimistic);

    const queueOffline = () => {
      const operation = { id: mutationId(), itemIds: items.map(item => item.id), action, createdAt: now };
      try {
        publishPending(itemMutations.enqueue(owner, operation));
      } catch (error) {
        onApply?.(items.map(item => updateItemState(item, previous.get(item.id))));
        notifications.show({ color: 'red', title: 'Change not saved', message: 'The offline change could not be stored. Try again when connected.' });
        throw error;
      }
      const queued = optimistic.map(item => updateItemState(item, { ...item.state, syncStatus: 'pending' }));
      onApply?.(queued);
      notifications.show({ title: 'Saved offline', message: 'This change will synchronize when the connection returns.' });
      return { items: queued.map(item => ({ id: item.id, state: item.state })), queued: true };
    };

    if (pendingRef.current.length || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      const result = queueOffline();
      flushPendingMutations();
      return result;
    }

    try {
      const result = await DaylightAPI('/api/v1/feed/items/state', { itemIds: items.map(item => item.id), action }, 'PATCH');
      const byId = new Map((result.items || []).map(item => [item.id, item.state]));
      onApply?.(optimistic.map(item => byId.has(item.id) ? updateItemState(item, byId.get(item.id)) : item));
      const inverse = { read: 'unread', unread: 'read', save: 'unsave', unsave: 'save', archive: 'unarchive', unarchive: 'archive' }[action];
      notifications.show({
        title: action === 'archive' ? 'Archived' : action === 'save' ? 'Saved' : 'Updated',
        message: (
          <span>
            {result.items?.some(item => item.state?.syncStatus === 'pending') ? 'Saved locally; source sync will retry. ' : 'Change saved. '}
            {inverse && <button type="button" className="feed-toast-undo" onClick={() => mutateItems(optimistic, inverse, { onApply }).catch(() => {})}>Undo</button>}
          </span>
        ),
        autoClose: 5000,
        withCloseButton: true,
      });
      refreshSummary();
      return result;
    } catch (error) {
      if (isNetworkFailure(error)) return queueOffline();
      onApply?.(items.map(item => updateItemState(item, previous.get(item.id))));
      notifications.show({ color: 'red', title: 'Change not saved', message: 'The item was restored. Try again.' });
      log.warn('feed.state.mutation_failed', { action, count: items.length, error: error.message });
      throw error;
    }
  }, [publishPending, flushPendingMutations, refreshSummary, synchronizeUserScope]);

  const retrySync = useCallback(async () => {
    const owner = feedQueueOwner();
    const view = preferenceView.current;
    const isCurrent = () => view && preferenceView.current === view && owner === feedQueueOwner();
    try {
      await flushPendingMutations();
      if (!isCurrent()) return;
      const value = await DaylightAPI('/api/v1/feed/items/state/retry', {}, 'POST');
      if (!isCurrent()) return;
      refreshSummary();
      notifications.show({ title: value.pendingSync ? 'Sync still pending' : 'Feed synchronized', message: value.pendingSync ? `${value.pendingSync} change${value.pendingSync === 1 ? '' : 's'} will retry again.` : 'All source changes are up to date.' });
    } catch (error) {
      if (!isCurrent()) return;
      log.warn('feed.state.retry_failed', { error: error.message });
      notifications.show({ color: 'red', title: 'Sync retry failed', message: 'Local changes are safe and will remain queued.' });
    }
  }, [flushPendingMutations, refreshSummary]);

  const value = useMemo(() => ({
    density, setDensity, readingPreferences, setReadingPreference, checkpoints, workspaceReady, sourcePreferences, setSourcePreference,
    getSnapshot, setSnapshot, getLastVisit, markVisited, mutateItems, applyPendingMutations,
    pendingMutations: pendingMutations.length, flushPendingMutations, revision, summary, refreshSummary, refreshWorkspace, retrySync,
  }), [applyPendingMutations, checkpoints, density, flushPendingMutations, getLastVisit, getSnapshot, markVisited, mutateItems, pendingMutations.length, readingPreferences, refreshSummary, refreshWorkspace, retrySync, revision, setDensity, setReadingPreference, setSnapshot, setSourcePreference, sourcePreferences, summary, workspaceReady]);

  return <FeedWorkspaceContext.Provider value={value}>{children}</FeedWorkspaceContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useFeedWorkspace() {
  const value = useContext(FeedWorkspaceContext);
  if (!value) throw new Error('useFeedWorkspace must be used inside FeedWorkspaceProvider');
  return value;
}
