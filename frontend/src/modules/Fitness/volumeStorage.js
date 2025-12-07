const GLOBAL_KEY = 'volume:global';
const FITNESS_PREFIX = 'volume:fitness';
const DEFAULT_VOLUME = { level: 0.6, muted: false, updatedAt: 0 };

const VOLUME_KEY_PATTERN = /^volume:fitness:([^:]+):([^:]+):(.+)$/;

function isUsableStorage(storage) {
  return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function';
}

function resolveStorage(providedStorage) {
  if (isUsableStorage(providedStorage)) return providedStorage;
  if (typeof window !== 'undefined' && isUsableStorage(window.localStorage)) return window.localStorage;
  return null;
}

function clampLevel(level) {
  if (Number.isNaN(level) || typeof level !== 'number') return DEFAULT_VOLUME.level;
  if (level < 0) return 0;
  if (level > 1) return 1;
  return level;
}

function sanitizeVolume(entry, fallback = DEFAULT_VOLUME) {
  const level = clampLevel(entry?.level ?? fallback.level);
  const muted = typeof entry?.muted === 'boolean' ? entry.muted : fallback.muted;
  const updatedAt = typeof entry?.updatedAt === 'number' ? entry.updatedAt : fallback.updatedAt;
  return { level, muted, updatedAt };
}

function parseKeyMeta(key) {
  const match = key.match(VOLUME_KEY_PATTERN);
  if (!match) return null;
  const [, showId, seasonId, trackId] = match;
  return { showId, seasonId, trackId };
}

function parseStoredEntry(key, rawValue) {
  const meta = parseKeyMeta(key);
  if (!meta) return null;
  try {
    const parsed = JSON.parse(rawValue);
    const sanitized = sanitizeVolume(parsed);
    return { ...sanitized, ...meta, key };
  } catch (_err) {
    return null;
  }
}

function isVolumeKey(key) {
  return key.startsWith(`${FITNESS_PREFIX}:`);
}

function ensureGlobalDefault(map) {
  if (!map.has(GLOBAL_KEY)) {
    map.set(GLOBAL_KEY, { ...DEFAULT_VOLUME, showId: null, seasonId: null, trackId: null, key: GLOBAL_KEY });
  }
}

function stripMeta(entry) {
  return { level: entry.level, muted: entry.muted, updatedAt: entry.updatedAt };
}

function normalizeIds(ids = {}) {
  const showId = ids.showId != null ? String(ids.showId) : null;
  const seasonId = ids.seasonId != null ? String(ids.seasonId) : 'global';
  const trackId = ids.trackId != null ? String(ids.trackId) : null;
  return { showId, seasonId, trackId };
}

function makeTrackKey(ids) {
  if (!ids.showId || !ids.trackId) return null;
  return `${FITNESS_PREFIX}:${ids.showId}:${ids.seasonId}:${ids.trackId}`;
}

function selectLatest(map, predicate) {
  let candidate = null;
  for (const entry of map.values()) {
    if (!predicate(entry)) continue;
    if (!candidate || entry.updatedAt > candidate.updatedAt) {
      candidate = entry;
    }
  }
  return candidate;
}

function resolveFromMap(map, ids) {
  const globalEntry = map.get(GLOBAL_KEY) ?? { ...DEFAULT_VOLUME, updatedAt: 0 };
  if (!ids.showId || !ids.trackId) {
    return { ...globalEntry, source: 'global' };
  }

  const exactKey = makeTrackKey(ids);
  const exact = exactKey ? map.get(exactKey) : null;
  if (exact) return { ...exact, source: 'exact' };

  const seasonSibling = selectLatest(map, (entry) => entry.showId === ids.showId && entry.seasonId === ids.seasonId && entry.trackId !== ids.trackId);
  if (seasonSibling) return { ...seasonSibling, source: 'season-sibling' };

  const showSibling = selectLatest(map, (entry) => entry.showId === ids.showId && entry.trackId !== ids.trackId);
  if (showSibling) return { ...showSibling, source: 'show-sibling' };

  return { ...globalEntry, source: 'global' };
}

export function createVolumeStore(options = {}) {
  const { storage: providedStorage, now = () => Date.now(), onStorageError } = options;
  const map = new Map();
  const storage = resolveStorage(providedStorage);
  let storageHealthy = false;
  let storageErrorLogged = false;

  function handleStorageError(err) {
    if (!storageErrorLogged && typeof onStorageError === 'function') {
      onStorageError(err);
    }
    storageErrorLogged = true;
    storageHealthy = false;
  }

  function hydrateFromStorage() {
    if (!storage) return;
    try {
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (!key || !isVolumeKey(key)) continue;
        const raw = storage.getItem(key);
        if (raw == null) continue;
        const parsed = parseStoredEntry(key, raw);
        if (parsed) {
          map.set(key, parsed);
        }
      }
      storageHealthy = true;
    } catch (err) {
      handleStorageError(err);
    }
  }

  function writeThrough(key, entry) {
    if (!storage) return;
    if (key === GLOBAL_KEY) return; // never persist global defaults
    try {
      storage.setItem(key, JSON.stringify(stripMeta(entry)));
      storageHealthy = true;
    } catch (err) {
      handleStorageError(err);
    }
  }

  hydrateFromStorage();
  ensureGlobalDefault(map);

  function setVolume(ids, patch) {
    const normalizedIds = normalizeIds(ids);
    const key = makeTrackKey(normalizedIds);

    // Missing identity should never persist; just echo resolved fallback.
    if (!key) {
      const resolved = resolveFromMap(map, normalizedIds);
      return { ...resolved, source: resolved.source || 'global' };
    }

    const existing = map.get(key) || map.get(GLOBAL_KEY) || { ...DEFAULT_VOLUME, updatedAt: 0 };
    const next = sanitizeVolume({
      level: patch?.level ?? existing.level,
      muted: patch?.muted ?? existing.muted,
      updatedAt: now(),
    }, existing);
    const entryWithMeta = { ...next, ...parseKeyMeta(key), key };
    map.set(key, entryWithMeta);
    writeThrough(key, entryWithMeta);
    return { ...entryWithMeta, source: 'exact' };
  }

  function getVolume(ids) {
    const normalizedIds = normalizeIds(ids);
    return resolveFromMap(map, normalizedIds);
  }

  function getSnapshot() {
    return {
      storageHealthy,
      entries: Array.from(map.values()).map((entry) => ({
        key: entry.key,
        showId: entry.showId,
        seasonId: entry.seasonId,
        trackId: entry.trackId,
        level: entry.level,
        muted: entry.muted,
        updatedAt: entry.updatedAt,
      })),
    };
  }

  return { getVolume, setVolume, getSnapshot, isStorageHealthy: () => storageHealthy };
}
