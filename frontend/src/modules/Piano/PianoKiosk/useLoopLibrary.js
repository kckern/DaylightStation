import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import jsyaml from 'js-yaml';
import { Midi } from '@tonejs/midi';
import getLogger from '../../../lib/logging/Logger.js';
import { queryLoops, facets } from '@shared-music/loopQuery.mjs';
import { rankLayerCandidates } from '@shared-music/layerMatch.mjs';

/**
 * useLoopLibrary — loads the canonical MIDI loop catalog (media/midi/loops) and
 * exposes query / facet / layer-ranking helpers plus lazy note loading.
 *
 * The index is the queryable layer (one fetch, cached for the session). Note
 * data is loaded on demand per loop (tiny .mid parsed in-browser) and memoized,
 * so browsing is cheap and only auditioned/active loops pay the parse cost.
 */

const LOOPS_BASE = 'midi/loops';
const streamUrl = (rel) => `/api/v1/local/stream/${rel}`;

let _logger;
const logger = () => {
  if (!_logger) _logger = getLogger().child({ component: 'piano-loop-library' });
  return _logger;
};

export function useLoopLibrary() {
  const [loops, setLoops] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const notesCache = useRef(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t0 = performance.now();
        const text = await (await fetch(streamUrl(`${LOOPS_BASE}/index.yml`))).text();
        const parsed = jsyaml.load(text) || [];
        if (cancelled) return;
        setLoops(parsed);
        logger().info('loop-library.loaded', { count: parsed.length, ms: Math.round(performance.now() - t0) });
      } catch (err) {
        if (cancelled) return;
        setError(err.message);
        logger().error('loop-library.load-failed', { error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const query = useCallback((filters) => queryLoops(loops || [], filters), [loops]);
  const libraryFacets = useMemo(() => facets(loops || []), [loops]);
  const rankFor = useCallback((base, opts) => rankLayerCandidates(base, loops || [], opts), [loops]);

  /** Fetch + parse a loop's MIDI into { ppq, notes:[{ticks,durationTicks,midi}] }. Cached. */
  const loadNotes = useCallback(async (entry) => {
    if (notesCache.current.has(entry.path)) return notesCache.current.get(entry.path);
    try {
      const buf = await (await fetch(streamUrl(`${LOOPS_BASE}/${entry.path}`))).arrayBuffer();
      const midi = new Midi(buf);
      const notes = midi.tracks.flatMap((tr) => tr.notes.map((n) => ({
        ticks: n.ticks, durationTicks: n.durationTicks, midi: n.midi,
      })));
      const result = { ppq: midi.header.ppq || 480, notes };
      notesCache.current.set(entry.path, result);
      logger().debug('loop-library.notes-loaded', { path: entry.path, notes: notes.length });
      return result;
    } catch (err) {
      logger().warn('loop-library.notes-failed', { path: entry.path, error: err.message });
      return null;
    }
  }, []);

  return {
    loops,
    loading: loops === null && !error,
    error,
    query,
    facets: libraryFacets,
    rankFor,
    loadNotes,
  };
}

export default useLoopLibrary;
