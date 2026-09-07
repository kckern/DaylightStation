import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_DENSITY_LEVELS } from '@shared-contracts/health/densityLevels.mjs';
import { densityRevision } from '@shared-contracts/health/foodDensity.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('display-preferences');
const validPlacement = value => value === 'before' || value === 'after';
const readPlacement = key => {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return validPlacement(value?.densityPlacement) ? value.densityPlacement : 'before';
  } catch (error) {
    logger.warn('preference.read_failed', { key, error: error?.message });
    return 'before';
  }
};

const defaults = {
  densityPlacement: 'before',
  setDensityPlacement: () => {},
  densityLevels: DEFAULT_DENSITY_LEVELS,
  densityRevision: densityRevision(DEFAULT_DENSITY_LEVELS),
};

const HealthDisplayPreferencesContext = createContext(defaults);

export function HealthDisplayPreferencesProvider({
  userId, densityLevels = DEFAULT_DENSITY_LEVELS, densityRevision: revision, children,
}) {
  const key = `health:display:${userId}`;
  const [densityPlacement, setPlacement] = useState(() => readPlacement(key));
  useEffect(() => setPlacement(readPlacement(key)), [key]);
  useEffect(() => {
    const onStorage = event => {
      if (event.key !== key) return;
      try {
        const next = event.newValue === null ? 'before' : JSON.parse(event.newValue)?.densityPlacement;
        setPlacement(validPlacement(next) ? next : 'before');
      } catch (error) {
        logger.warn('preference.storage_event_failed', { key, error: error?.message });
        setPlacement('before');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key]);
  const setDensityPlacement = useCallback((next) => {
    if (!validPlacement(next)) return;
    setPlacement(next);
    try { localStorage.setItem(key, JSON.stringify({ densityPlacement: next })); }
    catch (error) { logger.warn('preference.write_failed', { key, error: error?.message }); }
  }, [key]);
  const value = useMemo(() => ({
    densityPlacement, setDensityPlacement, densityLevels,
    densityRevision: revision ?? densityRevision(densityLevels),
  }), [densityLevels, densityPlacement, revision, setDensityPlacement]);
  return <HealthDisplayPreferencesContext.Provider value={value}>{children}</HealthDisplayPreferencesContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- the consumer hook belongs with its small provider context.
export function useHealthDisplayPreferences() {
  return useContext(HealthDisplayPreferencesContext);
}
