import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import useEpisodeStills from './useEpisodeStills.js';
import { CELLS, CELL_MS, cellPools, cellForTick, nextFrame, isFlatLuma, sampleLuma } from './episodeStillsGrid.js';

// The rail at the top of the episode panel: the season's poster on the left
// and, to its right, the episode thumbnail — always a 3×3 grid of stills from
// inside the episode, each cell drawing in order from its own slice of the
// runtime. Once a second one cell (in reading order: top-left, top-centre, …)
// moves on to its next still with a short crossfade, so the picture keeps
// refreshing without ever changing all at once. A still is shown only once it
// has loaded — and is a picture, not a flat fade to black or white: the next
// one is preloaded (hidden) a tick ahead and sampled, the new still
// fades in OVER the old one, which stays solid underneath — no blank cell, no
// faded cell. Until all nine first stills are in, the episode's own art stands
// in. Nothing advances under prefers-reduced-motion, while the page is hidden,
// or while the rail is scrolled out of view. The rail's size is fixed by CSS
// aspect ratios, so nothing moves when the images land. `badge` (the runtime)
// sits on the thumbnail's corner.

let _logger;
const logger = () => { if (!_logger) _logger = getLogger().child({ component: 'episode-stills-rail' }); return _logger; };

const reducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// shown[c] / under[c]: the index (into cell c's pool) on top, and the one it
// replaced, still solid beneath while the new one fades in.
const initialGrid = { live: false, tick: 0, shown: [], under: [] };

function gridReducer(state, action) {
  if (action.type === 'live') {
    return { live: true, tick: 0, shown: action.shown, under: action.shown.map(() => null) };
  }
  if (action.type === 'tick' && state.live) {
    const cell = cellForTick(state.tick);
    const target = nextFrame(action.pools[cell], state.shown[cell], action.status);
    const ready = target != null && action.status[action.pools[cell][target]] === 'loaded';
    if (!ready) return { ...state, tick: state.tick + 1 };
    const shown = [...state.shown];
    const under = [...state.under];
    under[cell] = shown[cell];
    shown[cell] = target;
    return { ...state, tick: state.tick + 1, shown, under };
  }
  return state;
}

function StillsGrid({ episodeKey, pools, intervalMs, visible, onLive }) {
  const [status, setStatus] = useState({}); // src -> 'loaded' | 'failed'
  const [grid, dispatch] = useReducer(gridReducer, initialGrid);
  const statusRef = useRef(status);
  statusRef.current = status;
  const motion = !reducedMotion();

  const mark = useCallback((src, result) => {
    setStatus((s) => (s[src] === result ? s : { ...s, [src]: result }));
    if (result === 'failed') {
      logger().sampled('fitness.show.still_failed', { episode: episodeKey, src }, { maxPerMinute: 10, aggregate: true });
    }
  }, [episodeKey]);
  // A still of one flat colour (fade to black, blank screen) is passed over.
  const onPreloaded = useCallback((src, img) => {
    if (isFlatLuma(sampleLuma(img))) {
      logger().sampled('fitness.show.still_flat', { episode: episodeKey, src }, { maxPerMinute: 10, aggregate: true });
      setStatus((s) => ({ ...s, [src]: 'failed' }));
      return;
    }
    mark(src, 'loaded');
  }, [episodeKey, mark]);

  // Before the grid goes live: each cell's first still that has not failed.
  const firsts = useMemo(
    () => pools.map((pool) => pool.findIndex((src) => status[src] !== 'failed')),
    [pools, status],
  );
  const allFirstsLoaded = !grid.live && firsts.every((i, c) => i >= 0 && status[pools[c][i]] === 'loaded');
  useEffect(() => {
    if (!allFirstsLoaded) return;
    dispatch({ type: 'live', shown: firsts });
    logger().debug('fitness.show.stills_grid_live', { episode: episodeKey, stills: pools.reduce((n, p) => n + p.length, 0) });
  }, [allFirstsLoaded, firsts, episodeKey, pools]);

  useEffect(() => {
    onLive(grid.live);
    return () => onLive(false);
  }, [grid.live, onLive]);

  const playing = grid.live && visible && motion;
  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => dispatch({ type: 'tick', pools, status: statusRef.current }), intervalMs);
    return () => clearInterval(t);
  }, [playing, intervalMs, pools]);

  // What to have loading now, hidden: the nine first stills until the grid is
  // live, then the still the next tick will want.
  let preload = [];
  if (!grid.live) {
    preload = firsts.map((i, c) => (i >= 0 ? pools[c][i] : null)).filter((src) => src && !status[src]);
  } else if (motion) {
    const cell = cellForTick(grid.tick);
    const target = nextFrame(pools[cell], grid.shown[cell], status);
    const src = target != null ? pools[cell][target] : null;
    if (src && status[src] !== 'loaded') preload = [src];
  }
  preload = [...new Set(preload)];

  return (
    <>
      {grid.live && (
        <div className="episode-rail__mosaic" data-testid="episode-mosaic">
          {pools.map((pool, c) => {
            const top = pool[grid.shown[c]];
            const below = grid.under[c] != null ? pool[grid.under[c]] : null;
            return (
              <div className="episode-rail__cell" key={c} data-cell={c} data-frame={grid.shown[c]}>
                {below && below !== top && <img key={below} className="episode-rail__still is-under" src={below} alt="" />}
                <img
                  key={top}
                  className={`episode-rail__still is-over${below && below !== top ? ' is-fresh' : ''}`}
                  src={top}
                  alt=""
                />
              </div>
            );
          })}
        </div>
      )}
      {preload.map((src) => (
        <img
          key={src}
          className="episode-rail__preload"
          src={src}
          alt=""
          aria-hidden="true"
          onLoad={(event) => onPreloaded(src, event.currentTarget)}
          onError={() => mark(src, 'failed')}
        />
      ))}
    </>
  );
}

export default function EpisodeStillsRail({ episode, seasonImage, episodeImage, badge = null, intervalMs = CELL_MS }) {
  const { stills } = useEpisodeStills(episode);
  const pools = useMemo(() => cellPools(stills, CELLS), [stills]);
  const ready = pools.length === CELLS;
  const [visible, setVisible] = useState(true);
  const [live, setLive] = useState(false);
  const railRef = useRef(null);
  const stillKey = ready ? stills.join('|') : '';
  const episodeKey = episode ? String(episode.plex || episode.id || '') : '';

  // Pause when the tab is hidden or the rail is off screen.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    let onScreen = true;
    const update = () => setVisible(onScreen && document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    let observer = null;
    if (typeof IntersectionObserver === 'function' && railRef.current) {
      observer = new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; update(); });
      observer.observe(railRef.current);
    }
    return () => { document.removeEventListener('visibilitychange', update); observer?.disconnect(); };
  }, []);

  return (
    <div className="episode-rail" ref={railRef} data-testid="episode-rail">
      <div className="episode-rail__poster">
        {seasonImage && <img src={seasonImage} alt="" />}
      </div>
      <div className={`episode-rail__carousel${live ? ' is-live' : ''}`} data-state={live ? 'live' : 'art'}>
        <div className="episode-rail__art">
          {episodeImage && <img src={episodeImage} alt="" />}
        </div>
        {ready && <StillsGrid key={stillKey} episodeKey={episodeKey} pools={pools} intervalMs={intervalMs} visible={visible} onLive={setLive} />}
        {badge && <span className="episode-rail__badge">{badge}</span>}
      </div>
    </div>
  );
}
