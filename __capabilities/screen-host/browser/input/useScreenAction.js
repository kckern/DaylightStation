import { useEffect } from 'react';
import { getActionBus } from './ActionBus.js';

export function useScreenAction(action, handler) {
  useEffect(() => {
    if (!action || !handler) return;
    const bus = getActionBus();
    return bus.subscribe(action, handler);
  }, [action, handler]);
}
