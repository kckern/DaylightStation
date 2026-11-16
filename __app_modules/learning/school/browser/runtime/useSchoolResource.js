import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createSchoolResourceStore, schoolResourceKey } from './schoolResources.js';

/** Current reads always verify on mount. Inject a surface-owned store to share reads explicitly. */
export function useSchoolResource({
  key, load, enabled = true, policy = 'current', isEmpty, notFoundAs = 'error', nullAs = 'empty', store: suppliedStore,
}) {
  const privateStore = useMemo(createSchoolResourceStore, []);
  const store = suppliedStore ?? privateStore;
  const identity = schoolResourceKey(key);
  const stableKey = useMemo(() => key, [identity]); // eslint-disable-line react-hooks/exhaustive-deps
  const latest = useRef();
  latest.current = { load, policy, isEmpty, notFoundAs, nullAs };
  const loader = useCallback(options => latest.current.load(options), []);
  const subscribe = useCallback(listener => enabled ? store.subscribe(stableKey, listener) : () => {}, [store, stableKey, enabled]);
  const snapshot = useSyncExternalStore(subscribe, useCallback(() => store.getSnapshot(stableKey), [store, stableKey]));
  useEffect(() => {
    if (enabled) store.read(stableKey, loader, latest.current);
  }, [store, stableKey, loader, enabled, policy]);
  const retry = useCallback(() => {
    if (enabled) store.read(stableKey, loader, { ...latest.current, fresh: true });
  }, [store, stableKey, loader, enabled]);
  return { ...snapshot, retry };
}

export default useSchoolResource;
