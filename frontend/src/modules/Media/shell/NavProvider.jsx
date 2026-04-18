import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

const NavContext = createContext(null);

const INITIAL_ENTRY = { view: 'home', params: {} };

export function NavProvider({ children }) {
  const [stack, setStack] = useState([INITIAL_ENTRY]);

  const push = useCallback((view, params = {}) => {
    setStack((prev) => [...prev, { view, params }]);
  }, []);

  const pop = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const replace = useCallback((view, params = {}) => {
    setStack((prev) => [...prev.slice(0, -1), { view, params }]);
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
