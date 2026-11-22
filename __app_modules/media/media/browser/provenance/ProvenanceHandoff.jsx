/**
 * ProvenanceHandoff — the scene before a title that streams elsewhere: the
 * service's logo on a dark field, two lines reaching in from either side with
 * dots pulsing in the gap; when the film starts the lines meet, the field
 * clears, and the logo shrinks into the top-right corner and fades.
 *
 * The lines' motion is new for every play (linkCurve.js): bursts, stops where
 * the whole link waits (the dots slow and dim, then pick up), and the odd hang
 * on one side.
 *
 * Secondary logos (config `secondary_logos`), when the answer carries any,
 * sit smaller in a row in the bottom third and fade out as the main logo docks.
 *
 * No words: the logo and the joining lines say it. Phases come from
 * useSceneTimeline (driven by the Player's intro stage). Reference: __docs/reference/media/provenance.md
 */
import React, { useEffect, useId, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { makeLinkPlan, keyframesCss } from './linkCurve.js';
import './ProvenanceHandoff.scss';

/** The lines start reaching this long after the scene appears (matches the SCSS delay). */
const REACH_DELAY_MS = 150;
/** How long the dots' pick-up lasts after a stop. */
const RESUMED_MS = 420;

/**
 * The dots' mood while the lines reach: `stalled` during a stop where both
 * sides wait, `resumed` briefly as the link picks up again, else null.
 */
export function useLinkStalls(stalls, active) {
  const [mood, setMood] = useState(null);
  useEffect(() => {
    if (!active || !stalls?.length) { setMood(null); return undefined; }
    const timers = [];
    stalls.forEach(([a, b]) => {
      timers.push(setTimeout(() => setMood('stalled'), REACH_DELAY_MS + a));
      timers.push(setTimeout(() => setMood('resumed'), REACH_DELAY_MS + b));
      timers.push(setTimeout(() => setMood((m) => (m === 'resumed' ? null : m)), REACH_DELAY_MS + b + RESUMED_MS));
    });
    return () => timers.forEach(clearTimeout);
  }, [stalls, active]);
  return active ? mood : null;
}

/** Brand accent for the lines and dots. Unlisted providers use white. */
export const PROVIDER_ACCENTS = Object.freeze({
  netflix: '#e50914',
  'prime-video': '#1399ff',
  hulu: '#1ce783',
  'disney-plus': '#1f80e0',
  'hbo-max': '#5a2ff5',
  'paramount-plus': '#0064ff',
  tubi: '#ffff13',
  'pluto-tv': '#fff200',
  peacock: '#ffffff',
  'apple-tv': '#ffffff',
});

export function ProvenanceHandoff({ phase, provenance, linkMs = null, random = Math.random }) {
  // A fresh motion for every play: bursts, shared stops, a hang on one side.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => makeLinkPlan(linkMs || 2200, random), [linkMs]);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const names = { left: `ph-reach-l-${id}`, right: `ph-reach-r-${id}` };
  const css = useMemo(
    () => keyframesCss(names.left, plan.left) + keyframesCss(names.right, plan.right),
    [plan, names.left, names.right],
  );
  const linking = phase === 'linking';
  const mood = useLinkStalls(plan.stalls, linking);
  if (!provenance?.logoUrl) return null;
  const accent = PROVIDER_ACCENTS[provenance.provider] || '#ffffff';
  // The per-play animation applies only while linking; from `linked` on the
  // SCSS drops the animation and the lines close the gap.
  const reach = (name) => (linking ? { animationName: name } : undefined);
  return (
    <div
      className={`provenance-handoff provenance-handoff--${phase}${mood ? ` provenance-handoff--${mood}` : ''}`}
      style={{ '--ph-accent': accent, ...(linkMs ? { '--ph-link-ms': `${linkMs}ms` } : {}) }}
      data-provider={provenance.provider}
      aria-hidden="true"
    >
      <style>{css}</style>
      <div className="provenance-handoff__field" />
      <div className="provenance-handoff__link">
        <span className="provenance-handoff__line provenance-handoff__line--left" style={reach(names.left)} />
        <span className="provenance-handoff__dots"><i /><i /><i /></span>
        <span className="provenance-handoff__line provenance-handoff__line--right" style={reach(names.right)} />
        <span className="provenance-handoff__spark" />
      </div>
      <div className={`provenance-handoff__badge${provenance.plate ? ' provenance-handoff__badge--plate' : ''}`}>
        <img className="provenance-handoff__logo" src={provenance.logoUrl} alt="" draggable={false} />
      </div>
      {provenance.secondaryUrls?.length ? (
        <div className="provenance-handoff__secondary">
          {provenance.secondaryUrls.map((url) => (
            <img key={url} className="provenance-handoff__secondary-logo" src={url} alt="" draggable={false} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

ProvenanceHandoff.propTypes = {
  phase: PropTypes.oneOf(['linking', 'linked', 'docked', 'leaving']).isRequired,
  provenance: PropTypes.shape({
    provider: PropTypes.string, logoUrl: PropTypes.string, plate: PropTypes.bool, secondaryUrls: PropTypes.arrayOf(PropTypes.string),
  }),
  /** How long the video is held (5-10 s, random per play): the lines take that long to reach in. */
  linkMs: PropTypes.number,
  /** Random source for the per-play motion (injectable for tests). */
  random: PropTypes.func,
};
