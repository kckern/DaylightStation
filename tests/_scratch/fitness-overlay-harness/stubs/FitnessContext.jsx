// Harness stand-in for the app's FitnessContext module: the real one imports the
// whole fitness app (router, screen host). Scenes provide the value.
import { createContext, useContext } from 'react';

export const FITNESS_DEBUG = false;
export const FitnessContext = createContext(null);
export const useFitnessContext = () => {
  const ctx = useContext(FitnessContext);
  if (!ctx) throw new Error('useFitnessContext must be used within a FitnessProvider');
  return ctx;
};
export const useOptionalFitnessContext = () => useContext(FitnessContext);
export const useFitness = useFitnessContext;
export const useFitnessPlaylist = () => ({});
export const useFitnessSelector = (selector) => selector(useContext(FitnessContext) || {});
export const shallowEqualSelection = (a, b) => a === b;
