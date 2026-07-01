import React, { useCallback, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { computeGoto, debugCueState, DEFAULT_LEAD_SEC } from '../../../lib/Player/filterDebug.js';

/**
 * FilterDebugHud — a QA overlay for authoring/verifying content-filter EDLs
 * (see docs/_wip/plans/2026-06-30-content-filter-layer-design.md §6). Mounted only
 * when ?filter-debug=1. Pinned bottom-left above <FilterOverlay>, it shows the
 * cue currently firing (or the next armed one), a live countdown, and ◀/▶ buttons
 * that seek LEAD seconds before the prev/next cue so you watch each filter arm.
 *
 * Built for cue authoring: the cue id is a click-to-copy pill and 📋 copies a full
 * `id | category | in–out | effect` descriptor for pasting into an EDL. The whole
 * panel is text-selectable. Fixed width — no reflow jitter as content changes.
 *
 * Live playhead is sampled from getMediaEl() on requestAnimationFrame and only
 * re-renders when displayed values change. Pure cue math is in lib/Player/filterDebug.js.
 */

let _logger;
const logger = () => (_logger ||= getChildLogger({ component: 'content-filter-debug' }));

const fmt = (s) => (Number.isFinite(s) ? s.toFixed(2) : '—');
const secs = (s) => (Number.isFinite(s) ? `${s.toFixed(1)}s` : '—');

// One glyph per registered effect (see lib/Player/filterEffects.js).
const EFFECT_ICON = {
  skip: '⏭️',
  'skip-card': '🎬',
  mute: '🔇',
  bleep: '📢',
  blur: '🌫️',
  'full-blur': '🌑',
  'censor-bar': '⬛',
  pixelate: '🔲',
  'title-card': '🪧',
};
const effectIcon = (e) => EFFECT_ICON[e] || '🎛️';

// A stable key for the current display so we skip setState on unchanged frames.
const tenth = (v) => (v == null ? '' : (Math.round(v * 10) / 10).toFixed(1));
function snapshotKey(s) {
  return [
    s.focus?.id ?? 'none',
    s.firing ? 'fire' : 'arm',
    tenth(s.countdownSec),   // ticks while armed
    tenth(s.firingLeftSec),  // ticks while firing
    s.index,
    s.total,
    s.canPrev ? 1 : 0,
    s.canNext ? 1 : 0,
  ].join('|');
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

export function FilterDebugHud({ getMediaEl, transport, effectiveCues, lead = DEFAULT_LEAD_SEC, theme = {} }) {
  const [state, setState] = useState(() => debugCueState(effectiveCues, 0, lead));
  const [copied, setCopied] = useState(null); // 'id' | 'full' | null
  const keyRef = useRef('');
  const copyTimer = useRef(null);

  useEffect(() => {
    logger().info?.('filter.debug.mounted', { cues: effectiveCues?.length || 0, lead });
    return () => logger().info?.('filter.debug.unmounted', {});
  }, [effectiveCues?.length, lead]);

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

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

  const doCopy = useCallback(async (kind, cue) => {
    if (!cue) return;
    const text = kind === 'id'
      ? String(cue.id ?? '')
      : `${cue.id ?? '?'} | ${cue.category || cue.effect} | ${fmt(cue.in)}–${fmt(cue.out)} (${(cue.out - cue.in).toFixed(2)}s) | ${cue.effect}`;
    const ok = await copyToClipboard(text);
    logger().info?.('filter.debug.copy', { kind, cue: cue.id, ok });
    if (ok) {
      setCopied(kind);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(null), 1100);
    }
  }, []);

  const { focus, firing, countdownSec, firingLeftSec, index, total, canPrev, canNext } = state;

  const accent = firing ? '#ff5252' : (theme.debugAccent || '#2a9d8f');

  const navBtn = (enabled, onClick, label, glyph) => (
    <button
      type="button"
      aria-label={label}
      onClick={enabled ? onClick : undefined}
      style={{
        cursor: enabled ? 'pointer' : 'default',
        opacity: enabled ? 1 : 0.25,
        background: 'rgba(255,255,255,0.08)',
        border: '1px solid rgba(255,255,255,0.22)',
        color: '#fff',
        borderRadius: '0.3em',
        width: '2em',
        height: '1.7em',
        fontSize: '0.95em',
        lineHeight: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
      }}
    >{glyph}</button>
  );

  const dim = { opacity: 0.62 };

  return (
    <div
      className="filter-debug-hud"
      data-firing={firing ? '1' : '0'}
      style={{
        position: 'absolute',
        left: '1.1em',
        bottom: '1.1em',
        // Above <FilterOverlay> (zIndex 50) so a firing blur/censor/full-blur cue
        // doesn't cover or blur the HUD you're using to debug it.
        zIndex: 60,
        boxSizing: 'border-box',
        // `.video-player > div` (Player.scss) forces width/height:100% on direct
        // children — pin an explicit, FIXED width so the panel never reflows/jitters
        // as content changes (the old min/max range let it snap between widths).
        width: '19em',
        maxWidth: 'calc(100vw - 2.2em)',
        height: 'auto',
        padding: '0.6em 0.7em',
        borderRadius: '0.5em',
        borderLeft: `3px solid ${accent}`,
        background: 'rgba(12,12,14,0.82)',
        backdropFilter: 'blur(3px)',
        color: '#fff',
        fontFamily: theme.font || 'Roboto Condensed, system-ui, sans-serif',
        fontSize: '0.8rem',
        lineHeight: 1.4,
        letterSpacing: '0.01em',
        userSelect: 'text',
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.28em',
      }}
    >
      {/* Header — prev · effect · next */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4em' }}>
        {navBtn(canPrev, () => goto('prev'), 'Seek before previous filter', '◀')}
        <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.35em', fontWeight: 700, color: accent }}>
          <span style={{ fontSize: '1.05em' }}>{firing ? '🔴' : (focus ? '⏳' : '✓')}</span>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {focus ? `${effectIcon(focus.effect)} ${focus.effect}` : (total ? 'done' : 'no cues')}
          </span>
        </span>
        {navBtn(canNext, () => goto('next'), 'Seek before next filter', '▶')}
      </div>

      {focus && (
        <>
          {/* Cue id — its own row so it's never squeezed. Pill copies the id;
              📋 copies the full descriptor. Both flash ✓. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45em' }}>
            <code
              onClick={() => doCopy('id', focus)}
              title="Click to copy cue id"
              style={{
                cursor: 'pointer',
                flex: '0 1 auto',
                minWidth: 0,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '0.95em',
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.18)',
                borderRadius: '0.3em',
                padding: '0.05em 0.5em',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >{focus.id ?? '?'}</code>
            <button
              type="button"
              onClick={() => doCopy('full', focus)}
              title="Copy id · category · timing · effect"
              style={{
                cursor: 'pointer',
                flex: '0 0 auto',
                background: 'transparent',
                border: 'none',
                color: '#fff',
                padding: '0 0.1em',
                fontSize: '0.95em',
                lineHeight: 1,
              }}
            >📋</button>
            {copied && (
              <span style={{ color: '#8ce6c0', fontWeight: 700, fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                ✓ {copied === 'id' ? 'id' : 'cue'}
              </span>
            )}
          </div>

          {/* Category path (selectable, dim) */}
          <div style={{ ...dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {focus.category || focus.effect}
          </div>

          {/* Timing + optional meta */}
          <div style={{ ...dim, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            ⏱ {fmt(focus.in)}–{fmt(focus.out)} · {(focus.out - focus.in).toFixed(2)}s
            {[focus.sound && `🔈 ${focus.sound}`, focus.severity && `⚠️ ${focus.severity}`, focus.precision]
              .filter(Boolean).map((m) => `  ·  ${m}`).join('')}
          </div>

          {/* Live state — countdown while armed, remaining while firing */}
          <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {firing
              ? <span style={{ color: accent }}>🔴 {secs(firingLeftSec)} left</span>
              : <span>⏳ arms in {secs(countdownSec)}</span>}
          </div>
        </>
      )}

      {/* Footer — position in EDL + lead */}
      <div style={{ ...dim, fontSize: '0.9em' }}>
        {total ? `${index || '–'} / ${total}` : 'no cues'} · lead {lead}s
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
