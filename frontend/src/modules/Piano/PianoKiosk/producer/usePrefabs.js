/**
 * usePrefabs — the READ-ONLY loader for curated prefab content (Task 9.1,
 * design §4 "Prefabs"): example stacks and songs authored as YAML in the media
 * tree, served through the SAME local-stream route as the loop index
 * (`/api/v1/local/stream/midi/prefabs/...`). No POST/PATCH/DELETE — prefabs are
 * curated, immutable, and the ONLY catalog difference from household material
 * is the absence of a Delete button (design §4).
 *
 * SERVED PATH (verified): `midi/prefabs/index.yml` is a light manifest
 * ({ stacks:[…], songs:[…] } with id/title/author/kind + a count); per-item
 * payloads live at `midi/prefabs/{stacks,songs}/{id}.yml` and load on demand.
 * This mirrors useLoopLibrary's index-then-lazy-payload pattern exactly, and
 * the stream route already serves arbitrary media subpaths (loops/index.yml is
 * fetched the same way), so no backend change was needed.
 *
 * Slug→entry RESOLUTION is NOT this hook's job: it returns raw payloads via
 * getFull; prefabHydrate.resolvePrefab{Stack,Song} turns their library refs
 * into runtime layers/draft against the live loop index. Keeping the fetch/cache
 * concern (here) separate from resolution (pure module) keeps both testable.
 *
 * @returns {{
 *   stacks: Array, songs: Array, loading: boolean, error: string|null,
 *   getFull: (kind:'stacks'|'songs', id:string) => Promise<object>,
 *   refresh: () => Promise<void>,
 * }}
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import jsyaml from 'js-yaml';
import getLogger from '../../../../lib/logging/Logger.js';

const PREFABS_BASE = 'midi/prefabs';
const streamUrl = (rel) => `/api/v1/local/stream/${rel}`;

/** Fetch + parse a YAML doc from the local-stream route (text → js-yaml). */
async function fetchYaml(rel) {
  const res = await fetch(streamUrl(rel));
  if (!res.ok) throw new Error(`prefabs fetch ${rel} → ${res.status}`);
  return jsyaml.load(await res.text());
}

export function usePrefabs() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-producer-prefabs' }), []);
  const [lists, setLists] = useState({ stacks: [], songs: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fullCache = useRef(new Map()); // `${kind}:${id}` → payload
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
      const manifest = (await fetchYaml(`${PREFABS_BASE}/index.yml`)) || {};
      if (!mountedRef.current) return;
      const next = {
        stacks: Array.isArray(manifest.stacks) ? manifest.stacks : [],
        songs: Array.isArray(manifest.songs) ? manifest.songs : [],
      };
      setLists(next);
      logger.info('piano.producer.prefabs.lists', {
        stacks: next.stacks.length,
        songs: next.songs.length,
        ms: Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - t0),
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err.message);
      logger.error('piano.producer.prefabs.list-failed', { error: err.message });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [logger]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => { mountedRef.current = false; };
  }, [refresh]);

  /** GET a full payload (cached — prefabs are immutable). kind is the folder
   * name ('stacks' | 'songs'); the id is the manifest entry's id. */
  const getFull = useCallback(async (kind, id) => {
    const key = `${kind}:${id}`;
    if (fullCache.current.has(key)) return fullCache.current.get(key);
    const payload = await fetchYaml(`${PREFABS_BASE}/${kind}/${id}.yml`);
    fullCache.current.set(key, payload);
    logger.debug('piano.producer.prefabs.full', { kind, id });
    return payload;
  }, [logger]);

  return {
    stacks: lists.stacks,
    songs: lists.songs,
    loading,
    error,
    getFull,
    refresh,
  };
}

export default usePrefabs;
