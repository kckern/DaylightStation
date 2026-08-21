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
// without throwing" renders `children` inside a shell that generates NO BOX —
// `display: contents`, no class, no attributes — so an un-enriched page lays out
// exactly as a bare player does. That is asserted in the spec, not assumed.
//
// WHY A NO-BOX SHELL AND NOT "NO WRAPPER AT ALL"
// ---------------------------------------------
// The host learns an item is enriched from a poll, i.e. AFTER the player is
// already mounted. The original design rendered `children` bare and then moved
// them inside the frame — a different depth in the React tree, which is a
// remount, which reloads the <video>: one audible restart about a second into
// every enriched item. `children` now sit at ONE fixed depth for the whole
// session (SurroundStage → SurroundFrame → shell → media box), so engaging or
// dropping the frame is a style change, never a re-parenting.
//
// WHY POLLING
// -----------
// `Player` publishes nothing; it exposes an imperative handle. The established
// way to read it is a poll — `publishers/usePlayerSessionBinding.js` +
// `playerSessionBridge.js` do exactly this at 1 Hz for fleet-view session state.
// This host copies that cadence. A queue advance is therefore visible within a
// second, which is well inside the gap between two segments of anything.
//
// WHERE THE CLOCK LIVES
// ---------------------
// In `SurroundStage`, which is now mounted for every item (constant depth) but
// runs its clock only while the frame is on: when inactive it is handed a
// media-element getter that returns null, so nothing is attached, no rVFC loop
// runs and no 10 Hz React sampling happens. An un-enriched item costs the 1 Hz
// poll and the clock's idle supervisor, and nothing else.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import getLogger from '../../lib/logging/Logger.js';
import { useMediaClockState } from '../../lib/Player/useMediaClock.js';
import SurroundFrame from './SurroundFrame.jsx';
import { resolveContentId, railContentId } from './segments.js';
import { useSurroundSetting, SURROUND_OFF } from './SurroundSettingContext.js';
// Side-effect import: registers segment-map / cue-ticker / composer-card, so
// neither seam needs a registration call of its own.
import './builtins.js';

/** Matches the session bridge's 1 Hz cadence. */
const DEFAULT_POLL_MS = 1000;

/** Handed to the clock while the frame is off: attaches to nothing, ticks nothing. */
const NO_MEDIA = () => null;

/**
 * The slots a definition can fill, in the order the frame lays them out.
 *
 * IT IS THE SLOTS THE FRAME RENDERS, and it has to stay that way: naming a slot
 * here that `SurroundFrame` does not lay out would put a module in this event
 * that never mounts — a smaller version of the exact lie this helper was written
 * to end. (`overlay` was dropped when the inert overlay layer was deleted.)
 */
const REGION_SLOTS = Object.freeze(['top', 'right', 'bottom']);

/**
 * Every module the shipped definition actually mounts, in layout order.
 *
 * THE MOUNT LOG USED TO LIE. It read `regions.right?.module` — a single object —
 * and `right` has been a LIST since the rail gained its carousel, so the rail's
 * modules vanished from the event; `top` was never included at all. For six
 * waves `surround.mount` reported the band and nothing else, and nobody noticed
 * because logs are read when something breaks and this one only ever ran when
 * things worked. Both shapes are legal in a definition (`SurroundFrame`'s own
 * `normalizeRegions` accepts either), so this reads them the same way the frame
 * does rather than the way one slot happened to be authored.
 */
export function definitionModules(definition) {
  const regions = definition?.regions;
  if (!regions || typeof regions !== 'object') return [];
  return REGION_SLOTS.flatMap((slot) => {
    const value = regions[slot];
    if (!value) return [];
    return (Array.isArray(value) ? value : [value])
      .map((r) => (r && typeof r === 'object' ? r.module : null))
      .filter((m) => typeof m === 'string' && m);
  });
}

/** The backend omits the key entirely when there is no sidecar — test truthiness. */
function resolveSurround(item) {
  const s = item && typeof item === 'object' ? item.surround : null;
  return (s && typeof s === 'object' && !Array.isArray(s)) ? s : null;
}

/**
 * Clock owner and per-item lifecycle. Mounted for EVERY item — enriched or not —
 * because it sits on the path down to `children` and that path must never change
 * shape. `active` is what turns the frame and the clock on; the per-item logs are
 * keyed on `contentId` by effect dependency rather than by a React `key`, because
 * a `key` here would remount the player on every queue advance.
 */
function SurroundStage({ contentId, surround, active, mode, logger, getMediaEl, getPlayerHandle, children }) {
  const { position, duration, playing, seeking } = useMediaClockState({
    getMediaEl: active ? getMediaEl : NO_MEDIA,
    contentId,
    logger,
  });

  useEffect(() => {
    if (!active) return undefined;
    const startedAt = Date.now();
    logger.info('surround.mount', {
      contentId,
      surroundId: surround?.id ?? null,
      mode,
      modules: definitionModules(surround?.definition),
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
    // One pair per (item, active) span. `surround` is stable for the life of an
    // item, so it is deliberately not a dependency.
  }, [active, contentId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!active) return undefined;
    const handler = (e) => {
      const t = e?.detail?.seconds;
      if (!Number.isFinite(t)) return;
      const targetId = e?.detail?.contentId;
      const crossItem = targetId && contentId && String(targetId) !== String(contentId);
      logger.info('surround.seek', {
        seconds: t, targetContentId: targetId ?? null,
        currentContentId: contentId, crossItem,
      });
      if (crossItem) {
        const handle = getPlayerHandle?.();
        if (handle?.seekToItem) {
          handle.seekToItem(targetId, t);
          return;
        }
      }
      const el = getMediaEl?.();
      if (el) el.currentTime = t;
    };
    document.addEventListener('surround-seek', handler);
    return () => document.removeEventListener('surround-seek', handler);
  }, [active, getMediaEl, getPlayerHandle, contentId, logger]);

  const onModuleError = (error) => {
    logger.error('surround.render.error', {
      contentId,
      surroundId: surround?.id ?? null,
      error: String(error?.message ?? error),
    });
  };

  // THE FRAME OWNS THE CHROME: while the surround is active for this item, the
  // Player it wraps always renders the focused/minimal shader — no dispatch
  // parameter required, and no exception for whatever shader the launch path
  // asked for. `cloneElement` preserves `children`'s type and key, so this is a
  // prop update on the existing element, never a remount (constant depth, see
  // module header). Inactive/un-enriched items pass `children` through
  // untouched, so nothing about today's shader behaviour changes for them.
  const framedChildren = active && React.isValidElement(children)
    ? React.cloneElement(children, { forceShader: 'focused' })
    : children;

  return (
    <SurroundFrame
      active={active}
      data={surround}
      contentId={contentId}
      position={position}
      duration={duration}
      playing={playing}
      seeking={seeking}
      logger={logger}
      onModuleError={onModuleError}
    >
      {framedChildren}
    </SurroundFrame>
  );
}

SurroundStage.propTypes = {
  contentId: PropTypes.string,
  surround: PropTypes.object,
  active: PropTypes.bool,
  mode: PropTypes.string,
  logger: PropTypes.object.isRequired,
  getMediaEl: PropTypes.func.isRequired,
  getPlayerHandle: PropTypes.func,
  children: PropTypes.node,
};

/**
 * @param {object} props
 * @param {() => (object|null)} props.getPlayerHandle — returns the Player's
 *   imperative handle (or null). Called on every poll, so an inline arrow over a
 *   ref is fine and expected.
 * @param {string|object} [props.contentId] — what the SEAM was asked to play
 *   (`play` / `queue`). Used only to correlate logs before the first poll lands;
 *   the poll remains the source of truth for what is actually on screen.
 * @param {object} [props.logger] — override for the host logger. Tests inject a
 *   spy; production leaves it undefined and gets the durable session child.
 * @param {number} [props.pollMs]
 * @param {React.ReactNode} props.children — the player.
 */
export default function SurroundHost({
  getPlayerHandle,
  contentId = null,
  logger = null,
  pollMs = DEFAULT_POLL_MS,
  children,
}) {
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
      const surround = resolveSurround(item);
      // Not `resolveContentId` alone: on a container the item's own id may be
      // the container's, and the rail matches segments on the PART's.
      // `railContentId` prefers the queue's own pairing and falls back to the id.
      const nextId = railContentId(item, surround);
      const surroundId = surround?.id ?? null;
      if (nextId === seen.contentId && surroundId === seen.surroundId) return;

      hostLogger.debug('surround.item-change', {
        contentId: nextId,
        from: seen.contentId,
        to: nextId,
        enriched: !!surround,
        surroundId,
      });
      seen = { contentId: nextId, surroundId };
      // New object only on a real change — the surround reference is therefore
      // stable for the life of the item, which is what keeps the frame's payload
      // memo from rebuilding on every 10 Hz tick.
      setCurrent({ contentId: nextId, surround });
    };

    read();
    const timer = setInterval(read, pollMs > 0 ? pollMs : DEFAULT_POLL_MS);
    return () => clearInterval(timer);
    // `readHandle` reads through a ref, so it is deliberately not a dependency.
  }, [disabled, pollMs, hostLogger, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // The frame is on for exactly one reason: the backend attached a payload to
  // the item, and the screen did not say 'off'.
  const active = !disabled && !!current.surround;

  // The seam's id is a hint for log correlation only, and only until the poll
  // resolves the real one.
  const seamId = useMemo(() => resolveContentId(contentId), [contentId]);

  return (
    <SurroundStage
      contentId={current.contentId ?? seamId}
      surround={current.surround}
      active={active}
      mode={mode}
      logger={hostLogger}
      getMediaEl={() => readHandle()?.getMediaElement?.() ?? null}
      getPlayerHandle={readHandle}
    >
      {children}
    </SurroundStage>
  );
}

SurroundHost.propTypes = {
  getPlayerHandle: PropTypes.func,
  contentId: PropTypes.oneOfType([PropTypes.string, PropTypes.number, PropTypes.object]),
  logger: PropTypes.object,
  pollMs: PropTypes.number,
  children: PropTypes.node,
};
