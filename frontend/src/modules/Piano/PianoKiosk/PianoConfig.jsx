import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../lib/api.mjs';

// Two contexts: the household-wide roster (raw config + list of pianos) and the
// active piano's resolved config. A household can have multiple piano kiosks,
// each identified by pianoId in the route (/piano/:pianoId).
const RosterContext = createContext(null);
const ActivePianoContext = createContext(null);

export const PIANO_CONFIG_DEFAULTS = {
  voices: [
    { label: 'Grand Piano', program: 0 },
    { label: 'Electric Piano', program: 4 },
    { label: 'Harpsichord', program: 6 },
  ],
  videos: { plexCollection: null },
  music: { collection: null, playlists: [] },
  sheetmusic: { collection: null },
  games: null,
  midi: { preferredInputName: null },
  inactivityMinutes: 10,
  // Screensaver disabled until a deviceId is configured (null = no screen control).
  screensaver: { deviceId: null, timeoutMinutes: 20, quietHours: null },
};

/** Resolve screensaver config: per-piano values override shared, over defaults. */
export function resolveScreensaver(shared, p) {
  const s = shared.screensaver || {};
  const ps = p.screensaver || {};
  const d = PIANO_CONFIG_DEFAULTS.screensaver;
  return {
    deviceId: ps.deviceId ?? s.deviceId ?? d.deviceId,
    timeoutMinutes: ps.timeoutMinutes ?? s.timeoutMinutes ?? d.timeoutMinutes,
    quietHours: ps.quietHours ?? s.quietHours ?? d.quietHours,
  };
}

/** Derive the list of pianos from raw config; falls back to a single default piano. */
export function derivePianos(raw) {
  const shared = raw || {};
  const pianos = shared.pianos || {};
  const ids = Object.keys(pianos);
  if (ids.length > 0) {
    return ids.map((id) => ({ id, label: pianos[id]?.label || id }));
  }
  return [{ id: 'default', label: shared.label || 'Piano' }];
}

/** Resolve one piano's effective config: per-piano values override shared, over defaults. */
export function resolvePianoConfig(raw, pianoId) {
  const shared = raw || {};
  const pianos = shared.pianos || {};
  // 'default' (the synthesized single piano) inherits straight from shared top-level.
  const p = pianos[pianoId] || (pianoId === 'default' ? shared : {});
  return {
    label: p.label || (pianoId === 'default' ? (shared.label || 'Piano') : pianoId),
    voices: p.voices || shared.voices || PIANO_CONFIG_DEFAULTS.voices,
    videos: { plexCollection: p.videos?.plexCollection ?? shared.videos?.plexCollection ?? null },
    music: {
      collection: p.music?.collection ?? shared.music?.collection ?? null,
      playlists: p.music?.playlists ?? shared.music?.playlists ?? [],
    },
    sheetmusic: { collection: p.sheetmusic?.collection ?? shared.sheetmusic?.collection ?? null },
    midi: { preferredInputName: p.midi?.preferredInputName ?? shared.midi?.preferredInputName ?? null },
    inactivityMinutes: p.inactivityMinutes ?? shared.inactivityMinutes ?? PIANO_CONFIG_DEFAULTS.inactivityMinutes,
    games: p.games ?? shared.games ?? null,
    screensaver: resolveScreensaver(shared, p),
  };
}

/**
 * Loads the household piano config once and exposes the raw config + piano roster.
 * Sits above the route so it persists across piano selection.
 */
export function PianoConfigProvider({ children }) {
  const [raw, setRaw] = useState(null); // null = loading

  useEffect(() => {
    let cancelled = false;
    const logger = getLogger().child({ component: 'piano-config' });
    DaylightAPI('api/v1/admin/apps/piano/config')
      .then((res) => { if (!cancelled) setRaw(res?.parsed ?? {}); })
      .catch((err) => { logger.warn('piano.config-failed', { error: err.message }); if (!cancelled) setRaw({}); });
    return () => { cancelled = true; };
  }, []);

  const value = useMemo(() => ({
    loading: raw === null,
    raw: raw ?? {},
    pianos: derivePianos(raw),
  }), [raw]);

  return <RosterContext.Provider value={value}>{children}</RosterContext.Provider>;
}

/** Household roster: { loading, raw, pianos:[{id,label}] }. */
export function usePianoRoster() {
  const ctx = useContext(RosterContext);
  if (!ctx) throw new Error('usePianoRoster must be used within a PianoConfigProvider');
  return ctx;
}

/**
 * Provides the active piano's resolved config + id to the modes/chrome.
 * Accepts an explicit `config` (used by tests) or derives it from the roster.
 */
export function ActivePianoProvider({ pianoId, config, children }) {
  const roster = useContext(RosterContext);
  const value = useMemo(() => ({
    pianoId,
    config: config || resolvePianoConfig(roster?.raw, pianoId),
  }), [pianoId, config, roster?.raw]);
  return <ActivePianoContext.Provider value={value}>{children}</ActivePianoContext.Provider>;
}

/** Active piano: { pianoId, config }. */
export function usePianoKioskConfig() {
  const ctx = useContext(ActivePianoContext);
  if (!ctx) throw new Error('usePianoKioskConfig must be used within an ActivePianoProvider');
  return ctx;
}

export default ActivePianoContext;
