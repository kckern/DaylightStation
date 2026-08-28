import { useContext } from 'react';
import { ScreenDataContext, ScreenDataActionsContext } from './ScreenDataProvider.jsx';

export function useScreenData(key) {
  const store = useContext(ScreenDataContext);
  return store[key] ?? null;
}

export function useScreenDataRefetch() {
  const { refetch } = useContext(ScreenDataActionsContext);
  return refetch;
}
