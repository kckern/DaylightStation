import React, { createContext, useEffect, useMemo, useState, useCallback } from 'react';

export const CAST_TARGET_KEY = 'media-app.cast-target';
export const CastTargetContext = createContext(null);

function readPersisted() {
  try {
    const raw = localStorage.getItem(CAST_TARGET_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const mode = parsed.mode === 'fork' ? 'fork' : 'transfer';
    const targetIds = Array.isArray(parsed.targetIds) ? parsed.targetIds.filter((x) => typeof x === 'string') : [];
    return { mode, targetIds };
  } catch {
    return null;
  }
}

function writePersisted(state) {
  try { localStorage.setItem(CAST_TARGET_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

export function CastTargetProvider({ children }) {
  const [mode, setModeRaw] = useState('transfer');
  const [targetIds, setTargetIds] = useState([]);

  useEffect(() => {
    const persisted = readPersisted();
    if (persisted) {
      setModeRaw(persisted.mode);
      setTargetIds(persisted.targetIds);
    }
  }, []);

  useEffect(() => { writePersisted({ mode, targetIds }); }, [mode, targetIds]);

  const setMode = useCallback((m) => {
    if (m === 'transfer' || m === 'fork') setModeRaw(m);
  }, []);

  const toggleTarget = useCallback((id) => {
    setTargetIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }, []);

  const clearTargets = useCallback(() => setTargetIds([]), []);

  const value = useMemo(
    () => ({ mode, targetIds, setMode, toggleTarget, clearTargets }),
    [mode, targetIds, setMode, toggleTarget, clearTargets]
  );

  return <CastTargetContext.Provider value={value}>{children}</CastTargetContext.Provider>;
}

export default CastTargetProvider;
