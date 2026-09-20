// frontend/src/modules/Media/shell/NavProvider.jsx
// Single-route navigation: views are URL query state (?view=…), in-app
// navigation is a stack mirrored into history.state so browser Back, reload,
// and shared URLs all restore correctly. The stack itself is serialized into
// each history entry (mediaNavStack) — popstate restores the full stack, not
// a flattened single entry.
import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { readNavFromSearch, writeNavToSearch } from '../lib/urlParams.js';
import mediaLog from '../logging/mediaLog.js';

const NavContext = createContext(null);

// Canvas owns these view names. Keeping their primary-area ownership here
// makes navigation controls and visible Back labels consume one history model.
// eslint-disable-next-line react-refresh/only-export-components -- primary area metadata must be consumed by shell controls alongside the Provider
export const AREA_FOR_VIEW = Object.freeze({
  home: 'home',
  browse: 'browse',
  detail: 'browse',
  nowPlaying: 'home',
  fleet: 'fleet',
  peek: 'fleet',
});

const AREA_LABEL = Object.freeze({ home: 'Home', browse: 'Browse', fleet: 'Devices' });
const AREA_TOP = Object.freeze({
  home: { view: 'home', params: {} },
  browse: { view: 'browse', params: { path: '' } },
  fleet: { view: 'fleet', params: {} },
});

function normalizeEntry(entry) {
  if (!entry || !AREA_FOR_VIEW[entry.view]) return { view: 'home', params: {} };
  return { view: entry.view, params: entry.params ?? {} };
}

function normalizeStack(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return [{ view: 'home', params: {} }];
  // An unrecognised URL/state cannot be rendered truthfully. Replace its
  // whole in-app model with Home rather than merely letting Canvas fall back.
  if (entries.some((entry) => !AREA_FOR_VIEW[entry?.view])) return [{ view: 'home', params: {} }];
  return entries.map(normalizeEntry);
}

function initialStack() {
  if (typeof window === 'undefined') return [{ view: 'home', params: {} }];
  const hs = window.history.state;
  if (hs && Array.isArray(hs.mediaNavStack) && hs.mediaNavStack.length > 0) {
    return normalizeStack(hs.mediaNavStack);
  }
  return [normalizeEntry(readNavFromSearch(window.location.search))];
}

function syncHistory(stack, method) {
  if (typeof window === 'undefined') return;
  const top = stack[stack.length - 1];
  const qs = writeNavToSearch(window.location.search, top.view, top.params);
  const url = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
  const state = { ...(window.history.state || {}), mediaNavStack: stack };
  if (method === 'push') window.history.pushState(state, '', url);
  else window.history.replaceState(state, '', url);
}

export function NavProvider({ children }) {
  const [stack, setStack] = useState(initialStack);

  // Make sure the initial entry carries the stack so a reload restores it.
  useEffect(() => {
    syncHistory(stack, 'replace');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPop = (e) => {
      const s = e.state?.mediaNavStack;
      const next = Array.isArray(s) && s.length > 0
        ? normalizeStack(s)
        : [normalizeEntry(readNavFromSearch(window.location.search))];
      setStack(next);
      syncHistory(next, 'replace');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // `opts.replaceEntry` grows the in-app stack exactly like a normal push but
  // writes it over the CURRENT history entry instead of adding one. It exists
  // for a caller that already owns the current entry and is handing it off:
  // the mobile Search Mode pushes a marker entry when it opens (so browser
  // Back closes it), and a container tap inside it navigates to browse. With a
  // plain push, browse would sit ON TOP of that marker — the surface's own
  // exit path would then have to traverse back over it, which lands on the
  // marker's PRE-search nav stack and instantly un-navigates the user (they
  // tap a show and end up on Home). Replacing lets the browse route take the
  // marker's place: one entry, and Back from browse goes where it did before
  // the search started.
  const push = useCallback((view, params = {}, opts = {}) => {
    const replaceEntry = opts.replaceEntry === true;
    setStack((prev) => {
      const next = [...prev, normalizeEntry({ view, params })];
      syncHistory(next, replaceEntry ? 'replace' : 'push');
      mediaLog.navPushed({ view, depth: next.length, replaceEntry });
      return next;
    });
  }, []);

  const goToArea = useCallback((area) => {
    const top = AREA_TOP[area];
    if (!top) return;
    setStack((prev) => {
      const currentArea = AREA_FOR_VIEW[prev.at(-1)?.view] ?? 'home';
      if (currentArea !== area) {
        const next = [...prev, { view: top.view, params: { ...top.params } }];
        syncHistory(next, 'push');
        return next;
      }

      // Re-selection must land on an existing canonical top entry when one
      // exists. Traversing the browser entry (instead of replaceState) means
      // one Back reaches the actual prior area, with no duplicate area stop.
      const targetIndex = prev.findLastIndex((entry) => entry.view === top.view
        && JSON.stringify(entry.params ?? {}) === JSON.stringify(top.params));
      if (targetIndex >= 0 && targetIndex < prev.length - 1) {
        window.history.go(targetIndex - (prev.length - 1));
        return prev.slice(0, targetIndex + 1);
      }
      if (targetIndex === prev.length - 1) return prev;

      // A depth-one deep link has no in-app canonical top to traverse to.
      // Replace it in place so it does not manufacture a Back stop.
      const next = [...prev.slice(0, -1), { view: top.view, params: { ...top.params } }];
      syncHistory(next, 'replace');
      return next;
    });
  }, []);

  // pop() drives the browser history so in-app Back and browser Back are the
  // same operation; the popstate handler restores the previous stack.
  const pop = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.state?.mediaNavStack?.length > 1) {
      window.history.back();
      return;
    }
    // No in-app history (deep-linked entry): fall back to home.
    setStack((prev) => {
      if (prev.length <= 1 && prev[0]?.view === 'home') return prev;
      const next = [{ view: 'home', params: {} }];
      syncHistory(next, 'replace');
      return next;
    });
  }, []);

  const replace = useCallback((view, params = {}) => {
    setStack((prev) => {
      const next = [...prev.slice(0, -1), normalizeEntry({ view, params })];
      syncHistory(next, 'replace');
      return next;
    });
  }, []);

  const current = stack[stack.length - 1];
  const area = AREA_FOR_VIEW[current.view];
  const previous = stack.at(-2);
  const backDestination = previous ? AREA_LABEL[AREA_FOR_VIEW[previous.view]] : null;
  const value = useMemo(
    () => ({ view: current.view, params: current.params, depth: stack.length, area, backDestination, push, goToArea, pop, replace }),
    [current, stack.length, area, backDestination, push, goToArea, pop, replace]
  );

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- useNav is co-located with its Context/Provider (standard pattern); 24 consumers, splitting out of scope for a lint pass
export function useNav() {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNav must be used inside NavProvider');
  return ctx;
}

export default NavProvider;
