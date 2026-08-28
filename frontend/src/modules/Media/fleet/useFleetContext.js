// useFleetContext.js — the hook half of FleetProvider.jsx, split out so Fast
// Refresh can hot-reload the provider component on its own.
import { useContext } from 'react';
import { FleetContext } from './FleetProvider.jsx';

export function useFleetContext() {
  const ctx = useContext(FleetContext);
  if (!ctx) throw new Error('useFleetContext must be used inside FleetProvider');
  return ctx;
}
