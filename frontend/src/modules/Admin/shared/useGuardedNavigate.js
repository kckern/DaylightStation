import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUnsavedGuardRegistry } from './useUnsavedGuardRegistry.js';

export function useGuardedNavigate() {
  const navigate = useNavigate();
  const guard = useUnsavedGuardRegistry();
  return useCallback((to) => {
    if (guard) return guard.guardedNavigate(to);
    navigate(to);
    return true;
  }, [guard, navigate]);
}

export default useGuardedNavigate;
