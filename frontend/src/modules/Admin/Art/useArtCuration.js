import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';

const WORKS_PATH = 'api/v1/admin/art/works';

// Build the query string for the list endpoint from the active filters.
const qs = (filters) => {
  const p = new URLSearchParams();
  Object.entries(filters || {}).forEach(([k, v]) => { if (v) p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};

/**
 * Library data + mutations. Loads the filtered work list, tracks the focused
 * index, and applies optimistic auto-saving PATCHes with an undo stack.
 */
export function useArtCuration(filters = {}) {
  const logger = useMemo(() => getLogger().child({ component: 'admin-art-library' }), []);
  const [works, setWorks] = useState([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const undoStack = useRef([]);   // [{ id, prevMeta }]
  const worksRef = useRef([]);    // mirror of works for synchronous reads in callbacks
  const filterKey = JSON.stringify(filters);

  // Keep worksRef in sync so callbacks can read the current list without stale closures.
  const applyWorks = useCallback((ws) => {
    worksRef.current = ws;
    setWorks(ws);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Load the whole filtered pool so the grid is a real gallery, not the first
      // page. The backend caps pageSize, so this requests "all" up to that cap.
      const res = await DaylightAPI(`${WORKS_PATH}${qs({ ...filters, pageSize: 2000 })}`);
      applyWorks(res.works || []);
      setIndex(0);
      logger.info('art.library.loaded', { total: res.total ?? 0 });
    } catch (err) {
      logger.error('art.library.load-failed', { error: err.message });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, logger, applyWorks]);

  useEffect(() => { load(); }, [load]);

  const focused = works[index] || null;

  const clamp = useCallback((i) => Math.max(0, Math.min(works.length - 1, i)), [works.length]);
  const next = useCallback(() => setIndex((i) => clamp(i + 1)), [clamp]);
  const prev = useCallback(() => setIndex((i) => clamp(i - 1)), [clamp]);
  const goto = useCallback((i) => setIndex(() => clamp(i)), [clamp]);

  // Apply a patch to the focused work: optimistic local update + PATCH + undo entry.
  const patchWork = useCallback(async (id, patch, recordUndo = true) => {
    // Read the current meta synchronously from the ref (avoids updater-timing issues).
    const current = worksRef.current.find((w) => w.id === id);
    const prevMeta = current ? current.meta : null;

    // Optimistic update.
    const optimistic = worksRef.current.map((w) =>
      w.id === id ? { ...w, meta: { ...w.meta, ...patch } } : w
    );
    applyWorks(optimistic);

    if (recordUndo && prevMeta) undoStack.current.push({ id, prevMeta });

    try {
      // Encode each path segment but keep the slashes (sectioned-scope work ids).
      const encId = String(id).split('/').map(encodeURIComponent).join('/');
      const res = await DaylightAPI(`${WORKS_PATH}/${encId}`, patch, 'PATCH');
      // Only update from server response if it returns a meta object; otherwise
      // keep the optimistic state (avoids overwriting it with a stale snapshot).
      if (res && res.meta) {
        const updated = worksRef.current.map((w) =>
          w.id === id ? { ...w, meta: res.meta } : w
        );
        applyWorks(updated);
      }
      logger.debug('art.curate', { id, fields: Object.keys(patch) });
    } catch (err) {
      logger.error('art.curate-failed', { id, error: err.message });
    }
  }, [logger, applyWorks]);

  const mutate = useCallback(async (patch) => {
    if (!focused) return;
    await patchWork(focused.id, patch);
    if (autoAdvance) next();
  }, [focused, patchWork, autoAdvance, next]);

  const undo = useCallback(async () => {
    const last = undoStack.current.pop();
    if (!last) return;
    // Re-PATCH the previous metadata snapshot (whole-field restore).
    await patchWork(last.id, last.prevMeta, false);
    logger.info('art.curate.undo', { id: last.id });
  }, [patchWork, logger]);

  return {
    works, focused, index, loading, autoAdvance,
    setAutoAdvance, next, prev, goto, mutate, undo, reload: load,
  };
}

export default useArtCuration;
