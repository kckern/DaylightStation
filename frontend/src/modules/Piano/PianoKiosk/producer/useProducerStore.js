/**
 * useProducerStore — the API client + local cache for the household Producer
 * pool (Task 8.2, design §6). Wraps `GET/POST/PATCH/DELETE
 * /api/v1/piano/producer/{loops,crate,songs}` (Task 8.1) with:
 *
 * - light LISTS fetched on mount and cached in state (`songs`/`crate`/`loops`);
 * - full RECORDS fetched on demand and memoized in a ref map;
 * - author tagging from the current player (PianoUserContext) — a kiosk jam is
 *   never gated on identity, so with no player selected saves fall back to the
 *   `'household'` author (honest: the pool IS household-shared, design §6).
 *
 * ── CRYSTALLIZE (saveSong) ──────────────────────────────────────────────────
 * A song is persisted as its structural payload VERBATIM
 * (`{ sections, arrangement, meta, carriedLayers }`) so `loadSong → HYDRATE`
 * round-trips losing nothing. The ONE transform: recorded-take layers
 * (`source.kind === 'take'`, notes embedded in memory only) can't live inside a
 * song record — the design says recorded material participates like curated,
 * i.e. as a first-class loop. So saveSong AUTO-PERSISTS every embedded take as
 * a `/producer/loops` record FIRST, then rewrites those layers to
 * `{ kind:'loop', loopId }` refs before saving the song. Takes shared across
 * sections (a carried groove) are deduped by takeId → one loop, many refs.
 *
 * DEPENDENCY: saving a song with recorded takes writes N+1 records (N loops +
 * the song). loadSong reverses it — fetch each referenced loop and rebuild the
 * embedded-note take source — so the HYDRATEd draft plays identically. Library
 * layers keep `{ kind:'library', entry }` verbatim (the entry re-fetches notes
 * by slug via the shell's ensureLayerNotes; the store never touches lib).
 *
 * The Crate uses the SAME take→loop rewrite: a kept stack/section with a
 * recorded layer stores loop refs, not inline notes (design §6: "recorded loops
 * by id"). Callers pass FULLY-RESOLVED layer arrays (carriedRef placeholders
 * already expanded), so the Crate path sees only take/library sources.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { DaylightAPI } from '../../../../lib/api.mjs';
import getLogger from '../../../../lib/logging/Logger.js';
import { usePianoUser } from '../PianoUserContext.jsx';

const BASE = 'api/v1/piano/producer';
const FAMILIES = ['loops', 'crate', 'songs'];
/** No player selected → the pool is household-shared anyway (design §6). */
export const FALLBACK_AUTHOR = 'household';

/** Project a full record down to the API's light-listing shape so an
 * optimistic list insert matches what a later refresh() would return. Mirrors
 * the router's producerLight() so lists stay consistent without a round-trip. */
function lightOf(family, rec) {
  const light = {
    id: rec.id,
    kind: rec.kind ?? null,
    author: rec.author ?? null,
    created: rec.created ?? null,
  };
  if (rec.title != null) light.title = rec.title;
  if (typeof rec.favorite === 'boolean') light.favorite = rec.favorite;
  if (family === 'loops') {
    light.ppq = rec.ppq ?? null;
    light.lengthBars = rec.lengthBars ?? null;
    if (rec.specificity != null) light.specificity = rec.specificity;
    if (rec.drumMode != null) light.drumMode = rec.drumMode;
  } else if (family === 'crate') {
    light.lengthBars = rec.lengthBars ?? null;
    light.layerCount = Array.isArray(rec.layers) ? rec.layers.length : 0;
  } else if (family === 'songs') {
    light.sectionCount = Array.isArray(rec.sections) ? rec.sections.length : 0;
    if (rec.meta != null) light.meta = rec.meta;
  }
  return light;
}

/** Build a `/producer/loops` POST body from a take-sourced workspace layer.
 * Notes live in the layer's source; kind/specificity/drumMode surface at the
 * top level so the light listing (and the guardrails) can read them. */
function loopBodyFromLayer(layer, author) {
  const src = layer.source;
  const body = {
    author,
    kind: layer.role === 'groove' ? 'groove' : (layer.role ?? 'idea'),
    notes: src.notes,
    ppq: src.ppq ?? 480,
    lengthBars: src.lengthBars,
  };
  if (src.timeline) {
    body.timeline = src.timeline;
    if (Number.isFinite(src.timeline.root)) body.timelineRoot = src.timeline.root;
    if (src.timeline.specificity != null) body.specificity = src.timeline.specificity;
  }
  if (src.drumMode != null) body.drumMode = !!src.drumMode;
  return body;
}

/** Default name for a saved song. The kiosk has no text input, so every save
 * is stamped with the local date + time, e.g. "Song 2026-07-12 14:30". */
function defaultSongTitle() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `Song ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Rebuild an in-memory take source from a persisted loop record — the inverse
 * of loopBodyFromLayer, so a rewritten `{kind:'loop',loopId}` ref restores to a
 * playable embedded-note take on load. */
function takeSourceFromLoop(loop) {
  const src = {
    kind: 'take',
    takeId: loop.id,
    notes: Array.isArray(loop.notes) ? loop.notes : [],
    ppq: loop.ppq ?? 480,
    lengthBars: loop.lengthBars,
    drumMode: !!loop.drumMode,
  };
  if (loop.timeline) src.timeline = loop.timeline;
  return src;
}

/**
 * @returns {{
 *   songs: Array, crate: Array, loops: Array,
 *   loading: boolean, error: string|null,
 *   saveSong: (draft:object, opts?:{title?:string}) => Promise<object>,
 *   loadSong: (id:string) => Promise<{id:string, draft:object}>,
 *   saveCrateItem: (kind:'stack'|'section', payload:object, opts?:{title?:string}) => Promise<object>,
 *   saveLoop: (take:object, opts?:{title?:string}) => Promise<object>,
 *   remove: (family:string, id:string) => Promise<void>,
 *   rename: (family:string, id:string, title:string) => Promise<object>,
 *   refresh: () => Promise<void>,
 * }}
 */
export function useProducerStore() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-producer-store' }), []);
  const { currentUser } = usePianoUser();
  // Live author: the current player, or the household fallback. Held in a ref so
  // async save closures always read the CURRENT player, not a stale capture.
  const authorRef = useRef(FALLBACK_AUTHOR);
  authorRef.current = currentUser || FALLBACK_AUTHOR;

  const [lists, setLists] = useState({ loops: [], crate: [], songs: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fullCache = useRef(new Map()); // `${family}:${id}` → full record
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(FAMILIES.map((f) => DaylightAPI(`${BASE}/${f}`)));
      if (!mountedRef.current) return;
      const next = { loops: [], crate: [], songs: [] };
      FAMILIES.forEach((f, i) => {
        next[f] = Array.isArray(results[i]?.items) ? results[i].items : [];
      });
      setLists(next);
      logger.info('piano.producer.store.lists', {
        loops: next.loops.length, crate: next.crate.length, songs: next.songs.length,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err.message);
      logger.error('piano.producer.store.list-failed', { error: err.message });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [logger]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => { mountedRef.current = false; };
  }, [refresh]);

  /** GET :id with a session cache (full records are immutable once created). */
  const fetchFull = useCallback(async (family, id) => {
    const key = `${family}:${id}`;
    if (fullCache.current.has(key)) return fullCache.current.get(key);
    const rec = await DaylightAPI(`${BASE}/${family}/${id}`);
    fullCache.current.set(key, rec);
    return rec;
  }, []);

  /** POST create → cache full + optimistic light insert into the family list. */
  const create = useCallback(async (family, body) => {
    const rec = await DaylightAPI(`${BASE}/${family}`, body, 'POST');
    fullCache.current.set(`${family}:${rec.id}`, rec);
    if (mountedRef.current) {
      setLists((prev) => ({ ...prev, [family]: [...prev[family], lightOf(family, rec)] }));
    }
    return rec;
  }, []);

  /** Persist every embedded take in `layers` as a loop (deduped by takeId via
   * the shared map) and return the layers with those sources rewritten to
   * `{kind:'loop', loopId}` refs. Non-take layers (library, or carriedRef
   * placeholders — no source) pass through untouched. */
  const persistTakes = useCallback(async (layers, loopIdByTakeId) => {
    const out = [];
    for (const layer of (layers || [])) {
      if (layer?.source?.kind === 'take') {
        const takeId = layer.source.takeId;
        let loopId = loopIdByTakeId.get(takeId);
        if (!loopId) {
          const rec = await create('loops', loopBodyFromLayer(layer, authorRef.current));
          loopId = rec.id;
          loopIdByTakeId.set(takeId, loopId);
          logger.info('piano.producer.store.take-persisted', { takeId, loopId, role: layer.role });
        }
        out.push({ ...layer, source: { kind: 'loop', loopId } });
      } else {
        out.push(layer);
      }
    }
    return out;
  }, [create, logger]);

  const saveLoop = useCallback(async (take, { title } = {}) => {
    // A raw keep()/take → loop record (the CaptureCard "Keep to Crate" path).
    const body = loopBodyFromLayer(
      { source: take, role: take.kind === 'groove' ? 'groove' : (take.kind ?? 'idea') },
      authorRef.current,
    );
    if (title) body.title = title;
    const rec = await create('loops', body);
    logger.info('piano.producer.store.save-loop', { id: rec.id, kind: rec.kind });
    return rec;
  }, [create, logger]);

  const saveCrateItem = useCallback(async (kind, payload, { title } = {}) => {
    const loopIdByTakeId = new Map();
    const layers = await persistTakes(payload?.layers, loopIdByTakeId);
    const body = { author: authorRef.current, kind, layers };
    if (Number.isFinite(payload?.lengthBars)) body.lengthBars = payload.lengthBars;
    if (payload?.meta) body.meta = payload.meta;
    if (title) body.title = title;
    const rec = await create('crate', body);
    logger.info('piano.producer.store.save-crate', {
      id: rec.id, kind, layers: layers.length, takesPersisted: loopIdByTakeId.size,
    });
    return rec;
  }, [create, persistTakes, logger]);

  const saveSong = useCallback(async (draft, { title } = {}) => {
    if (!draft || !Array.isArray(draft.sections)) throw new Error('saveSong: no draft');
    const loopIdByTakeId = new Map();
    // Rewrite take layers → loop refs across every section + the carried pool.
    const sections = [];
    for (const s of draft.sections) {
      sections.push({ ...s, stack: await persistTakes(s.stack, loopIdByTakeId) });
    }
    const carriedLayers = {};
    for (const [id, layer] of Object.entries(draft.carriedLayers || {})) {
      const [rewritten] = await persistTakes([layer], loopIdByTakeId);
      carriedLayers[id] = rewritten;
    }
    // No text input in the kiosk — every save gets a default timestamped name
    // (e.g. "Song 2026-07-12 14:30") unless the draft already carries a title.
    const finalTitle = title || draft.meta?.title || defaultSongTitle();
    const meta = { ...draft.meta, title: finalTitle };
    const body = {
      author: authorRef.current,
      sections,
      arrangement: draft.arrangement || [],
      carriedLayers,
      meta,
    };
    if (meta.title) body.title = meta.title;
    const rec = await create('songs', body);
    logger.info('piano.producer.store.save-song', {
      id: rec.id, sections: sections.length, takesPersisted: loopIdByTakeId.size,
    });
    return rec;
  }, [create, persistTakes, logger]);

  const loadSong = useCallback(async (id) => {
    const rec = await fetchFull('songs', id);
    // Collect every loop ref across sections + carried pool.
    const loopIds = new Set();
    const scan = (layers) => (layers || []).forEach((l) => {
      if (l?.source?.kind === 'loop') loopIds.add(l.source.loopId);
    });
    (rec.sections || []).forEach((s) => scan(s.stack));
    scan(Object.values(rec.carriedLayers || {}));
    // Fetch the referenced loops (deduped) so takes get their notes back.
    const loopById = new Map();
    await Promise.all([...loopIds].map(async (lid) => {
      try { loopById.set(lid, await fetchFull('loops', lid)); }
      catch (err) { logger.warn('piano.producer.store.loop-ref-missing', { loopId: lid, error: err.message }); }
    }));
    const rebuild = (layers) => (layers || []).map((l) => {
      if (l?.source?.kind !== 'loop') return l;
      const loop = loopById.get(l.source.loopId);
      // A missing loop leaves the ref intact — the layer plays silently rather
      // than crashing the load (toSchedulerInputs omits notes-less layers).
      if (!loop) return l;
      return { ...l, source: takeSourceFromLoop(loop) };
    });
    const sections = (rec.sections || []).map((s) => ({ ...s, stack: rebuild(s.stack) }));
    const carriedLayers = {};
    for (const [k, v] of Object.entries(rec.carriedLayers || {})) {
      [carriedLayers[k]] = rebuild([v]);
    }
    const draft = {
      sections,
      arrangement: rec.arrangement || [],
      carriedLayers,
      meta: rec.meta || {},
    };
    logger.info('piano.producer.store.load-song', {
      id: rec.id, sections: sections.length, loopsResolved: loopById.size,
    });
    return { id: rec.id, draft };
  }, [fetchFull, logger]);

  /** Raw full-record access (cached) — used by the 'Ours' library facet to
   * pull a kept loop's embedded notes on pick. */
  const getFull = useCallback((family, id) => fetchFull(family, id), [fetchFull]);

  /** Resolve any `{kind:'loop', loopId}` refs in a layer array back into
   * embedded-note take sources (fetching the loops, cached + deduped). Shared
   * by loadCrateStack; loadSong keeps its own pass for the carried-map case. */
  const resolveLoopRefs = useCallback(async (layers) => {
    const loopIds = new Set();
    (layers || []).forEach((l) => { if (l?.source?.kind === 'loop') loopIds.add(l.source.loopId); });
    const loopById = new Map();
    await Promise.all([...loopIds].map(async (lid) => {
      try { loopById.set(lid, await fetchFull('loops', lid)); }
      catch (err) { logger.warn('piano.producer.store.loop-ref-missing', { loopId: lid, error: err.message }); }
    }));
    return (layers || []).map((l) => {
      if (l?.source?.kind !== 'loop') return l;
      const loop = loopById.get(l.source.loopId);
      return loop ? { ...l, source: takeSourceFromLoop(loop) } : l;
    });
  }, [fetchFull, logger]);

  /** A kept crate 'stack' resolved into workspace-ready layers (loop refs →
   * embedded takes; library layers untouched, notes re-fetch via the shell). */
  const loadCrateStack = useCallback(async (id) => {
    const rec = await fetchFull('crate', id);
    const layers = await resolveLoopRefs(rec.layers);
    logger.info('piano.producer.store.load-crate', { id: rec.id, kind: rec.kind, layers: layers.length });
    return { id: rec.id, kind: rec.kind, layers };
  }, [fetchFull, resolveLoopRefs, logger]);

  const remove = useCallback(async (family, id) => {
    await DaylightAPI(`${BASE}/${family}/${id}`, {}, 'DELETE');
    fullCache.current.delete(`${family}:${id}`);
    if (mountedRef.current) {
      setLists((prev) => ({ ...prev, [family]: prev[family].filter((it) => it.id !== id) }));
    }
    logger.info('piano.producer.store.remove', { family, id });
  }, [logger]);

  const rename = useCallback(async (family, id, title) => {
    const res = await DaylightAPI(`${BASE}/${family}/${id}`, { title }, 'PATCH');
    const key = `${family}:${id}`;
    if (fullCache.current.has(key)) {
      fullCache.current.set(key, { ...fullCache.current.get(key), title: res.title });
    }
    if (mountedRef.current) {
      setLists((prev) => ({
        ...prev,
        [family]: prev[family].map((it) => (it.id === id ? { ...it, title: res.title } : it)),
      }));
    }
    logger.info('piano.producer.store.rename', { family, id, title: res.title });
    return res;
  }, [logger]);

  return {
    songs: lists.songs,
    crate: lists.crate,
    loops: lists.loops,
    loading,
    error,
    saveSong,
    loadSong,
    saveCrateItem,
    saveLoop,
    loadCrateStack,
    getFull,
    remove,
    rename,
    refresh,
  };
}

export default useProducerStore;
