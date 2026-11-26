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
 * Real progress (`progress`, 0..1): a shared video being fetched. The lines
 * then follow the bytes instead of the per-play motion, and the dots slow when
 * no bytes have come for a while — a real stall, not a drawn one. `failed`
 * pulls the lines back and dims the logo.
 *
 * No words: the logo and the joining lines say it. Phases come from
 * useSceneTimeline (driven by the Player's intro stage). Reference: __docs/reference/media/provenance.md
 */
import React, { useEffect, useId, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { makeLinkPlan, keyframesCss, REACH_PERCENT } from './linkCurve.js';
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

/** Real progress that has not moved for this long reads as a stall (the dots slow). */
export const PROGRESS_STALL_MS = 2500;

/**
 * The dots' mood under real progress: `stalled` once it has not moved for
 * PROGRESS_STALL_MS, `resumed` briefly when it moves again, else null.
 */
export function useProgressStalls(progress, active, stallMs = PROGRESS_STALL_MS) {
  const [mood, setMood] = useState(null);
  useEffect(() => {
    if (!active) { setMood(null); return undefined; }
    setMood((m) => (m === 'stalled' ? 'resumed' : m));
    const timers = [
      setTimeout(() => setMood((m) => (m === 'resumed' ? null : m)), RESUMED_MS),
      setTimeout(() => setMood('stalled'), stallMs),
    ];
    return () => timers.forEach(clearTimeout);
  }, [progress, active, stallMs]);
  return active ? mood : null;
}

/** Line and dot colour when the answer names none (config `services[].accent`). */
export const DEFAULT_ACCENT = '#ffffff'; // data-color: default service accent

export function ProvenanceHandoff({ phase, provenance, linkMs = null, progress = null, failed = false, random = Math.random }) {
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
  const real = typeof progress === 'number' && Number.isFinite(progress);
  const planMood = useLinkStalls(plan.stalls, linking && !real);
  const progressMood = useProgressStalls(progress, linking && real && !failed);
  const mood = failed ? null : (real ? progressMood : planMood);
  if (!provenance?.logoUrl) return null;
  const accent = /^#[0-9a-f]{3,8}$/i.test(provenance.accent || '') ? provenance.accent : DEFAULT_ACCENT;
  // The per-play animation applies only while linking; from `linked` on the
  // SCSS drops the animation and the lines close the gap.
  // Under real progress the lines are as long as the bytes say (the SCSS
  // transition eases each step); a failure pulls them back.
  const reach = (name) => {
    if (!linking) return undefined;
    if (failed) return { animation: 'none', width: 0 };
    if (real) return { animation: 'none', width: `${Math.max(0, Math.min(1, progress)) * REACH_PERCENT}%` };
    return { animationName: name };
  };
  return (
    <div
      className={`provenance-handoff provenance-handoff--${phase}${mood ? ` provenance-handoff--${mood}` : ''}${failed ? ' provenance-handoff--failed' : ''}`}
      style={{ '--ph-accent': accent, ...(linkMs ? { '--ph-link-ms': `${linkMs}ms` } : {}) }}
      data-provider={provenance.provider}
      aria-hidden="true"
    >
      {real ? null : <style>{css}</style>}
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
    provider: PropTypes.string, accent: PropTypes.string, logoUrl: PropTypes.string, plate: PropTypes.bool, secondaryUrls: PropTypes.arrayOf(PropTypes.string),
  }),
  /** How long the video is held (5-10 s, random per play): the lines take that long to reach in. */
  linkMs: PropTypes.number,
  /** Real progress 0..1 (a shared video being fetched): the lines follow it instead of the per-play motion. */
  progress: PropTypes.number,
  /** The fetch failed: the lines pull back and the logo dims. */
  failed: PropTypes.bool,
  /** Random source for the per-play motion (injectable for tests). */
  random: PropTypes.func,
};
