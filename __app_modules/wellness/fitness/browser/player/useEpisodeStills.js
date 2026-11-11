import { useEffect, useState } from 'react';
import { DaylightMediaPath } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';

// Stills from inside an episode, for the show screen's rail. The media
// server keeps a preview index (BIF) per video part; a frame at any offset
// is one GET through the app's proxy. Nine frames, evenly spaced through the
// runtime (skipping the title card and the credits). An episode whose part
// has no index gets null — the rail then shows the episode's own art.

export const STILL_COUNT = 9;
export const STILL_WIDTH = 400;
export const STILL_HEIGHT = 225;
const FOCUS_SETTLE_MS = 250;

let _logger;
const logger = () => { if (!_logger) _logger = getLogger().child({ component: 'episode-stills' }); return _logger; };

const cache = new Map(); // episode key -> string[] | null
/** For tests. */
export function resetEpisodeStillsCache() { cache.clear(); }

export const stillUrl = (partId, offsetMs) =>
  `/api/v1/proxy/plex/library/parts/${partId}/indexes/sd/${offsetMs}?w=${STILL_WIDTH}&h=${STILL_HEIGHT}`;

/** The nine offsets: at 10%, 20% … 90% of the runtime. */
export const stillOffsets = (durationMs) =>
  Array.from({ length: STILL_COUNT }, (_, i) => Math.round((durationMs * (i + 1)) / (STILL_COUNT + 1)));

/** The part with a preview index, from a media-server metadata reply. */
export function indexedPart(metadata) {
  const item = metadata?.MediaContainer?.Metadata?.[0];
  for (const media of item?.Media || []) {
    for (const part of media?.Part || []) {
      if (part?.id != null && part?.indexes) return { id: part.id, durationMs: Number(part.duration) || Number(item?.duration) || 0 };
    }
  }
  return null;
}

async function fetchStills(ratingKey, durationSeconds) {
  const res = await fetch(DaylightMediaPath(`/api/v1/proxy/plex/library/metadata/${ratingKey}`), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`metadata ${res.status}`);
  const part = indexedPart(await res.json());
  if (!part) return null;
  const durationMs = part.durationMs || (Number(durationSeconds) || 0) * 1000;
  if (!(durationMs > 0)) return null;
  return stillOffsets(durationMs).map((offset) => stillUrl(part.id, offset));
}

/**
 * @returns {{ stills: string[] | null, settled: boolean }} settled is true once
 * the answer (stills or none) is known for this episode.
 */
export default function useEpisodeStills(episode) {
  const key = episode ? String(episode.plex || episode.id || '') : '';
  const ratingKey = key.replace(/^plex:/, '');
  const [state, setState] = useState(() => (cache.has(key) ? { key, stills: cache.get(key) } : { key: null, stills: null }));

  useEffect(() => {
    if (!ratingKey || !/^\d+$/.test(ratingKey)) { setState({ key, stills: null }); return undefined; }
    if (cache.has(key)) { setState({ key, stills: cache.get(key) }); return undefined; }
    let cancelled = false;
    // The D-pad walks the grid several cards a second: ask only once focus rests.
    const timer = setTimeout(() => {
      fetchStills(ratingKey, episode?.duration)
        .then((stills) => {
          cache.set(key, stills);
          if (stills) logger().debug('fitness.show.stills_loaded', { episode: key, count: stills.length });
          else logger().info('fitness.show.stills_unavailable', { episode: key });
          if (!cancelled) setState({ key, stills });
        })
        .catch((err) => {
          logger().warn('fitness.show.stills_failed', { episode: key, error: err?.message });
          if (!cancelled) setState({ key, stills: null });
        });
    }, FOCUS_SETTLE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key, ratingKey, episode?.duration]);

  return { stills: state.key === key ? state.stills : null, settled: state.key === key };
}
