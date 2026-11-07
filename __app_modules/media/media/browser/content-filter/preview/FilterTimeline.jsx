/**
 * FilterTimeline — the preview surround's bottom bar (`content-filter-timeline`).
 * Marks for every resolved cue on the file clock, a playhead, click-to-seek and
 * ◀ ▶ cue stepping (a scene's pieces are one stop). Mouse-only: plain buttons.
 */
import React, { useEffect, useMemo } from 'react';
import { useFilterPreview, previewStore, PREVIEW_LEAD_SEC } from './previewStore.js';
import { prevCueBefore, nextCueAfter } from '../filterDebug.js';
import { getChildLogger } from '../../../../../../frontend/src/lib/logging/singleton.js';
import './FilterTimeline.scss';

const TICK = new Set(['mute', 'bleep']);
const pct = (v) => `${Math.max(0, Math.min(100, v * 100))}%`;

function markClass(cue) {
  if (TICK.has(cue.effect)) return 'is-tick';
  if (cue.scene != null && cue.effect === 'blackout') return 'is-block is-blackout';
  if (cue.scene != null && cue.effect === 'skip-card') return 'is-block is-skip';
  return 'is-bar';
}

/** Cues sorted by in, one stop per scene (its first piece). */
export function stepStops(cues) {
  const seen = new Set();
  const out = [];
  for (const c of [...(cues || [])].filter((x) => Number.isFinite(x.in)).sort((a, b) => a.in - b.in)) {
    if (c.scene != null) {
      const sid = String(c.scene);
      if (seen.has(sid)) continue;
      seen.add(sid);
    }
    out.push(c);
  }
  return out;
}

export default function FilterTimeline({ position = 0, duration = 0 }) {
  const snap = useFilterPreview();
  const logger = useMemo(() => getChildLogger({ app: 'content-filter', component: 'filter-timeline' }), []);
  useEffect(() => { logger.debug('filter-timeline.mounted', {}); return () => logger.debug('filter-timeline.unmounted', {}); }, [logger]);

  const dur = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const cues = snap.cues || [];
  const stops = useMemo(() => stepStops(cues), [cues]);
  // Jumps land PREVIEW_LEAD_SEC before the cue, so "next" looks past that lead
  // too — otherwise ▶ right after a jump would re-select the same stop.
  const prev = prevCueBefore(stops, position, PREVIEW_LEAD_SEC);
  const next = nextCueAfter(stops, position + PREVIEW_LEAD_SEC);

  const onBarClick = (e) => {
    if (!dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (!r || !r.width) return;
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    previewStore.seekTo(frac * dur);
    logger.info('filter-timeline.seek', { seconds: frac * dur });
  };
  const step = (dir, cue) => {
    if (!cue) return;
    previewStore.jumpToCue(cue);
    logger.info('filter-timeline.step', { dir, id: cue.id, in: cue.in });
  };

  return (
    <div className="filter-timeline">
      <button type="button" className="filter-timeline__btn" aria-label="Previous cue" disabled={!prev} onClick={() => step('prev', prev)}>◀</button>
      <div className="filter-timeline__bar" data-testid="filter-timeline-bar" onClick={onBarClick}>
        {dur ? cues.filter((c) => Number.isFinite(c.in)).map((c, i) => {
          const w = Number.isFinite(c.out) ? Math.max(0, (c.out - c.in) / dur) : 0;
          const block = markClass(c).includes('is-block');
          return (
            <span
              key={`${c.id}:${i}`}
              data-testid="filter-timeline-mark"
              className={`filter-timeline__mark ${markClass(c)}`}
              style={{ left: pct(c.in / dur), ...(block ? { width: pct(w) } : {}) }}
            />
          );
        }) : null}
        {dur ? <span className="filter-timeline__playhead" style={{ left: pct(position / dur) }} /> : null}
      </div>
      <button type="button" className="filter-timeline__btn" aria-label="Next cue" disabled={!next} onClick={() => step('next', next)}>▶</button>
    </div>
  );
}
