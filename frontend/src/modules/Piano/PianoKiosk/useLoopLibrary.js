import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { musicXmlToNotes } from '@shared-music/musicXmlToNotes.mjs';
import { queryLoops, facets } from '@shared-music/loopQuery.mjs';
import { rankLayerCandidates } from '@shared-music/layerMatch.mjs';

/**
 * useLoopLibrary — loads the backend loop-manifest (one fetch, cached for the
 * session) and exposes query / facet / layer-ranking helpers plus lazy note
 * loading. The manifest is the queryable layer; a brick's notes are parsed from
 * its MusicXML on demand (tiny file, parsed in-browser) and memoized, so
 * browsing is cheap and only auditioned/active bricks pay the parse cost.
 */

const MANIFEST_URL = '/api/v1/piano/loop-manifest';
const streamUrl = (rel) => `/api/v1/local/stream/${encodeURI(rel)}`;

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
        const res = await fetch(MANIFEST_URL);
        const data = await res.json();
        const bricks = Array.isArray(data?.bricks) ? data.bricks : [];
        if (cancelled) return;
        setLoops(bricks);
        logger().info('loop-library.loaded', { count: bricks.length, ms: Math.round(performance.now() - t0) });
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

  /** Fetch + parse a brick's MusicXML into { ppq, notes:[{ticks,durationTicks,midi}] }. Cached. */
  const loadNotes = useCallback(async (entry) => {
    if (notesCache.current.has(entry.path)) return notesCache.current.get(entry.path);
    try {
      const xml = await (await fetch(streamUrl(`midi/${entry.path}`))).text();
      const { ppq, notes } = musicXmlToNotes(xml);
      const result = { ppq, notes };
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
