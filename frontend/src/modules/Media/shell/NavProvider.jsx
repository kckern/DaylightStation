import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';

const NavContext = createContext(null);

const INITIAL_ENTRY = { view: 'home', params: {} };

const NAV_PARAM_KEYS = ['view', 'path', 'contentId', 'deviceId'];

function readStateFromUrl() {
  if (typeof window === 'undefined') return INITIAL_ENTRY;
  const sp = new URLSearchParams(window.location.search);
  const view = sp.get('view') || 'home';
  const params = {};
  for (const key of NAV_PARAM_KEYS) {
    if (key === 'view') continue;
    const v = sp.get(key);
    if (v != null) params[key] = v;
  }
  return { view, params };
}

function writeStateToUrl(view, params, method = 'push') {
  if (typeof window === 'undefined') return;
  const sp = new URLSearchParams(window.location.search);
  // Strip existing nav keys; preserve everything else (e.g. ?play=, ?shader=).
  for (const key of NAV_PARAM_KEYS) sp.delete(key);
  if (view && view !== 'home') sp.set('view', view);
  for (const [k, v] of Object.entries(params || {})) {
    if (!NAV_PARAM_KEYS.includes(k)) continue;
    if (v != null && v !== '') sp.set(k, String(v));
  }
  const qs = sp.toString();
  const url = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
  const fn = method === 'replace' ? window.history.replaceState : window.history.pushState;
  fn.call(window.history, { view, params }, '', url);
}

export function NavProvider({ children }) {
  const [stack, setStack] = useState(() => [readStateFromUrl()]);

  useEffect(() => {
    const onPop = () => {
      const next = readStateFromUrl();
      // Replace the stack with the URL-derived entry; that's the browser's truth now.
      setStack([next]);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const push = useCallback((view, params = {}) => {
    setStack((prev) => [...prev, { view, params }]);
    writeStateToUrl(view, params, 'push');
  }, []);

  const pop = useCallback(() => {
    setStack((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.slice(0, -1);
      const top = next[next.length - 1];
      writeStateToUrl(top.view, top.params, 'replace');
      return next;
    });
  }, []);

  const replace = useCallback((view, params = {}) => {
    setStack((prev) => [...prev.slice(0, -1), { view, params }]);
    writeStateToUrl(view, params, 'replace');
  }, []);

  const current = stack[stack.length - 1];
  const value = useMemo(
    () => ({ view: current.view, params: current.params, depth: stack.length, push, pop, replace }),
    [current, stack.length, push, pop, replace]
  );

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav() {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNav must be used inside NavProvider');
  return ctx;
}

export default NavProvider;
