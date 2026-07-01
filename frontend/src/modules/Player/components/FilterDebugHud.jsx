import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { computeGoto, debugCueState, DEFAULT_LEAD_SEC } from '../../../lib/Player/filterDebug.js';

/**
 * FilterDebugHud — a QA overlay for authoring/verifying content-filter EDLs
 * (see docs/_wip/plans/2026-06-30-content-filter-layer-design.md §6). Mounted only
 * when ?filter-debug=1. Pinned bottom-left above <FilterOverlay>, it shows the next
 * armed cue (or the one currently FIRING), a live countdown, and ◀/▶ buttons that
 * seek to LEAD seconds before the previous/next cue so you watch each filter arm.
 *
 * Reads live playhead time from getMediaEl() on requestAnimationFrame (smooth,
 * immune to timeupdate throttling) and only re-renders when the displayed values
 * change. Pure cue math lives in lib/Player/filterDebug.js.
 */

let _logger;
const logger = () => (_logger ||= getChildLogger({ component: 'content-filter-debug' }));

const fmt = (s) => (Number.isFinite(s) ? s.toFixed(2) : '—');

// A stable key for the current display so we skip setState on unchanged frames.
function snapshotKey(s) {
  return [
    s.focus?.id ?? 'none',
    s.firing ? 'fire' : 'arm',
    s.countdownSec == null ? '' : (Math.round(s.countdownSec * 10) / 10).toFixed(1),
    s.index,
    s.total,
    s.canPrev ? 1 : 0,
    s.canNext ? 1 : 0,
  ].join('|');
}

export function FilterDebugHud({ getMediaEl, transport, effectiveCues, lead = DEFAULT_LEAD_SEC, theme = {} }) {
  const [state, setState] = useState(() => debugCueState(effectiveCues, 0, lead));
  const keyRef = useRef('');

  useEffect(() => {
    logger().info?.('filter.debug.mounted', { cues: effectiveCues?.length || 0, lead });
    return () => logger().info?.('filter.debug.unmounted', {});
  }, [effectiveCues?.length, lead]);

  // rAF loop: sample the playhead and recompute HUD state; commit only on change.
  useEffect(() => {
    let raf = null;
    let stopped = false;
    const frame = () => {
      if (stopped) return;
      const el = getMediaEl?.();
      const t = el && Number.isFinite(el.currentTime) ? el.currentTime : 0;
      const next = debugCueState(effectiveCues, t, lead);
      const key = snapshotKey(next);
      if (key !== keyRef.current) { keyRef.current = key; setState(next); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { stopped = true; if (raf != null) cancelAnimationFrame(raf); };
  }, [getMediaEl, effectiveCues, lead]);

  const goto = useCallback((direction) => {
    const el = getMediaEl?.();
    const t = el && Number.isFinite(el.currentTime) ? el.currentTime : 0;
    const g = computeGoto(effectiveCues, t, direction, lead);
    if (!g) { logger().debug?.('filter.debug.goto-noop', { direction, from: t }); return; }
    if (el) el.__seekSource = 'filter-debug'; // distinguish in logs; skip recovery heuristics
    transport?.seek?.(g.targetTime);
    logger().info?.('filter.debug.goto', {
      direction,
      fromTime: Math.round(t * 100) / 100,
      toTime: Math.round(g.targetTime * 100) / 100,
      cue: g.cue.id,
      category: g.cue.category,
      effect: g.cue.effect,
      cueIn: g.cue.in,
    });
  }, [getMediaEl, transport, effectiveCues, lead]);

  const { focus, firing, countdownSec, index, total, canPrev, canNext } = state;

  const accent = firing ? '#ff5252' : (theme.debugAccent || '#2a9d8f');
  const label = focus
    ? (firing ? 'FIRING' : 'NEXT')
    : (total ? 'DONE' : 'NO CUES');

  const btn = (enabled) => ({
    pointerEvents: 'auto',
    cursor: enabled ? 'pointer' : 'default',
    opacity: enabled ? 1 : 0.3,
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.25)',
    color: '#fff',
    borderRadius: '0.25em',
    width: '1.9em',
    height: '1.6em',
    fontSize: '1em',
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });

  return (
    <div
      className="filter-debug-hud"
      data-firing={firing ? '1' : '0'}
      style={{
        position: 'absolute',
        left: '1.2em',
        bottom: '1.2em',
        zIndex: 30,
        pointerEvents: 'none',
        // `.video-player > div` (Player.scss) forces width/height:100% on direct
        // children — override to auto so the HUD is a corner panel, not full-screen
        // (same guard .quality-overlay uses).
        width: 'auto',
        height: 'auto',
        minWidth: '16em',
        maxWidth: '22em',
        padding: '0.7em 0.9em',
        borderRadius: '0.4em',
        borderLeft: `3px solid ${accent}`,
        background: 'rgba(0,0,0,0.72)',
        color: '#fff',
        fontFamily: theme.font || 'Roboto Condensed, monospace, sans-serif',
        fontSize: '0.82rem',
        lineHeight: 1.35,
        letterSpacing: '0.01em',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
        <button type="button" aria-label="Previous filter" style={btn(canPrev)}
          onClick={canPrev ? () => goto('prev') : undefined}>◀</button>
        <span style={{ flex: 1, fontWeight: 700, color: accent, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}{focus ? `: ${focus.category || focus.effect}` : ''}
        </span>
        <button type="button" aria-label="Next filter" style={btn(canNext)}
          onClick={canNext ? () => goto('next') : undefined}>▶</button>
      </div>

      {focus && (
        <>
          <div style={{ opacity: 0.85 }}>
            {[focus.effect, focus.sound ? `sfx:${focus.sound}` : null, focus.severity]
              .filter(Boolean).join(' · ')}
          </div>
          <div style={{ opacity: 0.85 }}>
            in {fmt(focus.in)} → out {fmt(focus.out)} ({(focus.out - focus.in).toFixed(2)}s)
          </div>
          <div style={{ marginTop: '0.15em' }}>
            {firing
              ? <span style={{ color: accent, fontWeight: 700 }}>● FIRING</span>
              : <>▸ arming in <b>{countdownSec == null ? '—' : `${countdownSec.toFixed(1)}s`}</b></>}
          </div>
        </>
      )}

      <div style={{ opacity: 0.6, marginTop: '0.2em' }}>
        {total ? `cue ${index || '–'} / ${total}` : 'no cues loaded'}
        {` · lead ${lead}s`}
      </div>
    </div>
  );
}

FilterDebugHud.propTypes = {
  getMediaEl: PropTypes.func.isRequired,
  transport: PropTypes.shape({ seek: PropTypes.func }).isRequired,
  effectiveCues: PropTypes.array,
  lead: PropTypes.number,
  theme: PropTypes.object,
};
