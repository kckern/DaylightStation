import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import { derivePianos, resolvePianoConfig } from './pianoConfigModel.js';

// Two contexts: the household-wide roster (raw config + list of pianos) and the
// active piano's resolved config. A household can have multiple piano kiosks,
// each identified by pianoId in the route (/piano/:pianoId).
const RosterContext = createContext(null);
const ActivePianoContext = createContext(null);


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
 *
 * `basePath` is the route prefix this piano lives under: `/piano` for the lone
 * single/default piano, `/piano/:pianoId` for a named one in a multi-piano
 * household. Chrome/menu build navigation from it (never hardcode the id).
 * Defaults to `/piano/${pianoId}` so tests that omit it keep working.
 */
export function ActivePianoProvider({ pianoId, basePath, config, children }) {
  const roster = useContext(RosterContext);
  const value = useMemo(() => ({
    pianoId,
    basePath: basePath ?? `/piano/${pianoId}`,
    config: config || resolvePianoConfig(roster?.raw, pianoId),
  }), [pianoId, basePath, config, roster?.raw]);
  return <ActivePianoContext.Provider value={value}>{children}</ActivePianoContext.Provider>;
}

/** Active piano: { pianoId, basePath, config }. */
export function usePianoKioskConfig() {
  const ctx = useContext(ActivePianoContext);
  if (!ctx) throw new Error('usePianoKioskConfig must be used within an ActivePianoProvider');
  return ctx;
}

/**
 * Same, but null outside the provider instead of throwing.
 *
 * For components that legitimately render BOTH in the kiosk and on the office
 * screen, where PianoVisualizer is a screen-framework widget with no
 * ActivePianoProvider. Piano Hero threw here and died on open the first time
 * the note launcher made it reachable there; it now takes the config it needs
 * as a prop and uses this only as the kiosk fallback.
 */
export function usePianoKioskConfigOptional() {
  return useContext(ActivePianoContext) ?? null;
}

export default ActivePianoContext;
