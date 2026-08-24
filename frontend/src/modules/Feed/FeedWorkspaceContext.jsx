import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { notifications } from '@mantine/notifications';
import { DaylightAPI } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';
import { offlineStorageUser } from './offline/feedOfflineStore.js';

const FeedWorkspaceContext = createContext(null);
const log = getLogger().child({ app: 'feed', module: 'workspace' });
const PREFERENCES_KEY = 'feed:reading-preferences';
const PENDING_PREFIX = 'feed:pending-mutations:';
const DEFAULT_READING_PREFERENCES = Object.freeze({ theme: 'dark', density: 'comfortable', fontScale: 1, lineHeight: 1.65, measure: 72, sessionBudget: 0 });

function loadJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function loadReadingPreferences() {
  const stored = loadJson(PREFERENCES_KEY, {});
  const density = localStorage.getItem('feed:density');
  return { ...DEFAULT_READING_PREFERENCES, ...stored, ...(density ? { density } : {}) };
}

function pendingKey(user = offlineStorageUser()) {
  return `${PENDING_PREFIX}${user}`;
}

function loadPendingMutations(user = offlineStorageUser()) {
  const stored = loadJson(pendingKey(user), []);
  if (!Array.isArray(stored)) return [];
  const actions = new Set(['read', 'unread', 'save', 'unsave', 'archive', 'unarchive']);
  return stored.slice(0, 500).filter(entry => entry?.id && actions.has(entry.action) && Array.isArray(entry.itemIds));
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
  const userScopeRef = useRef(offlineStorageUser());
  const snapshotsRef = useRef(new Map());
  const checkpointsRef = useRef({});
  const pendingRef = useRef(loadPendingMutations(userScopeRef.current));
  const flushRef = useRef(false);
  const [readingPreferences, setReadingPreferencesState] = useState(loadReadingPreferences);
  const readingPreferencesRef = useRef(readingPreferences);
  const [checkpoints, setCheckpoints] = useState({});
  const [sourcePreferences, setSourcePreferences] = useState({});
  const sourcePreferencesRef = useRef({});
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [pendingMutations, setPendingMutations] = useState(pendingRef.current);
  const [revision, setRevision] = useState(0);
  const [summary, setSummary] = useState({ unread: 0, readerUnread: 0, saved: 0, archived: 0, pendingSync: 0 });

  const refreshSummary = useCallback(async () => {
    try {
      const value = await DaylightAPI('/api/v1/feed/items/state/summary');
      setSummary(value);
      return value;
    } catch (error) {
      log.warn('feed.state.summary_failed', { error: error.message });
      return null;
    }
  }, []);

  const refreshWorkspace = useCallback(async ({ migrateLocal = false } = {}) => {
    const workspace = await DaylightAPI('/api/v1/feed/workspace');
    const localPreferences = loadReadingPreferences();
    const nextPreferences = workspace?.preferencesStored
      ? { ...DEFAULT_READING_PREFERENCES, ...(workspace.preferences || {}) }
      : localPreferences;
    readingPreferencesRef.current = nextPreferences;
    setReadingPreferencesState(nextPreferences);
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(nextPreferences));
    localStorage.setItem('feed:density', nextPreferences.density);

    const nextCheckpoints = workspace?.checkpoints || {};
    checkpointsRef.current = nextCheckpoints;
    setCheckpoints(nextCheckpoints);
    const nextSourcePreferences = workspace?.sourcePreferences || {};
    sourcePreferencesRef.current = nextSourcePreferences;
    setSourcePreferences(nextSourcePreferences);

    if (migrateLocal && !workspace?.preferencesStored) {
      DaylightAPI('/api/v1/feed/workspace/preferences', nextPreferences, 'PATCH')
        .catch(error => log.warn('feed.preferences.migration_failed', { error: error.message }));
    }
    return workspace;
  }, []);

  const commitPending = useCallback((value) => {
    const next = typeof value === 'function' ? value(pendingRef.current) : value;
    pendingRef.current = next;
    setPendingMutations(next);
    localStorage.setItem(pendingKey(userScopeRef.current), JSON.stringify(next));
    return next;
  }, []);

  const synchronizeUserScope = useCallback(() => {
    const currentUser = offlineStorageUser();
    if (currentUser === userScopeRef.current) return currentUser;
    userScopeRef.current = currentUser;
    const next = loadPendingMutations(currentUser);
    pendingRef.current = next;
    setPendingMutations(next);
    flushRef.current = false;
    return currentUser;
  }, []);

  const flushPendingMutations = useCallback(async () => {
    synchronizeUserScope();
    if (flushRef.current || !pendingRef.current.length || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    const userScope = userScopeRef.current;
    flushRef.current = true;
    let completed = 0;
    try {
      for (const operation of [...pendingRef.current]) {
        try {
          await DaylightAPI('/api/v1/feed/items/state', { itemIds: operation.itemIds, action: operation.action }, 'PATCH');
          if (offlineStorageUser() !== userScope) break;
          commitPending(current => current.filter(entry => entry.id !== operation.id));
          completed += 1;
        } catch (error) {
          if (!isNetworkFailure(error)) log.warn('feed.offline_replay.failed', { operationId: operation.id, error: error.message });
          break;
        }
      }
      if (completed) {
        await refreshSummary();
        notifications.show({ title: 'Offline changes synchronized', message: `${completed} queued change${completed === 1 ? '' : 's'} saved.` });
      }
    } finally {
      flushRef.current = false;
    }
  }, [commitPending, refreshSummary, synchronizeUserScope]);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      refreshWorkspace({ migrateLocal: true }),
      refreshSummary(),
    ]).then(([workspaceResult]) => {
      if (!active) return;
      if (workspaceResult.status === 'rejected') {
        log.warn('feed.workspace.load_failed', { error: workspaceResult.reason?.message });
      }
    }).finally(() => {
      if (active) setWorkspaceReady(true);
    });
    return () => { active = false; };
  }, [refreshSummary, refreshWorkspace]);

  useEffect(() => {
    const handleOnline = () => flushPendingMutations();
    window.addEventListener('online', handleOnline);
    flushPendingMutations();
    return () => window.removeEventListener('online', handleOnline);
  }, [flushPendingMutations]);

  const setReadingPreference = useCallback((key, value) => {
    const next = { ...readingPreferencesRef.current, [key]: value };
    readingPreferencesRef.current = next;
    setReadingPreferencesState(next);
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
    if (key === 'density') localStorage.setItem('feed:density', value);
    DaylightAPI('/api/v1/feed/workspace/preferences', { [key]: value }, 'PATCH')
      .then(result => {
        if (result?.preferences) {
          readingPreferencesRef.current = result.preferences;
          setReadingPreferencesState(result.preferences);
          localStorage.setItem(PREFERENCES_KEY, JSON.stringify(result.preferences));
        }
      })
      .catch(error => log.warn('feed.preferences.save_failed', { key, error: error.message }));
  }, []);

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

  const getLastVisit = useCallback((mode) => checkpointsRef.current[mode]?.visitedAt || localStorage.getItem(`feed:last-visit:${mode}`), []);
  const markVisited = useCallback((mode, timestamp = new Date().toISOString(), position = {}) => {
    const optimistic = { itemId: position.itemId || null, scrollOffset: Math.max(0, Math.round(position.scrollOffset || 0)), visitedAt: timestamp };
    localStorage.setItem(`feed:last-visit:${mode}`, timestamp);
    checkpointsRef.current = { ...checkpointsRef.current, [mode]: optimistic };
    setCheckpoints(checkpointsRef.current);
    DaylightAPI(`/api/v1/feed/workspace/checkpoints/${encodeURIComponent(mode)}`, optimistic, 'PUT')
      .then(result => {
        if (!result?.checkpoint) return;
        checkpointsRef.current = { ...checkpointsRef.current, [mode]: result.checkpoint };
        setCheckpoints(checkpointsRef.current);
        localStorage.setItem(`feed:last-visit:${mode}`, result.checkpoint.visitedAt);
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
    synchronizeUserScope();
    const previous = new Map(items.map(item => [item.id, item.state]));
    const now = new Date().toISOString();
    const optimistic = items.map(item => applyAction(item, action, { now }));
    onApply?.(optimistic);

    const queueOffline = () => {
      const operation = { id: mutationId(), itemIds: items.map(item => item.id), action, createdAt: now };
      commitPending(current => [...current, operation].slice(-500));
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
            {inverse && <button type="button" className="feed-toast-undo" onClick={() => mutateItems(optimistic, inverse, { onApply })}>Undo</button>}
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
  }, [commitPending, flushPendingMutations, refreshSummary, synchronizeUserScope]);

  const retrySync = useCallback(async () => {
    try {
      await flushPendingMutations();
      const value = await DaylightAPI('/api/v1/feed/items/state/retry', {}, 'POST');
      setSummary(value);
      notifications.show({ title: value.pendingSync ? 'Sync still pending' : 'Feed synchronized', message: value.pendingSync ? `${value.pendingSync} change${value.pendingSync === 1 ? '' : 's'} will retry again.` : 'All source changes are up to date.' });
    } catch (error) {
      log.warn('feed.state.retry_failed', { error: error.message });
      notifications.show({ color: 'red', title: 'Sync retry failed', message: 'Local changes are safe and will remain queued.' });
    }
  }, [flushPendingMutations]);

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
