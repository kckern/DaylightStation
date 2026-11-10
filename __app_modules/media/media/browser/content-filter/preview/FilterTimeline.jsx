/**
 * FilterTimeline — the preview surround's bottom bar (`content-filter-timeline`).
 *
 * Two lanes, like an editor's tracks: SOUND (muted and bleeped words) above
 * PICTURE (blurred, hidden). A skip cuts both, so it spans both lanes. Each kind
 * has a colour AND a shape (tick, bar, block, hatch), named in the legend with
 * its count.
 *
 * Pointing at the track shows the time under the pointer; pointing at a mark
 * shows what it is (word / visual / scene), its tag, what the viewer gets, its
 * start–end and "click to jump". Click a mark: it is selected (the rail opens its
 * rulings) and playback jumps to PREVIEW_LEAD_SEC before it. Click anywhere else:
 * seek there. Previous / Next step one stop at a time (a scene's pieces are one
 * stop). Mouse-only by design: nothing here is reachable from a remote.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useFilterPreview, previewStore, PREVIEW_LEAD_SEC } from './previewStore.js';
import { prevCueBefore, nextCueAfter } from '../filterDebug.js';
import { getChildLogger } from '../../../../../../frontend/src/lib/logging/singleton.js';
import {
  KINDS, KIND_ORDER, kindOf, effectChip, effectSentence, sourceOf, categoryText, clock, lengthText, rowLabel,
} from './effectKinds.js';
import { uniqueUnits, wordUnits } from '../filterSummary.js';
import './contentFilterTheme.scss';
import './FilterTimeline.scss';

const pct = (v) => `${Math.max(0, Math.min(100, v * 100))}%`;
/** How close (CSS px) the pointer must be to a mark to point at it. */
const HIT_PX = 6;

/** Legacy shape classes (kept for callers and tests) plus the kind class. */
function markClass(cue) {
  const kind = kindOf(cue.effect);
  let shape = 'is-bar';
  if (kind === 'words') shape = 'is-tick';
  else if (cue.effect === 'blackout') shape = 'is-block is-blackout';
  else if (cue.scene != null && cue.effect === 'skip-card') shape = 'is-block is-skip';
  else if (kind === 'hidden' || kind === 'skipped') shape = 'is-block';
  return `${shape} is-${kind}`;
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

/**
 * Per kind, for the legend — counted the way the summary counts
 * (`filterSummary.js`): words once per word (tone pieces and mute remainders of
 * one word are one word), everything else once per unit (a scene, a subject
 * group, or a base cue however many keyframe pieces it was split into).
 */
export function kindCounts(cues) {
  const list = (cues || []).filter((c) => Number.isFinite(c.in));
  const counts = { words: 0, picture: 0, hidden: 0, skipped: 0 };
  counts.words = wordUnits(list).reduce((n, w) => n + w.n, 0);
  for (const k of ['picture', 'hidden', 'skipped']) counts[k] = uniqueUnits(list.filter((x) => kindOf(x.effect) === k)).length;
  return counts;
}

/**
 * The mark the pointer is on: within `tolSec` of a cue's span, preferring the
 * pointer's lane, then the nearest. Returns { cue, nearby } or null.
 */
export function markAt(cues, t, tolSec, lane = null) {
  const hits = [];
  for (const c of cues || []) {
    if (!Number.isFinite(c.in)) continue;
    const out = Number.isFinite(c.out) ? c.out : c.in;
    const d = t < c.in ? c.in - t : t > out ? t - out : 0;
    if (d <= tolSec) hits.push({ c, d });
  }
  if (!hits.length) return null;
  const inLane = lane ? hits.filter(({ c }) => {
    const l = KINDS[kindOf(c.effect)].lane;
    return l === 'both' || l === lane;
  }) : hits;
  const pool = inLane.length ? inLane : hits;
  pool.sort((a, b) => a.d - b.d || a.c.in - b.c.in);
  // A scene's pieces count once among the "nearby".
  const others = new Set(hits.filter(({ c }) => c !== pool[0].c && !(c.scene != null && c.scene === pool[0].c.scene))
    .map(({ c }) => (c.scene != null ? `s:${c.scene}` : `c:${c.id}`)));
  return { cue: pool[0].c, nearby: others.size };
}

/** A scene's whole span (all its pieces); a lone cue's own. */
function spanOf(cue, cues) {
  if (cue.scene == null) return { in: cue.in, out: Number.isFinite(cue.out) ? cue.out : cue.in, first: cue };
  const pieces = cues.filter((c) => c.scene === cue.scene && Number.isFinite(c.in));
  const first = pieces.reduce((a, b) => (b.in < a.in ? b : a), cue);
  return { in: first.in, out: Math.max(...pieces.map((p) => (Number.isFinite(p.out) ? p.out : p.in))), first };
}

function isSelected(cue, sel) {
  if (!sel) return false;
  if (sel.kind === 'scene') return cue.scene != null && String(cue.scene) === String(sel.id);
  return sel.id != null && String(cue.id) === String(sel.id);
}

/** Where a floating label sits so it never runs off the bar's ends. */
const alignAt = (frac) => (frac < 0.2 ? 'start' : frac > 0.8 ? 'end' : 'center');

const Chevron = ({ dir }) => (
  <svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
    <path d={dir === 'prev' ? 'M10 3 5 8l5 5' : 'M6 3l5 5-5 5'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** A stop's name: its tag, a scene's label, else "Violence scene" from its group. */
const stopName = (cue, scenes) => {
  if (!cue) return '';
  if (cue.scene != null) {
    const sc = (scenes || []).find((s) => String(s.id) === String(cue.scene));
    if (sc?.label) return sc.label;
    const what = categoryText(cue.category);
    return what ? `${what} scene` : rowLabel({ effect: cue.effect });
  }
  return rowLabel(cue);
};

export default function FilterTimeline({ position = 0, duration = 0 }) {
  const snap = useFilterPreview();
  const logger = useMemo(() => getChildLogger({ app: 'content-filter', component: 'filter-timeline' }), []);
  useEffect(() => { logger.debug('filter-timeline.mounted', {}); return () => logger.debug('filter-timeline.unmounted', {}); }, [logger]);
  const [hover, setHover] = useState(null); // { frac, t, hit: {cue, nearby} | null }

  const dur = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const cues = useMemo(() => (snap.cues || []).filter((c) => Number.isFinite(c.in)), [snap.cues]);
  const stops = useMemo(() => stepStops(cues), [cues]);
  const counts = useMemo(() => kindCounts(cues), [cues]);
  // Jumps land PREVIEW_LEAD_SEC before the cue, so "next" looks past that lead
  // too — otherwise Next right after a jump would re-select the same stop.
  const prev = prevCueBefore(stops, position, PREVIEW_LEAD_SEC);
  const next = nextCueAfter(stops, position + PREVIEW_LEAD_SEC);

  const pointer = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!dur || !r || !r.width) return null;
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const lane = r.height && Number.isFinite(e.clientY) ? ((e.clientY - r.top) / r.height < 0.5 ? 'sound' : 'picture') : null;
    return { frac, t: frac * dur, lane, tol: (HIT_PX / r.width) * dur };
  };

  const onMove = (e) => {
    const p = pointer(e);
    if (!p) return;
    const hit = markAt(cues, p.t, p.tol, p.lane);
    setHover((h) => {
      if (hit && h?.hit?.cue !== hit.cue) logger.debug('filter-timeline.hover', { id: hit.cue.id, effect: hit.cue.effect });
      return { frac: p.frac, t: p.t, hit };
    });
  };

  const select = (cue) => {
    const span = spanOf(cue, cues);
    previewStore.publish({ selected: cue.scene != null ? { id: String(cue.scene), kind: 'scene', in: span.in } : cue });
    previewStore.jumpToCue(span.first);
    logger.info('filter-timeline.jump', { id: cue.scene != null ? String(cue.scene) : cue.id, in: span.in });
  };

  const onBarClick = (e) => {
    if (!dur) return;
    if (hover?.hit) { select(hover.hit.cue); return; }
    const p = pointer(e);
    if (!p) return;
    previewStore.seekTo(p.t);
    logger.info('filter-timeline.seek', { seconds: p.t });
  };
  const step = (dir, cue) => {
    if (!cue) return;
    previewStore.jumpToCue(cue);
    logger.info('filter-timeline.step', { dir, id: cue.id, in: cue.in });
  };

  const tip = hover?.hit ? (() => {
    const { cue, nearby } = hover.hit;
    const span = spanOf(cue, cues);
    const kind = kindOf(cue.effect);
    return (
      <div className={`filter-timeline__tip is-${alignAt(hover.frac)}`} role="tooltip" data-testid="filter-timeline-tip" style={{ left: pct(hover.frac) }}>
        <div className="filter-timeline__tip-head">
          <span className={`filter-timeline__chip is-${kind}`}>{effectChip(cue.effect)}</span>
          <span className="filter-timeline__tip-source">{sourceOf(cue)}</span>
        </div>
        <div className="filter-timeline__tip-title">{stopName(cue, snap.scenes)}</div>
        {cue.scene == null && categoryText(cue.category) ? <div className="filter-timeline__tip-cat">{categoryText(cue.category)}</div> : null}
        <div className="filter-timeline__tip-what">{effectSentence(cue.effect)}</div>
        <div className="filter-timeline__tip-time">
          {clock(span.in, { precise: true })} to {clock(span.out, { precise: true })}
          {lengthText(span.out - span.in) ? <span className="filter-timeline__tip-len">{lengthText(span.out - span.in)}</span> : null}
        </div>
        <div className="filter-timeline__tip-act">Click to jump here. It plays from {PREVIEW_LEAD_SEC} s before.</div>
        {nearby ? <div className="filter-timeline__tip-more">{nearby} more close by. Step through them with Next.</div> : null}
      </div>
    );
  })() : null;

  const ph = dur ? position / dur : 0;

  return (
    <div className="filter-timeline">
      <div className="filter-timeline__track">
        <div className="filter-timeline__lanes" aria-hidden="true">
          <span>Sound</span>
          <span>Picture</span>
        </div>
        <div
          className={`filter-timeline__bar${hover ? ' is-hovering' : ''}${hover?.hit ? ' is-on-mark' : ''}`}
          data-testid="filter-timeline-bar"
          onClick={onBarClick}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          <span className="filter-timeline__lane is-sound" />
          <span className="filter-timeline__lane is-picture" />
          {dur ? cues.map((c, i) => {
            const w = Number.isFinite(c.out) ? Math.max(0, (c.out - c.in) / dur) : 0;
            const on = hover?.hit && (hover.hit.cue === c || (c.scene != null && c.scene === hover.hit.cue.scene));
            return (
              <span
                key={`${c.id}:${i}`}
                data-testid="filter-timeline-mark"
                className={`filter-timeline__mark ${markClass(c)}${isSelected(c, snap.selected) ? ' is-selected' : ''}${on ? ' is-hot' : ''}`}
                style={{ left: pct(c.in / dur), width: pct(w) }}
              />
            );
          }) : null}
          {dur ? <span className="filter-timeline__playhead" data-testid="filter-timeline-playhead" style={{ left: pct(ph) }} /> : null}
          {hover ? <span className="filter-timeline__scrub" style={{ left: pct(hover.frac) }} /> : null}
          {hover && !hover.hit ? (
            <span className={`filter-timeline__scrub-time is-${alignAt(hover.frac)}`} data-testid="filter-timeline-hover-time" style={{ left: pct(hover.frac) }}>
              {clock(hover.t)}<span className="filter-timeline__scrub-hint">Click to go here</span>
            </span>
          ) : null}
          {tip}
        </div>
      </div>

      <div className="filter-timeline__axis" aria-hidden={!dur}>
        <span className="filter-timeline__axis-end is-start">{clock(0)}</span>
        {dur ? (
          <span className={`filter-timeline__now is-${alignAt(ph)}`} data-testid="filter-timeline-now" style={{ left: pct(ph) }}>
            {clock(position)}
          </span>
        ) : null}
        <span className="filter-timeline__axis-end is-end">{dur ? clock(dur) : ''}</span>
      </div>

      <div className="filter-timeline__foot">
        <div className="filter-timeline__steps">
          <button
            type="button"
            className="filter-timeline__btn"
            aria-label="Previous cue"
            data-cf-hint={prev ? `Back to ${stopName(prev, snap.scenes)} at ${clock(prev.in)}` : 'Nothing earlier'}
            data-cf-hint-align="start"
            disabled={!prev}
            onClick={() => step('prev', prev)}
          >
            <Chevron dir="prev" /><span>Previous</span>
          </button>
          <button
            type="button"
            className="filter-timeline__btn"
            aria-label="Next cue"
            data-cf-hint={next ? `On to ${stopName(next, snap.scenes)} at ${clock(next.in)}` : 'Nothing later'}
            disabled={!next}
            onClick={() => step('next', next)}
          >
            <span>Next</span><Chevron dir="next" />
          </button>
        </div>
        <ul className="filter-timeline__legend" data-testid="filter-timeline-legend" aria-label="What the marks mean">
          {KIND_ORDER.map((k) => (
            <li key={k} className={`filter-timeline__key is-${k}${counts[k] ? '' : ' is-none'}`} data-cf-hint={KINDS[k].legend} data-cf-hint-align="end">
              <span className={`filter-timeline__swatch is-${k}`} aria-hidden="true" />
              <span className="filter-timeline__key-name">{KINDS[k].name}</span>
              <span className="filter-timeline__key-count">{counts[k]}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
