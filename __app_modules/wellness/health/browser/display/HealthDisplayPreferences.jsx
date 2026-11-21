import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_DENSITY_LEVELS } from "../../portable/contracts/health/densityLevels.mjs";
import { densityRevision } from "../../portable/contracts/health/foodDensity.mjs";
import { browserPreference, subscribeToStorageKey } from "../../../../../frontend/src/lib/browserPreference.js";

const DEFAULT_PLACEMENT = 'before';
const validPlacement = value => value === 'before' || value === 'after';
const decodePlacement = raw => {
  const placement = JSON.parse(raw)?.densityPlacement;
  return validPlacement(placement) ? placement : DEFAULT_PLACEMENT;
};
const defaults = {
  densityPlacement: DEFAULT_PLACEMENT,
  setDensityPlacement: () => {},
  densityLevels: DEFAULT_DENSITY_LEVELS,
  densityRevision: densityRevision(DEFAULT_DENSITY_LEVELS),
};

const HealthDisplayPreferencesContext = createContext(defaults);

export function HealthDisplayPreferencesProvider({
  userId, densityLevels = DEFAULT_DENSITY_LEVELS, densityRevision: revision, children,
}) {
  const key = `health:display:${userId}`;
  const preference = useMemo(() => browserPreference(key, DEFAULT_PLACEMENT, decodePlacement), [key]);
  const [densityPlacement, setPlacement] = useState(preference.read);
  useEffect(() => {
    const readCurrentPlacement = () => setPlacement(preference.read());
    const unsubscribe = subscribeToStorageKey(key, readCurrentPlacement);
    readCurrentPlacement();
    return unsubscribe;
  }, [key, preference]);
  const setDensityPlacement = useCallback((next) => {
    if (!validPlacement(next)) return;
    setPlacement(next);
    preference.write(JSON.stringify({ densityPlacement: next }));
  }, [preference]);
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
