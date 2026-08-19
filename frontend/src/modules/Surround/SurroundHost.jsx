// frontend/src/modules/Surround/SurroundHost.jsx
//
// SurroundHost — the seam wrapper. It is mounted around the legacy `Player` at
// the two places playback actually starts (`ScreenPlayer` for WS/URL-triggered
// playback, `MenuStack` for menu-selected playback) and decides, per item,
// whether that player gets a programme frame around it.
//
// THE ONE RULE
// ------------
// The surround can never be the reason something will not play. Every path that
// is not "this item is enriched AND the screen allows it AND the frame rendered
// without throwing" renders `children` DIRECTLY — no wrapper element, no extra
// context, DOM-identical to mounting the player on its own. That identity is
// asserted in the spec, not assumed.
//
// WHY POLLING
// -----------
// `Player` publishes nothing; it exposes an imperative handle. The established
// way to read it is a poll — `publishers/usePlayerSessionBinding.js` +
// `playerSessionBridge.js` do exactly this at 1 Hz for fleet-view session state.
// This host copies that cadence. A queue advance is therefore visible within a
// second, which is well inside the gap between two movements of anything.
//
// WHERE THE CLOCK LIVES
// ---------------------
// Only inside `SurroundStage`, which mounts only when an item is actually
// enriched. An un-enriched item costs one 1 Hz poll and nothing else: no rVFC
// loop, no 10 Hz React sampler, no ResizeObserver. The stage is keyed by
// contentId so the clock, the frame and the mount/unmount log pair all start
// fresh on a queue advance.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import getLogger from '../../lib/logging/Logger.js';
import { useMediaClockState } from '../../lib/Player/useMediaClock.js';
import SurroundFrame from './SurroundFrame.jsx';
import { useSurroundSetting, SURROUND_OFF } from './SurroundSettingContext.js';
// Side-effect import: registers movement-map / cue-ticker / composer-card, so
// neither seam needs a registration call of its own.
import './builtins.js';

/** Matches the session bridge's 1 Hz cadence. */
const DEFAULT_POLL_MS = 1000;

/** Identity keys, in the order `playerSessionBridge.normalizePlayableItem` reads them. */
const ID_KEYS = ['contentId', 'assetId', 'id', 'plex', 'key'];

function resolveContentId(item) {
  if (!item || typeof item !== 'object') return null;
  for (const k of ID_KEYS) {
    const v = item[k];
    if (v != null && String(v).length > 0) return String(v);
  }
  return null;
}

/** The backend omits the key entirely when there is no sidecar — test truthiness. */
function resolveSurround(item) {
  const s = item && typeof item === 'object' ? item.surround : null;
  return (s && typeof s === 'object' && !Array.isArray(s)) ? s : null;
}

/**
 * Error boundary around the frame. A module that throws in render takes the
 * WHOLE frame down and hands the player back bare — the video keeps playing,
 * minus its programme. `fallback` and `children` contain the same player
 * element, so React remounts it one level up; that costs a reload of a broken
 * page's video and is the correct trade against a black screen.
 */
class SurroundErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prevProps) {
    // A new item gets a fresh attempt: the failure belonged to the old payload.
    if (this.state.failed && prevProps.contentId !== this.props.contentId) {
      this.setState({ failed: false });
    }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

SurroundErrorBoundary.propTypes = {
  contentId: PropTypes.string,
  onError: PropTypes.func,
  fallback: PropTypes.node,
  children: PropTypes.node,
};

/**
 * The enriched branch. Owns the 10 Hz clock and the frame. Mounted under a
 * `key` of contentId, so everything here is per-item by construction.
 */
function SurroundStage({ contentId, surround, mode, logger, getMediaEl, children }) {
  const { position, duration, playing, seeking } = useMediaClockState({
    getMediaEl,
    contentId,
    logger,
  });

  const mountedAt = useRef(Date.now());
  useEffect(() => {
    const startedAt = mountedAt.current;
    logger.info('surround.mount', {
      contentId,
      surroundId: surround?.id ?? null,
      mode,
      modules: [
        surround?.definition?.regions?.right?.module,
        ...(Array.isArray(surround?.definition?.regions?.bottom)
          ? surround.definition.regions.bottom.map((r) => r?.module)
          : [surround?.definition?.regions?.bottom?.module]),
      ].filter(Boolean),
    });
    return () => {
      logger.info('surround.unmount', {
        contentId,
        surroundId: surround?.id ?? null,
        // Wall-clock seconds the frame was on screen — not playhead progress, so
        // a paused-and-abandoned item reads as the long session it really was.
        watchedSec: Math.round((Date.now() - startedAt) / 1000),
      });
    };
    // Per-item lifecycle: the `key` above guarantees one pair per contentId.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onError = (error) => {
    logger.error('surround.render.error', {
      contentId,
      surroundId: surround?.id ?? null,
      error: String(error?.message ?? error),
    });
  };

  return (
    <SurroundErrorBoundary contentId={contentId} onError={onError} fallback={children}>
      <SurroundFrame
        data={surround}
        contentId={contentId}
        position={position}
        duration={duration}
        playing={playing}
        seeking={seeking}
        logger={logger}
      >
        {children}
      </SurroundFrame>
    </SurroundErrorBoundary>
  );
}

SurroundStage.propTypes = {
  contentId: PropTypes.string,
  surround: PropTypes.object,
  mode: PropTypes.string,
  logger: PropTypes.object.isRequired,
  getMediaEl: PropTypes.func.isRequired,
  children: PropTypes.node,
};

/**
 * @param {object} props
 * @param {() => (object|null)} props.getPlayerHandle — returns the Player's
 *   imperative handle (or null). Called on every poll, so an inline arrow over a
 *   ref is fine and expected.
 * @param {object} [props.logger] — override for the host logger. Tests inject a
 *   spy; production leaves it undefined and gets the durable session child.
 * @param {number} [props.pollMs]
 * @param {React.ReactNode} props.children — the player.
 */
export default function SurroundHost({ getPlayerHandle, logger = null, pollMs = DEFAULT_POLL_MS, children }) {
  const mode = useSurroundSetting();

  // Created once. `sessionLog: true` lives HERE and nowhere below: the frame and
  // every module re-child from this logger and inherit it, and re-declaring it
  // would double-open the backend session file.
  const hostLogger = useMemo(
    () => logger ?? getLogger().child({ app: 'surround', component: 'surround-host', sessionLog: true }),
    [logger],
  );

  // Latest-ref so a fresh inline closure never restarts the poll.
  const getHandleRef = useRef(getPlayerHandle);
  getHandleRef.current = getPlayerHandle;

  const readHandle = () => {
    try {
      return getHandleRef.current?.() ?? null;
    } catch (_) {
      return null;
    }
  };

  const disabled = mode === SURROUND_OFF;

  const [current, setCurrent] = useState({ contentId: null, surround: null });

  useEffect(() => {
    if (disabled) {
      // The most valuable line in the feature is the one explaining why NOTHING
      // happened: "configured off" and "no sidecar" look identical from outside.
      hostLogger.debug('surround.disabled', { contentId: null, mode });
      return undefined;
    }

    // Tracked outside React state so the poll can compare without re-subscribing.
    let seen = { contentId: null, surroundId: null };

    const read = () => {
      let item = null;
      try {
        item = readHandle()?.getNowPlaying?.()?.item ?? null;
      } catch (_) {
        item = null;
      }
      const contentId = resolveContentId(item);
      const surround = resolveSurround(item);
      const surroundId = surround?.id ?? null;
      if (contentId === seen.contentId && surroundId === seen.surroundId) return;

      hostLogger.debug('surround.item-change', {
        contentId,
        from: seen.contentId,
        to: contentId,
        enriched: !!surround,
        surroundId,
      });
      seen = { contentId, surroundId };
      // New object only on a real change — the surround reference is therefore
      // stable for the life of the item, which is what keeps the frame's payload
      // memo from rebuilding on every 10 Hz tick.
      setCurrent({ contentId, surround });
    };

    read();
    const timer = setInterval(read, pollMs > 0 ? pollMs : DEFAULT_POLL_MS);
    return () => clearInterval(timer);
    // `readHandle` reads through a ref, so it is deliberately not a dependency.
  }, [disabled, pollMs, hostLogger, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // A definition-id mode is a forced definition, which in the PoC still only
  // applies to items the backend already enriched (plan: "Out of scope").
  const active = !disabled && !!current.surround;
  if (!active) return <>{children}</>;

  return (
    <SurroundStage
      key={current.contentId}
      contentId={current.contentId}
      surround={current.surround}
      mode={mode}
      logger={hostLogger}
      getMediaEl={() => readHandle()?.getMediaElement?.() ?? null}
    >
      {children}
    </SurroundStage>
  );
}

SurroundHost.propTypes = {
  getPlayerHandle: PropTypes.func,
  logger: PropTypes.object,
  pollMs: PropTypes.number,
  children: PropTypes.node,
};

export { SurroundErrorBoundary };
