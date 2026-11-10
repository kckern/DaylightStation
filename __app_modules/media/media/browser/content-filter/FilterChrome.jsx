import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { getChildLogger } from "../../../../../frontend/src/lib/logging/singleton.js";

let _logger;
const logger = () => (_logger ||= getChildLogger({ component: 'content-filter' }));

/**
 * FilterChrome — the viewer-facing confidence chrome for a filtered title
 * (spec §2: ops:docs/superpowers/specs/2026-11-06-content-filter-surround-design.md).
 *
 * - FilterBumper: ~4 s over the opening, logo + "Edited for content" + summary.
 * - FilterBadge: small shield bottom-right, ~40% opacity; glows gold while a filter
 *   effect is active. Solid = certified, outline = provisional, crossed = filter
 *   data failed to load (shown so nobody is reassured by an absent filter).
 *
 * Mouse-only: the badge is never focusable (tabIndex -1, no key handler) so the TV
 * remote cannot open it; with `onOpen` it takes pointer events and click opens the preview.
 */
const FADE_MS = 300;
const SHIELD = 'M12 2 4 5v6c0 5.2 3.4 9.4 8 11 4.6-1.6 8-5.8 8-11V5l-8-3z';

export function FilterBumper({ summary, art, theme = {} }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(id); }, []);
  const font = theme.font || 'Roboto Condensed, sans-serif';
  return (
    <div
      className="filter-bumper"
      style={{
        position: 'absolute', left: '50%', bottom: '12%', transform: 'translateX(-50%)',
        minWidth: '32%', maxWidth: '60%', padding: '1em 1.6em', borderRadius: '0.5em',
        background: theme.cardBg || 'rgba(0,0,0,0.82)', color: '#fff', fontFamily: font,
        textAlign: 'center', pointerEvents: 'none',
        opacity: mounted ? 1 : 0, transition: `opacity ${FADE_MS}ms ease`,
      }}
    >
      {art?.logo && !logoFailed && (
        <img src={art.logo} alt="" onError={() => setLogoFailed(true)}
          onLoad={(e) => { if (e.currentTarget.naturalWidth < 300) setLogoFailed(true); }}
          style={{ maxWidth: '70%', maxHeight: '4.5em', objectFit: 'contain', marginBottom: '0.5em' }} />
      )}
      <div style={{ fontSize: '1.35em', letterSpacing: '0.04em' }}>Edited for content</div>
      {summary && <div style={{ fontSize: '0.95em', opacity: 0.8, marginTop: '0.3em' }}>{summary}</div>}
    </div>
  );
}

export function FilterBadge({ state, active = false, onOpen }) {
  const prevActive = useRef(false);
  useEffect(() => {
    if (active && !prevActive.current) {
      logger().sampled?.('content-filter.badge.active', { state }, { maxPerMinute: 10 });
    }
    prevActive.current = active;
  }, [active, state]);

  const solid = state === 'certified';
  const ink = active ? '#ffd54a' : '#fff';
  const clickable = typeof onOpen === 'function';
  const handleClick = clickable ? (e) => { e.stopPropagation(); onOpen(); } : undefined;
  return (
    <div
      data-filter-badge={state}
      data-active={active ? '1' : undefined}
      aria-hidden={clickable ? undefined : 'true'}
      aria-label={clickable ? 'Content filter preview' : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? -1 : undefined}
      onClick={handleClick}
      style={{
        position: 'absolute', right: '2.5%', bottom: '4%', width: 'clamp(16px, 1.5vw, 30px)',
        pointerEvents: clickable ? 'auto' : 'none', cursor: clickable ? 'pointer' : undefined,
        opacity: active ? 1 : 0.4, transition: 'opacity 250ms ease, filter 250ms ease',
        filter: active
          ? 'drop-shadow(0 0 6px rgba(255,213,74,0.9))'
          : 'drop-shadow(0 1px 3px rgba(0,0,0,0.7))',
      }}
    >
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path d={SHIELD} fill={solid ? ink : 'none'} stroke={ink} strokeWidth="1.6" strokeLinejoin="round" />
        {state === 'failed' && <line x1="4" y1="4" x2="20" y2="20" stroke={ink} strokeWidth="2" strokeLinecap="round" />}
      </svg>
    </div>
  );
}

FilterBumper.propTypes = {
  summary: PropTypes.string,
  art: PropTypes.shape({ logo: PropTypes.string, background: PropTypes.string, poster: PropTypes.string }),
  theme: PropTypes.object,
};
FilterBadge.propTypes = {
  state: PropTypes.oneOf(['certified', 'provisional', 'failed']).isRequired,
  active: PropTypes.bool,
  onOpen: PropTypes.func,
};
