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
 * - FilterBadge: small shield bottom-right, ~40% opacity; brightens briefly each
 *   time a cue fires. Solid = certified, outline = provisional, crossed = filter
 *   data failed to load (shown so nobody is reassured by an absent filter).
 *
 * Display-only in this slice: the badge takes no focus and no pointer events, so
 * D-pad navigation is unchanged. Clicking it to open the preview is slice 3.
 */
const FADE_MS = 300;
const PULSE_MS = 600;
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
          style={{ maxWidth: '70%', maxHeight: '4.5em', objectFit: 'contain', marginBottom: '0.5em' }} />
      )}
      <div style={{ fontSize: '1.35em', letterSpacing: '0.04em' }}>Edited for content</div>
      {summary && <div style={{ fontSize: '0.95em', opacity: 0.8, marginTop: '0.3em' }}>{summary}</div>}
    </div>
  );
}

export function FilterBadge({ state, fireCount }) {
  const [pulse, setPulse] = useState(false);
  const last = useRef(fireCount);
  useEffect(() => {
    if (fireCount === last.current) return undefined;
    last.current = fireCount;
    logger().sampled?.('content-filter.badge.pulse', { fireCount, state }, { maxPerMinute: 10 });
    setPulse(true);
    const id = setTimeout(() => setPulse(false), PULSE_MS);
    return () => clearTimeout(id);
  }, [fireCount]);

  const solid = state === 'certified';
  return (
    <div
      data-filter-badge={state}
      data-pulse={pulse ? '1' : '0'}
      aria-hidden="true"
      style={{
        position: 'absolute', right: '2.5%', bottom: '4%', width: 'clamp(22px, 2.2vw, 44px)',
        pointerEvents: 'none', opacity: pulse ? 0.95 : 0.4, transition: 'opacity 250ms ease',
        filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.7))',
      }}
    >
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path d={SHIELD} fill={solid ? '#fff' : 'none'} stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
        {state === 'failed' && <line x1="4" y1="4" x2="20" y2="20" stroke="#fff" strokeWidth="2" strokeLinecap="round" />}
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
  fireCount: PropTypes.number,
};
